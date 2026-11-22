// ─────────────────────────────────────────────────────────────────────────────
// LGPD: retenção, limpeza automática, eliminação a pedido e aviso de privacidade.
//
// Prazos por DETRAN (Central de Gestão → Configurações):
//   - conversas/mensagens sem atividade há N dias (padrão 180) são apagadas;
//     junto vão as fichas de cidadão sem conversa e os registros do balcão;
//   - chamados resolvidos/cancelados há N dias (padrão 365) perdem os dados
//     pessoais (nome, telefone, descrição, comentários); ficam protocolo,
//     assunto, datas e situação, para a estatística.
//   - indicadores (Evento) não têm dado pessoal e ficam.
//
// A limpeza roda todo dia (cron da Vercel em /api/cron/limpeza, protegido por
// CRON_SECRET) e também, no máximo 1x por dia, quando a Central é aberta.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { comTenant, limparCacheTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { configDe } from "./gestao-config.js";
import { mesmoSegredo } from "./cripto.js";
import { anotarLinha, lerLinhas } from "../store.js";

// Histórico das eliminações (só contagens; nunca o dado apagado). 5 anos.
const historico = (t, tipo, contagens) => anotarLinha(`lgpd:${t.slug}`, { em: new Date().toISOString(), tipo, ...contagens }, 5 * 365 * 86400).catch((e) => console.error(`[lgpd:${t.slug}] histórico:`, e.message));

const DIA = 86400000;
const REMOVIDO = "[removido pela política de retenção de dados]";

async function anonimizarChamados(where) {
  const chs = await prisma.chamado.findMany({ where, select: { id: true } });
  if (!chs.length) return 0;
  const ids = chs.map((c) => c.id);
  await prisma.$transaction([
    prisma.chamado.updateMany({ where: { id: { in: ids } }, data: { contato: null, nome: null, conversaId: null, descricao: REMOVIDO } }),
    prisma.chamadoEvento.updateMany({ where: { chamadoId: { in: ids }, tipo: { in: ["COMENTARIO", "NOTA"] } }, data: { texto: REMOVIDO } }),
  ]);
  return ids.length;
}

// Aplica (ou só simula) a política de retenção de um DETRAN.
export async function limparTenant(t, { simular = false } = {}) {
  const cfg = configDe(t);
  const corte = new Date(Date.now() - cfg.retencaoConversasDias * DIA);
  const corteCh = new Date(Date.now() - cfg.retencaoChamadosDias * DIA);
  const wConv = { tenantId: t.id, ultimaEm: { lt: corte }, status: { not: "HUMANO" } }; // nunca no meio de um atendimento
  const wBal = { tenantId: t.id, criadoEm: { lt: corte } };
  const wCh = { tenantId: t.id, status: { in: ["RESOLVIDO", "CANCELADO"] }, resolvidoEm: { lt: corteCh }, OR: [{ contato: { not: null } }, { nome: { not: null } }] };
  if (simular) {
    const [conversas, balcao, chamados] = await Promise.all([prisma.conversa.count({ where: wConv }), prisma.atendimentoBalcao.count({ where: wBal }), prisma.chamado.count({ where: wCh })]);
    return { conversas, balcao, chamados, simulado: true };
  }
  const conversas = (await prisma.conversa.deleteMany({ where: wConv })).count; // mensagens vão junto (cascade)
  const balcao = (await prisma.atendimentoBalcao.deleteMany({ where: wBal })).count;
  const ativos = new Set((await prisma.conversa.findMany({ where: { tenantId: t.id }, select: { contato: true } })).map((c) => c.contato));
  const fichas = await prisma.contato.findMany({ where: { tenantId: t.id, atualizadoEm: { lt: corte } }, select: { id: true, contato: true } });
  const orfas = fichas.filter((f) => !ativos.has(f.contato)).map((f) => f.id);
  const contatos = orfas.length ? (await prisma.contato.deleteMany({ where: { id: { in: orfas } } })).count : 0;
  const chamados = await anonimizarChamados(wCh);
  // Lembretes encerrados/cancelados também saem (têm o telefone).
  const lembretes = (await prisma.lembrete.deleteMany({ where: { tenantId: t.id, status: { in: ["CONCLUIDO", "CANCELADO"] }, criadoEm: { lt: corte } } })).count;
  await prisma.tenant.update({ where: { id: t.id }, data: { configGestao: { ...cfg, ultimaLimpeza: new Date().toISOString() } } });
  limparCacheTenant(t.slug);
  await historico(t, "retencao", { conversas, balcao, contatos, chamados, lembretes });
  return { conversas, balcao, contatos, chamados, lembretes };
}

// Na Central: roda sozinha se a última limpeza tem mais de 1 dia (sem travar a tela).
export function limparSeAtrasado(t) {
  const ult = configDe(t).ultimaLimpeza;
  if (ult && Date.now() - new Date(ult) < DIA) return;
  limparTenant(t).catch((e) => console.error("[lgpd] limpeza:", e.message));
}

