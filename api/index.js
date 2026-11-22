// ─────────────────────────────────────────────────────────────────────────────
// Assistente DETRAN — aplicação multi-tenant (um tenant por DETRAN).
//
//   /pa, /am ...            chat do cidadão de cada DETRAN
//   /pa/tutor, /pa/balcao   áreas internas (login por usuário e perfil)
//   /pa/painel              painel executivo
//   /api/t/<slug>/...       API do DETRAN (dados sempre isolados por tenant)
//
// O "cérebro" de cada DETRAN é o bot dele no BotAyio (prompt, base, tutoria).
// A IA local cuida de fotos, formulários, defesa e balcão, e é o plano B do
// chat enquanto um DETRAN ainda não tem bot no BotAyio.
//
// Roda local (server.js chama app.listen) e na Vercel (export default).
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import { contarNaJanela } from "../store.js";
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { prisma, bancoConfigurado } from "../lib/db.js";
import { comTenant, buscarTenant, configPublica, integracoes, statusIntegracoes, SLUG_RE } from "../lib/tenants.js";
import { login, exigir, exigirSuper, podeAcessar } from "../lib/auth.js";
import { registrarSaude, registrarFalha } from "../lib/saude.js";
import { lerCache, guardarCache, registrarTempo } from "../lib/cache-respostas.js";
import { registrarSeguranca, etapaPosSenha, auditar } from "../lib/seguranca.js";
import { registrarImpacto } from "../lib/impacto.js";
import { lerToken } from "../lib/cripto.js";
import { chamarLLM, limparHistorico, textoDe, temImagem, llmConfigurado, SEM_CHAVE, PROVIDER_ID, MODEL, MAX_TOKENS } from "../lib/llm.js";
import { perguntarRapido } from "../lib/botayio.js";
import { registrarUso } from "../lib/uso-ia.js";
import { montarResposta, aquecerTenant } from "../lib/aquecer-cache.js";
import { promptCidadao, promptOperador, promptDefesa, promptTermo, promptExtracao } from "../lib/prompts.js";
import { registrarTroca, registrarEvento, estatisticas, classificarTema } from "../lib/registro.js";
import { registrarWhatsApp } from "../whatsapp.js";
import { registrarAdmin } from "../lib/admin.js";
import { registrarAtendimento } from "../lib/atendimento.js";
import { registrarGestao } from "../lib/gestao.js";
import { registrarTutoriaGestao, buscarNaBase, mascarar } from "../lib/tutoria-gestao.js";
import { analisarSuspeita, pareceVerificacao, textoParaChat } from "../lib/antigolpe.js";
import { registrarObservatorio } from "../lib/observatorio.js";
import { registrarMeuDetran, contextoMeuDetran } from "../lib/meu-detran.js";
import { registrarJornadas } from "../lib/jornadas-api.js";
import { detectarJornada } from "../lib/jornadas.js";
import { registrarConferencia } from "../lib/conferencia.js";
import { registrarPrivacidade } from "../lib/privacidade.js";
import { registrarLembretes } from "../lib/lembretes.js";
import { registrarSimulacao, contextoParaChat } from "../lib/simulacao.js";
import { registrarCatalogoSim } from "../lib/simulacao-servicos.js";
import { configDe } from "../lib/gestao-config.js";
import { chaveNaUrl, liberadoDemo, gravarCookieDemo, paginaRestrita, chaveSimNaUrl, gravarCookieSim, simPorCookie } from "../lib/demo.js";
import { cssDoTema, marcaProvisoriaSvg } from "../lib/tema.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TENANT = String(process.env.DEFAULT_TENANT || "pa").toLowerCase();

const app = express();
app.disable("x-powered-by");

// Cabeçalhos de segurança em todas as respostas do servidor.
// Aplicado: não pode ser embutido em outro site (clickjacking), sem plugins,
// base fixa. A política completa de origens (CSP) vai em modo "observação"
// (Report-Only) para não quebrar o VLibras; dá para endurecer depois.
const CSP_OBSERVACAO = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://vlibras.gov.br https://*.vlibras.gov.br",
  "style-src 'self' 'unsafe-inline' https://vlibras.gov.br https://*.vlibras.gov.br",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://vlibras.gov.br https://*.vlibras.gov.br",
  "connect-src 'self' https://vlibras.gov.br https://*.vlibras.gov.br",
  "media-src 'self' blob: https://vlibras.gov.br https://*.vlibras.gov.br",
  "worker-src 'self' blob:",
  "frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'",
].join("; ");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    "Content-Security-Policy-Report-Only": CSP_OBSERVACAO,
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  });
  if (req.path.startsWith("/api/")) res.set("Cache-Control", res.get("Cache-Control") || "no-store");
  next();
});

