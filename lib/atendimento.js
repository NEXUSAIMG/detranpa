// ─────────────────────────────────────────────────────────────────────────────
// Atendimento humano (transbordo do bot), por DETRAN.
//
// Quando o bot do BotAyio pede atendente (handed_off), a conversa do WhatsApp
// vira "HUMANO": as mensagens do cidadão deixam de ir para o bot e entram na
// fila desta tela. O atendente assume, responde pelo WhatsApp do DETRAN
// (Zapayio), devolve para o bot ou encerra.
//
//   GET  /api/t/<slug>/atendimento/conversas?status=HUMANO|BOT|ENCERRADA|TODAS&busca=
//   GET  /api/t/<slug>/atendimento/conversas/:id
//   POST /api/t/<slug>/atendimento/conversas/:id/assumir
//   POST /api/t/<slug>/atendimento/conversas/:id/responder   { texto }
//   POST /api/t/<slug>/atendimento/conversas/:id/transferir  (puxa do bot para humano)
//   POST /api/t/<slug>/atendimento/conversas/:id/devolver    { aviso? }
//   POST /api/t/<slug>/atendimento/conversas/:id/encerrar    { aviso? }
//   GET  /api/t/<slug>/atendimento/resumo
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { comTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { enviarWhatsApp, reiniciarSessao } from "../whatsapp.js";
import { configDe } from "./gestao-config.js";

const STATUS = ["HUMANO", "BOT", "ENCERRADA"];
const AVISO_DEVOLVER = "Obrigado! Agora o assistente virtual volta a te atender por aqui. Se precisar de um atendente de novo, é só pedir. 🙂";
const AVISO_ENCERRAR = "Atendimento encerrado. Obrigado pelo contato! Se precisar, é só mandar uma nova mensagem.";

// Nome de quem está logado (o token só traz o id).
export async function quemSou(req) {
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.uid }, select: { id: true, nome: true } });
  return u || { id: req.usuario.uid, nome: "Atendente" };
}

export async function conversaDoTenant(req, res) {
  const c = await prisma.conversa.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!c) { res.status(404).json({ error: "Conversa não encontrada neste DETRAN." }); return null; }
  return c;
}

export const resumoConversa = (c, ultima) => ({
  id: c.id, canal: c.canal, contato: c.contato, nome: c.nome, status: c.status, categoria: c.categoria,
  atendenteId: c.atendenteId, atendenteNome: c.atendenteNome, transbordoEm: c.transbordoEm,
  iniciadaEm: c.iniciadaEm, ultimaEm: c.ultimaEm,
  primeiraRespostaEm: c.primeiraRespostaEm, encerradaEm: c.encerradaEm, avaliacao: c.avaliacao,
  ultima: ultima ? { autor: ultima.autor, texto: String(ultima.texto).slice(0, 140), criadoEm: ultima.criadoEm } : null,
  // aguardando = a última palavra é do cidadão (precisa de resposta humana)
  aguardando: c.status === "HUMANO" && (!ultima || ultima.autor === "CIDADAO"),
});

