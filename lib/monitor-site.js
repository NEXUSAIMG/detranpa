// Monitor do site oficial do DETRAN (25/11/2026).
//
// Todo dia a rotina baixa as páginas oficiais escolhidas pela equipe (taxas,
// documentos, procedimentos) e compara o TEXTO com a última versão. Se mudou,
// a Tutoria mostra o aviso com o trecho que entrou e o que saiu, para a equipe
// decidir: atualizar a base do bot (ensinar/corrigir) ou marcar "sem impacto".
// Nada entra na base sozinho.
//
// Só páginas https do próprio portal do DETRAN (mesmo domínio do portal
// cadastrado). Até 20 páginas por DETRAN. Guardado no KV, uma chave por página.
//
//   GET    /api/t/<slug>/gestao/tutoria/site            -> páginas e avisos
//   POST   /api/t/<slug>/gestao/tutoria/site/paginas    { url }
//   DELETE /api/t/<slug>/gestao/tutoria/site/paginas?url=
//   POST   /api/t/<slug>/gestao/tutoria/site/verificar
//   POST   /api/t/<slug>/gestao/tutoria/site/decidir    { url, acao: "revisado" | "sem_impacto" | "desfazer" }
import { createHash, X509Certificate } from "node:crypto";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { comTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";

const MAX_PAGINAS = 20;
const MAX_BYTES = 2_000_000;
const MAX_TEXTO = 60_000;
const UM_ANO = 400 * 86400;
const kIdx = (slug) => `site:${slug}:urls`;
const kPag = (slug, url) => `site:${slug}:p:${createHash("sha1").update(url).digest("hex")}`;
const lerJson = async (k, padrao) => { try { const v = await kvGetStr(k); return v ? JSON.parse(v) : padrao; } catch { return padrao; } };

// Domínio-base do portal: "www.detran.pa.gov.br" -> "detran.pa.gov.br".
export function dominioPortal(t) {
  try { return new URL(t.portalUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
// URL aceita? https, no domínio do portal (ou subdomínio), sem credenciais nem porta estranha.
export function urlPermitida(t, u) {
  const base = dominioPortal(t);
  if (!base) return null;
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null;
    const h = x.hostname.toLowerCase();
    if (h !== base && !h.endsWith("." + base)) return null;
    x.hash = "";
    return x.toString();
  } catch { return null; }
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ordm: "º", ordf: "ª", deg: "°", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decodificar = (s) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : " "; }
  return ENT[e.toLowerCase()] ?? m;
});
// Linhas que mudam sozinhas (relógio, contador de visitas, "atualizado em") não contam.
const RUIDO = /^(\d{1,2}[/:.-]\d{1,2}([/:.-]\d{2,4})?\s*)+$|acess(os|ou)|visitas?\b|atualizad[oa] em|publicad[oa] em|última modificação|ultima modificacao|cookies?|todos os direitos/i;

// HTML -> linhas de texto visível (uma por bloco).
export function textoDaPagina(html) {
  const corpo = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr|\/div|\/section|\/article|\/dt|\/dd|\/td|\/th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const vistas = new Set();
  const linhas = [];
  for (const bruta of decodificar(corpo).split("\n")) {
    const l = bruta.replace(/\s+/g, " ").trim();
    if (l.length < 3 || RUIDO.test(l) || vistas.has(l)) continue;
    vistas.add(l); linhas.push(l);
  }
  return linhas.join("\n").slice(0, MAX_TEXTO);
}
const hashTexto = (s) => createHash("sha256").update(s).digest("hex");

// O que entrou e o que saiu (por linha, até 15 de cada).
export function diferencas(antes, depois) {
  const a = new Set(String(antes || "").split("\n")), b = new Set(String(depois || "").split("\n"));
  const corta = (l) => (l.length > 300 ? l.slice(0, 297) + "…" : l);
  return {
    entrou: [...b].filter((l) => l && !a.has(l)).slice(0, 15).map(corta),
    saiu: [...a].filter((l) => l && !b.has(l)).slice(0, 15).map(corta),
  };
}
const tituloDe = (html) => decodificar((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim().slice(0, 140);

// ── HTTPS com cadeia completada (25/11/2026) ──
// Alguns portais (ex.: detran.pa.gov.br) mandam só o certificado do site, sem o
// intermediário. O navegador busca o intermediário no endereço indicado no próprio
// certificado (AIA); o Node não. Aqui fazemos o mesmo: baixamos o intermediário,
// conferimos que é de autoridade (CA) e repetimos a conexão com ele. A verificação
// continua ligada: a cadeia inteira tem de fechar numa raiz confiável do Node.
const intermediarios = new Map(); // host -> PEM
const lerCorpo = (res, max) => new Promise((ok, falha) => {
  const partes = []; let n = 0;
  res.on("data", (c) => { n += c.length; if (n > max) { res.destroy(); falha(new Error("Página grande demais para conferir.")); } else partes.push(c); });
  res.on("end", () => ok(Buffer.concat(partes)));
  res.on("error", falha);
});
function obter(url, { ca, max = MAX_BYTES, timeout = 15000, headers = {} } = {}) {
  const u = new URL(url);
  const mod = u.protocol === "http:" ? http : https;
  return new Promise((ok, falha) => {
    const req = mod.get(u, { headers, timeout, ...(ca ? { ca } : {}) }, async (res) => {
      try { ok({ status: res.statusCode, headers: res.headers, corpo: await lerCorpo(res, max) }); } catch (e) { falha(e); }
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("O site demorou demais para responder."), { name: "TimeoutError" })));
    req.on("error", falha);
  });
}
async function intermediarioDe(host) {
  if (intermediarios.has(host)) return intermediarios.get(host);
  const aia = await new Promise((ok) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => {
      const c = s.getPeerCertificate(); s.end(); ok((c?.infoAccess?.["CA Issuers - URI"] || [])[0] || null);
    });
    s.on("error", () => ok(null)); s.on("timeout", () => { s.destroy(); ok(null); });
  });
  if (!aia || !/^https?:\/\//i.test(aia) || /^https?:\/\/(\d+\.){3}\d+|localhost|\.internal|\.local\b/i.test(aia)) return null;
  const r = await obter(aia, { max: 20000, timeout: 10000 }).catch(() => null);
  if (!r || r.status !== 200) return null;
  try {
    const der = r.corpo.toString("latin1").startsWith("-----BEGIN") ? r.corpo.toString() : r.corpo;
    const x = new X509Certificate(der);
    if (!x.ca) return null;
    intermediarios.set(host, x.toString());
    return x.toString();
  } catch { return null; }
}
// fetch "de bolso" (só o que o monitor usa), com a cadeia completada quando faltar.
export async function baixarHttps(url, { headers } = {}) {
  const host = new URL(url).hostname;
  const comCa = (pem) => (pem ? [...tls.rootCertificates, pem] : undefined);
  let r;
  try { r = await obter(url, { headers, ca: comCa(intermediarios.get(host)) }); }
  catch (e) {
    if (!/UNABLE_TO_VERIFY_LEAF_SIGNATURE|unable to verify the first certificate/i.test(`${e.code} ${e.message}`)) throw e;
    const pem = await intermediarioDe(host);
    if (!pem) throw new Error("O certificado do site está incompleto e não foi possível completá-lo.");
    r = await obter(url, { headers, ca: comCa(pem) });
  }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: (k) => { const v = r.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v ?? null; } }, arrayBuffer: async () => r.corpo };
}

