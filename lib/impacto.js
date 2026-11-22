// ─────────────────────────────────────────────────────────────────────────────
// Medição de impacto (para provar o resultado da inovação):
//  • Pesquisa de 1 pergunta: "Isso evitou uma ida ao DETRAN?" (após conferência
//    completa e jornada concluída) → Evento IMPACTO, tema "sim|nao|talvez:<contexto>".
//  • Marcos: conferência com tudo certo → Evento MARCO, tema "conferencia-ok:<serviço>".
//  • Origem: de onde o cidadão veio (?origem=balcao-sede no QR) → Evento ORIGEM.
//  • QR Code e cartaz A4 por ponto de divulgação.
//  • Linha de base e medições periódicas (dados do DETRAN: tempo no balcão,
//    retorno por documento faltante, ligações ao 154, denúncias de golpe).
// Nada aqui guarda dado pessoal: só contagens e rótulos.
// ─────────────────────────────────────────────────────────────────────────────
import QRCode from "qrcode";
import { comTenant, urlImagem } from "./tenants.js";
import { exigir } from "./auth.js";
import { registrarEvento } from "./registro.js";
import { kvSetNxEx, persistente } from "../store.js";
import { cssDoTema } from "./tema.js";
import { liberadoDemo } from "./demo.js";

export const ORIGEM_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CONTEXTO_RE = /^(conferencia|jornada):[a-z0-9-]{1,40}$/;
const RESPOSTAS = new Set(["sim", "nao", "talvez"]);
const sessaoOk = (s) => /^[\w-]{8,64}$/.test(String(s || ""));
export const limparOrigem = (o) => String(o || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

// Campos da linha de base (preenchidos pelo DETRAN; todos opcionais).
export const CAMPOS_BASE = {
  tempoBalcaoMin: "Tempo médio de atendimento no balcão (min)",
  esperaMin: "Tempo médio de espera na fila (min)",
  retornoPct: "Cidadãos que voltam por documento faltante (%)",
  atendimentosMes: "Atendimentos presenciais por mês",
  ligacoesMes: "Ligações ao call center por mês",
  denunciasGolpeMes: "Denúncias de golpe por mês",
};
export function limparMedicao(m) {
  const out = { data: /^\d{4}-\d{2}-\d{2}$/.test(m?.data || "") ? m.data : new Date().toISOString().slice(0, 10) };
  for (const k of Object.keys(CAMPOS_BASE)) {
    const v = m?.[k];
    if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0) out[k] = Math.round(Number(v) * 10) / 10;
  }
  out.fonte = String(m?.fonte || "").slice(0, 200);
  out.obs = String(m?.obs || "").slice(0, 500);
  return out;
}
const chaveBase = (slug) => `impacto:${slug}:medicoes`;
export async function lerMedicoes(slug) {
  try { return JSON.parse((await persistente.get(chaveBase(slug))) || "[]"); } catch { return []; }
}

// Variação entre a linha de base (1ª medição) e a última, por campo.
// "melhor" diz se o número caindo é bom (tempo, retorno, ligações, golpe) ou subindo é bom.
export function compararMedicoes(lista) {
  if (!lista.length) return null;
  const base = lista[0], ultima = lista[lista.length - 1];
  const campos = Object.keys(CAMPOS_BASE).filter((k) => base[k] !== undefined);
  return {
    base: base.data, ultima: ultima.data, mesma: lista.length === 1,
    campos: campos.map((k) => {
      const a = base[k], b = ultima[k];
      const variacao = b === undefined || a === 0 ? null : Math.round(((b - a) / a) * 1000) / 10;
      return { campo: k, rotulo: CAMPOS_BASE[k], base: a, atual: b ?? null, variacao, bom: variacao === null ? null : k === "atendimentosMes" ? null : variacao < 0 };
    }),
  };
}

