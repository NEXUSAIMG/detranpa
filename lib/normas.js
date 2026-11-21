// Monitor de normas: detecta resoluções novas do CONTRAN publicadas no gov.br e
// avisa na Tutoria de cada DETRAN. Nada entra na base sozinho: a equipe abre a
// norma e decide "incluir na base" (o sistema baixa o PDF e manda para o bot),
// "já está na base" ou "ignorar".
//
// Como detecta: os arquivos seguem o padrão resolucao<N><ANO>.pdf na pasta de
// resoluções do Ministério dos Transportes. A rotina diária testa os próximos
// números depois do último conhecido (poucas requisições leves por dia).
import { kvGetStr, kvSetEx } from "../store.js";

export const BASE_RES = (process.env.CONTRAN_RES_URL || "https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/").replace(/\/?$/, "/");
const ULTIMA_PADRAO = Number(process.env.CONTRAN_ULTIMA_CONHECIDA || 1032); // carregadas na base em nov/2026
const PADROES = ["resolucao", "Resolucao", "Resoluo"];
const K_ULTIMA = "normas:contran:ultima";
const K_NOVAS = "normas:contran:novas";
const K_DEC = (slug) => `normas:${slug}:decisoes`;
const UM_ANO = 400 * 86400;

const lerJson = async (k, padrao) => { try { const v = await kvGetStr(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } };

async function existe(url, fetchImpl) {
  try {
    const r = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15000) });
    return r.status === 200;
  } catch { return false; }
}

// Procura até `janela` números depois do último conhecido, neste ano e no anterior.
export async function verificarNormas({ fetchImpl = fetch, agora = new Date(), janela = 6 } = {}) {
  const ultima = Number(await kvGetStr(K_ULTIMA).catch(() => null)) || ULTIMA_PADRAO;
  const novas = await lerJson(K_NOVAS, []);
  const anos = [agora.getFullYear(), agora.getFullYear() - 1];
  let maior = ultima, falhasSeguidas = 0;
  const achadas = [];
  for (let n = ultima + 1; n <= ultima + janela && falhasSeguidas < 3; n++) {
    let achou = null;
    for (const ano of anos) {
      for (const p of PADROES) {
        const url = `${BASE_RES}${p}${n}${ano}.pdf`;
        if (await existe(url, fetchImpl)) { achou = { numero: n, ano, url }; break; }
      }
      if (achou) break;
    }
    if (achou) {
      falhasSeguidas = 0; maior = n;
      if (!novas.some((x) => x.numero === n)) { achadas.push(achou); novas.unshift({ ...achou, detectadaEm: agora.toISOString() }); }
    } else falhasSeguidas++;
  }
  if (maior !== ultima) await kvSetEx(K_ULTIMA, String(maior), UM_ANO).catch(() => {});
  if (achadas.length) await kvSetEx(K_NOVAS, JSON.stringify(novas.slice(0, 50)), UM_ANO).catch(() => {});
  return { ultimaConhecida: maior, novas: achadas.map((a) => `${a.numero}/${a.ano}`) };
}

// Lista para um DETRAN: o que foi detectado e o que a equipe já decidiu.
export async function normasDoTenant(slug) {
  const [novas, dec] = await Promise.all([lerJson(K_NOVAS, []), lerJson(K_DEC(slug), {})]);
  return novas.map((x) => ({ ...x, titulo: `Resolução CONTRAN nº ${x.numero}/${x.ano}`, decisao: dec[x.numero] || null }));
}

export async function decidirNorma(slug, numero, decisao, autor) {
  const dec = await lerJson(K_DEC(slug), {});
  if (decisao) dec[numero] = { decisao, autor: autor || null, em: new Date().toISOString() };
  else delete dec[numero];
  await kvSetEx(K_DEC(slug), JSON.stringify(dec), UM_ANO);
  return dec[numero] || null;
}

// Baixa o PDF oficial (só da pasta de resoluções do gov.br).
export async function baixarNorma(norma, { fetchImpl = fetch } = {}) {
  if (!String(norma?.url || "").startsWith(BASE_RES)) throw new Error("Endereço da norma fora do site oficial.");
  const r = await fetchImpl(`${norma.url}/@@download/file`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Não consegui baixar a norma (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200 || buf.slice(0, 4).toString() !== "%PDF") throw new Error("O arquivo baixado não é um PDF.");
  if (buf.length > 8 * 1024 * 1024) throw new Error("A norma é grande demais para importar automaticamente.");
  return buf;
}
