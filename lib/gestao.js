// ─────────────────────────────────────────────────────────────────────────────
// Central de Gestão de cada DETRAN: /<uf>/gestao
//
// Junta, numa tela só, a operação do atendimento humano:
//   - visão geral ao vivo e indicadores do período
//   - caixa de entrada (fila, meus, equipe, no bot, resolvidos), notas internas,
//     repasse entre colegas e "puxar o próximo da fila"
//   - chamados com protocolo (UF-AAAA-NNNNNN), linha do tempo e Kanban
//   - fichas dos cidadãos com etiquetas e anotações
//   - equipe com status (online/pausa/offline) e produtividade
//   - respostas rápidas, etiquetas e configurações (gestor/admin)
//   - IA para resumir conversa, sugerir resposta e preencher chamado
//
// Tudo em /api/t/<slug>/gestao/*, com login do próprio DETRAN.
// As ações de conversa (assumir, responder, devolver, encerrar) continuam em
// lib/atendimento.js e são as mesmas usadas por esta tela.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { comTenant, limparCacheTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { enviarWhatsApp } from "../whatsapp.js";
import { quemSou, conversaDoTenant, resumoConversa } from "./atendimento.js";
import { chamarLLM, llmConfigurado } from "./llm.js";
import { limparSeAtrasado } from "./privacidade.js";
import { lembretesSeAtrasado } from "./lembretes.js";
import { textoMeusPedidos, linkConta, variantesFone } from "./conta-cidadao.js";
import {
  configDe, configPublicaGestao, limparConfig, agoraNoFuso, PRIORIDADES, STATUS_CHAMADO, STATUS_TEXTO, RESPOSTAS_PADRAO, ETIQUETAS_PADRAO,
} from "./gestao-config.js";

const GESTORES = ["GESTOR", "ADMIN", "SUPERADMIN"];
const STATUS_ATENDENTE = ["ONLINE", "PAUSA", "OFFLINE"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ABERTOS = ["ABERTO", "EM_ANDAMENTO", "AGUARDANDO_CIDADAO"];

const falha = (res, err, msg = "Não foi possível concluir agora.") => {
  console.error("[gestao]", err);
  res.status(500).json({ error: msg });
};
const soGestor = (req, res, next) => (GESTORES.includes(req.usuario.perfil) ? next() : res.status(403).json({ error: "Só gestores e administradores podem fazer isso." }));
const minutos = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / 60000) : null);
const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const arred = (n, c = 1) => (n == null ? null : Math.round(n * 10 ** c) / 10 ** c);
const listaEtiquetas = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : []);

export function protocoloDe(tenant, numero, ano = new Date().getFullYear()) {
  return `${tenant.uf}-${ano}-${String(numero).padStart(6, "0")}`;
}
export const PROTOCOLO_RE = /\b([A-Z]{2})-(\d{4})-(\d{6})\b/i;

// Texto que o cidadão recebe sobre o chamado (WhatsApp).
export function textoSituacao(ch, eventosPublicos = []) {
  const linhas = [`📋 *Protocolo ${ch.protocolo}*`, `Assunto: ${ch.assunto}`, `Situação: *${STATUS_TEXTO[ch.status] || ch.status}*`];
  if (ch.prazoEm && ABERTOS.includes(ch.status)) linhas.push(`Previsão: ${new Date(ch.prazoEm).toLocaleDateString("pt-BR")}`);
  const ult = eventosPublicos[eventosPublicos.length - 1];
  if (ult) linhas.push("", `Última atualização: ${ult.texto}`);
  return linhas.join("\n");
}

async function avisarCidadao(tenant, ch, texto) {
  if (!ch.avisarCidadao || ch.canal !== "WHATSAPP" || !ch.contato) return false;
  try { await enviarWhatsApp(tenant, ch.contato, texto); return true; }
  catch (err) { console.warn("[gestao] aviso do chamado não enviado:", err.message); return false; }
}

// Primeira vez na central: cria respostas rápidas e etiquetas de exemplo.
async function garantirPadroes(tenantId) {
  const [nr, ne] = await Promise.all([
    prisma.respostaRapida.count({ where: { tenantId } }),
    prisma.etiqueta.count({ where: { tenantId } }),
  ]);
  if (!nr) await prisma.respostaRapida.createMany({ data: RESPOSTAS_PADRAO.map((r, i) => ({ tenantId, ordem: i, ...r })), skipDuplicates: true });
  if (!ne) await prisma.etiqueta.createMany({ data: ETIQUETAS_PADRAO.map((e) => ({ tenantId, ...e })), skipDuplicates: true });
}

const resumoChamado = (c) => ({
  id: c.id, protocolo: c.protocolo, numero: c.numero, assunto: c.assunto, descricao: c.descricao, categoria: c.categoria,
  prioridade: c.prioridade, status: c.status, responsavelId: c.responsavelId, responsavelNome: c.responsavelNome,
  prazoEm: c.prazoEm, criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, resolvidoEm: c.resolvidoEm,
  canal: c.canal, contato: c.contato, nome: c.nome, conversaId: c.conversaId, avisarCidadao: c.avisarCidadao, criadoPorNome: c.criadoPorNome,
  vencido: Boolean(c.prazoEm && ABERTOS.includes(c.status) && new Date(c.prazoEm) < new Date()),
});