// Números de impacto a partir dos eventos (usado pelo Observatório e pelo relatório).
export const ESTIMATIVA = { minutosViagem: 120, minutosServidor: 20 };
export function montarImpacto(eventos, { desde = 0 } = {}) {
  const r = { sim: 0, nao: 0, talvez: 0 };
  const porContexto = {};
  let conferenciasOk = 0, jornadasConcluidas = 0, golpesBarrados = 0, lacunasCorrigidas = 0;
  const origens = {};
  for (const e of eventos) {
    if (new Date(e.criadoEm).getTime() < desde) continue;
    if (e.tipo === "IMPACTO" && e.tema) {
      const [resp, ...ctx] = String(e.tema).split(":");
      if (resp in r) r[resp]++;
      const c = ctx.join(":") || "outros";
      (porContexto[c] ||= { sim: 0, nao: 0, talvez: 0 })[resp] = ((porContexto[c] || {})[resp] || 0) + 1;
    } else if (e.tipo === "MARCO" && String(e.tema).startsWith("conferencia-ok")) conferenciasOk++;
    else if (e.tipo === "JORNADA" && String(e.tema).endsWith(":fim")) jornadasConcluidas++;
    else if (e.tipo === "GOLPE" && e.tema === "golpe") golpesBarrados++;
    else if (e.tipo === "TUTORIA" && e.tema === "ensinou") lacunasCorrigidas++;
    else if (e.tipo === "ORIGEM" && e.tema) origens[e.tema] = (origens[e.tema] || 0) + 1;
  }
  const respostas = r.sim + r.nao + r.talvez;
  const viagensEvitadas = r.sim;
  return {
    viagensEvitadas, respostas, respostasDetalhe: r,
    taxaEvitou: respostas ? Math.round((r.sim / respostas) * 100) : null,
    conferenciasOk, jornadasConcluidas, golpesBarrados, lacunasCorrigidas,
    horasCidadao: Math.round((viagensEvitadas * ESTIMATIVA.minutosViagem) / 6) / 10,
    horasServidor: Math.round((viagensEvitadas * ESTIMATIVA.minutosServidor) / 6) / 10,
    estimativa: ESTIMATIVA,
    porContexto: Object.entries(porContexto).map(([contexto, v]) => ({ contexto, ...v })).sort((a, b) => b.sim - a.sim),
    origens: Object.entries(origens).map(([origem, n]) => ({ origem, n })).sort((a, b) => b.n - a.n),
  };
}