app.use(express.json({ limit: "10mb" }));
// Arquivos estáticos (css, js, imagens). As páginas HTML são servidas pelas
// rotas abaixo, com os dados do DETRAN injetados.
// Arquivos com versão na URL (?v=) podem ficar no navegador por 1 ano: a cada
// publicação a versão muda e o navegador busca o novo. Sem versão: revalida.
const estatico = express.static(join(ROOT, "public"), {
  index: false,
  setHeaders: (res, _caminho) => { if (res.req?.query?.v) res.set("Cache-Control", "public, max-age=31536000, immutable"); },
});
export const VERSAO_ARQUIVOS = String(process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || Date.now().toString(36)).replace(/[^\w-]/g, "").slice(0, 12);
const versionar = (html) => html.replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSAO_ARQUIVOS}"`);
app.use((req, res, next) => (/\.html?$/i.test(req.path) ? next() : estatico(req, res, next)));

// ── Limite de perguntas por IP ──────────────────────────────────────────────
const hits = new Map();
const LIMITE_CHAT_MIN = Number(process.env.LIMITE_CHAT_MIN) || 20;
function rateLimited(chave, max = 20, janela = 60_000) {
  const agora = Date.now();
  const reg = hits.get(chave) || { count: 0, reset: agora + janela };
  if (agora > reg.reset) { reg.count = 0; reg.reset = agora + janela; }
  reg.count += 1; hits.set(chave, reg);
  return reg.count > max;
}
const ipDe = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "anon";

// ── Formulários do DETRAN (MySQL, cache de 60s) ─────────────────────────────
const formsCache = new Map();
async function formsDoTenant(t) {
  const c = formsCache.get(t.id);
  if (c && c.exp > Date.now()) return c.valor;
  const rows = await prisma.formulario.findMany({ where: { tenantId: t.id, ativo: true }, orderBy: { ordem: "asc" } });
  const valor = rows.map((r) => ({ ...r.definicao, id: r.chave }));
  formsCache.set(t.id, { valor, exp: Date.now() + 60_000 });
  return valor;
}
const indiceForms = (forms) => forms.map((f) => ({ id: f.id, title: f.title, desc: f.desc, subtitle: f.subtitle }));

// ── Saúde e lista de DETRANs ────────────────────────────────────────────────
app.get("/api/health", async (_req, res) => {
  let banco = false;
  try { if (bancoConfigurado()) { await prisma.$queryRaw`SELECT 1`; banco = true; } } catch (_) {}
  res.json({ ok: true, banco, provider: PROVIDER_ID, model: MODEL, llm: llmConfigurado() });
});
app.get("/api/tenants", async (_req, res) => {
  try {
    // Só os DETRANs clientes: os de demonstração são privados.
    const ts = await prisma.tenant.findMany({ where: { ativo: true, demonstracao: false }, select: { slug: true, sigla: true, nome: true }, orderBy: { slug: "asc" } });
    res.json({ tenants: ts });
  } catch (err) { console.error("[tenants]", err); res.status(503).json({ error: "Indisponível." }); }
});

// ═════════════════════════ API DO DETRAN ═════════════════════════
const T = "/api/t/:slug";

app.get(`${T}/config`, comTenant, async (req, res) => {
  res.json({ tenant: configPublica(req.tenant), integracoes: statusIntegracoes(req.tenant) });
});

// Identidade visual: logo e marca enviados pelo /admin (ou a marca provisória).
app.get(`${T}/arquivo/:tipo`, comTenant, async (req, res) => {
  const tipo = req.params.tipo;
  if (!["logo", "marca"].includes(tipo)) return res.status(404).end();
  try {
    const achar = (tp) => prisma.tenantArquivo.findUnique({ where: { tenantId_tipo: { tenantId: req.tenant.id, tipo: tp } } });
    const a = (await achar(tipo)) || (await achar(tipo === "logo" ? "marca" : "logo"));
    res.set({ "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
    if (a) return res.type(a.mime).send(Buffer.from(a.dados));
    res.type("image/svg+xml").send(marcaProvisoriaSvg(req.tenant, { grande: tipo === "logo" }));
  } catch (err) { console.error("[arquivo]", err); res.status(500).end(); }
});

// Catálogo de documentos preenchíveis
app.get(`${T}/forms`, comTenant, async (req, res) => {
  try { res.json({ forms: indiceForms(await formsDoTenant(req.tenant)) }); }
  catch (err) { console.error("[forms]", err); res.status(500).json({ error: "Erro ao carregar documentos." }); }
});
app.get(`${T}/forms/:id`, comTenant, async (req, res) => {
  const form = (await formsDoTenant(req.tenant)).find((f) => f.id === req.params.id);
  if (!form) return res.status(404).json({ error: "Documento não encontrado." });
  res.json({ form });
});

// Extrair dados da conversa para pré-preencher um documento
app.post(`${T}/extract`, comTenant, async (req, res) => {
  if (!llmConfigurado()) return res.status(500).json({ error: SEM_CHAVE });
  const { formId, messages } = req.body || {};
  const form = (await formsDoTenant(req.tenant)).find((f) => f.id === formId);
  if (!form) return res.status(404).json({ error: "Documento não encontrado." });
  const hist = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => `${m.role === "user" ? "Cidadão" : "Assistente"}: ${textoDe(m.content)}`)
    .filter((l) => l.trim().length > 12).slice(-20).join("\n");
  if (!hist) return res.json({ values: {} });
  const campos = [];
  form.sections.forEach((sec) => sec.fields.forEach((f) => campos.push(f)));
  const esquema = campos.map((c) => {
    let l = `- ${c.key} (${c.label})`;
    if (c.type === "radio" && c.options) l += ` [escolha uma: ${c.options.join(" | ")}]`;
    if (c.type === "date") l += " [data AAAA-MM-DD]";
    return l;
  }).join("\n");
  try {
    const txt = await chamarLLM({ system: promptExtracao(req.tenant, form, esquema), maxTokens: 700,
      messages: [{ role: "user", content: `CONVERSA:\n${hist}\n\nExtraia o JSON de preenchimento.` }] });
    const mm = txt.match(/\{[\s\S]*\}/);
    let parsed = {};
    if (mm) { try { parsed = JSON.parse(mm[0]); } catch (_) {} }
    const byKey = new Map(campos.map((c) => [c.key, c]));
    const out = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      const campo = byKey.get(k);
      if (!campo || v == null) continue;
      const val = String(v).slice(0, 300);
      if (campo.type === "radio" && campo.options && !campo.options.includes(val)) continue;
      if (val.trim()) out[k] = val;
    }
    res.json({ values: out });
  } catch (e) { console.error("[extract]", e); res.status(502).json({ error: "Falha ao extrair." }); }
});