async function baixar(t, url, fetchImpl) {
  // Redirecionamento seguido à mão (até 3), conferindo que continua no portal do DETRAN.
  let atual = url, r = null;
  for (let i = 0; i <= 3; i++) {
    r = await fetchImpl(atual, { redirect: "manual", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "AssistenteDETRAN-Monitor/1.0 (aviso de mudancas para a equipe do DETRAN)", Accept: "text/html,application/pdf;q=0.8,*/*;q=0.5" } });
    if (r.status < 300 || r.status >= 400) break;
    const prox = urlPermitida(t, new URL(r.headers.get("location") || "", atual).toString());
    if (!prox) throw new Error("A página redirecionou para fora do portal do DETRAN.");
    if (i === 3) throw new Error("Redirecionamentos demais.");
    atual = prox;
  }
  if (!r.ok) throw new Error(`O site respondeu ${r.status}.`);
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Página grande demais para conferir.");
  if (tipo.includes("pdf") || buf.slice(0, 4).toString() === "%PDF") return { pdf: true, hash: hashTexto(buf.toString("base64")), texto: "", titulo: "" };
  const html = buf.toString("utf8");
  const texto = textoDaPagina(html);
  // Página "casca" de aplicativo (Vue/React): o texto chega depois, por JavaScript.
  const semTexto = texto.split("\n").filter(Boolean).length < 3 && /<div[^>]+id=["'](app|root|__next|__nuxt)["']/i.test(html);
  return { pdf: false, hash: hashTexto(texto), texto, titulo: tituloDe(html), semTexto };
}

export async function paginasDoTenant(t) {
  let urls = await lerJson(kIdx(t.slug), null);
  if (!urls) { const p = urlPermitida(t, t.portalUrl); urls = p ? [p] : []; }
  const out = [];
  for (const url of urls) out.push({ url, ...(await lerJson(kPag(t.slug, url), {})) });
  return out;
}

// Confere uma página; guarda e devolve o estado.
async function conferir(t, url, agora, fetchImpl) {
  const ant = await lerJson(kPag(t.slug, url), {});
  const st = { ...ant, verificadoEm: agora.toISOString() };
  try {
    const p = await baixar(t, url, fetchImpl);
    st.erro = null; st.falhas = 0;
    if (p.titulo) st.titulo = p.titulo;
    st.pdf = p.pdf;
    st.semTexto = Boolean(p.semTexto);
    if (!ant.hash) { st.hash = p.hash; st.texto = p.texto; st.desde = agora.toISOString(); }
    else if (ant.hash !== p.hash) {
      st.mudanca = p.pdf ? { entrou: [], saiu: [], pdf: true } : diferencas(ant.texto, p.texto);
      st.mudouEm = agora.toISOString(); st.decisao = null;
      st.hash = p.hash; st.texto = p.texto;
    }
  } catch (e) {
    st.erro = String(e?.name === "TimeoutError" ? "O site demorou demais para responder." : e?.message || e).slice(0, 160);
    st.falhas = (ant.falhas || 0) + 1;
  }
  await kvSetEx(kPag(t.slug, url), JSON.stringify(st), UM_ANO);
  return st;
}

