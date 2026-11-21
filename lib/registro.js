// Registro de conversas, mensagens e indicadores por DETRAN (MySQL).
// Falhas aqui nunca derrubam o atendimento: tudo é "melhor esforço".
import { prisma } from "./db.js";

export function classificarTema(q) {
  const s = String(q || "").toLowerCase();
  const has = (arr) => arr.some((w) => s.includes(w));
  if (has(["multa", "infrac", "infraç", "recurso", "jari", "pontos", "autuac", "autuaç", "penalidade"])) return "multas";
  if (has(["cnh", "habilit", "carteira", "renovar", "categoria", "exame", "toxicol", "reciclagem", "psicot"])) return "cnh";
  if (has(["ipva"])) return "ipva";
  if (has(["golpe", "fraude", "boleto falso", "link falso"])) return "golpe";
  if (has(["veic", "veíc", "carro", "moto", "transfer", "licenciamento", "placa", "crlv", "crv", "vistoria", "emplac", "gravame", "venda"])) return "veiculos";
  return "outros";
}

// Cria ou atualiza a conversa e grava as mensagens (cidadão e bot).
// `status` força a situação (ex.: "BOT" ao reabrir uma conversa encerrada);
// transbordo do bot sempre leva para "HUMANO".
export async function registrarTroca({ tenantId, canal, contato, nome, pergunta, respostas = [], categoria, transbordo, status }) {
  try {
    const agora = new Date();
    const novo = transbordo ? "HUMANO" : status;
    const conv = await prisma.conversa.upsert({
      where: { tenantId_canal_contato: { tenantId, canal, contato } },
      create: { tenantId, canal, contato, nome: nome || null, categoria: categoria || null, status: novo || "BOT", transbordoEm: transbordo ? agora : null },
      update: {
        ultimaEm: agora, ...(nome ? { nome } : {}), ...(categoria ? { categoria } : {}),
        ...(novo ? { status: novo } : {}), ...(transbordo ? { transbordoEm: agora, atendenteId: null, atendenteNome: null } : {}),
        ...(novo === "BOT" ? { atendenteId: null, atendenteNome: null } : {}),
      },
    });
    const msgs = [];
    if (pergunta) msgs.push({ conversaId: conv.id, autor: "CIDADAO", texto: String(pergunta).slice(0, 8000) });
    for (const r of respostas) if (r) msgs.push({ conversaId: conv.id, autor: "BOT", texto: String(r).slice(0, 8000) });
    if (msgs.length) await prisma.mensagem.createMany({ data: msgs });
    return conv;
  } catch (err) {
    console.error("[registro] conversa:", err.message);
    return null;
  }
}

// Situação atual da conversa (para saber se está com atendente humano).
export async function buscarConversa(tenantId, canal, contato) {
  try { return await prisma.conversa.findUnique({ where: { tenantId_canal_contato: { tenantId, canal, contato } } }); }
  catch (err) { console.error("[registro] buscar:", err.message); return null; }
}

// Mensagem que chega enquanto a conversa está com atendente: só grava.
export async function registrarEntradaHumano(conv, { texto, nome }) {
  try {
    await prisma.$transaction([
      prisma.mensagem.create({ data: { conversaId: conv.id, autor: "CIDADAO", texto: String(texto).slice(0, 8000) } }),
      prisma.conversa.update({ where: { id: conv.id }, data: { ultimaEm: new Date(), ...(nome ? { nome } : {}) } }),
    ]);
  } catch (err) { console.error("[registro] entrada humano:", err.message); }
}

export async function registrarEvento(dados) {
  try { await prisma.evento.create({ data: dados }); }
  catch (err) { console.error("[registro] evento:", err.message); }
}

// Indicadores do painel (últimos N dias).
export async function estatisticas(tenantId, dias = 30) {
  const desde = new Date(Date.now() - dias * 86400_000);
  const eventos = await prisma.evento.findMany({
    where: { tenantId, criadoEm: { gte: desde } },
    select: { tipo: true, canal: true, tema: true, resolvido: true, positivo: true, transbordo: true, criadoEm: true },
  });
  const st = { dias, total: 0, resolved: 0, unresolved: 0, up: 0, down: 0, transbordos: 0, byTheme: {}, byHour: {}, byCanal: { WEB: 0, WHATSAPP: 0 } };
  for (const e of eventos) {
    if (e.tipo === "FEEDBACK") { if (e.positivo) st.up++; else st.down++; continue; }
    if (e.tipo !== "PERGUNTA") continue; // GOLPE / SEMBASE / JORNADA: só no Observatório
    st.total++;
    if (e.resolvido === false) st.unresolved++; else st.resolved++;
    if (e.transbordo) st.transbordos++;
    const t = e.tema || "outros"; st.byTheme[t] = (st.byTheme[t] || 0) + 1;
    const h = new Date(e.criadoEm).getHours(); st.byHour[h] = (st.byHour[h] || 0) + 1;
    st.byCanal[e.canal] = (st.byCanal[e.canal] || 0) + 1;
  }
  st.conversas = await prisma.conversa.count({ where: { tenantId, ultimaEm: { gte: desde } } });
  return st;
}