export function registrarAtendimento(app) {
  const R = "/api/t/:slug/atendimento";
  const mw = [comTenant, exigir("atendimento")];

  app.get(`${R}/resumo`, ...mw, async (req, res) => {
    try {
      const humanos = await prisma.conversa.findMany({ where: { tenantId: req.tenant.id, status: "HUMANO" }, select: { id: true, atendenteId: true } });
      res.json({ emAtendimento: humanos.length, semAtendente: humanos.filter((h) => !h.atendenteId).length, meus: humanos.filter((h) => h.atendenteId === req.usuario.uid).length });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Erro ao carregar." }); }
  });

  app.get(`${R}/conversas`, ...mw, async (req, res) => {
    const st = String(req.query.status || "HUMANO").toUpperCase();
    const busca = String(req.query.busca || "").trim().slice(0, 60);
    const where = { tenantId: req.tenant.id };
    if (STATUS.includes(st)) where.status = st;
    if (busca) where.OR = [{ contato: { contains: busca.replace(/\D/g, "") || busca } }, { nome: { contains: busca } }];
    try {
      const cs = await prisma.conversa.findMany({
        where, orderBy: { ultimaEm: "desc" }, take: 100,
        include: { mensagens: { orderBy: { criadoEm: "desc" }, take: 1 } },
      });
      res.json({ conversas: cs.map((c) => resumoConversa(c, c.mensagens[0])) });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Erro ao listar." }); }
  });

  app.get(`${R}/conversas/:id`, ...mw, async (req, res) => {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      const msgs = await prisma.mensagem.findMany({ where: { conversaId: c.id }, orderBy: { criadoEm: "desc" }, take: 300 });
      res.json({ conversa: resumoConversa(c, msgs[0]), mensagens: msgs.reverse().map((m) => ({ id: m.id, autor: m.autor, autorNome: m.autorNome, texto: m.texto, criadoEm: m.criadoEm })) });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Erro ao abrir." }); }
  });

  app.post(`${R}/conversas/:id/assumir`, ...mw, async (req, res) => {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      if (c.status !== "HUMANO") return res.status(409).json({ error: "Esta conversa não está aguardando atendente." });
      const eu = await quemSou(req);
      // Só assume se ninguém assumiu (ou se já é minha).
      const r = await prisma.conversa.updateMany({
        where: { id: c.id, tenantId: req.tenant.id, OR: [{ atendenteId: null }, { atendenteId: eu.id }] },
        data: { atendenteId: eu.id, atendenteNome: eu.nome },
      });
      if (!r.count) return res.status(409).json({ error: `Já está com ${c.atendenteNome || "outro atendente"}.` });
      await prisma.mensagem.create({ data: { conversaId: c.id, autor: "SISTEMA", texto: `${eu.nome} assumiu o atendimento.` } });
      res.json({ ok: true });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Não foi possível assumir." }); }
  });

  // Puxa uma conversa que está com o bot para atendimento humano.
  app.post(`${R}/conversas/:id/transferir`, ...mw, async (req, res) => {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      if (c.canal !== "WHATSAPP") return res.status(400).json({ error: "Só conversas do WhatsApp podem ser atendidas por aqui." });
      if (c.status === "HUMANO") return res.status(409).json({ error: "Já está em atendimento humano." });
      const eu = await quemSou(req);
      await prisma.conversa.update({ where: { id: c.id }, data: { status: "HUMANO", transbordoEm: new Date(), atendenteId: eu.id, atendenteNome: eu.nome } });
      await prisma.mensagem.create({ data: { conversaId: c.id, autor: "SISTEMA", texto: `${eu.nome} puxou a conversa para atendimento humano.` } });
      res.json({ ok: true });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Não foi possível transferir." }); }
  });

  app.post(`${R}/conversas/:id/responder`, ...mw, async (req, res) => {
    const texto = String(req.body?.texto || "").trim().slice(0, 4000);
    if (!texto) return res.status(400).json({ error: "Escreva a mensagem." });
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      if (c.canal !== "WHATSAPP") return res.status(400).json({ error: "Só é possível responder conversas do WhatsApp." });
      if (c.status !== "HUMANO") return res.status(409).json({ error: "Assuma ou puxe a conversa para atendimento humano antes de responder." });
      const eu = await quemSou(req);
      if (c.atendenteId && c.atendenteId !== eu.id && req.usuario.perfil === "BALCAO") return res.status(409).json({ error: `Esta conversa está com ${c.atendenteNome}.` });
      try { await enviarWhatsApp(req.tenant, c.contato, texto); }
      catch (err) { return res.status(502).json({ error: `O WhatsApp não aceitou a mensagem: ${err.message}` }); }
      await prisma.$transaction([
        prisma.mensagem.create({ data: { conversaId: c.id, autor: "ATENDENTE", autorNome: eu.nome, texto } }),
        prisma.conversa.update({ where: { id: c.id }, data: {
          ultimaEm: new Date(), ...(c.atendenteId ? {} : { atendenteId: eu.id, atendenteNome: eu.nome }),
          ...(c.primeiraRespostaEm && c.transbordoEm && c.primeiraRespostaEm >= c.transbordoEm ? {} : { primeiraRespostaEm: new Date() }),
        } }),
      ]);
      res.json({ ok: true });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Não foi possível enviar." }); }
  });

  async function finalizar(req, res, novoStatus, avisoPadrao, textoSistema) {
    try {
      const c = await conversaDoTenant(req, res); if (!c) return;
      if (c.status !== "HUMANO") return res.status(409).json({ error: "Esta conversa não está em atendimento humano." });
      const eu = await quemSou(req);
      const aviso = req.body?.aviso === false ? "" : String(req.body?.aviso || avisoPadrao).slice(0, 1000);
      if (aviso && c.canal === "WHATSAPP") {
        try { await enviarWhatsApp(req.tenant, c.contato, aviso); }
        catch (err) { console.warn("[atendimento] aviso não enviado:", err.message); }
      }
      if (c.canal === "WHATSAPP") await reiniciarSessao(req.tenant, c.contato);
      // Ao encerrar: guarda quem atendeu (para os indicadores) e, se ligado,
      // pede a nota de 1 a 5 ao cidadão.
      const encerrando = novoStatus === "ENCERRADA";
      const cfg = configDe(req.tenant);
      let pesquisa = "";
      if (encerrando && cfg.pesquisaSatisfacao && c.canal === "WHATSAPP" && req.body?.pesquisa !== false) {
        try { await enviarWhatsApp(req.tenant, c.contato, cfg.mensagemPesquisa); pesquisa = cfg.mensagemPesquisa; }
        catch (err) { console.warn("[atendimento] pesquisa não enviada:", err.message); }
      }
      await prisma.$transaction([
        ...(aviso ? [prisma.mensagem.create({ data: { conversaId: c.id, autor: "ATENDENTE", autorNome: eu.nome, texto: aviso } })] : []),
        prisma.mensagem.create({ data: { conversaId: c.id, autor: "SISTEMA", texto: `${eu.nome} ${textoSistema}.` } }),
        ...(pesquisa ? [prisma.mensagem.create({ data: { conversaId: c.id, autor: "SISTEMA", texto: `Pesquisa de satisfação enviada: ${pesquisa}` } })] : []),
        prisma.conversa.update({ where: { id: c.id }, data: encerrando
          ? { status: novoStatus, atendenteId: c.atendenteId || eu.id, atendenteNome: c.atendenteNome || eu.nome, encerradaEm: new Date(), ultimaEm: new Date(), avaliacao: null, avaliacaoPendente: Boolean(pesquisa) }
          : { status: novoStatus, atendenteId: null, atendenteNome: null, ultimaEm: new Date() } }),
      ]);
      res.json({ ok: true });
    } catch (err) { console.error("[atendimento]", err); res.status(500).json({ error: "Não foi possível concluir." }); }
  }
  app.post(`${R}/conversas/:id/devolver`, ...mw, (req, res) => finalizar(req, res, "BOT", AVISO_DEVOLVER, "devolveu a conversa para o assistente virtual"));
  app.post(`${R}/conversas/:id/encerrar`, ...mw, (req, res) => finalizar(req, res, "ENCERRADA", AVISO_ENCERRAR, "encerrou o atendimento"));
}
