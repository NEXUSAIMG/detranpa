// Relatório mensal para o DETRAN (25/11/2026).
//
// Um mês fechado (calendário, horário de Brasília/Belém, UTC-3) numa página só,
// pronta para imprimir ou salvar em PDF e mandar para a direção:
//   - atendimentos (site e WhatsApp), perguntas por assunto, o que o bot não soube;
//   - protocolos: abertos, resolvidos, tempo de resposta, dentro do prazo, pendentes no fim do mês;
//   - atendimento humano: conversas encaminhadas, 1ª resposta, nota média;
//   - satisfação (👍/👎), "evitou uma ida ao DETRAN?", golpes barrados, custo da IA.
// Sem dado pessoal: só contagens, médias e rótulos.
//
// A rotina diária guarda o relatório do mês anterior no dia 1º (KV, 13 meses),
// para ficar pronto na Central sem ninguém precisar gerar.
//
//   GET /api/t/<slug>/gestao/relatorio-mensal?mes=AAAA-MM   (padrão: mês passado)
//   GET /api/t/<slug>/gestao/relatorio-mensal/meses         (meses já guardados)
import { prisma } from "./db.js";
import { comTenant } from "./tenants.js";
import { exigir } from "./auth.js";
import { montarObservatorio } from "./observatorio.js";
import { montarImpacto } from "./impacto.js";
import { resumoUso } from "./uso-ia.js";
import { STATUS_TEXTO } from "./gestao-config.js";
import { kvGetStr, kvSetEx } from "../store.js";

const OFFSET_H = 3; // UTC-3 (Belém e Goiânia não têm horário de verão)
const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const TREZE_MESES = 400 * 86400;
const chave = (slug, mes) => `relatorio:${slug}:${mes}`;
const NOMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function limitesMes(mes) {
  const m = MES_RE.exec(String(mes || ""));
  if (!m) return null;
  const ano = Number(m[1]), mm = Number(m[2]);
  const ini = new Date(Date.UTC(ano, mm - 1, 1, OFFSET_H));
  const fim = new Date(Date.UTC(ano, mm, 1, OFFSET_H));
  return { mes, ini, fim, dias: Math.round((fim - ini) / 86400000), nome: `${NOMES[mm - 1]} de ${ano}` };
}
// Mês passado e mês corrente (no horário local).
const mesComDesvio = (agora, desvio) => {
  const local = new Date(agora.getTime() - OFFSET_H * 3600000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + desvio, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const mesAnterior = (agora = new Date()) => mesComDesvio(agora, -1);
export const mesAtual = (agora = new Date()) => mesComDesvio(agora, 0);
const dentro = (d, ini, fim) => d && new Date(d) >= ini && new Date(d) < fim;
const horas = (a, b) => (new Date(b) - new Date(a)) / 3600000;
const media = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), k = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) * 10) / 10; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const contar = (xs, f) => { const o = {}; for (const x of xs) { const k = f(x) || "Sem categoria"; o[k] = (o[k] || 0) + 1; } return Object.entries(o).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n); };

// Protocolos (chamados) do mês. Origem: aberto pelo próprio cidadão ou pela equipe.
export function montarChamados(chs, { ini, fim: fimMes }, agora = new Date()) {
  // Mês em andamento: pendentes e vencidos contam até agora, não até o fim do mês.
  const fim = new Date(Math.min(fimMes.getTime(), agora.getTime()));
  const criados = chs.filter((c) => dentro(c.criadoEm, ini, fim));
  const resolvidos = chs.filter((c) => c.status === "RESOLVIDO" && dentro(c.resolvidoEm, ini, fim));
  const tempos = resolvidos.map((c) => horas(c.criadoEm, c.resolvidoEm)).filter((h) => h >= 0);
  const comPrazo = resolvidos.filter((c) => c.prazoEm);
  const noPrazo = comPrazo.filter((c) => new Date(c.resolvidoEm) <= new Date(c.prazoEm)).length;
  // Ainda em aberto no último instante do mês (resolvido ou cancelado depois conta como pendente naquele dia).
  const pendentes = chs.filter((c) => new Date(c.criadoEm) < fim && !(c.resolvidoEm && new Date(c.resolvidoEm) < fim));
  const vencidos = pendentes.filter((c) => c.prazoEm && new Date(c.prazoEm) < fim).length;
  return {
    abertos: criados.length,
    peloCidadao: criados.filter((c) => /^Cidadão/.test(c.criadoPorNome || "")).length,
    resolvidos: resolvidos.length,
    cancelados: chs.filter((c) => c.status === "CANCELADO" && dentro(c.resolvidoEm, ini, fim)).length,
    tempoMedioHoras: media(tempos), tempoMedianoHoras: mediana(tempos),
    noPrazo, comPrazo: comPrazo.length, taxaNoPrazo: pct(noPrazo, comPrazo.length),
    pendentesNoFim: pendentes.length, vencidosNoFim: vencidos,
    porCategoria: contar(criados, (c) => c.categoria).slice(0, 10),
    situacaoAtual: contar(criados, (c) => STATUS_TEXTO[c.status] || c.status),
  };
}

