// Rede de DETRANs: os mesmos indicadores calculados para todos os estados.
//  - Equipe Ayio (SUPERADMIN): tabela comparando os DETRANs, com nome.
//  - Cada DETRAN (Observatório): a média da rede, SEM nome de outros estados, e
//    só quando há estados suficientes para não identificar ninguém.
import { prisma } from "./db.js";

export const MIN_ESTADOS_ANONIMO = 3; // sem isso, "média da rede" entregaria o número de outro estado
export const MIN_PERGUNTAS = 20;      // estado com pouco movimento não entra na média

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// Indicadores de um DETRAN a partir das linhas já carregadas (função pura, testável).
export function indicadores({ eventos = [], conversas = [] }) {
  let perguntas = 0, semBase = 0, transb = 0, up = 0, down = 0, golpes = 0, golpesProv = 0;
  const canais = { WEB: 0, WHATSAPP: 0 };
  for (const e of eventos) {
    if (e.tipo === "PERGUNTA") { perguntas++; if (e.resolvido === false) semBase++; if (e.transbordo) transb++; canais[e.canal] = (canais[e.canal] || 0) + 1; }
    else if (e.tipo === "FEEDBACK") { if (String(e.tema || "").startsWith("fb:")) continue; if (e.positivo) up++; else down++; } // "fb:" = motivo do 👎, já contado
    else if (e.tipo === "GOLPE") { golpes++; if (e.tema === "golpe") golpesProv++; }
  }
  const esperas = conversas.filter((c) => c.transbordoEm && c.primeiraRespostaEm && c.primeiraRespostaEm >= c.transbordoEm)
    .map((c) => Math.round((new Date(c.primeiraRespostaEm) - new Date(c.transbordoEm)) / 60000));
  const notas = conversas.map((c) => c.avaliacao).filter((n) => n >= 1 && n <= 5);
  return {
    perguntas, conversas: conversas.length,
    taxaSemBase: pct(semBase, perguntas), taxaTransbordo: pct(transb, perguntas),
    satisfacao: pct(up, up + down), avaliacoes: up + down,
    notaAtendimento: notas.length ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10 : null,
    esperaMediana: mediana(esperas), golpes, golpesProvaveis: golpesProv,
    whatsapp: pct(canais.WHATSAPP, perguntas),
  };
}

// Média simples entre estados (cada estado pesa igual), ignorando nulos.
export function mediaRede(lista, chave) {
  const v = lista.map((x) => x[chave]).filter((n) => typeof n === "number");
  return v.length ? Math.round((v.reduce((s, n) => s + n, 0) / v.length) * 10) / 10 : null;
}

export async function indicadoresRede(dias = 30) {
  const desde = new Date(Date.now() - dias * 86400_000);
  const tenants = await prisma.tenant.findMany({ where: { ativo: true }, select: { id: true, slug: true, sigla: true, demonstracao: true }, orderBy: { slug: "asc" } });
  const [eventos, conversas] = await Promise.all([
    prisma.evento.findMany({ where: { criadoEm: { gte: desde } }, select: { tenantId: true, tipo: true, canal: true, tema: true, resolvido: true, positivo: true, transbordo: true } }),
    prisma.conversa.findMany({ where: { ultimaEm: { gte: desde } }, select: { tenantId: true, transbordoEm: true, primeiraRespostaEm: true, avaliacao: true } }),
  ]);
  const por = (arr) => arr.reduce((m, x) => ((m[x.tenantId] ||= []).push(x), m), {});
  const ev = por(eventos), cv = por(conversas);
  return tenants.map((t) => ({ slug: t.slug, sigla: t.sigla, demonstracao: t.demonstracao, ...indicadores({ eventos: ev[t.id] || [], conversas: cv[t.id] || [] }) }));
}

const CHAVES = ["taxaSemBase", "taxaTransbordo", "satisfacao", "esperaMediana", "notaAtendimento", "whatsapp"];

// Benchmark anônimo para um DETRAN: média dos OUTROS estados com movimento.
export function benchmarkAnonimo(lista, slug) {
  const outros = lista.filter((x) => x.slug !== slug && !x.demonstracao && x.perguntas >= MIN_PERGUNTAS);
  if (outros.length < MIN_ESTADOS_ANONIMO) return { disponivel: false, motivo: `A comparação aparece quando houver pelo menos ${MIN_ESTADOS_ANONIMO} outros DETRANs com movimento na rede.` };
  return { disponivel: true, estados: outros.length, ...Object.fromEntries(CHAVES.map((k) => [k, mediaRede(outros, k)])) };
}

export function resumoRede(lista) {
  const ativos = lista.filter((x) => x.perguntas > 0);
  return { estados: lista.length, comMovimento: ativos.length, perguntas: lista.reduce((s, x) => s + x.perguntas, 0),
    golpes: lista.reduce((s, x) => s + x.golpes, 0), ...Object.fromEntries(CHAVES.map((k) => [k, mediaRede(ativos, k)])) };
}
