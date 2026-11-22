// ─────────────────────────────────────────────────────────────────────────────
// Saúde do sistema: checa banco, estado curto (KV/MySQL), BotAyio e WhatsApp
// de cada DETRAN, guarda o histórico de falhas e expõe:
//   GET /api/saude                    público, sem detalhes (para o monitor externo)
//   GET /api/admin/saude              equipe Ayio: detalhes + falhas recentes
//   GET /api/t/:slug/gestao/saude     gestor do DETRAN: só as integrações dele
// O monitor externo (GitHub Actions, .github/workflows/monitor.yml) chama
// /api/saude a cada 10 min; se falhar, o GitHub manda e-mail ao dono do repo.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { kvGetStr, kvSetEx, storageMode } from "../store.js";
import { integracoes, statusIntegracoes } from "./tenants.js";
import { resumoTempos } from "./cache-respostas.js";

const ANO = 365 * 86400;
const CHAVE_FALHAS = "sys:falhas";
const MAX_FALHAS = 200;
const ms = (t0) => Date.now() - t0;

// ── Registro de falhas (sem dados pessoais: só componente + mensagem curta) ──
const limpar = (s) => String(s || "").replace(/\b\d{8,}\b/g, "•••").replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);
let gravando = Promise.resolve();
export function registrarFalha(componente, erro, extra = {}) {
  const item = { em: new Date().toISOString(), componente: String(componente).slice(0, 40), msg: limpar(erro?.message || erro), ...extra };
  console.error(`[falha] ${item.componente}: ${item.msg}`);
  // Serializa as gravações para não perder itens em rajadas.
  gravando = gravando.then(async () => {
    let lista = [];
    try { lista = JSON.parse((await kvGetStr(CHAVE_FALHAS)) || "[]"); } catch { lista = []; }
    lista.unshift(item);
    await kvSetEx(CHAVE_FALHAS, JSON.stringify(lista.slice(0, MAX_FALHAS)), ANO);
  }).catch((e) => console.error("[falha] não gravou o registro:", e.message));
  return item;
}
// Todo console.error com etiqueta ("[BotAyio:pa] ...", "[chat] ...") também
// entra no histórico, para nenhum erro ficar só no log da Vercel.
// "[store]" fica de fora: o estado do armazenamento já aparece na checagem.
const IGNORAR = new Set(["falha", "store"]);
if (!globalThis.__detranConsoleSaude) {
  globalThis.__detranConsoleSaude = true;
  const original = console.error.bind(console);
  let dentro = false;
  console.error = (...args) => {
    original(...args);
    if (dentro) return;
    const tag = String(args[0] ?? "").match(/^\[([^\]]{1,40})\]/);
    if (!tag || IGNORAR.has(tag[1])) return;
    dentro = true;
    try {
      const [comp, slug] = tag[1].split(":");
      const msg = args.slice(1).map((x) => (x && x.message) || (typeof x === "string" ? x : "")).join(" ").trim() || String(args[0]).slice(tag[0].length).trim();
      registrarFalha(comp, msg, slug ? { slug } : {});
    } finally { dentro = false; }
  };
}

export async function falhasRecentes(limite = 50) {
  try { return JSON.parse((await kvGetStr(CHAVE_FALHAS)) || "[]").slice(0, limite); } catch { return []; }
}
// Um mesmo componente falhando 5+ vezes em 10 min vira alerta no /api/saude.
function emRajada(lista) {
  const desde = Date.now() - 10 * 60 * 1000, cont = {};
  for (const f of lista) if (Date.parse(f.em) >= desde) cont[f.componente] = (cont[f.componente] || 0) + 1;
  return Object.entries(cont).filter(([, n]) => n >= 5).map(([c, n]) => ({ componente: c, vezes: n }));
}