// Rotina diária (e o botão "Verificar agora").
export async function verificarSite(t, { fetchImpl = baixarHttps, agora = new Date() } = {}) {
  if (!dominioPortal(t)) return { semPortal: true };
  const paginas = await paginasDoTenant(t);
  let mudaram = 0, erros = 0;
  // 4 de cada vez, para não sobrecarregar o site do DETRAN.
  for (let i = 0; i < paginas.length; i += 4) {
    const lote = await Promise.all(paginas.slice(i, i + 4).map((p) => conferir(t, p.url, agora, fetchImpl)));
    for (const s of lote) { if (s.mudouEm === agora.toISOString()) mudaram++; if (s.erro) erros++; }
  }
  return { paginas: paginas.length, mudaram, erros };
}

const publico = ({ texto, hash, ...p }) => ({ ...p, pendente: Boolean(p.mudouEm && !p.decisao) });

export function registrarMonitorSite(app, { limitar } = {}) {
  const B = "/api/t/:slug/gestao/tutoria/site";
  const mw = [comTenant, exigir("tutor")];
  const erro = (res, e) => { console.error("[monitor-site]", String(e?.message || e).slice(0, 160)); res.status(500).json({ error: "Não foi possível concluir agora." }); };
  const lista = async (t) => ({ dominio: dominioPortal(t), max: MAX_PAGINAS, itens: (await paginasDoTenant(t)).map(publico) });

  app.get(B, ...mw, async (req, res) => { try { res.json(await lista(req.tenant)); } catch (e) { erro(res, e); } });

  app.post(`${B}/paginas`, ...mw, async (req, res) => {
    try {
      const t = req.tenant;
      const url = urlPermitida(t, req.body?.url);
      if (!url) return res.status(400).json({ error: `Use um endereço https do portal do ${t.sigla} (${dominioPortal(t) || "portal não cadastrado"}).` });
      const urls = (await paginasDoTenant(t)).map((p) => p.url);
      if (urls.includes(url)) return res.status(409).json({ error: "Essa página já está sendo acompanhada." });
      if (urls.length >= MAX_PAGINAS) return res.status(400).json({ error: `No máximo ${MAX_PAGINAS} páginas. Tire alguma antes.` });
      await kvSetEx(kIdx(t.slug), JSON.stringify([...urls, url]), UM_ANO);
      await conferir(t, url, new Date(), baixarHttps); // 1ª leitura vira a referência
      res.status(201).json(await lista(t));
    } catch (e) { erro(res, e); }
  });

  app.delete(`${B}/paginas`, ...mw, async (req, res) => {
    try {
      const t = req.tenant;
      const url = String(req.query.url || "");
      const urls = (await paginasDoTenant(t)).map((p) => p.url);
      if (!urls.includes(url)) return res.status(404).json({ error: "Página não encontrada." });
      await kvSetEx(kIdx(t.slug), JSON.stringify(urls.filter((u) => u !== url)), UM_ANO);
      await kvDel(kPag(t.slug, url)).catch(() => {});
      res.json(await lista(t));
    } catch (e) { erro(res, e); }
  });

  app.post(`${B}/verificar`, ...mw, async (req, res) => {
    if (limitar && limitar(`site-verif:${req.tenant.slug}`, 3)) return res.status(429).json({ error: "Aguarde um minuto para verificar de novo." });
    try { const r = await verificarSite(req.tenant); res.json({ ...r, ...(await lista(req.tenant)) }); } catch (e) { erro(res, e); }
  });

  app.post(`${B}/decidir`, ...mw, async (req, res) => {
    try {
      const t = req.tenant;
      const url = String(req.body?.url || "");
      const acao = String(req.body?.acao || "");
      const MAPA = { revisado: "revisado", sem_impacto: "sem_impacto", desfazer: null };
      if (!(acao in MAPA)) return res.status(400).json({ error: "Ação inválida." });
      const st = await lerJson(kPag(t.slug, url), null);
      if (!st) return res.status(404).json({ error: "Página não encontrada." });
      const { quemSou } = await import("./atendimento.js");
      const eu = await quemSou(req).catch(() => null);
      st.decisao = MAPA[acao] ? { decisao: MAPA[acao], autor: eu?.nome || null, em: new Date().toISOString() } : null;
      await kvSetEx(kPag(t.slug, url), JSON.stringify(st), UM_ANO);
      res.json(await lista(t));
    } catch (e) { erro(res, e); }
  });
}