// ── Pré-aquecimento do cache (cron; Bearer CRON_SECRET) ──
// Responde de antemão as perguntas que mais abrem conversas. Incremental e com
// orçamento de tempo: pode ser chamado várias vezes (cron diário, monitor).
app.get("/api/cron/aquecer", async (req, res) => {
  const { mesmoSegredo } = await import("../lib/cripto.js");
  const seg = process.env.CRON_SECRET || "";
  if (!seg || !mesmoSegredo(String(req.headers.authorization || ""), `Bearer ${seg}`)) return res.status(401).json({ error: "Não autorizado." });
  const orcamentoMs = Math.min(50000, Math.max(2000, Number(process.env.AQUECER_MS) || 8000));
  const fim = Date.now() + orcamentoMs, out = {};
  for (const t of await prisma.tenant.findMany({ where: { ativo: true }, include: { integracao: true } })) {
    const resta = fim - Date.now(); if (resta < 1500) { out[t.slug] = { adiado: true }; continue; }
    out[t.slug] = await aquecerTenant(t, { orcamentoMs: resta }).catch((e) => ({ erro: e.message }));
  }
  res.json({ ok: true, resultado: out });
});

// ── Chat do cidadão ─────────────────────────────────────────────────────────
// Texto -> bot do DETRAN no BotAyio. Foto (ou DETRAN sem bot) -> IA local.
app.post(`${T}/chat`, comTenant, async (req, res) => {
  const t = req.tenant;
  const ip = ipDe(req);
  // Transmissão (22/11/2026): o site pede `stream: true`; a resposta vira linhas JSON
  // {"d": pedaço} ... {"fim": {reply, origem}}. Sem pedaços (cache, antigolpe,
  // IA local), sai o JSON de sempre.
  let transmitindo = false;
  const abrirTransmissao = () => {
    if (transmitindo) return;
    transmitindo = true;
    res.status(200).set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.flushHeaders?.();
  };
  const responder = (corpo, status = 200) => {
    if (!transmitindo) return res.status(status).json(corpo);
    res.end(JSON.stringify(status >= 400 ? { erro: corpo.error || "Falha." } : { fim: corpo }) + "\n");
  };
  if (rateLimited(`${t.slug}:${ip}`)) return res.status(429).json({ error: "Muitas perguntas em sequência. Aguarde um instante e tente de novo." });
  // Limite compartilhado entre as instâncias da Vercel (a memória é de cada uma).
  // Corre em paralelo com o resto e só é conferido antes de chamar a IA.
  const limiteGlobal = contarNaJanela(`chat:${t.slug}:${ip}`, 60).catch(() => 0);

  const hist = limparHistorico(req.body?.messages);
  if (!hist.length || hist[hist.length - 1].role !== "user") return res.status(400).json({ error: "A última mensagem deve ser do usuário." });
  const ultima = hist[hist.length - 1].content;
  const pergunta = textoDe(ultima) || "análise de documento enviado por foto";
  const sid = String(req.body?.sessionId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48)
    || createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const tema = classificarTema(pergunta);
  const { botayio } = integracoes(t);
  // Simulação (só demonstração): cidadão fictício escolhido em "Meu DETRAN" -> responde com os dados dele.
  const simP = simPorCookie(req, t) ? String(req.body?.simCidadao || "").replace(/[^a-z]/g, "").slice(0, 20) : "";
  const simCtx = simP ? await contextoParaChat(t, String(req.body?.simSessao || "").replace(/[^\w-]/g, "").slice(0, 40) || "anon", simP).catch(() => "") : "";
  // "Meu DETRAN" oficial: dados da própria pessoa, só com login gov.br (cookie de sessão curta).
  const realCtx = simCtx ? "" : await contextoMeuDetran(req, t).catch((e) => { console.warn(`[meu-detran:${t.slug}]`, e.message); return ""; });

  // 0) Antigolpe: a pessoa colou um link, um código de barras ou perguntou se
  // uma cobrança é golpe -> análise determinística na hora, sem passar pelo bot.
  if (!temImagem(ultima) && pareceVerificacao(pergunta)) {
    const r = analisarSuspeita(pergunta, t);
    const reply = textoParaChat(r);
    if (!simCtx) {
      registrarTroca({ tenantId: t.id, canal: "WEB", contato: sid, pergunta, respostas: reply.split("\n[[BREAK]]\n"), categoria: "golpe" });
      registrarEvento({ tenantId: t.id, tipo: "GOLPE", canal: "WEB", tema: r.nivel, resolvido: true });
    }
    return res.json({ reply, origem: "antigolpe", antigolpe: r });
  }

  // 0.5) Cache das perguntas frequentes (só 1ª pergunta, sem dados pessoais).
  const t0 = Date.now();
  const primeira = !hist.some((m) => m.role === "assistant");
  const podeCache = primeira && !simCtx && !realCtx && !temImagem(ultima);
  if (podeCache) {
    const c = await lerCache(t.slug, pergunta);
    if (c?.reply) {
      await Promise.all([
        registrarTroca({ tenantId: t.id, canal: "WEB", contato: sid, pergunta, respostas: c.reply.replace(/\n\[\[JORNADA:\w+\]\]$/, "").split("\n[[BREAK]]\n"), categoria: c.categoria }),
        registrarEvento({ tenantId: t.id, tipo: "PERGUNTA", canal: "WEB", tema: c.categoria || tema, resolvido: true }),
        registrarTempo(t.slug, Date.now() - t0, "cache"),
      ]);
      return res.json({ reply: c.reply, origem: "cache" });
    }
  }

  // 1) BotAyio (texto). Na simulação vai com o contexto do cidadão fictício e a
  // marca `simulacao` (BotAyio não grava). Se o BotAyio não confirmar que aplicou
  // o contexto (versão antiga), a resposta é descartada e segue a IA local.
  if ((await limiteGlobal) > LIMITE_CHAT_MIN) return responder({ error: "Muitas perguntas em sequência. Aguarde um instante e tente de novo." }, 429);
  if (!temImagem(ultima) && botayio.url && botayio.secret) {
    try {
      const restart = primeira;
      const extra = simCtx ? { contexto: simCtx.trim().slice(0, 7900), simulacao: true } : realCtx ? { contexto: realCtx.trim().slice(0, 7900) } : {};
      const aoPedaco = req.body?.stream === true && !simCtx ? (d) => { abrirTransmissao(); res.write(JSON.stringify({ d }) + "\n"); } : null;
      const resp = await perguntarRapido(botayio, `detran-${t.slug}-web-${simCtx ? "sim-" : ""}${sid}`, pergunta, restart, extra, aoPedaco);
      if (simCtx && !resp.contexto_aplicado) throw new Error("BotAyio sem suporte a contexto (versão antiga)");
      // [[SEMBASE]] é registro interno: não vai para o cidadão; marca a lacuna.
      const { partes, reply, semBase, transbordo, final } = montarResposta(resp, pergunta);
      // simulação não entra nas conversas nem nas estatísticas do DETRAN
      const gravacoes = simCtx ? [] : [
        registrarTroca({ tenantId: t.id, canal: "WEB", contato: sid, pergunta, respostas: partes, categoria: resp.categoria, transbordo }),
        registrarEvento({ tenantId: t.id, tipo: "PERGUNTA", canal: "WEB", tema: resp.categoria || tema, resolvido: !semBase, transbordo }),
        semBase ? registrarEvento({ tenantId: t.id, tipo: "SEMBASE", canal: "WEB", tema: mascarar(pergunta).replace(/\s+/g, " ").trim().slice(0, 60) }) : null,
      ];
      // Despachante Parente: a pergunta de uma jornada leva [[JORNADA:x]] (o site oferece o passo a passo).
      // Na Vercel a função "dorme" logo após responder: grava antes de responder.
      await Promise.all([
        ...gravacoes,
        simCtx ? null : registrarTempo(t.slug, Date.now() - t0, "bot"),
        simCtx ? null : registrarUso(t.slug, "WEB", resp.uso),
        podeCache && reply && !semBase && !transbordo ? guardarCache(t.slug, pergunta, { reply: final, categoria: resp.categoria || tema }) : null,
      ]);
      return responder({ reply: final, origem: simCtx ? "botayio-sim" : "botayio" });
    } catch (err) {
      console.error(`[BotAyio:${t.slug}] chat web:`, err.message);
      if (!llmConfigurado()) {
        registrarEvento({ tenantId: t.id, tipo: "PERGUNTA", canal: "WEB", tema: "erro", resolvido: false });
        return responder({ error: "Não foi possível obter a resposta agora. Tente novamente em instantes." }, 502);
      }
      // segue para a IA local como plano B
    }
  }

  // 2) IA local (fotos, ou plano B)
  if (!llmConfigurado()) return responder({ error: SEM_CHAVE }, 500);
  try {
    let texto = await chamarLLM({ system: promptCidadao(t, await formsDoTenant(t)) + simCtx + realCtx, messages: hist, maxTokens: MAX_TOKENS });
    let semBase = false;
    if (texto.includes("[[SEMBASE]]")) { semBase = true; texto = texto.replace(/\[\[SEMBASE\]\]/g, "").trim(); }
    if (!simCtx) {
      registrarTroca({ tenantId: t.id, canal: "WEB", contato: sid, pergunta, respostas: [texto] });
      registrarEvento({ tenantId: t.id, tipo: "PERGUNTA", canal: "WEB", tema, resolvido: !semBase });
      if (semBase && !temImagem(ultima)) registrarEvento({ tenantId: t.id, tipo: "SEMBASE", canal: "WEB", tema: mascarar(pergunta).replace(/\s+/g, " ").trim().slice(0, 60) });
    }
    const jor = temImagem(ultima) ? null : detectarJornada(pergunta);
    responder({ reply: (texto || "Não consegui gerar uma resposta. Pode reformular a pergunta?") + (jor ? `\n[[JORNADA:${jor}]]` : ""), origem: "local" });
  } catch (err) {
    console.error("[chat]", err.message);
    responder({ error: "Não foi possível obter a resposta agora. Tente novamente em instantes." }, 502);
  }
});