// ── Checagens ──
async function comPrazo(promessa, prazoMs) {
  let timer; const tempo = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`sem resposta em ${prazoMs / 1000}s`)), prazoMs); });
  try { return await Promise.race([promessa, tempo]); } finally { clearTimeout(timer); }
}
async function checarBanco() {
  const t0 = Date.now();
  try { await comPrazo(prisma.$queryRawUnsafe("SELECT 1"), 5000); return { nome: "Banco de dados", ok: true, ms: ms(t0) }; }
  catch (e) { return { nome: "Banco de dados", ok: false, ms: ms(t0), detalhe: limpar(e.message) }; }
}
async function checarEstado() {
  const t0 = Date.now(), k = "sys:saude:ping", v = String(Date.now());
  try {
    await comPrazo(kvSetEx(k, v, 120), 6000);
    const lido = await comPrazo(kvGetStr(k), 6000);
    const modo = storageMode();
    return { nome: "Estado curto", ok: lido === v, ms: ms(t0), modo, detalhe: modo === "kv" ? "Redis (Upstash)" : modo === "mysql" ? "MySQL (reserva)" : "memória" };
  } catch (e) { return { nome: "Estado curto", ok: false, ms: ms(t0), detalhe: limpar(e.message) }; }
}
async function checarBotayio(url) {
  const t0 = Date.now();
  try {
    const base = new URL(url).origin;
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, ms: ms(t0), detalhe: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) { return { ok: false, ms: ms(t0), detalhe: limpar(e.message) }; }
}
async function checarWhatsApp(t) {
  const z = integracoes(t).zapayio, t0 = Date.now();
  if (!z.instanceId || !z.token) return null; // DETRAN sem WhatsApp: não conta
  try {
    const headers = z.clientToken ? { "client-token": z.clientToken } : {};
    const r = await fetch(`${z.baseUrl}/instances/${z.instanceId}/token/${z.token}/status`, { headers, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => ({}));
    const conectado = Boolean(j?.connected ?? j?.value?.connected);
    return { ok: r.ok && conectado, ms: ms(t0), detalhe: !r.ok ? `HTTP ${r.status}` : conectado ? null : "desconectado (precisa parear pelo QR)" };
  } catch (e) { return { ok: false, ms: ms(t0), detalhe: limpar(e.message) }; }
}

// Checa um DETRAN (integrações dele).
export async function saudeTenant(t) {
  const st = statusIntegracoes(t), itens = [];
  if (st.botayio) itens.push({ nome: "Assistente (BotAyio)", ...(await checarBotayio(integracoes(t).botayio.url)) });
  else itens.push({ nome: "Assistente (BotAyio)", ok: false, detalhe: "não configurado", configurado: false });
  const wa = await checarWhatsApp(t);
  itens.push(wa ? { nome: "WhatsApp", ...wa } : { nome: "WhatsApp", ok: null, detalhe: "não usado por este DETRAN", configurado: false });
  return itens;
}

// Visão geral (todos os DETRANs ativos). `demonstracao` não derruba o status geral.
export async function verificarSaude({ detalhes = false } = {}) {
  const t0 = Date.now();
  const [banco, estado] = await Promise.all([checarBanco(), checarEstado()]);
  let tenants = [];
  if (banco.ok) {
    try { tenants = await prisma.tenant.findMany({ where: { ativo: true }, include: { integracao: true } }); }
    catch (e) { registrarFalha("saude", e); }
  }
  const porTenant = await Promise.all(tenants.map(async (t) => ({ slug: t.slug, sigla: t.sigla, demonstracao: Boolean(t.demonstracao), itens: await saudeTenant(t), tempos: detalhes ? await resumoTempos(t.slug) : undefined })));
  const falhas = await falhasRecentes(MAX_FALHAS);
  const rajadas = emRajada(falhas);
  const criticos = [banco, estado, ...porTenant.filter((x) => !x.demonstracao).flatMap((x) => x.itens.filter((i) => i.configurado !== false).map((i) => ({ ...i, nome: `${x.sigla}: ${i.nome}` })))];
  const fora = criticos.filter((c) => c.ok === false).map((c) => c.nome);
  const ok = fora.length === 0 && rajadas.length === 0;
  const base = { ok, em: new Date().toISOString(), ms: ms(t0), fora, rajadas };
  if (!detalhes) return base;
  return { ...base, componentes: [banco, estado], detrans: porTenant, falhas: falhas.slice(0, 50) };
}

// Rotas.
export function registrarSaude(app, { exigirSuper, comTenant, exigir }) {
  app.get("/api/saude", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { const s = await verificarSaude(); res.status(s.ok ? 200 : 503).json(s); }
    catch (e) { registrarFalha("saude", e); res.status(503).json({ ok: false, fora: ["verificação"], em: new Date().toISOString() }); }
  });
  app.get("/api/admin/saude", exigirSuper, async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await verificarSaude({ detalhes: true }));
  });
  app.get("/api/t/:slug/gestao/saude", comTenant, exigir("painel"), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const itens = await saudeTenant(req.tenant);
    const falhas = (await falhasRecentes(MAX_FALHAS)).filter((f) => f.slug === req.tenant.slug).slice(0, 20);
    res.json({ itens, falhas, tempos: await resumoTempos(req.tenant.slug), em: new Date().toISOString() });
  });
}
