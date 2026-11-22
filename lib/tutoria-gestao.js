// ─────────────────────────────────────────────────────────────────────────────
// Tutoria do bot dentro da Central de Gestão: /api/t/<slug>/gestao/tutoria/*
//
// O "cérebro" de cada DETRAN é o bot dele no BotAyio. Aqui a equipe (TUTOR,
// GESTOR, ADMIN) ensina coisas novas, corrige respostas, publica avisos com
// prazo e sobe normas — tudo entra no ar NA HORA (decisão de 20/11/2026: sem
// etapa de aprovação).
//
// Conversa servidor a servidor com a "tutoria" do BotAyio, usando o link de
// tutoria cadastrado no /admin (bot + token). O token nunca vai ao navegador;
// o autor de cada ensinamento é o usuário logado no DETRAN.
// ─────────────────────────────────────────────────────────────────────────────
import express from "express";
import { prisma } from "./db.js";
import { comTenant, integracoes } from "./tenants.js";
import { exigir } from "./auth.js";
import { normasDoTenant, verificarNormas, decidirNorma, baixarNorma } from "./normas.js";
import { invalidarCache } from "./cache-respostas.js";

const MAX_DOC = 4 * 1024 * 1024; // a Vercel recusa corpos maiores que ~4,5 MB

// Bot e token a partir do link de tutoria (…/tutor/app?bot=<uuid>&token=<tok>).
export function alvoTutoria(tenant) {
  const url = integracoes(tenant).botayio.tutorUrl;
  if (!url) return null;
  try {
    const u = new URL(url);
    const bot = u.searchParams.get("bot"), token = u.searchParams.get("token");
    if (!bot || !token || !/^[0-9a-f-]{36}$/i.test(bot)) return null;
    return { base: u.origin, bot, token };
  } catch { return null; }
}