export function registrarGestao(app, { limitar } = {}) {
  const G = "/api/t/:slug/gestao";
  const mw = [comTenant, exigir("gestao")];
  const limiteIA = (req, res, next) => (limitar && limitar(`ia:${req.tenant.slug}:${req.usuario.uid}`, 20) ? res.status(429).json({ error: "Muitos pedidos à IA em sequência. Aguarde um minuto." }) : next());

  // ── Quem sou + tudo que a tela precisa para começar ──
  app.get(`${G}/inicio`, comTenant, exigir("central"), async (req, res) => {
    try {
      const t = req.tenant;
      // TUTOR: só a seção Tutoria (sem fila, equipe nem respostas da operação).
      if (req.usuario.perfil === "TUTOR") {
        const eu = await prisma.usuario.findUnique({ where: { id: req.usuario.uid }, select: { id: true, nome: true, perfil: true } });
        return res.json({
          eu: { ...(eu || { id: req.usuario.uid, nome: "Tutor", perfil: "TUTOR" }), status: "OFFLINE" },
          podeGerir: false, soTutoria: true, podeTutoria: true, config: configPublicaGestao(t), equipe: [], respostas: [], etiquetas: [],
          ia: false, prioridades: PRIORIDADES, statusChamado: STATUS_CHAMADO, statusTexto: STATUS_TEXTO,
        });
      }
      await garantirPadroes(t.id);
      limparSeAtrasado(t); // LGPD: limpeza diária também ao abrir a central (sem esperar)
      lembretesSeAtrasado(t); // lembretes do dia, se o cron não rodou
      const [eu, equipe, respostas, etiquetas] = await Promise.all([
        prisma.usuario.findUnique({ where: { id: req.usuario.uid }, select: { id: true, nome: true, perfil: true, statusAtendimento: true } }),
        prisma.usuario.findMany({ where: { tenantId: t.id, ativo: true }, select: { id: true, nome: true, perfil: true, statusAtendimento: true, statusEm: true }, orderBy: { nome: "asc" } }),
        prisma.respostaRapida.findMany({ where: { tenantId: t.id }, orderBy: [{ ordem: "asc" }, { atalho: "asc" }] }),
        prisma.etiqueta.findMany({ where: { tenantId: t.id }, orderBy: { nome: "asc" } }),
      ]);
      res.json({
        eu: eu ? { ...eu, status: eu.statusAtendimento } : { id: req.usuario.uid, nome: "Equipe Ayio", perfil: req.usuario.perfil, status: "OFFLINE" },
        podeGerir: GESTORES.includes(req.usuario.perfil),
        podeTutoria: GESTORES.includes(req.usuario.perfil), soTutoria: false,
        config: configPublicaGestao(t),
        equipe: equipe.map((u) => ({ id: u.id, nome: u.nome, perfil: u.perfil, status: u.statusAtendimento })),
        respostas: respostas.map((r) => ({ id: r.id, atalho: r.atalho, titulo: r.titulo, texto: r.texto })),
        etiquetas: etiquetas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
        ia: llmConfigurado(),
        prioridades: PRIORIDADES, statusChamado: STATUS_CHAMADO, statusTexto: STATUS_TEXTO,
      });
    } catch (err) { falha(res, err, "Não foi possível abrir a central."); }
  });

  app.put(`${G}/eu/status`, ...mw, async (req, res) => {
    const st = String(req.body?.status || "").toUpperCase();
    if (!STATUS_ATENDENTE.includes(st)) return res.status(400).json({ error: "Status inválido." });
    try {
      await prisma.usuario.updateMany({ where: { id: req.usuario.uid }, data: { statusAtendimento: st, statusEm: new Date() } });
      res.json({ ok: true, status: st });
    } catch (err) { falha(res, err); }
  });

  // ── Pulso (a tela consulta a cada poucos segundos) ──
  app.get(`${G}/pulso`, ...mw, async (req, res) => {
    try {
      const t = req.tenant.id;
      const humanos = await prisma.conversa.findMany({
        where: { tenantId: t, status: "HUMANO" },
        select: { id: true, atendenteId: true, transbordoEm: true, ultimaEm: true, mensagens: { orderBy: { criadoEm: "desc" }, take: 1, select: { autor: true } } },
      });
      const fila = humanos.filter((h) => !h.atendenteId);
      const meus = humanos.filter((h) => h.atendenteId === req.usuario.uid);
      const [chamadosMeus, vencidos] = await Promise.all([
        prisma.chamado.count({ where: { tenantId: t, responsavelId: req.usuario.uid, status: { in: ABERTOS } } }),
        prisma.chamado.count({ where: { tenantId: t, status: { in: ABERTOS }, prazoEm: { lt: new Date() } } }),
      ]);
      res.json({
        fila: fila.length,
        filaMaisAntiga: fila.reduce((m, h) => (!m || (h.transbordoEm && h.transbordoEm < m) ? h.transbordoEm : m), null),
        meus: meus.length,
        meusAguardando: meus.filter((h) => h.mensagens[0]?.autor === "CIDADAO").length,
        emAtendimento: humanos.length - fila.length,
        chamadosMeus, chamadosVencidos: vencidos,
        assinatura: humanos.map((h) => `${h.id}:${+new Date(h.ultimaEm)}:${h.atendenteId || ""}`).join("|").length + ":" + Math.max(0, ...humanos.map((h) => +new Date(h.ultimaEm))),
        agora: new Date(),
      });
    } catch (err) { falha(res, err); }
  });

  // ── Caixa de entrada ──
  // aba: fila | meus | equipe | bot | resolvidos | todas
  app.get(`${G}/conversas`, ...mw, async (req, res) => {
    const aba = String(req.query.aba || "fila");
    const busca = String(req.query.busca || "").trim().slice(0, 60);
    const etiqueta = String(req.query.etiqueta || "");
    const categoria = String(req.query.categoria || "");
    const where = { tenantId: req.tenant.id };
    if (aba === "fila") Object.assign(where, { status: "HUMANO", atendenteId: null });
    else if (aba === "meus") Object.assign(where, { status: "HUMANO", atendenteId: req.usuario.uid });
    else if (aba === "equipe") Object.assign(where, { status: "HUMANO", NOT: { atendenteId: null } });
    else if (aba === "bot") Object.assign(where, { status: "BOT" });
    else if (aba === "resolvidos") Object.assign(where, { status: "ENCERRADA" });
    if (categoria) where.categoria = categoria;
    if (busca) {
      const dig = busca.replace(/\D/g, "");
      where.OR = [{ nome: { contains: busca } }, ...(dig.length >= 3 ? [{ contato: { contains: dig } }] : [])];
    }
    try {
      let cs = await prisma.conversa.findMany({
        where, take: 150,
        orderBy: aba === "fila" ? { transbordoEm: "asc" } : { ultimaEm: "desc" },
        include: { mensagens: { orderBy: { criadoEm: "desc" }, take: 6, select: { autor: true, texto: true, criadoEm: true } } },
      });
      const fichas = await prisma.contato.findMany({ where: { tenantId: req.tenant.id, contato: { in: cs.map((c) => c.contato) } }, select: { contato: true, etiquetas: true } });
      const etqDe = Object.fromEntries(fichas.map((f) => [f.contato, listaEtiquetas(f.etiquetas)]));
      if (etiqueta) cs = cs.filter((c) => (etqDe[c.contato] || []).includes(etiqueta));
      res.json({
        conversas: cs.map((c) => {
          const visiveis = c.mensagens.filter((m) => m.autor !== "SISTEMA" && m.autor !== "NOTA");
          // espera = desde a 1ª mensagem do cidadão ainda sem resposta (ou desde o transbordo)
          let esperaDesde = null;
          if (c.status === "HUMANO") {
            for (const m of visiveis) { if (m.autor === "CIDADAO") esperaDesde = m.criadoEm; else break; }
            if (!esperaDesde && !c.primeiraRespostaEm) esperaDesde = c.transbordoEm;
          }
          return { ...resumoConversa(c, visiveis[0]), etiquetas: etqDe[c.contato] || [], esperaDesde };
        }),
      });
    } catch (err) { falha(res, err, "Erro ao listar as conversas."); }
  });

  app.get(`${G}/conversas/:id`, ...mw, async (req, res) => {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      const [msgs, ficha, chamados] = await Promise.all([
        prisma.mensagem.findMany({ where: { conversaId: c.id }, orderBy: { criadoEm: "desc" }, take: 400 }),
        prisma.contato.findUnique({ where: { tenantId_contato: { tenantId: req.tenant.id, contato: c.contato } } }),
        prisma.chamado.findMany({ where: { tenantId: req.tenant.id, contato: c.contato }, orderBy: { criadoEm: "desc" }, take: 20 }),
      ]);
      res.json({
        conversa: resumoConversa(c, msgs.find((m) => m.autor !== "SISTEMA" && m.autor !== "NOTA")),
        mensagens: msgs.reverse().map((m) => ({ id: m.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, criadoEm: m.criadoEm })),
        ficha: { nome: ficha?.nome || c.nome || "", notas: ficha?.notas || "", etiquetas: listaEtiquetas(ficha?.etiquetas) },
        chamados: chamados.map(resumoChamado),
      });
    } catch (err) { falha(res, err, "Erro ao abrir a conversa."); }
  });

  // Nota interna: fica no histórico, o cidadão não recebe.
  app.post(`${G}/conversas/:id/nota`, ...mw, async (req, res) => {
    const texto = String(req.body?.texto || "").trim().slice(0, 4000);
    if (!texto) return res.status(400).json({ error: "Escreva a nota." });
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      const eu = await quemSou(req);
      await prisma.mensagem.create({ data: { conversaId: c.id, autor: "NOTA", autorNome: eu.nome, texto } });
      res.json({ ok: true });
    } catch (err) { falha(res, err); }
  });

  // Repassa para um colega do mesmo DETRAN.
  app.post(`${G}/conversas/:id/repassar`, ...mw, async (req, res) => {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      if (c.status !== "HUMANO") return res.status(409).json({ error: "Só dá para repassar conversas em atendimento humano." });
      const alvo = await prisma.usuario.findFirst({ where: { id: String(req.body?.usuarioId || ""), tenantId: req.tenant.id, ativo: true }, select: { id: true, nome: true } });
      if (!alvo) return res.status(400).json({ error: "Escolha um colega deste DETRAN." });
      const eu = await quemSou(req);
      if (c.atendenteId && c.atendenteId !== eu.id && !GESTORES.includes(req.usuario.perfil)) return res.status(409).json({ error: `Esta conversa está com ${c.atendenteNome}.` });
      await prisma.$transaction([
        prisma.conversa.update({ where: { id: c.id }, data: { atendenteId: alvo.id, atendenteNome: alvo.nome } }),
        prisma.mensagem.create({ data: { conversaId: c.id, autor: "SISTEMA", texto: `${eu.nome} repassou o atendimento para ${alvo.nome}.` } }),
      ]);
      res.json({ ok: true });
    } catch (err) { falha(res, err); }
  });

  // Pega a conversa que espera há mais tempo na fila.
  app.post(`${G}/fila/proximo`, ...mw, async (req, res) => {
    try {
      const eu = await quemSou(req);
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        const prox = await prisma.conversa.findFirst({ where: { tenantId: req.tenant.id, status: "HUMANO", atendenteId: null }, orderBy: { transbordoEm: "asc" } });
        if (!prox) return res.json({ ok: true, conversaId: null });
        const r = await prisma.conversa.updateMany({ where: { id: prox.id, atendenteId: null, status: "HUMANO" }, data: { atendenteId: eu.id, atendenteNome: eu.nome } });
        if (r.count) {
          await prisma.mensagem.create({ data: { conversaId: prox.id, autor: "SISTEMA", texto: `${eu.nome} assumiu o atendimento.` } });
          return res.json({ ok: true, conversaId: prox.id });
        }
      }
      res.status(409).json({ error: "A fila mudou agora mesmo. Tente de novo." });
    } catch (err) { falha(res, err); }
  });

  // ── Ficha do cidadão ──
  app.get(`${G}/contatos`, ...mw, async (req, res) => {
    const busca = String(req.query.busca || "").trim().slice(0, 60);
    const where = { tenantId: req.tenant.id, canal: "WHATSAPP" };
    if (busca) { const dig = busca.replace(/\D/g, ""); where.OR = [{ nome: { contains: busca } }, ...(dig.length >= 3 ? [{ contato: { contains: dig } }] : [])]; }
    try {
      const cs = await prisma.conversa.findMany({ where, orderBy: { ultimaEm: "desc" }, take: 200, select: { id: true, contato: true, nome: true, status: true, ultimaEm: true, avaliacao: true, categoria: true } });
      const [fichas, chamados] = await Promise.all([
        prisma.contato.findMany({ where: { tenantId: req.tenant.id, contato: { in: cs.map((c) => c.contato) } } }),
        prisma.chamado.groupBy({ by: ["contato"], where: { tenantId: req.tenant.id, contato: { in: cs.map((c) => c.contato) } }, _count: { _all: true } }),
      ]);
      const f = Object.fromEntries(fichas.map((x) => [x.contato, x]));
      const n = Object.fromEntries(chamados.map((x) => [x.contato, x._count._all]));
      res.json({ contatos: cs.map((c) => ({ conversaId: c.id, contato: c.contato, nome: f[c.contato]?.nome || c.nome, status: c.status, ultimaEm: c.ultimaEm, avaliacao: c.avaliacao, categoria: c.categoria, etiquetas: listaEtiquetas(f[c.contato]?.etiquetas), notas: f[c.contato]?.notas || "", chamados: n[c.contato] || 0 })) });
    } catch (err) { falha(res, err); }
  });

  app.put(`${G}/contatos/:contato`, ...mw, async (req, res) => {
    const contato = String(req.params.contato || "").slice(0, 80);
    const b = req.body || {};
    try {
      const existe = await prisma.conversa.findFirst({ where: { tenantId: req.tenant.id, contato }, select: { id: true } });
      if (!existe) return res.status(404).json({ error: "Cidadão não encontrado neste DETRAN." });
      const validas = new Set((await prisma.etiqueta.findMany({ where: { tenantId: req.tenant.id }, select: { id: true } })).map((e) => e.id));
      const dados = {};
      if (b.nome !== undefined) dados.nome = String(b.nome || "").trim().slice(0, 120) || null;
      if (b.notas !== undefined) dados.notas = String(b.notas || "").slice(0, 5000) || null;
      if (b.etiquetas !== undefined) dados.etiquetas = listaEtiquetas(b.etiquetas).filter((id) => validas.has(id));
      await prisma.contato.upsert({ where: { tenantId_contato: { tenantId: req.tenant.id, contato } }, create: { tenantId: req.tenant.id, contato, ...dados }, update: dados });
      if (dados.nome) await prisma.conversa.updateMany({ where: { tenantId: req.tenant.id, contato }, data: { nome: dados.nome } });
      res.json({ ok: true });
    } catch (err) { falha(res, err); }
  });

  // ── Chamados ──
  app.get(`${G}/chamados`, ...mw, async (req, res) => {
    const q = req.query;
    const where = { tenantId: req.tenant.id };
    if (q.status === "abertos") where.status = { in: ABERTOS };
    else if (STATUS_CHAMADO.includes(q.status)) where.status = q.status;
    if (PRIORIDADES.includes(q.prioridade)) where.prioridade = q.prioridade;
    if (q.responsavel === "eu") where.responsavelId = req.usuario.uid;
    else if (q.responsavel === "ninguem") where.responsavelId = null;
    else if (q.responsavel) where.responsavelId = String(q.responsavel);
    if (q.categoria) where.categoria = String(q.categoria);
    if (q.vencidos === "1") Object.assign(where, { status: { in: ABERTOS }, prazoEm: { lt: new Date() } });
    const busca = String(q.busca || "").trim().slice(0, 60);
    if (busca) {
      const dig = busca.replace(/\D/g, "");
      where.OR = [{ protocolo: { contains: busca.toUpperCase() } }, { assunto: { contains: busca } }, { nome: { contains: busca } }, ...(dig.length >= 3 ? [{ contato: { contains: dig } }] : [])];
    }
    try {
      const cs = await prisma.chamado.findMany({ where, orderBy: [{ atualizadoEm: "desc" }], take: 300 });
      res.json({ chamados: cs.map(resumoChamado) });
    } catch (err) { falha(res, err, "Erro ao listar os chamados."); }
  });

  app.post(`${G}/chamados`, ...mw, async (req, res) => {
    const b = req.body || {};
    const assunto = String(b.assunto || "").trim().slice(0, 160);
    if (!assunto) return res.status(400).json({ error: "Informe o assunto do chamado." });
    const prioridade = PRIORIDADES.includes(b.prioridade) ? b.prioridade : "NORMAL";
    const cfg = configDe(req.tenant);
    try {
      const eu = await quemSou(req);
      let conv = null;
      if (b.conversaId) {
        conv = await prisma.conversa.findFirst({ where: { id: String(b.conversaId), tenantId: req.tenant.id } });
        if (!conv) return res.status(404).json({ error: "Conversa não encontrada neste DETRAN." });
      }
      let resp = null;
      if (b.responsavelId) {
        resp = await prisma.usuario.findFirst({ where: { id: String(b.responsavelId), tenantId: req.tenant.id, ativo: true }, select: { id: true, nome: true } });
        if (!resp) return res.status(400).json({ error: "Responsável inválido." });
      }
      const prazo = b.prazoEm && !Number.isNaN(Date.parse(b.prazoEm)) ? new Date(b.prazoEm) : new Date(Date.now() + cfg.slaHoras[prioridade] * 3600_000);
      // Número sequencial por DETRAN (incremento atômico no próprio Tenant).
      const t = await prisma.tenant.update({ where: { id: req.tenant.id }, data: { protocoloSeq: { increment: 1 } }, select: { protocoloSeq: true, uf: true } });
      const protocolo = protocoloDe(t, t.protocoloSeq);
      const avisar = b.avisarCidadao !== undefined ? Boolean(b.avisarCidadao) : cfg.avisarChamado;
      const ch = await prisma.chamado.create({
        data: {
          tenantId: req.tenant.id, numero: t.protocoloSeq, protocolo, conversaId: conv?.id || null,
          canal: conv?.canal || null, contato: conv?.contato || (b.contato ? String(b.contato).replace(/\D/g, "").slice(0, 20) || null : null),
          nome: String(b.nome || conv?.nome || "").trim().slice(0, 120) || null,
          assunto, descricao: String(b.descricao || "").slice(0, 8000) || null,
          categoria: String(b.categoria || "").trim().slice(0, 60) || null, prioridade,
          responsavelId: resp?.id || null, responsavelNome: resp?.nome || null,
          prazoEm: prazo, avisarCidadao: avisar, criadoPorNome: eu.nome,
          eventos: { create: [{ tipo: "ABERTURA", autorNome: eu.nome, texto: `Chamado aberto${resp ? ` e atribuído a ${resp.nome}` : ""}.`, publico: true }] },
        },
      });
      if (conv) await prisma.mensagem.create({ data: { conversaId: conv.id, autor: "SISTEMA", texto: `${eu.nome} abriu o chamado ${protocolo}: ${assunto}.` } });
      const avisou = await avisarCidadao(req.tenant, ch,
        `📋 Abrimos o chamado *${protocolo}* para você: ${assunto}.\nPrevisão: ${prazo.toLocaleDateString("pt-BR")}.\n\nPara acompanhar, é só mandar aqui: *protocolo ${protocolo}*`);
      if (avisou && conv) await prisma.mensagem.create({ data: { conversaId: conv.id, autor: "ATENDENTE", autorNome: eu.nome, texto: `Aviso de abertura do chamado ${protocolo} enviado ao cidadão.` } });
      res.status(201).json({ ok: true, chamado: resumoChamado(ch), avisou });
    } catch (err) { falha(res, err, "Não foi possível abrir o chamado."); }
  });

  async function chamadoDoTenant(req, res) {
    const ch = await prisma.chamado.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
    if (!ch) { res.status(404).json({ error: "Chamado não encontrado neste DETRAN." }); return null; }
    return ch;
  }

  app.get(`${G}/chamados/:id`, ...mw, async (req, res) => {
    try {
      const ch = await chamadoDoTenant(req, res); if (!ch) return;
      const eventos = await prisma.chamadoEvento.findMany({ where: { chamadoId: ch.id }, orderBy: { criadoEm: "asc" } });
      res.json({ chamado: resumoChamado(ch), eventos: eventos.map((e) => ({ id: e.id, tipo: e.tipo, autorNome: e.autorNome, texto: e.texto, publico: e.publico, criadoEm: e.criadoEm })) });
    } catch (err) { falha(res, err); }
  });

  // Muda status, prioridade, responsável, prazo, categoria ou assunto.
  app.patch(`${G}/chamados/:id`, ...mw, async (req, res) => {
    const b = req.body || {};
    try {
      const ch = await chamadoDoTenant(req, res); if (!ch) return;
      const eu = await quemSou(req);
      const dados = {}; const eventos = []; let avisoStatus = null;
      if (b.status !== undefined && b.status !== ch.status) {
        if (!STATUS_CHAMADO.includes(b.status)) return res.status(400).json({ error: "Situação inválida." });
        dados.status = b.status;
        dados.resolvidoEm = ["RESOLVIDO", "CANCELADO"].includes(b.status) ? new Date() : null;
        const motivo = String(b.motivo || "").trim().slice(0, 1000);
        const txt = `Situação: ${STATUS_TEXTO[ch.status]} → ${STATUS_TEXTO[b.status]}${motivo ? `. ${motivo}` : ""}`;
        eventos.push({ tipo: "STATUS", autorNome: eu.nome, texto: txt, publico: true });
        avisoStatus = `📋 Protocolo *${ch.protocolo}*\nSua solicitação agora está: *${STATUS_TEXTO[b.status]}*.${motivo ? `\n\n${motivo}` : ""}`;
        // Pediram algo ao cidadão: diz como responder (link da conta só com PUBLIC_URL).
        if (b.status === "AGUARDANDO_CIDADAO" && process.env.PUBLIC_URL) avisoStatus += `\n\nPara responder ou mandar o documento pedido, entre em *Meus pedidos*: ${linkConta(req.tenant)}`;
      }
      if (b.prioridade !== undefined && b.prioridade !== ch.prioridade) {
        if (!PRIORIDADES.includes(b.prioridade)) return res.status(400).json({ error: "Prioridade inválida." });
        dados.prioridade = b.prioridade;
        eventos.push({ tipo: "PRIORIDADE", autorNome: eu.nome, texto: `Prioridade: ${ch.prioridade} → ${b.prioridade}` });
      }
      if (b.responsavelId !== undefined && (b.responsavelId || null) !== ch.responsavelId) {
        if (b.responsavelId) {
          const r = await prisma.usuario.findFirst({ where: { id: String(b.responsavelId), tenantId: req.tenant.id, ativo: true }, select: { id: true, nome: true } });
          if (!r) return res.status(400).json({ error: "Responsável inválido." });
          Object.assign(dados, { responsavelId: r.id, responsavelNome: r.nome });
          eventos.push({ tipo: "RESPONSAVEL", autorNome: eu.nome, texto: `Responsável: ${r.nome}` });
        } else {
          Object.assign(dados, { responsavelId: null, responsavelNome: null });
          eventos.push({ tipo: "RESPONSAVEL", autorNome: eu.nome, texto: "Chamado ficou sem responsável." });
        }
      }
      if (b.prazoEm !== undefined) {
        const p = b.prazoEm ? new Date(b.prazoEm) : null;
        if (p && Number.isNaN(+p)) return res.status(400).json({ error: "Prazo inválido." });
        dados.prazoEm = p;
        eventos.push({ tipo: "PRAZO", autorNome: eu.nome, texto: p ? `Prazo: ${p.toLocaleDateString("pt-BR")}` : "Prazo removido." });
      }
      if (b.categoria !== undefined) dados.categoria = String(b.categoria || "").trim().slice(0, 60) || null;
      if (b.assunto !== undefined && String(b.assunto).trim()) dados.assunto = String(b.assunto).trim().slice(0, 160);
      if (b.avisarCidadao !== undefined) dados.avisarCidadao = Boolean(b.avisarCidadao);
      if (!Object.keys(dados).length) return res.json({ ok: true, chamado: resumoChamado(ch) });
      const novo = await prisma.chamado.update({ where: { id: ch.id }, data: { ...dados, eventos: { create: eventos } } });
      const avisou = avisoStatus ? await avisarCidadao(req.tenant, novo, avisoStatus) : false;
      res.json({ ok: true, chamado: resumoChamado(novo), avisou });
    } catch (err) { falha(res, err, "Não foi possível atualizar o chamado."); }
  });

  // Comentário: público (vai para o cidadão no WhatsApp) ou nota interna.
  app.post(`${G}/chamados/:id/comentarios`, ...mw, async (req, res) => {
    const texto = String(req.body?.texto || "").trim().slice(0, 4000);
    if (!texto) return res.status(400).json({ error: "Escreva o comentário." });
    const publico = Boolean(req.body?.publico);
    try {
      const ch = await chamadoDoTenant(req, res); if (!ch) return;
      const eu = await quemSou(req);
      await prisma.chamado.update({ where: { id: ch.id }, data: { eventos: { create: [{ tipo: publico ? "COMENTARIO" : "NOTA", autorNome: eu.nome, texto, publico }] } } });
      const avisou = publico ? await avisarCidadao(req.tenant, ch, `📋 Protocolo *${ch.protocolo}*\n${texto}`) : false;
      res.status(201).json({ ok: true, avisou });
    } catch (err) { falha(res, err); }
  });

  // ── Visão geral e indicadores ──
  app.get(`${G}/visao`, ...mw, async (req, res) => {
    const dias = [1, 7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 7;
    const desde = new Date(Date.now() - dias * 86400_000);
    const t = req.tenant.id;
    const cfg = configDe(req.tenant);
    try {
      const [agoraConv, periodoConv, eventos, chamadosAbertos, chamadosPeriodo, equipe] = await Promise.all([
        prisma.conversa.findMany({ where: { tenantId: t, OR: [{ status: "HUMANO" }, { status: "BOT", ultimaEm: { gte: new Date(Date.now() - 30 * 60000) } }] }, select: { status: true, atendenteId: true, transbordoEm: true } }),
        prisma.conversa.findMany({ where: { tenantId: t, ultimaEm: { gte: desde } }, select: { canal: true, status: true, transbordoEm: true, primeiraRespostaEm: true, encerradaEm: true, avaliacao: true, atendenteId: true, atendenteNome: true, categoria: true } }),
        prisma.evento.findMany({ where: { tenantId: t, criadoEm: { gte: desde }, tipo: "PERGUNTA" }, select: { tema: true, canal: true, criadoEm: true, transbordo: true } }),
        prisma.chamado.findMany({ where: { tenantId: t, status: { in: ABERTOS } }, select: { status: true, prazoEm: true, prioridade: true } }),
        prisma.chamado.findMany({ where: { tenantId: t, criadoEm: { gte: desde } }, select: { status: true, criadoEm: true, resolvidoEm: true, categoria: true } }),
        prisma.usuario.findMany({ where: { tenantId: t, ativo: true }, select: { id: true, nome: true, statusAtendimento: true } }),
      ]);
      const [lembretesAtivos, lembretesEnviados] = await Promise.all([
        prisma.lembrete.count({ where: { tenantId: t, status: "ATIVO" } }),
        prisma.lembrete.count({ where: { tenantId: t, ultimoEnvioEm: { gte: desde } } }),
      ]);
      const humanos = agoraConv.filter((c) => c.status === "HUMANO");
      const fila = humanos.filter((c) => !c.atendenteId);
      const transb = periodoConv.filter((c) => c.transbordoEm && c.transbordoEm >= desde);
      const tpr = transb.map((c) => (c.primeiraRespostaEm && c.primeiraRespostaEm >= c.transbordoEm ? minutos(c.transbordoEm, c.primeiraRespostaEm) : null)).filter((x) => x != null);
      const encerradas = periodoConv.filter((c) => c.encerradaEm && c.encerradaEm >= desde);
      const tma = encerradas.map((c) => (c.transbordoEm && c.encerradaEm > c.transbordoEm ? minutos(c.transbordoEm, c.encerradaEm) : null)).filter((x) => x != null);
      const notas = periodoConv.map((c) => c.avaliacao).filter((n) => n >= 1 && n <= 5);
      const distNotas = [1, 2, 3, 4, 5].map((n) => notas.filter((x) => x === n).length);
      // Temas e mapa de calor (dia da semana × hora, no fuso do DETRAN)
      const temas = {}; const calor = Array.from({ length: 7 }, () => Array(24).fill(0)); const porDia = {};
      const canais = { WEB: 0, WHATSAPP: 0 };
      for (const e of eventos) {
        const tm = e.tema || "outros"; temas[tm] = (temas[tm] || 0) + 1;
        const { dia, hora } = agoraNoFuso(cfg.fuso, e.criadoEm); calor[dia][hora]++;
        const d = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.fuso }).format(e.criadoEm); porDia[d] = (porDia[d] || 0) + 1;
        canais[e.canal] = (canais[e.canal] || 0) + 1;
      }
      // Produtividade por atendente
      const porAt = {};
      for (const c of encerradas) {
        if (!c.atendenteId) continue;
        const a = (porAt[c.atendenteId] ||= { id: c.atendenteId, nome: c.atendenteNome, atendimentos: 0, tpr: [], notas: [] });
        a.atendimentos++;
        if (c.primeiraRespostaEm && c.transbordoEm && c.primeiraRespostaEm >= c.transbordoEm) a.tpr.push(minutos(c.transbordoEm, c.primeiraRespostaEm));
        if (c.avaliacao) a.notas.push(c.avaliacao);
      }
      const emAtend = {}; for (const c of humanos) if (c.atendenteId) emAtend[c.atendenteId] = (emAtend[c.atendenteId] || 0) + 1;
      const ranking = equipe.map((u) => {
        const a = porAt[u.id] || { atendimentos: 0, tpr: [], notas: [] };
        return { id: u.id, nome: u.nome, status: u.statusAtendimento, emAtendimento: emAtend[u.id] || 0, atendimentos: a.atendimentos, tprMin: arred(media(a.tpr)), nota: arred(media(a.notas)), avaliacoes: a.notas.length };
      }).sort((x, y) => y.atendimentos - x.atendimentos || x.nome.localeCompare(y.nome));
      const agora = new Date();
      res.json({
        dias,
        agora: {
          noBot: agoraConv.filter((c) => c.status === "BOT").length,
          fila: fila.length,
          emAtendimento: humanos.length - fila.length,
          esperaMaxMin: arred(Math.max(0, ...fila.map((c) => minutos(c.transbordoEm, agora) || 0)), 0),
          online: equipe.filter((u) => u.statusAtendimento === "ONLINE").length,
          chamadosAbertos: chamadosAbertos.length,
          chamadosVencidos: chamadosAbertos.filter((c) => c.prazoEm && c.prazoEm < agora).length,
        },
        periodo: {
          perguntas: eventos.length,
          conversas: periodoConv.length,
          transbordos: transb.length,
          // Mesma base do número ao lado (teste I1): conversas que pediram atendente ÷ conversas do período.
          // Antes dividia eventos-pergunta marcados, e o % não batia com a contagem mostrada.
          taxaTransbordo: periodoConv.length ? arred(Math.min(100, (transb.length / periodoConv.length) * 100)) : 0,
          encerradas: encerradas.length,
          tprMedioMin: arred(media(tpr)),
          tmaMedioMin: arred(media(tma)),
          nota: arred(media(notas)), avaliacoes: notas.length, distNotas,
          csat: notas.length ? Math.round((notas.filter((n) => n >= 4).length / notas.length) * 100) : null,
          chamadosAbertos: chamadosPeriodo.length,
          chamadosResolvidos: chamadosPeriodo.filter((c) => c.status === "RESOLVIDO").length,
          resolucaoMediaH: arred(media(chamadosPeriodo.filter((c) => c.resolvidoEm).map((c) => minutos(c.criadoEm, c.resolvidoEm) / 60))),
          lembretesAtivos, lembretesEnviados,
        },
        temas: Object.entries(temas).sort((a, b) => b[1] - a[1]).map(([tema, n]) => ({ tema, n })),
        canais, calor, porDia,
        chamadosPorStatus: Object.fromEntries(STATUS_CHAMADO.map((s) => [s, chamadosAbertos.filter((c) => c.status === s).length])),
        ranking,
      });
    } catch (err) { falha(res, err, "Erro ao calcular os indicadores."); }
  });

  // ── Configurações (gestor/admin) ──
  app.put(`${G}/config`, ...mw, soGestor, async (req, res) => {
    try {
      const atual = configDe(req.tenant);
      const nova = limparConfig(req.body || {}, atual);
      await prisma.tenant.update({ where: { id: req.tenant.id }, data: { configGestao: nova } });
      limparCacheTenant(req.tenant.slug);
      res.json({ ok: true, config: (({ meuDetran, ...x }) => x)(nova) });
    } catch (err) { falha(res, err); }
  });

  app.post(`${G}/respostas`, ...mw, soGestor, async (req, res) => {
    const b = req.body || {};
    const atalho = String(b.atalho || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    const titulo = String(b.titulo || "").trim().slice(0, 120);
    const texto = String(b.texto || "").trim().slice(0, 4000);
    if (!atalho || !titulo || !texto) return res.status(400).json({ error: "Preencha atalho (letras, números e hífen), título e texto." });
    try {
      const dados = { atalho, titulo, texto, ordem: Number(b.ordem) || 0 };
      const r = b.id
        ? await prisma.respostaRapida.update({ where: { id: (await prisma.respostaRapida.findFirst({ where: { id: String(b.id), tenantId: req.tenant.id } }))?.id || "-" }, data: dados })
        : await prisma.respostaRapida.create({ data: { tenantId: req.tenant.id, ...dados } });
      res.status(b.id ? 200 : 201).json({ ok: true, resposta: { id: r.id, atalho: r.atalho, titulo: r.titulo, texto: r.texto } });
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: "Já existe uma resposta com esse atalho." });
      if (err.code === "P2025") return res.status(404).json({ error: "Resposta não encontrada." });
      falha(res, err);
    }
  });
  app.delete(`${G}/respostas/:id`, ...mw, soGestor, async (req, res) => {
    try { await prisma.respostaRapida.deleteMany({ where: { id: req.params.id, tenantId: req.tenant.id } }); res.json({ ok: true }); }
    catch (err) { falha(res, err); }
  });

  app.post(`${G}/etiquetas`, ...mw, soGestor, async (req, res) => {
    const nome = String(req.body?.nome || "").trim().slice(0, 40);
    const cor = HEX.test(req.body?.cor) ? req.body.cor : "#64748B";
    if (!nome) return res.status(400).json({ error: "Dê um nome à etiqueta." });
    try {
      const e = req.body?.id
        ? await prisma.etiqueta.update({ where: { id: (await prisma.etiqueta.findFirst({ where: { id: String(req.body.id), tenantId: req.tenant.id } }))?.id || "-" }, data: { nome, cor } })
        : await prisma.etiqueta.create({ data: { tenantId: req.tenant.id, nome, cor } });
      res.status(req.body?.id ? 200 : 201).json({ ok: true, etiqueta: { id: e.id, nome: e.nome, cor: e.cor } });
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: "Já existe uma etiqueta com esse nome." });
      if (err.code === "P2025") return res.status(404).json({ error: "Etiqueta não encontrada." });
      falha(res, err);
    }
  });
  app.delete(`${G}/etiquetas/:id`, ...mw, soGestor, async (req, res) => {
    try { await prisma.etiqueta.deleteMany({ where: { id: req.params.id, tenantId: req.tenant.id } }); res.json({ ok: true }); }
    catch (err) { falha(res, err); }
  });

  // ── IA de apoio ao atendente ──
  async function historicoTexto(req, res) {
    const c = await prisma.conversa.findFirst({ where: { id: String(req.body?.conversaId || ""), tenantId: req.tenant.id } });
    if (!c) { res.status(404).json({ error: "Conversa não encontrada neste DETRAN." }); return null; }
    const msgs = (await prisma.mensagem.findMany({ where: { conversaId: c.id, autor: { not: "SISTEMA" } }, orderBy: { criadoEm: "desc" }, take: 60 })).reverse();
    const nomes = { CIDADAO: "Cidadão", BOT: "Assistente virtual", ATENDENTE: "Atendente", NOTA: "Nota interna" };
    return { conversa: c, texto: msgs.map((m) => `${nomes[m.autor] || m.autor}: ${String(m.texto).slice(0, 1200)}`).join("\n").slice(-14000) };
  }
  const semIA = (res) => res.status(503).json({ error: "A IA não está configurada neste servidor." });
  const baseIA = (t) => `Você apoia a equipe de atendimento do ${t.sigla} (${t.nome}). Seja objetivo, correto e em português do Brasil. Nunca invente valores de taxas, prazos legais ou links: se não souber, diga para conferir no portal oficial ${t.portalUrl}.`;

  app.post(`${G}/ia/resumo`, ...mw, limiteIA, async (req, res) => {
    if (!llmConfigurado()) return semIA(res);
    try {
      const h = await historicoTexto(req, res); if (!h) return;
      const txt = await chamarLLM({ system: baseIA(req.tenant), maxTokens: 500, messages: [{ role: "user", content: `Resuma este atendimento para um colega que vai assumir agora. Use no máximo 5 tópicos curtos: o que o cidadão quer, o que já foi informado, o que falta, e o próximo passo sugerido.\n\n${h.texto}` }] });
      res.json({ resumo: txt });
    } catch (err) { falha(res, err, "A IA não respondeu agora."); }
  });

  app.post(`${G}/ia/sugestao`, ...mw, limiteIA, async (req, res) => {
    if (!llmConfigurado()) return semIA(res);
    try {
      const h = await historicoTexto(req, res); if (!h) return;
      const txt = await chamarLLM({ system: baseIA(req.tenant), maxTokens: 400, messages: [{ role: "user", content: `Escreva a próxima mensagem do atendente para o cidadão no WhatsApp: cordial, curta (até 4 linhas), sem saudação repetida se a conversa já começou. Responda só com o texto da mensagem.\n\n${h.texto}` }] });
      res.json({ sugestao: txt.replace(/^["']|["']$/g, "").trim() });
    } catch (err) { falha(res, err, "A IA não respondeu agora."); }
  });

  app.post(`${G}/ia/chamado`, ...mw, limiteIA, async (req, res) => {
    if (!llmConfigurado()) return semIA(res);
    try {
      const h = await historicoTexto(req, res); if (!h) return;
      const cats = configDe(req.tenant).categorias;
      const txt = await chamarLLM({ system: baseIA(req.tenant), maxTokens: 500, messages: [{ role: "user", content: `A partir do atendimento abaixo, prepare um chamado. Responda SOMENTE com JSON: {"assunto": "até 80 caracteres", "categoria": uma de ${JSON.stringify(cats)}, "prioridade": "BAIXA"|"NORMAL"|"ALTA"|"URGENTE", "descricao": "o pedido do cidadão e o que precisa ser feito, em até 6 linhas"}.\n\n${h.texto}` }] });
      const m = txt.match(/\{[\s\S]*\}/);
      let d = {}; try { d = JSON.parse(m ? m[0] : "{}"); } catch { d = {}; }
      res.json({
        assunto: String(d.assunto || "").slice(0, 160),
        categoria: cats.includes(d.categoria) ? d.categoria : "",
        prioridade: PRIORIDADES.includes(d.prioridade) ? d.prioridade : "NORMAL",
        descricao: String(d.descricao || "").slice(0, 4000),
      });
    } catch (err) { falha(res, err, "A IA não respondeu agora."); }
  });
}

// ── Usado pelo WhatsApp (whatsapp.js) antes de chamar o bot ──────────────────

// Nota de 1 a 5 depois do atendimento. Devolve true se a mensagem era a nota.
export async function tratarAvaliacao(tenant, conv, texto) {
  if (!conv?.avaliacaoPendente) return false;
  const m = String(texto || "").trim().match(/^([1-5])(?:\s*(?:estrelas?|⭐+))?[.!]?$/i);
  if (!m) {
    await prisma.conversa.update({ where: { id: conv.id }, data: { avaliacaoPendente: false } }).catch(() => {});
    return false;
  }
  const nota = Number(m[1]);
  const cfg = configDe(tenant);
  await prisma.$transaction([
    prisma.conversa.update({ where: { id: conv.id }, data: { avaliacao: nota, avaliacaoPendente: false } }),
    prisma.mensagem.create({ data: { conversaId: conv.id, autor: "CIDADAO", texto: String(texto).slice(0, 200) } }),
    prisma.mensagem.create({ data: { conversaId: conv.id, autor: "SISTEMA", texto: `Avaliação do atendimento: ${nota}/5.` } }),
  ]);
  try { await enviarWhatsApp(tenant, conv.contato, cfg.agradecimentoPesquisa); } catch (err) { console.warn("[gestao] agradecimento:", err.message); }
  return true;
}

// "protocolo PA-2026-000123": responde a situação, só para o número que abriu.
export async function tratarConsultaProtocolo(tenant, phone, texto) {
  // "meus pedidos" / "meus protocolos": lista tudo deste número (25/11/2026).
  const limpo = String(texto || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!?]+$/, "");
  if (/^(meus|minhas) (pedidos|protocolos|solicitacoes|chamados)$/.test(limpo)) return textoMeusPedidos(tenant, phone);
  const m = String(texto || "").match(PROTOCOLO_RE);
  if (!m) return null;
  // Só trata como consulta se a mensagem for o próprio número ou falar em protocolo/chamado.
  const soNumero = String(texto).trim().length <= m[0].length + 3;
  if (!soNumero && !/protocolo|chamado|situa|andamento|consult/i.test(texto)) return null;
  const protocolo = m[0].toUpperCase();
  const ch = await prisma.chamado.findFirst({ where: { tenantId: tenant.id, protocolo } });
  if (!ch || !(ch.contato === phone || variantesFone(phone).includes(ch.contato))) return `Não encontrei o protocolo ${protocolo} para este número. Confira o número ou fale com a gente por aqui.`;
  const ev = await prisma.chamadoEvento.findMany({ where: { chamadoId: ch.id, publico: true }, orderBy: { criadoEm: "asc" } });
  return textoSituacao(ch, ev);
}