// Rascunho de defesa de multa (público)
app.post(`${T}/defesa`, comTenant, async (req, res) => {
  if (!llmConfigurado()) return res.status(500).json({ error: SEM_CHAVE });
  if (rateLimited(`defesa:${req.tenant.slug}:${ipDe(req)}`, 6)) return res.status(429).json({ error: "Aguarde um instante e tente de novo." });
  const hist = limparHistorico(req.body?.messages);
  // tipo: defesa_previa | jari | cetran | auto (descobre pela conversa)
  const tipo = ["defesa_previa", "jari", "cetran"].includes(req.body?.tipo) ? req.body.tipo : "auto";
  if (!hist.length || hist[hist.length - 1].role !== "user") hist.push({ role: "user", content: "Redija o rascunho da peça com base na conversa acima." });
  try { res.json({ defesa: await chamarLLM({ system: promptDefesa(req.tenant, tipo), messages: hist, maxTokens: 2800 }), tipo }); }
  catch (e) { console.error("[defesa]", e.message); res.status(502).json({ error: "Não foi possível gerar agora. Tente de novo." }); }
});

// Antigolpe (público): confere mensagem, link ou código de barras antes de pagar.
app.post(`${T}/antigolpe`, comTenant, (req, res) => {
  if (rateLimited(`golpe:${req.tenant.slug}:${ipDe(req)}`, 15)) return res.status(429).json({ error: "Aguarde um instante e tente de novo." });
  const texto = String(req.body?.texto || "").slice(0, 6000);
  if (!texto.trim()) return res.status(400).json({ error: "Cole a mensagem, o link ou o código de barras." });
  const r = analisarSuspeita(texto, req.tenant);
  if (r.nivel !== "sem_dados") registrarEvento({ tenantId: req.tenant.id, tipo: "GOLPE", canal: "WEB", tema: r.nivel, resolvido: true });
  res.json(r);
});

