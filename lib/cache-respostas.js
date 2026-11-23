// ─────────────────────────────────────────────────────────────────────────────
// Cache das perguntas frequentes + medição do tempo de resposta.
//
// Só entra no cache a PRIMEIRA pergunta de uma conversa, sem foto, sem dados
// pessoais (Meu DETRAN/simulação ficam de fora), sem transbordo e com resposta
// da base. A chave leva a "versão da base" do DETRAN: ensinar algo na Tutoria
// troca a versão e invalida tudo na hora. Validade: 6 horas (24 h no pré-aquecimento).
//
// Perguntas parecidas (22/11/2026): a chave usa a FORMA CANÔNICA da pergunta —
// sem acentos, sem palavras vazias, com radical simples e em ordem alfabética —
// para "Como renovo a CNH?" e "renovação da carteira de motorista" caírem na
// mesma resposta. Números e letras de categoria são preservados (A ≠ B).
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { kvGetStr, kvSetEx, anotarLinha, lerLinhas } from "../store.js";

const VALIDADE = 6 * 3600;
const ANO = 365 * 86400;
export const normalizarPergunta = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const chaveVersao = (slug) => `cache:${slug}:versao`;

async function versao(slug) { return (await kvGetStr(chaveVersao(slug)).catch(() => null)) || "0"; }
const VAZIAS = new Set("a o as os um uma uns umas de da do das dos em na no nas nos para pra pro por pelo pela com sem que qual quais como onde quando quanto quanta quantos quantas e ou se eu meu minha meus minhas me mim voce voces seu sua ao aos à é e ser estar esta isso isto este essa esse aquele preciso precisa precisar posso pode poder fazer faco faz devo deve tenho tem ter gostaria queria quero saber sobre favor ola oi bom dia tarde noite obrigado por favor detran pa ai la ja".split(" "));
const SINONIMOS = [[/carteira de motorista|carteira nacional de habilitacao|carteira de habilitacao|habilitacao/g, "cnh"], [/\bcarro\b|\bautomovel\b/g, "veiculo"]];
const radical = (w) => (w.length <= 4 || /\d|^cat_/.test(w) ? w : w.replace(/(acoes|acao|encias?|amento|imento|aria|arios?|ados?|adas?|ar|er|ir|ou|ei|amos|ando|endo|os|as|es|o|a|s)$/, "") || w);
export function formaCanonica(p) {
  let s = normalizarPergunta(p);
  for (const [re, por] of SINONIMOS) s = s.replace(re, por);
  s = s.replace(/\bcategoria\s+([a-e])\b/g, "cat_$1");
  const toks = [...new Set(s.split(" ").filter((w) => w && !VAZIAS.has(w)).map(radical))].sort();
  return toks.join(" ");
}
const chave = (slug, ver, pergunta) => `cache:${slug}:${ver}:${createHash("sha256").update(process.env.CACHE_SEMELHANTE === "0" ? normalizarPergunta(pergunta) : "c2:" + formaCanonica(pergunta)).digest("hex").slice(0, 32)}`;

// Pergunta que pode ir para o cache: curta, sem números longos (CPF, placa,
// telefone, protocolo) e sem e-mail.
export function cacheavel(pergunta, { ignorarDesligado = false } = {}) {
  if (process.env.CACHE_RESPOSTAS === "0" && !ignorarDesligado) return false; // desligado (ex.: testes ponta a ponta)
  const p = String(pergunta || "");
  return p.length >= 6 && p.length <= 200 && !/\d{5,}|@|[a-z]{3}\d[a-z0-9]\d{2}/i.test(p.replace(/\s/g, ""));
}

export async function lerCache(slug, pergunta) {
  if (!cacheavel(pergunta)) return null;
  try {
    const v = await kvGetStr(chave(slug, await versao(slug), pergunta));
    const d = v ? JSON.parse(v) : null;
    // 22/11/2026: respostas de falha guardadas durante a queda da IA não voltam ao cidadão.
    return d && !RESPOSTA_DE_FALHA.test(d.reply || "") ? d : null;
  } catch { return null; }
}
const RESPOSTA_DE_FALHA = /tive um problema para responder agora/i;
export async function guardarCache(slug, pergunta, dados, { horas } = {}) {
  if (!cacheavel(pergunta) || /\d{8,}/.test(dados?.reply || "") || RESPOSTA_DE_FALHA.test(dados?.reply || "") || formaCanonica(pergunta).length < 3) return false;
  try { await kvSetEx(chave(slug, await versao(slug), pergunta), JSON.stringify(dados), horas ? horas * 3600 : VALIDADE); return true; } catch { return false; }
}
// Chamado quando a base muda (Tutoria ensinou, desligou, subiu documento, norma).
export async function invalidarCache(slug) {
  try { await kvSetEx(chaveVersao(slug), String(Date.now()), ANO); } catch (e) { console.error(`[cache:${slug}] não invalidou:`, e.message); }
}

// ── Tempo de resposta (últimas 300 por DETRAN) ──
const chaveTempos = (slug) => `lat:${slug}`;
export async function registrarTempo(slug, ms, origem) {
  // Uma linha por resposta (só INSERT); somem sozinhas em 8 dias.
  try { await anotarLinha(`${chaveTempos(slug)}:l`, [Math.round(ms), origem === "cache" ? 1 : 0, Date.now()], 8 * 86400); }
  catch { /* medição é acessória */ }
}
export async function resumoTempos(slug) {
  let lista = []; try { lista = await lerLinhas(`${chaveTempos(slug)}:l`, 1000); } catch { lista = []; }
  const desde = Date.now() - 7 * 86400000;
  const ms = lista.filter((x) => x[2] >= desde).map((x) => x[0]).sort((a, b) => a - b);
  if (!ms.length) return { n: 0 };
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
  return { n: ms.length, medianaMs: q(0.5), p95Ms: q(0.95), abaixo8s: Math.round((ms.filter((x) => x <= 8000).length / ms.length) * 100), doCache: lista.filter((x) => x[2] >= desde && x[1]).length };
}
