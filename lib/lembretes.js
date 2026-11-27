// ─────────────────────────────────────────────────────────────────────────────
// Lembretes pelo WhatsApp: vencimento da CNH, prazo da defesa de multa e
// licenciamento do veículo.
//
// Consentimento: pedido pelo site ou pelo balcão fica PENDENTE e o número
// recebe "responda SIM para confirmar" (assim ninguém cadastra o número de
// outra pessoa). Pedido feito pelo próprio WhatsApp já vale (é o dono do número).
// "parar lembretes" cancela tudo; "meus lembretes" lista.
//
// Envio: rotina diária (cron /api/cron/diario), entre 8h e 20h no fuso do DETRAN.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { comTenant, integracoes, limparCacheTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { lerToken } from "./cripto.js";
import { configDe, agoraNoFuso } from "./gestao-config.js";
import { enviarWhatsApp } from "../whatsapp.js";
import { kvSetEx, kvGetStr, kvDel } from "../store.js";

const DIA = 86400000;
export const TIPOS = {
  CNH: { nome: "vencimento da CNH", icone: "🪪", avisos: [30, 7, 0] },
  DEFESA: { nome: "prazo da defesa da multa", icone: "⚖️", avisos: [10, 3, 1, 0] },
  LICENCIAMENTO: { nome: "licenciamento do veículo", icone: "🚗", avisos: [15, 3, 0] },
  // 22/11/2026 (Despachante Parente "Comprei um veículo"): a data informada é a da COMPRA; o prazo é +30 dias.
  TRANSFERENCIA: { nome: "prazo da transferência do veículo", icone: "🚙", avisos: [10, 3, 1, 0] },
};
const MAX_ATIVOS = 10;
const PENDENTE_HORAS = 48;