// LGPD: a equipe revisa o que o bot respondeu, não precisa ver dado pessoal.
export function mascarar(txt) {
  return String(txt ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
    .replace(/(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]")
    .replace(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/gi, "[placa]")
    .replace(/\b\d{9,11}\b/g, "[número]");
}

// Resumo do "porquê" de uma resposta: o que a busca achou na base (sem o texto inteiro).
function resumoRaciocinio(rac) {
  const out = [];
  for (const ev of rac || []) {
    if (ev?.tipo !== "busca") continue;
    for (const r of ev.resultados || []) {
      out.push({ topico: String(r.topico || "").slice(0, 160), score: typeof r.score === "number" ? Math.round(r.score * 100) / 100 : null, usado: Boolean(r.usado), ensinado: Boolean(r.prioritaria) });
    }
  }
  return out.slice(0, 6);
}
const respostaOut = (i) => ({
  mensagemId: i.mensagem_id, quando: i.quando, pergunta: mascarar(i.pergunta), resposta: mascarar(i.resposta),
  confianca: i.confianca, jaCorrigida: Boolean(i.ja_tem_correcao), base: resumoRaciocinio(i.raciocinio),
});
const ensinadoOut = (c) => ({
  id: c.id, pergunta: c.pergunta, resposta: c.resposta_corrigida, autor: c.autor, ativo: c.ativo, noAr: c.no_ar !== false && c.ativo,
  tipo: c.tipo || "resposta", vigenteDe: c.vigente_de || null, vigenteAte: c.vigente_ate || null,
  dataRevisao: c.data_revisao || null, revisar: Boolean(c.vencida), criadoEm: c.criado_em, origem: c.resposta_original ? "correcao" : "novo",
});
// "" = limpar, null = sem data, "AAAA-MM-DD" = data; undefined = formato inválido.
const dataOk = (v) => (v === "" ? "" : v == null ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : undefined);

async function chamar(alvo, metodo, caminho, { query = {}, json, form } = {}) {
  const q = new URLSearchParams({ ...query, token: alvo.token });
  const url = `${alvo.base}/tutoria/${alvo.bot}${caminho}?${q}`;
  const opts = { method: metodo, headers: {}, signal: AbortSignal.timeout(metodo === "GET" ? 20000 : 60000) };
  if (json !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(json); }
  if (form) opts.body = form;
  let r;
  try { r = await fetch(url, opts); }
  catch (e) { const err = new Error("O BotAyio não respondeu agora. Tente de novo em instantes."); err.status = 502; err.causa = e.message; throw err; }
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
  if (!r.ok) {
    const det = data?.detail;
    const msg = r.status === 403 ? "O link de tutoria deste DETRAN não é mais aceito pelo BotAyio (token trocado). Atualize-o no /admin."
      : (r.status === 404 || r.status === 405) && !det ? "O BotAyio ainda não tem esta função publicada."
      : typeof det === "string" ? det : Array.isArray(det) ? det.map((d) => d.msg).join("; ") : `O BotAyio recusou o pedido (${r.status}).`;
    const err = new Error(msg); err.status = r.status === 403 ? 409 : r.status >= 500 ? 502 : r.status; throw err;
  }
  return data;
}

// Trechos da base do bot (a MESMA que ele usa) para uma pergunta — usado pelo
// copiloto do balcão. Sem tutoria ligada ou com BotAyio fora: lista vazia.
export async function buscarNaBase(tenant, pergunta, k = 8) {
  const alvo = alvoTutoria(tenant);
  if (!alvo || !String(pergunta || "").trim()) return [];
  try {
    const d = await chamar(alvo, "POST", "/buscar", { json: { pergunta: String(pergunta).slice(0, 1000), k } });
    return Array.isArray(d?.trechos) ? d.trechos : [];
  } catch (e) {
    console.warn("[balcao] busca na base do bot:", e.message);
    return [];
  }
}

export function registrarTutoriaGestao(app) {
  const B = "/api/t/:slug/gestao/tutoria";
  // Qualquer mudança na base (ensinar, editar, desligar, documento, norma)
  // invalida o cache de respostas daquele DETRAN assim que der certo.
  app.use(B, (req, res, next) => {
    if (req.method !== "GET" && !/\/testar\/?$/.test(req.path)) {
      res.on("finish", () => { if (res.statusCode < 400 && req.tenant?.slug) invalidarCache(req.tenant.slug); });
    }
    next();
  });
  const precisaAlvo = (req, res, next) => {
    const alvo = alvoTutoria(req.tenant);
    if (!alvo) return res.status(409).json({ error: "A tutoria do bot deste DETRAN ainda não foi ligada. Cadastre o link de tutoria do BotAyio no /admin → Integrações.", semTutoria: true });
    req.alvo = alvo; next();
  };
  const mw = [comTenant, exigir("tutor"), precisaAlvo];
  const erro = (res, e) => { if (!e.status || e.status >= 500) console.error("[tutoria]", e.message, e.causa || ""); res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message || "Não foi possível concluir agora." }); };
  const autorDe = async (req) => (await prisma.usuario.findUnique({ where: { id: req.usuario.uid }, select: { nome: true } }).catch(() => null))?.nome || "Equipe Ayio";

  app.get(`${B}/status`, comTenant, exigir("tutor"), (req, res) => {
    const alvo = alvoTutoria(req.tenant);
    res.json({ ligada: Boolean(alvo) });
  });

  // Respostas reais do bot (site e WhatsApp). revisao=1 → só as "no escuro".
  app.get(`${B}/respostas`, ...mw, async (req, res) => {
    try {
      const limite = Math.min(200, Math.max(10, Number(req.query.limite) || 80));
      const data = await chamar(req.alvo, "GET", "/respostas", { query: { limit: String(limite), ...(req.query.revisao === "1" ? { so_revisao: "true" } : {}) } });
      res.json({ itens: (data || []).map(respostaOut) });
    } catch (e) { erro(res, e); }
  });

  app.get(`${B}/estatisticas`, ...mw, async (req, res) => {
    try { res.json(await chamar(req.alvo, "GET", "/estatisticas")); } catch (e) { erro(res, e); }
  });

  // Ensinar (novo, correção de uma resposta ou aviso com prazo) — entra no ar na hora.
  app.post(`${B}/ensinar`, ...mw, async (req, res) => {
    try {
      const b = req.body || {};
      const pergunta = String(b.pergunta || "").trim().slice(0, 2000), resposta = String(b.resposta || "").trim().slice(0, 8000);
      if (!pergunta || !resposta) return res.status(400).json({ error: "Escreva a pergunta e a resposta certa." });
      const tipo = b.tipo === "aviso" ? "aviso" : "resposta";
      const de = dataOk(b.vigenteDe), ate = dataOk(b.vigenteAte), rev = dataOk(b.dataRevisao);
      if ([de, ate, rev].includes(undefined)) return res.status(400).json({ error: "Datas devem estar no formato AAAA-MM-DD." });
      if (tipo === "aviso" && !ate) return res.status(400).json({ error: "Aviso precisa de data final (ele sai do ar sozinho nesse dia)." });
      const data = await chamar(req.alvo, "POST", "/corrigir", { json: {
        pergunta, resposta_corrigida: resposta, autor: (await autorDe(req)).slice(0, 120), tipo,
        vigente_de: de || null, vigente_ate: ate || null, data_revisao: rev || null,
        mensagem_id: b.mensagemId || null, resposta_original: b.respostaOriginal ? String(b.respostaOriginal).slice(0, 8000) : null,
      } });
      res.status(201).json({ ok: true, id: data?.id });
    } catch (e) { erro(res, e); }
  });

  // Pergunta de teste ao bot (sessão isolada; não vira conversa real).
  app.post(`${B}/testar`, ...mw, async (req, res) => {
    try {
      const pergunta = String(req.body?.pergunta || "").trim().slice(0, 2000);
      if (!pergunta) return res.status(400).json({ error: "Escreva a pergunta para testar." });
      const data = await chamar(req.alvo, "POST", "/testar", { json: { pergunta } });
      const usados = resumoRaciocinio(data?.trace);
      res.json({ resposta: String(data?.resposta || "").replace(/\[\[(SEMBASE|DEFESA|FORM:[\w-]+)\]\]/g, "").trim(), base: usados });
    } catch (e) { erro(res, e); }
  });

  // O que já foi ensinado (inclui avisos).
  app.get(`${B}/ensinado`, ...mw, async (req, res) => {
    try { res.json({ itens: (await chamar(req.alvo, "GET", "/correcoes") || []).map(ensinadoOut) }); } catch (e) { erro(res, e); }
  });
  app.put(`${B}/ensinado/:id`, ...mw, async (req, res) => {
    try {
      const b = req.body || {};
      const resposta = String(b.resposta || "").trim().slice(0, 8000);
      if (!resposta) return res.status(400).json({ error: "A resposta não pode ficar vazia." });
      if (["vigenteDe", "vigenteAte", "dataRevisao"].some((k) => b[k] !== undefined && dataOk(b[k]) === undefined)) return res.status(400).json({ error: "Datas devem estar no formato AAAA-MM-DD." });
      const de = dataOk(b.vigenteDe), ate = dataOk(b.vigenteAte), rev = dataOk(b.dataRevisao);
      const json = { resposta_corrigida: resposta, autor: (await autorDe(req)).slice(0, 120) };
      if (b.vigenteDe !== undefined) json.vigente_de = de ?? "";
      if (b.vigenteAte !== undefined) json.vigente_ate = ate ?? "";
      if (b.dataRevisao !== undefined) json.data_revisao = rev ?? "";
      const data = await chamar(req.alvo, "PUT", `/correcoes/${encodeURIComponent(req.params.id)}`, { json });
      res.json({ item: ensinadoOut(data) });
    } catch (e) { erro(res, e); }
  });
  app.post(`${B}/ensinado/:id/alternar`, ...mw, async (req, res) => {
    try { res.json(await chamar(req.alvo, "POST", `/correcoes/${encodeURIComponent(req.params.id)}/alternar`)); } catch (e) { erro(res, e); }
  });
  app.get(`${B}/ensinado/:id/historico`, ...mw, async (req, res) => {
    try { res.json({ itens: await chamar(req.alvo, "GET", `/correcoes/${encodeURIComponent(req.params.id)}/historico`) || [] }); } catch (e) { erro(res, e); }
  });

  // Normas novas do CONTRAN detectadas pela rotina diária (ver lib/normas.js).
  app.get(`${B}/normas`, comTenant, exigir("tutor"), async (req, res) => {
    try { res.json({ itens: await normasDoTenant(req.tenant.slug) }); } catch (e) { erro(res, e); }
  });
  app.post(`${B}/normas/verificar`, comTenant, exigir("tutor"), async (req, res) => {
    try { const r = await verificarNormas(); res.json({ ...r, itens: await normasDoTenant(req.tenant.slug) }); } catch (e) { erro(res, e); }
  });
  app.post(`${B}/normas/:numero`, comTenant, exigir("tutor"), async (req, res) => {
    try {
      const numero = Number(req.params.numero);
      const norma = (await normasDoTenant(req.tenant.slug)).find((x) => x.numero === numero);
      if (!norma) return res.status(404).json({ error: "Norma não encontrada." });
      const acao = String(req.body?.acao || "");
      const autor = await autorDe(req);
      if (acao === "incluir") {
        const alvo = alvoTutoria(req.tenant);
        if (!alvo) return res.status(409).json({ error: "A tutoria do bot deste DETRAN ainda não foi ligada.", semTutoria: true });
        const pdf = await baixarNorma(norma);
        const form = new FormData();
        form.append("file", new Blob([pdf], { type: "application/pdf" }), `Resolucao_CONTRAN_${norma.numero}_${norma.ano}.pdf`);
        form.append("base_legal", `${norma.titulo} (${norma.url})`);
        const data = await chamar(alvo, "POST", "/documentos", { form });
        const d = await decidirNorma(req.tenant.slug, numero, "incluida", autor);
        return res.json({ ok: true, decisao: d, trechos: data?.adicionados || 0 });
      }
      const mapa = { ja_tem: "ja_tem", ignorar: "ignorada", desfazer: null };
      if (!(acao in mapa)) return res.status(400).json({ error: "Ação inválida." });
      res.json({ ok: true, decisao: await decidirNorma(req.tenant.slug, numero, mapa[acao], autor) });
    } catch (e) {
      if (/^Já existe/.test(e.message)) { await decidirNorma(req.tenant.slug, Number(req.params.numero), "incluida", await autorDe(req)); return res.json({ ok: true, jaExistia: true }); }
      erro(res, e);
    }
  });

  // Documentos (normas) — texto integral na base do bot.
  app.get(`${B}/documentos`, ...mw, async (req, res) => {
    try { res.json({ itens: await chamar(req.alvo, "GET", "/documentos") || [] }); } catch (e) { erro(res, e); }
  });
  app.post(`${B}/documentos`, ...mw, express.raw({ type: () => true, limit: MAX_DOC }), async (req, res) => {
    try {
      const nome = decodeURIComponent(String(req.headers["x-nome-arquivo"] || "")).replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 200);
      if (!nome || !/\.(pdf|docx|txt|md)$/i.test(nome)) return res.status(400).json({ error: "Envie um arquivo PDF, DOCX, TXT ou MD." });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Arquivo vazio." });
      const form = new FormData();
      form.append("file", new Blob([req.body]), nome);
      const baseLegal = decodeURIComponent(String(req.headers["x-base-legal"] || "")).trim().slice(0, 500);
      if (baseLegal) form.append("base_legal", baseLegal);
      const data = await chamar(req.alvo, "POST", "/documentos", { form });
      res.status(201).json({ ok: true, nome: data?.nome, trechos: data?.adicionados, truncado: Boolean(data?.truncado) });
    } catch (e) { erro(res, e); }
  });
  app.delete(`${B}/documentos`, ...mw, async (req, res) => {
    try {
      const nome = String(req.query.nome || "").trim();
      if (!nome) return res.status(400).json({ error: "Informe o documento." });
      res.json(await chamar(req.alvo, "DELETE", "/documentos", { query: { nome } }));
    } catch (e) { erro(res, e); }
  });

  // Erro de tamanho do express.raw → mensagem clara.
  app.use(B, (err, req, res, next) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Arquivo grande demais para envio pela Central (máx. 4 MB). Divida o PDF ou envie em TXT." });
    next(err);
  });
}