// Atendimento humano (transbordo) do mês.
export function montarHumano(convs, { ini, fim }) {
  const enc = convs.filter((c) => dentro(c.transbordoEm, ini, fim));
  const primeira = enc.filter((c) => c.primeiraRespostaEm).map((c) => (new Date(c.primeiraRespostaEm) - new Date(c.transbordoEm)) / 60000).filter((m) => m >= 0);
  const notas = convs.filter((c) => c.avaliacao && dentro(c.encerradaEm || c.ultimaEm, ini, fim)).map((c) => c.avaliacao);
  return {
    encaminhadas: enc.length, respondidas: primeira.length,
    primeiraRespostaMin: mediana(primeira),
    notaMedia: media(notas), avaliacoes: notas.length,
  };
}

export async function gerarRelatorio(t, mes) {
  const L = limitesMes(mes);
  if (!L) throw new Error("Mês inválido (use AAAA-MM).");
  const { ini, fim, dias } = L;
  const antes = new Date(ini.getTime() - dias * 86400000);
  const [eventos, mensagens, balcao, convs, chs, conversasNovas, porCanal] = await Promise.all([
    prisma.evento.findMany({ where: { tenantId: t.id, criadoEm: { gte: antes, lt: fim } },
      select: { tipo: true, canal: true, tema: true, resolvido: true, positivo: true, transbordo: true, criadoEm: true } }),
    prisma.mensagem.findMany({ where: { autor: "CIDADAO", criadoEm: { gte: antes, lt: fim }, conversa: { tenantId: t.id } },
      select: { texto: true, criadoEm: true }, orderBy: { criadoEm: "desc" }, take: 8000 }),
    prisma.atendimentoBalcao.findMany({ where: { tenantId: t.id, criadoEm: { gte: antes, lt: fim } }, select: { servico: true, criadoEm: true }, take: 5000 }),
    prisma.conversa.findMany({ where: { tenantId: t.id, OR: [{ transbordoEm: { gte: ini, lt: fim } }, { encerradaEm: { gte: ini, lt: fim } }] },
      select: { transbordoEm: true, primeiraRespostaEm: true, encerradaEm: true, ultimaEm: true, avaliacao: true }, take: 20000 }),
    prisma.chamado.findMany({ where: { tenantId: t.id, OR: [{ criadoEm: { gte: ini, lt: fim } }, { resolvidoEm: { gte: ini, lt: fim } }, { criadoEm: { lt: fim }, resolvidoEm: null }, { criadoEm: { lt: fim }, resolvidoEm: { gte: fim } }] },
      select: { criadoEm: true, resolvidoEm: true, prazoEm: true, status: true, categoria: true, criadoPorNome: true }, take: 50000 }),
    prisma.conversa.count({ where: { tenantId: t.id, iniciadaEm: { gte: ini, lt: fim } } }),
    prisma.conversa.groupBy({ by: ["canal"], where: { tenantId: t.id, iniciadaEm: { gte: ini, lt: fim } }, _count: { _all: true } }),
  ]);
  const ob = montarObservatorio({ eventos, mensagens, balcao, dias, agora: fim.getTime() });
  const imp = montarImpacto(eventos, { desde: ini.getTime() });
  const uso = await resumoUso(t.slug, mes).catch(() => null);
  return {
    mes, nome: L.nome, sigla: t.sigla, orgao: t.nome, geradoEm: new Date().toISOString(), demonstracao: Boolean(t.demonstracao),
    parcial: fim.getTime() > Date.now(),
    atendimento: {
      conversasNovas, porCanal: Object.fromEntries(porCanal.map((x) => [x.canal, x._count._all])),
      perguntas: ob.resumo.perguntas, perguntasMesAnterior: ob.resumo.perguntasAntes, variacao: ob.resumo.variacao,
      taxaSemBase: ob.resumo.taxaSemBase, taxaTransbordo: ob.resumo.taxaTransbordo,
      satisfacao: ob.resumo.satisfacao, avaliacoes: ob.resumo.avaliacoes,
    },
    assuntos: ob.temas.slice(0, 12).map((x) => ({ tema: x.tema, n: x.atual, anterior: x.anterior, variacao: x.variacao })),
    lacunas: ob.lacunas.slice(0, 10).map((l) => ({ pergunta: l.pergunta, vezes: l.vezes })),
    protocolos: montarChamados(chs, L),
    humano: montarHumano(convs, L),
    impacto: { viagensEvitadas: imp.viagensEvitadas, taxaEvitou: imp.taxaEvitou, respostas: imp.respostas, jornadasConcluidas: imp.jornadasConcluidas,
      conferenciasOk: imp.conferenciasOk, golpesBarrados: imp.golpesBarrados, lacunasCorrigidas: imp.lacunasCorrigidas, horasCidadao: imp.horasCidadao, horasServidor: imp.horasServidor },
    jornadas: ob.jornadas.map((j) => ({ titulo: j.titulo, inicio: j.etapas[0]?.n || 0, fim: j.etapas[j.etapas.length - 1]?.n || 0 })),
    custoIA: uso?.respostas ? { respostas: uso.respostas, custoReais: uso.custoReais, custoPorResposta: uso.custoPorResposta } : null,
  };
}

