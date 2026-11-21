// "Meu DETRAN" com dados OFICIAIS: conector plugável para a API do DETRAN.
//
//   modo "desligado" (padrão) -> nada muda; a simulação continua só na demonstração.
//   modo "api"                -> depois do login gov.br, o chat e a tela usam os
//                                dados da pessoa vindos da API do DETRAN.
//
// O contrato da API está em docs/CONECTOR_MEU_DETRAN.md. Configuração por DETRAN
// em Tenant.configGestao.meuDetran (segredos cifrados; nunca voltam ao navegador).
import { prisma } from "./db.js";
import { comTenant, limparCacheTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { cifrar, decifrar, assinarToken, lerToken } from "./cripto.js";
import { kvSetEx, kvGetStr, kvDel } from "../store.js";
import { montarAutorizacao, concluirLogin, AMBIENTES } from "./govbr.js";

const COOKIE = (slug) => `md_${slug}`;
const SESSAO_HORAS = 0.5; // 30 min: dado pessoal, sessão curta
const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dBR = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");

export function configMeuDetran(t) {
  const c = (t?.configGestao && t.configGestao.meuDetran) || {};
  return {
    modo: c.modo === "api" ? "api" : "desligado",
    apiUrl: c.apiUrl || "", apiToken: c.apiTokenEnc ? decifrar(c.apiTokenEnc) : "",
    govbrAmbiente: AMBIENTES[c.govbrAmbiente] ? c.govbrAmbiente : "homologacao", govbrBaseUrl: c.govbrBaseUrl || "",
    govbrClientId: c.govbrClientId || "", govbrClientSecret: c.govbrClientSecretEnc ? decifrar(c.govbrClientSecretEnc) : "",
  };
}
export function statusMeuDetran(t) {
  const c = configMeuDetran(t);
  const api = Boolean(c.apiUrl && c.apiToken), govbr = Boolean(c.govbrClientId && c.govbrClientSecret);
  return { modo: c.modo, api, govbr, pronto: c.modo === "api" && api && govbr, govbrAmbiente: c.govbrAmbiente, apiUrl: c.apiUrl || null, govbrClientId: c.govbrClientId || null };
}

// ── Conector (API do DETRAN) ──
export function validarResumo(d) {
  if (!d || typeof d !== "object" || !d.cidadao || typeof d.cidadao.nome !== "string") throw new Error("resposta da API fora do contrato (cidadao.nome)");
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    cidadao: { nome: d.cidadao.nome },
    cnh: d.cnh && typeof d.cnh === "object" ? d.cnh : null,
    veiculos: arr(d.veiculos), infracoes: arr(d.infracoes), debitos: arr(d.debitos), processos: arr(d.processos), agendamentos: arr(d.agendamentos),
    atualizadoEm: d.atualizadoEm || new Date().toISOString(),
  };
}
export async function buscarResumo(t, cpf, { fetchImpl = fetch } = {}) {
  const c = configMeuDetran(t);
  if (!c.apiUrl || !c.apiToken) throw new Error("API do Meu DETRAN não configurada");
  const r = await fetchImpl(`${c.apiUrl.replace(/\/+$/, "")}/cidadaos/${encodeURIComponent(cpf)}/resumo`, {
    headers: { Authorization: `Bearer ${c.apiToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(12000),
  });
  if (r.status === 404) return validarResumo({ cidadao: { nome: "" } , cnh: null });
  if (!r.ok) throw new Error(`API do DETRAN respondeu ${r.status}`);
  return validarResumo(await r.json());
}

// Texto para o bot responder sobre a situação da pessoa (dados oficiais).
export function contextoOficial(t, d) {
  const cnh = d.cnh ? `CNH categoria ${d.cnh.categoria || "—"}, situação ${d.cnh.situacao || "—"}, validade ${dBR(d.cnh.validade)}, ${d.cnh.pontos ?? "—"} pontos nos últimos 12 meses.${d.cnh.observacoes ? ` ${d.cnh.observacoes}` : ""}` : "Sem CNH registrada.";
  const veic = d.veiculos.map((v) => `${v.modelo || "veículo"} placa ${v.placa || "—"}, ${v.situacao || "—"}, licenciado até ${v.licenciadoAte || "—"}${(v.restricoes || []).length ? `, restrições: ${v.restricoes.join("; ")}` : ""}`).join(" | ") || "nenhum";
  const abertos = d.debitos.filter((x) => !/PAGO/i.test(x.situacao || ""));
  const total = abertos.reduce((s, x) => s + Number(x.valor || 0), 0);
  return `\n\nDADOS OFICIAIS DO ${t.sigla} (consultados agora, com login gov.br da própria pessoa):
Cidadão: ${d.cidadao.nome}. ${cnh}
Veículos: ${veic}.
Infrações: ${d.infracoes.map((i) => `${i.desc} (${i.natureza || "—"}, ${i.pontos ?? "—"} pts, ${i.orgao || "—"}, ${i.fase || "—"})`).join("; ") || "nenhuma"}.
Débitos em aberto (total ${brl(total)}): ${abertos.map((x) => `${x.desc} ${brl(x.valor)} (vence ${dBR(x.vencimento)})`).join("; ") || "nenhum"}.
Processos: ${d.processos.map((p) => `${p.numero || ""} ${p.tipo || ""} — ${p.situacao || ""}`).join("; ") || "nenhum"}.
Agendamentos: ${d.agendamentos.map((a) => `${a.servico} em ${a.local}, ${dBR(a.data)} ${a.hora || ""}`).join("; ") || "nenhum"}.
Use ESTES dados para responder sobre a situação desta pessoa. Valores e prazos são os do sistema agora; para pagar, emitir guia ou protocolar, indique o portal oficial ${t.portalUrl}. Não repita o CPF.`;
}

// ── Sessão do cidadão (cookie curto, assinado) ──
function lerCookie(req, nome) {
  for (const p of String(req.headers.cookie || "").split(";")) { const [k, ...v] = p.trim().split("="); if (k === nome) return decodeURIComponent(v.join("=")); }
  return null;
}
export function sessaoCidadao(req, t) {
  const d = lerToken(lerCookie(req, COOKIE(t.slug)) || "");
  return d && d.md === 1 && d.tid === t.id && d.cpf ? d : null;
}
const seguro = (req) => req.secure || req.headers["x-forwarded-proto"] === "https";
const publicUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");

// Contexto para o chat (cache de 5 min por pessoa para não martelar a API).
export async function contextoMeuDetran(req, t) {
  const st = statusMeuDetran(t); if (!st.pronto) return "";
  const s = sessaoCidadao(req, t); if (!s) return "";
  const k = `md:${t.slug}:ctx:${s.cpf}`;
  const cache = await kvGetStr(k).catch(() => null);
  if (cache) return cache;
  const ctx = contextoOficial(t, await buscarResumo(t, s.cpf));
  await kvSetEx(k, ctx, 300).catch(() => {});
  return ctx;
}

export function registrarMeuDetran(app, { limitar } = {}) {
  const T = "/api/t/:slug";

  app.get(`${T}/meu-detran/status`, comTenant, (req, res) => {
    const st = statusMeuDetran(req.tenant); const s = st.pronto ? sessaoCidadao(req, req.tenant) : null;
    res.json({ ativo: st.pronto, logado: s ? { nome: s.nome } : null });
  });

  app.get(`${T}/govbr/entrar`, comTenant, async (req, res) => {
    const t = req.tenant, cfg = configMeuDetran(t);
    if (!statusMeuDetran(t).pronto) return res.status(404).send("Login gov.br não disponível para este DETRAN.");
    if (limitar && limitar(`govbr:${t.slug}:${req.ip}`, 20)) return res.status(429).send("Muitas tentativas. Aguarde um minuto.");
    const redirectUri = `${publicUrl(req)}/api/t/${t.slug}/govbr/retorno`;
    const a = montarAutorizacao(cfg, redirectUri);
    await kvSetEx(`govbr:${a.state}`, JSON.stringify({ slug: t.slug, nonce: a.nonce, verifier: a.verifier }), 600);
    res.redirect(302, a.url);
  });

  app.get(`${T}/govbr/retorno`, comTenant, async (req, res) => {
    const t = req.tenant, cfg = configMeuDetran(t);
    const volta = (q) => res.redirect(302, `/${t.slug}?govbr=${q}`);
    try {
      const state = String(req.query.state || ""), code = String(req.query.code || "");
      if (!state || !code) return volta("cancelado");
      const salvo = JSON.parse((await kvGetStr(`govbr:${state}`)) || "null");
      await kvDel(`govbr:${state}`).catch(() => {});
      if (!salvo || salvo.slug !== t.slug) return volta("expirado");
      const u = await concluirLogin(cfg, { code, redirectUri: `${publicUrl(req)}/api/t/${t.slug}/govbr/retorno`, verifier: salvo.verifier, nonce: salvo.nonce });
      const tok = assinarToken({ md: 1, tid: t.id, cpf: u.cpf, nome: String(u.nome).split(" ")[0] }, SESSAO_HORAS);
      res.append("Set-Cookie", `${COOKIE(t.slug)}=${encodeURIComponent(tok)}; Path=/; Max-Age=${SESSAO_HORAS * 3600}; HttpOnly; SameSite=Lax${seguro(req) ? "; Secure" : ""}`);
      volta("ok");
    } catch (e) { console.warn(`[govbr:${t.slug}]`, e.message); volta("erro"); }
  });

  app.post(`${T}/govbr/sair`, comTenant, async (req, res) => {
    const s = sessaoCidadao(req, req.tenant);
    if (s) await kvDel(`md:${req.tenant.slug}:ctx:${s.cpf}`).catch(() => {});
    res.append("Set-Cookie", `${COOKIE(req.tenant.slug)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${seguro(req) ? "; Secure" : ""}`);
    res.json({ ok: true });
  });

  // Resumo para a tela (só com login gov.br).
  app.get(`${T}/meu-detran/resumo`, comTenant, async (req, res) => {
    const t = req.tenant; if (!statusMeuDetran(t).pronto) return res.status(404).json({ error: "Indisponível." });
    const s = sessaoCidadao(req, t); if (!s) return res.status(401).json({ error: "Entre com a sua conta gov.br." });
    try { const d = await buscarResumo(t, s.cpf); res.set("Cache-Control", "no-store"); res.json(d); }
    catch (e) { console.warn(`[meu-detran:${t.slug}]`, e.message); res.status(502).json({ error: "O sistema do DETRAN não respondeu agora. Tente de novo em instantes." }); }
  });

  // Configuração (admin do DETRAN). Segredos: em branco = mantém; nunca voltam.
  app.get(`${T}/admin/meu-detran`, comTenant, exigir("admin"), (req, res) => res.json(statusMeuDetran(req.tenant)));
  app.put(`${T}/admin/meu-detran`, comTenant, exigir("admin"), async (req, res) => {
    const b = req.body || {};
    const atual = (req.tenant.configGestao && req.tenant.configGestao.meuDetran) || {};
    const url = (v) => !v || /^https:\/\/[^\s]+$/i.test(v);
    if (!url(b.apiUrl)) return res.status(400).json({ error: "A URL da API precisa começar com https://" });
    if (b.govbrAmbiente && !AMBIENTES[b.govbrAmbiente]) return res.status(400).json({ error: "Ambiente gov.br inválido." });
    const novo = {
      ...atual,
      modo: b.modo === "api" ? "api" : "desligado",
      apiUrl: String(b.apiUrl ?? atual.apiUrl ?? "").trim().slice(0, 300),
      govbrAmbiente: b.govbrAmbiente || atual.govbrAmbiente || "homologacao",
      govbrClientId: String(b.govbrClientId ?? atual.govbrClientId ?? "").trim().slice(0, 200),
      ...(atual.govbrBaseUrl ? { govbrBaseUrl: atual.govbrBaseUrl } : {}),
      ...(b.apiToken ? { apiTokenEnc: cifrar(String(b.apiToken).trim()) } : {}),
      ...(b.govbrClientSecret ? { govbrClientSecretEnc: cifrar(String(b.govbrClientSecret).trim()) } : {}),
    };
    try {
      const t = await prisma.tenant.update({ where: { id: req.tenant.id }, data: { configGestao: { ...(req.tenant.configGestao || {}), meuDetran: novo } } });
      limparCacheTenant(req.tenant.slug);
      res.json(statusMeuDetran(t));
    } catch (e) { console.error("[meu-detran admin]", e.message); res.status(500).json({ error: "Não foi possível salvar." }); }
  });
}