// Eliminação a pedido do titular: apaga conversas e ficha; anonimiza chamados.
export async function apagarCidadao(t, contato) {
  const conversas = (await prisma.conversa.deleteMany({ where: { tenantId: t.id, contato } })).count;
  const contatos = (await prisma.contato.deleteMany({ where: { tenantId: t.id, contato } })).count;
  const chamados = await anonimizarChamados({ tenantId: t.id, contato });
  const lembretes = (await prisma.lembrete.deleteMany({ where: { tenantId: t.id, contato } })).count;
  await historico(t, "pedido-do-cidadao", { conversas, contatos, chamados, lembretes });
  return { conversas, contatos, chamados, lembretes };
}

export function textoAvisoWhatsApp(t) {
  const cfg = configDe(t);
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  return `🔒 Aviso de privacidade: esta conversa com o ${t.sigla} fica registrada por até ${cfg.retencaoConversasDias} dias, só para atender você e melhorar o serviço, e depois é apagada. Para pedir a exclusão a qualquer momento, escreva *apagar meus dados*.${base ? ` Saiba mais: ${base}/${t.slug}/privacidade` : ""}`;
}

export function registrarPrivacidade(app, { limitar } = {}) {
  const P = "/api/t/:slug/privacidade";

  // O que o site mostra no aviso e na página de privacidade.
  app.get(P, comTenant, (req, res) => {
    const c = configDe(req.tenant);
    res.json({ retencaoConversasDias: c.retencaoConversasDias, retencaoChamadosDias: c.retencaoChamadosDias, encarregado: c.encarregado, politicaUrl: c.politicaUrl });
  });

  // O cidadão apaga a conversa do site (quem tem o id da sessão é o próprio navegador).
  app.delete(`${P}/conversa`, comTenant, async (req, res) => {
    const sid = String(req.body?.sessionId || "").slice(0, 80);
    if (!/^[\w-]{8,80}$/.test(sid)) return res.status(400).json({ error: "Sessão inválida." });
    if (limitar && limitar(`apagar:${req.tenant.slug}:${String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")}`, 5)) return res.status(429).json({ error: "Aguarde um instante." });
    try {
      const r = await prisma.conversa.deleteMany({ where: { tenantId: req.tenant.id, canal: "WEB", contato: sid } });
      if (r.count) await historico(req.tenant, "pedido-do-cidadao-site", { conversas: r.count });
      res.json({ ok: true, apagadas: r.count });
    } catch (err) { console.error("[lgpd]", err); res.status(500).json({ error: "Não foi possível apagar agora." }); }
  });

  // Gestor/admin: prévia e limpeza imediata; eliminação a pedido do cidadão.
  const gestor = [comTenant, exigir("painel")];
  app.get("/api/t/:slug/gestao/lgpd/previa", ...gestor, async (req, res) => {
    try { res.json({ ...(await limparTenant(req.tenant, { simular: true })), ultimaLimpeza: configDe(req.tenant).ultimaLimpeza }); }
    catch (err) { console.error("[lgpd]", err); res.status(500).json({ error: "Erro ao calcular." }); }
  });
  // Relatório: o que foi apagado, quando e por quê (retenção automática ou pedido).
  app.get("/api/t/:slug/gestao/lgpd/historico", ...gestor, async (req, res) => {
    try {
      const itens = await lerLinhas(`lgpd:${req.tenant.slug}`, req.query.limite || 100);
      const soma = (k) => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
      res.json({ itens, totais: { conversas: soma("conversas"), contatos: soma("contatos"), chamados: soma("chamados"), lembretes: soma("lembretes"), balcao: soma("balcao") }, ultimaLimpeza: configDe(req.tenant).ultimaLimpeza });
    } catch (err) { console.error("[lgpd]", err.message); res.status(500).json({ error: "Erro ao carregar o histórico." }); }
  });
  app.post("/api/t/:slug/gestao/lgpd/limpar", ...gestor, async (req, res) => {
    try { res.json({ ok: true, ...(await limparTenant(req.tenant)) }); }
    catch (err) { console.error("[lgpd]", err); res.status(500).json({ error: "Erro na limpeza." }); }
  });
  app.post("/api/t/:slug/gestao/lgpd/apagar-cidadao", ...gestor, async (req, res) => {
    const contato = String(req.body?.contato || "").slice(0, 80);
    if (!contato) return res.status(400).json({ error: "Informe o cidadão." });
    try {
      const r = await apagarCidadao(req.tenant, contato);
      console.log(`[lgpd] ${req.tenant.slug}: dados de um cidadão apagados a pedido por ${req.usuario.uid}`);
      res.json({ ok: true, ...r });
    } catch (err) { console.error("[lgpd]", err); res.status(500).json({ error: "Não foi possível apagar." }); }
  });

  // Cron diário da Vercel (Authorization: Bearer CRON_SECRET).
  app.get("/api/cron/limpeza", async (req, res) => {
    const seg = process.env.CRON_SECRET || "";
    const h = String(req.headers.authorization || "");
    if (!seg || !mesmoSegredo(h, `Bearer ${seg}`)) return res.status(401).json({ error: "Não autorizado." });
    const out = {};
    for (const t of await prisma.tenant.findMany({ where: { ativo: true } })) {
      try { out[t.slug] = await limparTenant(t); } catch (e) { out[t.slug] = { erro: e.message }; }
    }
    console.log("[lgpd] limpeza diária:", JSON.stringify(out));
    res.json({ ok: true, resultado: out });
  });
}