export function normalizarFone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
const iso = (d) => d.toISOString().slice(0, 10);
const br = (d) => iso(d).split("-").reverse().join("/");
// Datas "só dia" ficam ao meio-dia UTC (não mudam de dia em nenhum fuso do Brasil).
const dia = (ano, mes, d) => { const x = new Date(Date.UTC(ano, mes - 1, d, 12)); return x.getUTCMonth() === mes - 1 ? x : null; };
export function lerData(txt) {
  const s = String(txt || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dia(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return dia(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}
function hojeNoFuso(fuso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return dia(+p.year, +p.month, +p.day);
}
const diasAte = (alvo, hoje) => Math.round((alvo - hoje) / DIA);

// Calendário de licenciamento (Configurações da Central): final da placa -> "dd/mm".
export function dataLicenciamento(cfg, final, hoje) {
  const v = (cfg.calendarioLicenciamento || {})[String(final)];
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  let d = dia(hoje.getUTCFullYear(), +m[2], +m[1]);
  if (d && d < hoje) d = dia(hoje.getUTCFullYear() + 1, +m[2], +m[1]);
  return d;
}

// Monta o lembrete a partir do pedido (valida tudo). Devolve { erro } ou { dados }.
export function montar(t, { tipo, data, dataRecebimento, final }) {
  const cfg = configDe(t); const hoje = hojeNoFuso(cfg.fuso);
  tipo = String(tipo || "").toUpperCase();
  if (!TIPOS[tipo]) return { erro: "Escolha o tipo de lembrete." };
  let alvo = null, descricao = null;
  if (tipo === "DEFESA") {
    const rec = lerData(dataRecebimento || data);
    if (!rec) return { erro: "Informe a data em que recebeu a notificação (dd/mm/aaaa)." };
    alvo = new Date(rec.getTime() + 30 * DIA);
    descricao = `notificação recebida em ${br(rec)}`;
  } else if (tipo === "TRANSFERENCIA") {
    const comp = lerData(data || dataRecebimento);
    if (!comp) return { erro: "Informe a data da compra (dd/mm/aaaa)." };
    alvo = new Date(comp.getTime() + 30 * DIA);
    descricao = `compra em ${br(comp)}`;
  } else if (tipo === "LICENCIAMENTO" && final !== undefined && final !== null && final !== "") {
    if (!/^\d$/.test(String(final))) return { erro: "Informe o último número da placa (0 a 9)." };
    alvo = dataLicenciamento(cfg, final, hoje);
    if (!alvo) return { erro: "O calendário de licenciamento deste DETRAN ainda não foi cadastrado. Informe a data de vencimento." };
    descricao = `placa final ${final}`;
  } else {
    alvo = lerData(data);
    if (!alvo) return { erro: "Informe a data (dd/mm/aaaa)." };
  }
  const faltam = diasAte(alvo, hoje);
  if (faltam < 0) return { erro: `Essa data (${br(alvo)}) já passou.` };
  if (faltam > 3660) return { erro: "A data está longe demais (mais de 10 anos)." };
  return { dados: { tipo, dataAlvo: alvo, descricao, avisos: TIPOS[tipo].avisos } };
}

// Atalhos que o aviso oferece ("responda 1 ou 2"). O WhatsApp lê a escolha
// (ver resolverAtalhoLembrete) por até 3 dias depois do aviso.
export const ATALHOS = {
  CNH: {
    1: { rotulo: "passo a passo da renovação", pergunta: "Como faço para renovar a minha CNH? Quero o passo a passo completo, com documentos e onde agendar o exame." },
    2: { rotulo: "conferir meus documentos antes de ir", link: "conferir" },
  },
  DEFESA: {
    1: { rotulo: "o que escrever na defesa", pergunta: "Recebi uma notificação de autuação. Como faço a defesa prévia e o que devo argumentar?" },
    2: { rotulo: "gerar o rascunho da defesa", link: "defesa" },
  },
  LICENCIAMENTO: {
    1: { rotulo: "passo a passo do licenciamento", pergunta: "Como faço o licenciamento anual do veículo? Quero o passo a passo e o que preciso pagar antes." },
    2: { rotulo: "conferir se um boleto que recebi é verdadeiro", texto: "🛡️ Cole aqui o texto da mensagem, o link ou o número do código de barras que você recebeu. Eu confiro na hora se tem cara de golpe." },
  },
  TRANSFERENCIA: {
    1: { rotulo: "passo a passo da transferência", pergunta: "Comprei um veículo usado. Como faço a transferência para o meu nome? Quero o passo a passo, os documentos e a vistoria." },
    2: { rotulo: "conferir meus documentos antes de ir", link: "conferir" },
  },
};
const CHECKLIST = {
  CNH: (t) => `O que separar:\n• Documento oficial com foto e CPF\n• Comprovante de residência recente\n• Agendamento do exame médico${t.telefone ? ` (${t.telefone})` : ""}`,
  DEFESA: () => "O que separar:\n• A notificação (frente e verso)\n• Documento com foto do proprietário ou condutor\n• Provas que você tiver (fotos, comprovantes)",
  LICENCIAMENTO: () => "Antes de pagar o licenciamento:\n• Confira se há multas ou IPVA em aberto (eles travam o documento)\n• Emita a guia SÓ pelo portal oficial — não use link de mensagem",
  TRANSFERENCIA: () => "O que separar:\n• ATPV-e assinada (ou CRV com firmas reconhecidas)\n• Laudo de vistoria (vale 30 dias)\n• Identidade, CPF e comprovante de residência",
};

export function textoAviso(t, l, faltam) {
  const T = TIPOS[l.tipo];
  const quando = faltam === 0 ? "é *hoje*" : faltam === 1 ? "é *amanhã*" : `é em *${faltam} dias* (${br(l.dataAlvo)})`;
  const dica = {
    CNH: `Para renovar, você precisa do exame médico em clínica credenciada${faltam <= 7 ? ". Dá para dirigir até 30 dias depois do vencimento, mas não deixe passar" : ""}. Comece pelo portal: ${t.portalUrl}`,
    DEFESA: `Depois do prazo, não dá mais para apresentar a defesa desta fase.`,
    LICENCIAMENTO: `Emita a guia no portal e pague até a data para não ter o veículo retido: ${t.portalUrl}`,
    TRANSFERENCIA: `Depois do prazo, a transferência continua possível, mas com multa (art. 233 do CTB). Comece pelo portal: ${t.portalUrl}`,
  }[l.tipo];
  const A = ATALHOS[l.tipo];
  const menu = `Responda:\n*1* — ${A[1].rotulo}\n*2* — ${A[2].rotulo}`;
  return `${T.icone} *Lembrete do ${t.sigla}*\nO ${T.nome}${l.descricao ? ` (${l.descricao})` : ""} ${quando}.\n\n${dica}\n\n${CHECKLIST[l.tipo](t)}\n\n${menu}\n\n_Para parar os lembretes, responda PARAR LEMBRETES._`;
}

// "1" ou "2" logo depois de um aviso -> { pergunta } (vai ao bot), { texto } (resposta pronta) ou null.
export async function resolverAtalhoLembrete(t, fone, texto) {
  const m = String(texto || "").trim().match(/^([12])[.!)]?$/);
  if (!m) return null;
  const tipo = await kvGetStr(`detran:${t.slug}:wa:lemb:${fone}`).catch(() => null);
  const a = tipo && ATALHOS[tipo] ? ATALHOS[tipo][m[1]] : null;
  if (!a) return null;
  await kvDel(`detran:${t.slug}:wa:lemb:${fone}`).catch(() => {});
  if (a.pergunta) return { pergunta: a.pergunta };
  if (a.texto) return { texto: a.texto };
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  return { texto: base ? `👉 Abra aqui: ${base}/${t.slug}?acao=${a.link}` : `Abra o site do assistente e toque em "${a.rotulo}".` };
}

const textoConfirmar = (t, l) => `🔔 Você pediu um lembrete do ${t.sigla} para o *${TIPOS[l.tipo].nome}*${l.descricao ? ` (${l.descricao})` : ""}, com data em ${br(l.dataAlvo)}.\n\nResponda *SIM* para confirmar que quer receber os avisos neste número. Se não foi você, é só ignorar.`;

// Cria e pede confirmação (site/balcão) ou já ativa (WhatsApp).
export async function criarLembrete(t, { contato, origem, ...pedido }) {
  const fone = normalizarFone(contato);
  if (!fone) return { erro: "Informe um WhatsApp válido com DDD." };
  const m = montar(t, pedido); if (m.erro) return m;
  const ativos = await prisma.lembrete.count({ where: { tenantId: t.id, contato: fone, status: { in: ["ATIVO", "PENDENTE"] } } });
  if (ativos >= MAX_ATIVOS) return { erro: "Este número já tem lembretes demais. Responda PARAR LEMBRETES no WhatsApp para limpar." };
  const direto = origem === "WHATSAPP";
  const l = await prisma.lembrete.create({ data: { tenantId: t.id, contato: fone, origem, ...m.dados, status: direto ? "ATIVO" : "PENDENTE", consentidoEm: direto ? new Date() : null, enviados: [] } });
  if (!direto) {
    try { await enviarWhatsApp(t, fone, textoConfirmar(t, l)); }
    catch (err) { await prisma.lembrete.delete({ where: { id: l.id } }); return { erro: "Não consegui enviar a confirmação para esse WhatsApp. Confira o número." }; }
  }
  return { lembrete: l };
}

// Comandos que chegam pelo WhatsApp. Devolve o texto de resposta ou null.
export async function tratarComandoLembrete(t, fone, texto) {
  const s = String(texto || "").trim();
  const pend = { tenantId: t.id, contato: fone, status: "PENDENTE", criadoEm: { gte: new Date(Date.now() - PENDENTE_HORAS * 3600000) } };
  if (/^(sim|s|confirmo|confirmar)[.!]?$/i.test(s)) {
    const r = await prisma.lembrete.updateMany({ where: pend, data: { status: "ATIVO", consentidoEm: new Date() } });
    if (!r.count) return null; // "sim" de outra conversa: segue para o bot
    return `✅ Pronto! ${r.count > 1 ? `Seus ${r.count} lembretes estão ativos` : "Seu lembrete está ativo"}. Eu aviso aqui perto da data.\n\nPara ver: *meus lembretes*. Para parar: *parar lembretes*.`;
  }
  if (/^parar\s+(os\s+)?lembretes?[.!]?$/i.test(s)) {
    const r = await prisma.lembrete.updateMany({ where: { tenantId: t.id, contato: fone, status: { in: ["ATIVO", "PENDENTE"] } }, data: { status: "CANCELADO" } });
    return r.count ? `Pronto, cancelei ${r.count > 1 ? `seus ${r.count} lembretes` : "seu lembrete"}. Você não vai receber mais avisos.` : "Você não tem lembretes ativos.";
  }
  if (/^(meus\s+)?lembretes[?]?$/i.test(s)) {
    const ls = await prisma.lembrete.findMany({ where: { tenantId: t.id, contato: fone, status: { in: ["ATIVO", "PENDENTE"] } }, orderBy: { dataAlvo: "asc" } });
    if (!ls.length) return ajuda(t);
    return "🔔 *Seus lembretes*\n" + ls.map((l) => `• ${TIPOS[l.tipo].nome}${l.descricao ? ` (${l.descricao})` : ""}: ${br(l.dataAlvo)}${l.status === "PENDENTE" ? " — falta confirmar (responda SIM)" : ""}`).join("\n") + "\n\nPara cancelar: *parar lembretes*.";
  }
  const m = s.match(/^lembrete\s+(cnh|carteira|defesa|multa|licenciamento|licenciar|transfer[eê]ncia|compra)\b\s*(.*)$/i);
  if (m) {
    const tipo = /cnh|carteira/i.test(m[1]) ? "CNH" : /defesa|multa/i.test(m[1]) ? "DEFESA" : /transfer|compra/i.test(m[1]) ? "TRANSFERENCIA" : "LICENCIAMENTO";
    const resto = m[2].trim();
    const fin = resto.match(/final\s*(\d)/i);
    const r = await criarLembrete(t, { contato: fone, origem: "WHATSAPP", tipo, data: resto, dataRecebimento: resto, final: fin ? fin[1] : undefined });
    if (r.erro) return `⚠️ ${r.erro}\n\n${ajuda(t, tipo)}`;
    const l = r.lembrete;
    return `✅ Lembrete criado: *${TIPOS[l.tipo].nome}*${l.descricao ? ` (${l.descricao})` : ""}, data ${br(l.dataAlvo)}. Vou avisar ${l.avisos.filter((d) => d > 0).join(", ")} dia(s) antes e no dia.\n\nPara parar: *parar lembretes*.`;
  }
  if (/^lembretes?[?!.]?$/i.test(s) || /^(como|quero)\s.*lembrete/i.test(s)) return ajuda(t);
  return null;
}

function ajuda(t, tipo) {
  const cal = Object.keys(configDe(t).calendarioLicenciamento || {}).length;
  const ex = {
    CNH: "• *lembrete cnh 15/03/2027* (data de validade da CNH)",
    DEFESA: "• *lembrete defesa 20/11/2026* (data em que recebeu a notificação: eu conto os 30 dias)",
    LICENCIAMENTO: cal ? "• *lembrete licenciamento final 7* (último número da placa)" : "• *lembrete licenciamento 30/09/2027* (data de vencimento)",
    TRANSFERENCIA: "• *lembrete transferência 10/11/2026* (data da compra do veículo: eu conto os 30 dias)",
  };
  return `🔔 Posso te lembrar aqui no WhatsApp. Mande assim:\n${tipo ? ex[tipo] : Object.values(ex).join("\n")}\n\nVer: *meus lembretes* · Parar: *parar lembretes*`;
}

// Envia os avisos do dia de um DETRAN. Só entre 8h e 20h no fuso dele.
export async function processarLembretes(t, { forcar = false } = {}) {
  const cfg = configDe(t);
  const { hora } = agoraNoFuso(cfg.fuso);
  if (!forcar && (hora < 8 || hora >= 20)) return { enviados: 0, foraDoHorario: true };
  const z = integracoes(t).zapayio;
  await prisma.lembrete.deleteMany({ where: { tenantId: t.id, status: "PENDENTE", criadoEm: { lt: new Date(Date.now() - PENDENTE_HORAS * 3600000) } } }); // sem confirmação: descarta
  if (!z.instanceId || !z.token) return { enviados: 0, semWhatsApp: true };
  const hoje = hojeNoFuso(cfg.fuso);
  const ls = await prisma.lembrete.findMany({ where: { tenantId: t.id, status: "ATIVO" }, take: 500, orderBy: { dataAlvo: "asc" } });
  let enviados = 0, concluidos = 0, falhas = 0;
  for (const l of ls) {
    const faltam = diasAte(new Date(l.dataAlvo), hoje);
    const ja = Array.isArray(l.enviados) ? l.enviados : [];
    const avisos = Array.isArray(l.avisos) ? l.avisos : [];
    if (faltam < 0 || (faltam === 0 && ja.includes(0))) { await prisma.lembrete.update({ where: { id: l.id }, data: { status: "CONCLUIDO" } }); concluidos++; continue; }
    const devidos = avisos.filter((d) => d >= faltam && !ja.includes(d));
    if (!devidos.length) continue;
    try {
      await enviarWhatsApp(t, l.contato, textoAviso(t, l, faltam));
      await kvSetEx(`detran:${t.slug}:wa:lemb:${l.contato}`, l.tipo, 3 * 86400).catch(() => {});
      // marca todos os avisos já vencidos (não manda vários atrasados de uma vez)
      await prisma.lembrete.update({ where: { id: l.id }, data: { enviados: [...ja, ...devidos], ultimoEnvioEm: new Date(), ...(faltam === 0 ? { status: "CONCLUIDO" } : {}) } });
      enviados++;
    } catch (err) { falhas++; console.warn(`[lembretes:${t.slug}]`, err.message); }
  }
  return { enviados, concluidos, falhas };
}

export function registrarLembretes(app, { limitar } = {}) {
  const L = "/api/t/:slug/lembretes";
  app.get(L, comTenant, (req, res) => {
    const z = integracoes(req.tenant).zapayio; const cfg = configDe(req.tenant);
    res.json({ disponivel: Boolean(z.instanceId && z.token), finais: Object.keys(cfg.calendarioLicenciamento || {}).sort(), tipos: Object.fromEntries(Object.entries(TIPOS).map(([k, v]) => [k, { nome: v.nome, avisos: v.avisos }])) });
  });

  // Site (público) ou balcão (com login): cria PENDENTE e pede o SIM no WhatsApp.
  app.post(L, comTenant, async (req, res) => {
    const b = req.body || {};
    if (!b.aceite) return res.status(400).json({ error: "É preciso aceitar receber os lembretes pelo WhatsApp." });
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    if (limitar && limitar(`lemb:${req.tenant.slug}:${ip}`, 5)) return res.status(429).json({ error: "Muitos pedidos em sequência. Aguarde um minuto." });
    const z = integracoes(req.tenant).zapayio;
    if (!z.instanceId || !z.token) return res.status(503).json({ error: "Os lembretes pelo WhatsApp ainda não estão disponíveis neste DETRAN." });
    const h = String(req.headers.authorization || "");
    const tok = h.startsWith("Bearer ") ? lerToken(h.slice(7)) : null;
    const origem = tok && (tok.tid === req.tenant.id || tok.perfil === "SUPERADMIN") ? "BALCAO" : "SITE";
    const fone = normalizarFone(b.telefone);
    if (fone && origem === "SITE" && limitar && limitar(`lembfone:${req.tenant.slug}:${fone}`, 3)) return res.status(429).json({ error: "Esse número já recebeu pedidos demais agora. Tente mais tarde." });
    try {
      const r = await criarLembrete(req.tenant, { contato: b.telefone, origem, tipo: b.tipo, data: b.data, dataRecebimento: b.dataRecebimento, final: b.final });
      if (r.erro) return res.status(400).json({ error: r.erro });
      res.status(201).json({ ok: true, dataAlvo: r.lembrete.dataAlvo, status: r.lembrete.status });
    } catch (err) { console.error("[lembretes]", err); res.status(500).json({ error: "Não foi possível criar o lembrete agora." }); }
  });

  // Central: lembretes de um cidadão e cancelamento.
  const g = [comTenant, exigir("gestao")];
  app.get("/api/t/:slug/gestao/lembretes", ...g, async (req, res) => {
    const contato = normalizarFone(req.query.contato);
    if (!contato) return res.json({ lembretes: [] });
    const ls = await prisma.lembrete.findMany({ where: { tenantId: req.tenant.id, contato }, orderBy: { dataAlvo: "asc" }, take: 30 });
    res.json({ lembretes: ls.map((l) => ({ id: l.id, tipo: l.tipo, nome: TIPOS[l.tipo]?.nome, dataAlvo: l.dataAlvo, descricao: l.descricao, status: l.status, origem: l.origem, ultimoEnvioEm: l.ultimoEnvioEm })) });
  });
  app.delete("/api/t/:slug/gestao/lembretes/:id", ...g, async (req, res) => {
    const r = await prisma.lembrete.updateMany({ where: { id: req.params.id, tenantId: req.tenant.id }, data: { status: "CANCELADO" } });
    res.json({ ok: r.count === 1 });
  });

  // Rotina diária: limpeza LGPD + lembretes (cron da Vercel, Bearer CRON_SECRET).
  app.get("/api/cron/diario", async (req, res) => {
    const { mesmoSegredo } = await import("./cripto.js");
    const { limparTenant } = await import("./privacidade.js");
    const seg = process.env.CRON_SECRET || "";
    if (!seg || !mesmoSegredo(String(req.headers.authorization || ""), `Bearer ${seg}`)) return res.status(401).json({ error: "Não autorizado." });
    const out = {};
    for (const t of await prisma.tenant.findMany({ where: { ativo: true }, include: { integracao: true } })) {
      out[t.slug] = {};
      try { out[t.slug].limpeza = await limparTenant(t); } catch (e) { out[t.slug].limpeza = { erro: e.message }; }
      try { out[t.slug].lembretes = await processarLembretes(t, { forcar: req.query.forcar === "1" }); } catch (e) { out[t.slug].lembretes = { erro: e.message }; }
      // Despachante Parente: chama quem parou numa etapa ou está perto do prazo.
      try { out[t.slug].jornadas = await (await import("./jornadas.js")).cutucarParados(t, (fone, txt) => enviarWhatsApp(t, fone, txt)); } catch (e) { out[t.slug].jornadas = { erro: e.message }; }
      // Relatório do mês anterior pronto na Central (gera uma vez, no dia 1º).
      try { out[t.slug].relatorio = await (await import("./relatorio-mensal.js")).guardarMesAnterior(t); } catch (e) { out[t.slug].relatorio = { erro: e.message }; }
      // Páginas oficiais do DETRAN que mudaram (aviso na Tutoria).
      try { out[t.slug].site = await (await import("./monitor-site.js")).verificarSite(t); } catch (e) { out[t.slug].site = { erro: e.message }; }
    }
    // Normas novas do CONTRAN (uma vez por dia, para todos os DETRANs).
    try { out._normas = await (await import("./normas.js")).verificarNormas(); } catch (e) { out._normas = { erro: e.message }; }
    console.log("[rotina diária]", JSON.stringify(out));
    res.json({ ok: true, resultado: out });
  });
}

// Reserva: se o cron falhar, a Central dispara os lembretes do dia (1x por dia).
export function lembretesSeAtrasado(t) {
  const cfg = configDe(t);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.fuso }).format(new Date());
  if (cfg.ultimosLembretes === hoje) return;
  const { hora } = agoraNoFuso(cfg.fuso);
  if (hora < 8 || hora >= 20) return;
  prisma.tenant.findUnique({ where: { id: t.id }, include: { integracao: true } }).then(async (tt) => {
    const r = await processarLembretes(tt);
    await prisma.tenant.update({ where: { id: t.id }, data: { configGestao: { ...configDe(tt), ultimosLembretes: hoje } } });
    limparCacheTenant(t.slug);
    if (r.enviados) console.log(`[lembretes:${t.slug}] reserva enviou ${r.enviados}`);
  }).catch((e) => console.error("[lembretes] reserva:", e.message));
}