// ── QR e cartaz ──
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
export const linkComOrigem = (base, slug, origem) => `${base}/${slug}${origem ? `?origem=${encodeURIComponent(origem)}` : ""}`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cartazHtml(t, { link, svg, local }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Cartaz — ${esc(t.assistente || "Assistente " + t.sigla)}</title>
${cssDoTema(t)}
<style>
@page { size: A4; margin: 0; }
* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1B2236; background: #F4F6FA; }
.folha { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; display: flex; flex-direction: column; }
.topo { background: var(--ayio-grad, var(--ayio-navy)); color: #fff; padding: 16mm 16mm 12mm; display: flex; gap: 8mm; align-items: center; }
.topo img { width: 26mm; height: 26mm; object-fit: contain; background: #fff; border-radius: 6mm; padding: 2mm; }
.topo small { display: block; font-size: 12pt; opacity: .9; letter-spacing: .04em; text-transform: uppercase; }
.topo h1 { margin: 2mm 0 0; font-size: 26pt; line-height: 1.1; }
main { padding: 12mm 16mm; flex: 1; display: grid; grid-template-columns: 1fr 78mm; gap: 10mm; align-items: start; }
h2 { font-size: 22pt; line-height: 1.15; margin: 0 0 6mm; color: var(--ayio-navy); }
ul { margin: 0; padding-left: 6mm; font-size: 14pt; line-height: 1.55; } li { margin-bottom: 2mm; }
.qr { text-align: center; } .qr svg { width: 78mm; height: 78mm; display: block; }
.qr b { display: block; font-size: 14pt; margin-top: 3mm; color: var(--ayio-navy); }
.qr span { display: block; font-size: 9pt; color: #4E5870; word-break: break-all; margin-top: 1mm; }
.aviso { margin: 0 16mm 10mm; padding: 5mm 6mm; border-radius: 4mm; background: #FFF6E0; color: #5C4400; font-size: 12pt; }
footer { padding: 6mm 16mm 12mm; font-size: 10pt; color: #4E5870; display: flex; justify-content: space-between; gap: 6mm; }
.acoes { text-align: center; padding: 10px; } .acoes button { font: 600 15px system-ui; padding: 10px 18px; border-radius: 10px; border: 0; background: #192662; color: #fff; cursor: pointer; }
@media print { body { background: #fff; } .acoes { display: none; } .folha { margin: 0; } }
@media screen and (max-width: 820px) { .folha { width: 100%; min-height: 0; } main { grid-template-columns: 1fr; padding: 18px; gap: 18px; } .qr svg { width: min(78mm, 100%); height: auto; aspect-ratio: 1; margin: 0 auto; } .topo, footer, .aviso { padding-left: 18px; padding-right: 18px; } }
</style></head><body>
<div class="acoes"><button onclick="window.print()">Imprimir ou salvar em PDF</button></div>
<div class="folha">
  <header class="topo"><img src="${esc(urlImagem(t, "marca"))}" alt=""><div><small>${esc(t.nome || t.sigla)}</small><h1>${esc(t.assistente || "Assistente " + t.sigla)}</h1></div></header>
  <main><div>
    <h2>Tire suas dúvidas de CNH, veículo e multas antes de vir ao balcão</h2>
    <ul>
      <li><b>Confira seus documentos</b> pela foto e evite voltar outro dia.</li>
      <li><b>Passo a passo</b> para vender o carro, renovar a CNH ou recorrer de multa, com os prazos.</li>
      <li><b>É golpe?</b> Cole a mensagem ou o boleto e confira antes de pagar.</li>
      <li>Atende 24 horas, de graça, em linguagem simples, com tradução em Libras.</li>
    </ul></div>
    <div class="qr">${svg}<b>Aponte a câmera do celular</b><span>${esc(link)}</span></div>
  </main>
  <div class="aviso">⚠️ O ${esc(t.sigla)} não cobra por mensagem nem manda link de pagamento pelo WhatsApp. Pagamentos só pelo portal oficial${t.portalUrl ? `: ${esc(String(t.portalUrl).replace(/^https?:\/\//, ""))}` : ""}.</div>
  <footer><span>${esc(t.governo || "")}</span><span>${local ? `Ponto: ${esc(local)}` : ""}</span></footer>
</div></body></html>`;
}

export function registrarImpacto(app, { limitar } = {}) {
  const T = "/api/t/:slug";

  // Pesquisa de 1 pergunta (cidadão; sem login). Uma resposta por sessão e contexto.
  app.post(`${T}/impacto`, comTenant, async (req, res) => {
    const { contexto, resposta, sessao } = req.body || {};
    if (!CONTEXTO_RE.test(String(contexto || "")) || !RESPOSTAS.has(resposta) || !sessaoOk(sessao)) return res.status(400).json({ error: "Resposta inválida." });
    if (limitar && limitar(`impacto:${req.tenant.slug}:${req.ip}`, 20)) return res.status(429).json({ error: "Aguarde um instante." });
    const nova = await kvSetNxEx(`impacto:${req.tenant.slug}:${sessao}:${contexto}`, "1", 30 * 86400).catch(() => true);
    if (nova) await registrarEvento({ tenantId: req.tenant.id, tipo: "IMPACTO", canal: "WEB", tema: `${resposta}:${contexto}`.slice(0, 60) });
    res.json({ ok: true, registrado: Boolean(nova) });
  });

  // Marco: conferência com tudo certo (uma vez por sessão e serviço).
  app.post(`${T}/impacto/marco`, comTenant, async (req, res) => {
    const servico = String(req.body?.servico || ""), sessao = req.body?.sessao;
    if (!/^[a-z0-9-]{1,40}$/.test(servico) || !sessaoOk(sessao)) return res.status(400).json({ error: "Dados inválidos." });
    if (limitar && limitar(`marco:${req.tenant.slug}:${req.ip}`, 20)) return res.status(429).json({ error: "Aguarde um instante." });
    const nova = await kvSetNxEx(`marco:${req.tenant.slug}:${sessao}:${servico}`, "1", 30 * 86400).catch(() => true);
    if (nova) await registrarEvento({ tenantId: req.tenant.id, tipo: "MARCO", canal: "WEB", tema: `conferencia-ok:${servico}`.slice(0, 60) });
    res.json({ ok: true });
  });

  // Origem do acesso (QR do balcão, site oficial, redes...). Uma vez por sessão.
  app.post(`${T}/origem`, comTenant, async (req, res) => {
    const origem = limparOrigem(req.body?.origem), sessao = req.body?.sessao;
    if (!ORIGEM_RE.test(origem) || !sessaoOk(sessao)) return res.status(400).json({ error: "Origem inválida." });
    if (limitar && limitar(`origem:${req.tenant.slug}:${req.ip}`, 20)) return res.status(429).json({ error: "Aguarde um instante." });
    const nova = await kvSetNxEx(`origem:${req.tenant.slug}:${sessao}`, origem, 30 * 86400).catch(() => true);
    if (nova) await registrarEvento({ tenantId: req.tenant.id, tipo: "ORIGEM", canal: "WEB", tema: origem });
    res.json({ ok: true });
  });

  // QR Code (SVG) do link com origem. Público: só codifica um endereço do próprio site.
  app.get(`${T}/qr.svg`, comTenant, async (req, res) => {
    const origem = limparOrigem(req.query.origem);
    if (req.query.origem && !ORIGEM_RE.test(origem)) return res.status(400).send("origem inválida");
    const svg = await QRCode.toString(linkComOrigem(baseUrl(req), req.tenant.slug, origem), { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A1549", light: "#FFFFFF" } });
    res.set({ "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" }).send(svg);
  });

  // Cartaz A4 para imprimir (/:slug/cartaz?origem=balcao-sede&local=Balcão da sede).
  app.get("/:slug/cartaz", async (req, res, next) => {
    const { buscarTenant } = await import("./tenants.js");
    const t = await buscarTenant(String(req.params.slug || "").toLowerCase()).catch(() => null);
    if (!t) return next();
    if (t.demonstracao && !liberadoDemo(req, t)) return res.status(403).send("Demonstração restrita.");
    const origem = limparOrigem(req.query.origem);
    const link = linkComOrigem(baseUrl(req), t.slug, ORIGEM_RE.test(origem) ? origem : "");
    const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0A1549", light: "#FFFFFF" } });
    res.set({ "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" }).send(cartazHtml(t, { link, svg, local: String(req.query.local || "").slice(0, 80) }));
  });

  // Linha de base e medições periódicas (gestor/admin).
  app.get(`${T}/gestao/impacto/medicoes`, comTenant, exigir("painel"), async (req, res) => {
    const lista = await lerMedicoes(req.tenant.slug);
    res.json({ campos: CAMPOS_BASE, medicoes: lista, comparacao: compararMedicoes(lista) });
  });
  app.post(`${T}/gestao/impacto/medicoes`, comTenant, exigir("painel"), async (req, res) => {
    const m = limparMedicao(req.body || {});
    if (Object.keys(CAMPOS_BASE).every((k) => m[k] === undefined)) return res.status(400).json({ error: "Informe pelo menos um número." });
    const lista = (await lerMedicoes(req.tenant.slug)).filter((x) => x.data !== m.data);
    lista.push({ ...m, registradoPor: req.usuario.uid, em: new Date().toISOString() });
    lista.sort((a, b) => a.data.localeCompare(b.data));
    await persistente.set(chaveBase(req.tenant.slug), JSON.stringify(lista.slice(-36)));
    res.json({ ok: true, medicoes: lista, comparacao: compararMedicoes(lista) });
  });
  app.delete(`${T}/gestao/impacto/medicoes/:data`, comTenant, exigir("painel"), async (req, res) => {
    const lista = (await lerMedicoes(req.tenant.slug)).filter((x) => x.data !== req.params.data);
    await persistente.set(chaveBase(req.tenant.slug), JSON.stringify(lista));
    res.json({ ok: true, medicoes: lista, comparacao: compararMedicoes(lista) });
  });
}