// Feedback do cidadão (público)
app.post(`${T}/feedback`, comTenant, (req, res) => {
  registrarEvento({ tenantId: req.tenant.id, tipo: "FEEDBACK", canal: "WEB", positivo: Boolean(req.body?.up) });
  res.json({ ok: true });
});

// ── Login das áreas internas ────────────────────────────────────────────────
app.post(`${T}/auth/login`, comTenant, async (req, res) => {
  if (rateLimited(`login:${req.tenant.slug}:${ipDe(req)}`, 10)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
  try {
    const r = await login(req.tenant, req.body?.login, req.body?.senha);
    if (!r) { auditar({ slug: req.tenant.slug, acao: "login-falhou", ip: ipDe(req) }); return res.status(401).json({ error: "Usuário ou senha incorretos." }); }
    const area = String(req.body?.area || "");
    if (area && !podeAcessar(r.usuario.perfil, area)) return res.status(403).json({ error: "Seu perfil não tem acesso a esta área." });
    const uid = lerToken(r.token)?.uid;
    auditar({ slug: req.tenant.slug, uid, perfil: r.usuario.perfil, acao: "login-senha-ok", ip: ipDe(req) });
    res.json(await etapaPosSenha(r, { slug: req.tenant.slug, uid }));
  } catch (err) { console.error("[login]", err); res.status(500).json({ error: "Não foi possível entrar agora." }); }
});
// Confere se o token ainda vale para uma área
app.get(`${T}/auth/eu`, comTenant, (req, res) => {
  const h = String(req.headers.authorization || "");
  const d = h.startsWith("Bearer ") ? lerToken(h.slice(7)) : null;
  if (!d || !d.perfil || (d.perfil !== "SUPERADMIN" && d.tid !== req.tenant.id)) return res.status(401).json({ error: "Sessão expirada." });
  const area = String(req.query.area || "");
  if (area && !podeAcessar(d.perfil, area)) return res.status(403).json({ error: "Sem acesso a esta área." });
  res.json({ perfil: d.perfil });
});

// ── Sala do Tutor: tutoria do bot (BotAyio) + indicadores ──────────────────
app.get(`${T}/tutoria`, comTenant, exigir("tutor"), (req, res) => {
  const { botayio } = integracoes(req.tenant);
  res.json({ tutorUrl: botayio.tutorUrl || null, integracoes: statusIntegracoes(req.tenant) });
});
app.get(`${T}/stats`, comTenant, exigir("tutor"), async (req, res) => {
  try { res.json({ stats: await estatisticas(req.tenant.id, Math.min(365, Number(req.query.dias) || 30)) }); }
  catch (err) { console.error("[stats]", err); res.status(500).json({ error: "Erro ao carregar indicadores." }); }
});

// ── Balcão (copiloto do atendente) ─────────────────────────────────────────
app.post(`${T}/atendente`, comTenant, exigir("balcao"), async (req, res) => {
  if (!llmConfigurado()) return res.status(500).json({ error: SEM_CHAVE });
  const hist = limparHistorico(req.body?.messages, { maxImgs: 3 });
  if (!hist.length || hist[hist.length - 1].role !== "user") return res.status(400).json({ error: "A última mensagem deve ser do atendente." });
  try {
    // Mesma base do bot (BotAyio): busca pelas 2 últimas falas do atendente.
    const consulta = hist.filter((m) => m.role === "user").slice(-2).map((m) => textoDe(m.content)).join(" ").trim();
    const trechos = await buscarNaBase(req.tenant, consulta, 8);
    const texto = await chamarLLM({ system: promptOperador(req.tenant, trechos), messages: hist, maxTokens: Math.max(MAX_TOKENS, 1800) });
    const fontes = trechos.map((x, i) => ({ n: i + 1, topico: x.topico, baseLegal: x.base_legal || null, tutoria: Boolean(x.prioritaria) }));
    res.json({ reply: texto || "Sem resposta. Reformule a pergunta.", fontes, origemBase: trechos.length ? "bot" : "local" });
  } catch (e) { console.error("[atendente]", e.message); res.status(502).json({ error: "Não foi possível responder agora." }); }
});
app.post(`${T}/termo`, comTenant, exigir("balcao"), async (req, res) => {
  if (!llmConfigurado()) return res.status(500).json({ error: SEM_CHAVE });
  const hist = limparHistorico(req.body?.messages, { maxImgs: 3 });
  if (!hist.length || hist[hist.length - 1].role !== "user") hist.push({ role: "user", content: "Gere o termo de exigência com base no atendimento acima." });
  try { res.json({ termo: await chamarLLM({ system: promptTermo(req.tenant), messages: hist, maxTokens: 1600 }) }); }
  catch (e) { console.error("[termo]", e.message); res.status(502).json({ error: "Não foi possível gerar agora." }); }
});
app.post(`${T}/atendimento`, comTenant, exigir("balcao"), async (req, res) => {
  const b = req.body || {};
  if (!b.servico && !b.resumo) return res.status(400).json({ error: "Informe ao menos o serviço." });
  const s = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
  try {
    const r = await prisma.atendimentoBalcao.create({ data: {
      tenantId: req.tenant.id, usuarioId: req.usuario.uid,
      guiche: s(b.guiche, 40), atendente: s(b.atendente, 60), servico: s(b.servico, 120),
      cidadao: s(b.cidadao, 80), cpf: s(b.cpf, 20), protocolo: s(b.protocolo, 40), resumo: s(b.resumo, 1500),
    } });
    res.json({ ok: true, id: r.id });
  } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Não foi possível salvar agora." }); }
});
app.get(`${T}/balcao`, comTenant, exigir("balcao"), async (req, res) => {
  try {
    const rows = await prisma.atendimentoBalcao.findMany({ where: { tenantId: req.tenant.id }, orderBy: { criadoEm: "desc" }, take: 500 });
    res.json({ atendimentos: rows.map((r) => ({ ...r, at: r.criadoEm.getTime() })) });
  } catch (err) { console.error("[balcao]", err); res.status(500).json({ error: "Erro ao carregar." }); }
});

// WhatsApp (Zapayio <-> BotAyio) por DETRAN
registrarWhatsApp(app);

// Administração: /api/admin (equipe Ayio) e /api/t/<slug>/admin (admin do DETRAN)
registrarAdmin(app, { limitar: (chave, max) => rateLimited(chave, max) });

// Atendimento humano (transbordo do bot) por DETRAN
registrarAtendimento(app);

// Central de Gestão de cada DETRAN (chamados, fila, indicadores, equipe)
registrarGestao(app, { limitar: (chave, max) => rateLimited(chave, max) });
registrarTutoriaGestao(app);
registrarObservatorio(app);

// "Meu DETRAN" oficial (conector da API do DETRAN + login gov.br); desligado por padrão
registrarMeuDetran(app, { limitar: (chave, max) => rateLimited(chave, max) });

// "Despachante Parente": jornadas guiadas (venda de veículo, renovação de CNH, defesa de multa)
registrarJornadas(app, { limitar: (chave, max) => rateLimited(chave, max) });

// Conferência de documentos antes do protocolo (checklist por serviço + foto)
registrarConferencia(app, { limitar: (chave, max) => rateLimited(chave, max) });

// LGPD: retenção, limpeza diária (cron), eliminação a pedido e aviso de privacidade
registrarPrivacidade(app, { limitar: (chave, max) => rateLimited(chave, max) });

// Lembretes pelo WhatsApp (CNH, defesa, licenciamento) + rotina diária (cron)
registrarLembretes(app, { limitar: (chave, max) => rateLimited(chave, max) });

// "Meu DETRAN" em modo simulação (só DETRAN em demonstração)
registrarSimulacao(app);
registrarCatalogoSim(app);

// Saúde do sistema (monitor externo, painel do Admin e da Central)
registrarSaude(app, { exigirSuper, comTenant, exigir });

// Verificação em duas etapas e trilha de auditoria
registrarSeguranca(app, { comTenant, exigir, exigirSuper, limitar: (chave, max) => rateLimited(chave, max) });

// Medição de impacto: pesquisa de 1 pergunta, marcos, origem (QR), cartaz e linha de base
registrarImpacto(app, { limitar: (chave, max) => rateLimited(chave, max) });

// ═════════════════════════ PÁGINAS ═════════════════════════
const PAGINAS = { chat: "index.html", tutor: "tutor.html", balcao: "balcao.html", painel: "painel-custos.html", admin: "admin.html", atendimento: "atendimento.html", gestao: "gestao.html", privacidade: "privacidade.html", servicos: "servicos.html" };
const htmlCache = new Map();
const lerHtml = (arq) => {
  if (!htmlCache.has(arq) || process.env.NODE_ENV === "development") htmlCache.set(arq, versionar(readFileSync(join(ROOT, "public", arq), "utf8")));
  return htmlCache.get(arq);
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Página "não encontrada" acessível (idioma, título e título de nível 1).
const naoEncontrada = (res) => res.status(404).type("html").send('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Página não encontrada</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#1B2236;max-width:560px;margin:15vh auto;padding:0 16px}h1{font-size:22px;color:#192662}</style></head><body><main><h1>Página não encontrada</h1><p>Confira o endereço. Se você chegou aqui por um link, ele pode ter expirado.</p></main></body></html>');
const urlSegura = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "#");

function renderPagina(arq, t, sim = false) {
  const cfg = configPublica(t);
  const c = cfg.conteudo || {};
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const vars = {
    SIGLA: t.sigla, ASSISTENTE: t.assistente, NOME: t.nome, GOVERNO: t.governo, UF: t.uf.toUpperCase(),
    SLUG: t.slug, PORTAL: t.portalUrl, TELEFONE: t.telefone,
    MARCA: cfg.marcaUrl, LOGO: cfg.logoUrl,
    COR: t.corPrimaria || "",
    CONTATO: t.telefone ? `no portal oficial ou pelo telefone ${t.telefone}` : "no portal oficial",
    // LGPD (página /<uf>/privacidade)
    RETENCAO: String(configDe(t).retencaoConversasDias), RETENCAOCH: String(configDe(t).retencaoChamadosDias),
    ENCARREGADO: configDe(t).encarregado || `pelos canais oficiais do ${t.sigla}`,
    BVTITULO: c.boasVindasTitulo || `Olá! Bora resolver teu serviço de trânsito?`,
    BVTEXTO: c.boasVindasTexto || `Tire suas dúvidas sobre habilitação (CNH), veículos, multas e licenciamento. Comece por uma das perguntas abaixo:`,
  };
  const canais = (Array.isArray(c.canais) && c.canais.length ? c.canais : [{ rotulo: `Portal ${t.sigla}`, url: t.portalUrl }])
    .map((k) => `<a href="${esc(urlSegura(k.url))}" target="_blank" rel="noopener noreferrer">↗ ${esc(k.rotulo)}</a>`).join("\n          ");
  let html = lerHtml(arq)
    .replace(/\{\{\{CANAIS\}\}\}/g, canais)
    .replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
  const boot = `<script>window.TENANT=${json};window.API_BASE="/api/t/${t.slug}";window.TENANT_BASE="/${t.slug}";${sim ? "window.SIM_LIBERADO=true;" : ""}</script>`;
  // Demonstração: fora do Google e com faixa avisando que não é canal oficial.
  const demoHead = t.demonstracao
    ? `<meta name="robots" content="noindex, nofollow" /><style>.demo-faixa{position:sticky;top:0;z-index:50;background:#FFF4CC;color:#5C4400;font:600 12.5px/1.35 system-ui,sans-serif;text-align:center;padding:7px 12px;border-bottom:1px solid #EBD58A}.demo-faixa a{color:#5C4400;text-decoration:underline}body.demo .app{height:calc(100dvh - 34px)}</style>`
    : "";
  html = html.replace("</head>", `${cssDoTema(t)}\n${demoHead}${boot}\n</head>`);
  if (t.demonstracao) {
    const faixa = `<div class="demo-faixa" role="note">Demonstração — este não é um canal oficial do ${esc(t.sigla)}. Para serviços e informações oficiais, acesse <a href="${esc(urlSegura(t.portalUrl))}" target="_blank" rel="noopener noreferrer">o portal do ${esc(t.sigla)}</a>.</div>`;
    html = html.replace(/<body([^>]*)>/i, (m, attrs) => `<body${attrs.includes("class=") ? attrs.replace(/class="/, 'class="demo ') : `${attrs} class="demo"`}>\n${faixa}`);
  }
  return html;
}

async function pagina(req, res, qual) {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return naoEncontrada(res);
  try {
    const t = await buscarTenant(slug);
    if (!t) return res.status(404).send("DETRAN não encontrado.");
    if (t.demonstracao) {
      res.set("X-Robots-Tag", "noindex, nofollow");
      res.set("Cache-Control", "private, no-store");
      // Link privado: grava o cookie e volta para o endereço limpo (a chave não fica na barra).
      if (chaveNaUrl(req, t)) {
        gravarCookieDemo(req, res, t);
        const resto = new URLSearchParams(req.query); resto.delete("demo");
        const q = resto.toString();
        return res.redirect(302, req.path + (q ? `?${q}` : ""));
      }
      if (!liberadoDemo(req, t)) return res.status(403).set("Content-Type", "text/html; charset=utf-8").send(paginaRestrita(t));
    }
    res.set("Content-Type", "text/html; charset=utf-8").send(renderPagina(PAGINAS[qual], t, simPorCookie(req, t)));
  } catch (err) { console.error("[pagina]", err); res.status(503).send("Serviço indisponível no momento."); }
}

// Endereços antigos continuam funcionando (vão para o DETRAN padrão).
app.get("/", (_req, res) => res.redirect(302, `/${DEFAULT_TENANT}`));
app.get(["/tutor", "/tutor.html"], (_req, res) => res.redirect(302, `/${DEFAULT_TENANT}/tutor`));
app.get(["/balcao", "/balcao.html"], (_req, res) => res.redirect(302, `/${DEFAULT_TENANT}/balcao`));
app.get(["/painel-custos", "/painel-custos.html"], (_req, res) => res.redirect(302, `/${DEFAULT_TENANT}/painel`));
app.get("/index.html", (_req, res) => res.redirect(302, `/${DEFAULT_TENANT}`));

// Área geral da equipe Ayio (sem DETRAN): cadastra e gerencia todos.
app.get("/admin", (_req, res) => {
  const html = lerHtml("admin.html")
    .replace(/\{\{([A-Z]+)\}\}/g, (m, k) => ({ SIGLA: "Ayio", ASSISTENTE: "Assistente DETRAN", SLUG: "" }[k] ?? ""))
    .replace("</head>", `<script>window.ADMIN_GERAL=true;</script>\n</head>`);
  res.set("Content-Type", "text/html; charset=utf-8").send(html);
});

app.get("/:slug", (req, res) => pagina(req, res, "chat"));
app.get("/:slug/admin", (req, res) => pagina(req, res, "admin"));
app.get("/:slug/atendimento", (req, res) => pagina(req, res, "atendimento"));
app.get("/:slug/gestao", (req, res) => pagina(req, res, "gestao"));
app.get("/:slug/privacidade", (req, res) => pagina(req, res, "privacidade"));
app.get("/:slug/servicos", async (req, res) => {
  // Demonstração: abre com o link da demo. DETRAN cliente: só com o link privado da simulação (?sim=CHAVE -> cookie).
  const t = SLUG_RE.test(String(req.params.slug || "").toLowerCase()) ? await buscarTenant(String(req.params.slug).toLowerCase()).catch(() => null) : null;
  if (!t) return naoEncontrada(res);
  if (!t.demonstracao) {
    res.set("X-Robots-Tag", "noindex, nofollow"); res.set("Cache-Control", "private, no-store");
    if (chaveSimNaUrl(req, t)) {
      gravarCookieSim(req, res, t);
      const resto = new URLSearchParams(req.query); resto.delete("sim");
      const q = resto.toString();
      return res.redirect(302, req.path + (q ? `?${q}` : ""));
    }
    if (!simPorCookie(req, t)) return naoEncontrada(res);
  }
  pagina(req, res, "servicos");
});
app.get("/:slug/tutor", (req, res) => pagina(req, res, "tutor"));
app.get("/:slug/balcao", (req, res) => pagina(req, res, "balcao"));
app.get("/:slug/painel", (req, res) => pagina(req, res, "painel"));

// Erro não tratado em qualquer rota: registra (sem dados pessoais) e responde
// com mensagem amigável, em vez de derrubar a função ou sumir em silêncio.
app.use((err, req, res, _next) => {
  registrarFalha("rota", err, { rota: String(req.path || "").replace(/\/\d{6,}/g, "/•").slice(0, 80), slug: req.tenant?.slug });
  if (res.headersSent) return;
  res.status(500).json({ error: "Algo deu errado do nosso lado. Tente de novo em instantes." });
});
if (!globalThis.__detranErrosGlobais) {
  globalThis.__detranErrosGlobais = true;
  process.on("unhandledRejection", (e) => registrarFalha("promessa", e));
}

export default app;
export { MODEL };