// Rotina diária: no dia 1º (ou depois, se faltou) guarda o mês anterior.
export async function guardarMesAnterior(t, agora = new Date()) {
  const mes = mesAnterior(agora);
  if (await kvGetStr(chave(t.slug, mes)).catch(() => null)) return { mes, jaTinha: true };
  const r = await gerarRelatorio(t, mes);
  await kvSetEx(chave(t.slug, mes), JSON.stringify(r), TREZE_MESES);
  const idx = JSON.parse((await kvGetStr(`relatorio:${t.slug}:meses`).catch(() => null)) || "[]");
  if (!idx.includes(mes)) await kvSetEx(`relatorio:${t.slug}:meses`, JSON.stringify([mes, ...idx].sort().reverse().slice(0, 13)), TREZE_MESES);
  return { mes, guardado: true };
}

export function registrarRelatorioMensal(app) {
  const R = "/api/t/:slug/gestao/relatorio-mensal";
  app.get(`${R}/meses`, comTenant, exigir("painel"), async (req, res) => {
    const guardados = JSON.parse((await kvGetStr(`relatorio:${req.tenant.slug}:meses`).catch(() => null)) || "[]");
    res.json({ padrao: mesAnterior(), guardados });
  });
  app.get(R, comTenant, exigir("painel"), async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const mes = String(req.query.mes || mesAnterior());
    if (!limitesMes(mes)) return res.status(400).json({ error: "Mês inválido (use AAAA-MM)." });
    if (mes > mesAtual()) return res.status(400).json({ error: "Esse mês ainda não começou." });
    try {
      // Mês fechado e já guardado: devolve o guardado (mesmos números de quando foi gerado).
      const guardado = mes < mesAtual() ? await kvGetStr(chave(req.tenant.slug, mes)).catch(() => null) : null;
      if (guardado && req.query.refazer !== "1") return res.json({ ...JSON.parse(guardado), guardado: true });
      res.json(await gerarRelatorio(req.tenant, mes));
    } catch (e) {
      console.error("[relatorio-mensal]", String(e?.message || e).slice(0, 160));
      res.status(500).json({ error: "Não foi possível montar o relatório agora." });
    }
  });
}
