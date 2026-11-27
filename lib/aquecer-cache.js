// ─────────────────────────────────────────────────────────────────────────────
// Montagem da resposta do BotAyio para o site + pré-aquecimento do cache (22/11/2026).
//
// Pré-aquecimento: as perguntas que mais abrem conversas (30 dias, site e WhatsApp)
// são respondidas de antemão e guardadas no cache por 24 h. Quem pergunta depois
// recebe a resposta em menos de 1 s. Roda em pedaços (orçamento de tempo) e pula o
// que já está no cache: chamado pelo cron diário e, se configurado, pelo monitor.
// As perguntas vão ao BotAyio como `simulacao` (não entram no Inbox nem na Tutoria).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { integracoes } from "./tenants.js";
import { perguntarRapido, textoComBotoes } from "./botayio.js";
import { detectarJornada } from "./jornadas.js";
import { cacheavel, formaCanonica, lerCache, guardarCache } from "./cache-respostas.js";
import { registrarUso } from "./uso-ia.js";

// "em o portal" -> "no portal" (teste C9/C10): o texto às vezes vem com a preposição solta.
// Só "em + artigo", que em português é sempre contraído.
const CONTR = { o: "no", a: "na", os: "nos", as: "nas" }; // "em um" é aceito; fica como está
export function contrair(s) {
  return String(s).replace(/(?<![\p{L}\d])([Ee])m (o|a|os|as) (?=\p{L})/gu, (m, e, art) => {
    const c = CONTR[art]; return (e === "E" ? c[0].toUpperCase() + c.slice(1) : c) + " ";
  });
}

export function montarResposta(resp, pergunta) {
  const partes = [];
  for (const item of resp.contents || []) {
    const txt = textoComBotoes(item);
    if (txt) partes.push(txt);
    if (item.arquivo?.url) partes.push(`📎 ${item.arquivo.nome || "Arquivo"}: ${item.arquivo.url}`);
  }
  // [[SEMBASE]] é registro interno: não vai para o cidadão; marca a lacuna.
  const semBase = partes.some((p) => p.includes("[[SEMBASE]]"));
  for (let i = partes.length - 1; i >= 0; i--) {
    partes[i] = contrair(partes[i].replace(/\s*\[\[SEMBASE\]\]\s*/g, "\n")).trim();
    if (!partes[i]) partes.splice(i, 1);
  }
  const reply = partes.join("\n[[BREAK]]\n");
  const transbordo = Boolean(resp.handed_off);
  const jor = detectarJornada(pergunta);
  const final = (reply || "Não consegui gerar uma resposta. Pode reformular a pergunta?") + (jor && !transbordo ? `\n[[JORNADA:${jor}]]` : "");
  return { partes, reply, semBase, transbordo, final };
}

// Perguntas que mais abrem conversas (forma canônica -> exemplo e contagem).
export async function perguntasFrequentes(t, { dias = 30, minimo = 2, limite = 40 } = {}) {
  const desde = new Date(Date.now() - dias * 86400000);
  const convs = await prisma.conversa.findMany({
    where: { tenantId: t.id, iniciadaEm: { gte: desde } }, orderBy: { iniciadaEm: "desc" }, take: 3000,
    select: { mensagens: { where: { autor: "CIDADAO" }, orderBy: { criadoEm: "asc" }, take: 1, select: { texto: true } } },
  });
  const cont = new Map();
  for (const c of convs) {
    const p = String(c.mensagens[0]?.texto || "").trim();
    if (!cacheavel(p, { ignorarDesligado: true })) continue;
    const k = formaCanonica(p); if (!k) continue;
    const e = cont.get(k) || { pergunta: p, n: 0 }; e.n++; cont.set(k, e);
  }
  return [...cont.values()].filter((e) => e.n >= minimo).sort((a, b) => b.n - a.n).slice(0, limite);
}

export async function aquecerTenant(t, { orcamentoMs = 8000, paralelo = 3 } = {}) {
  const { botayio } = integracoes(t);
  if (!botayio.url || !botayio.secret) return { pulado: "sem BotAyio" };
  const fim = Date.now() + orcamentoMs;
  const fila = [];
  for (const f of await perguntasFrequentes(t)) if (!(await lerCache(t.slug, f.pergunta))) fila.push(f);
  let aquecidas = 0, falhas = 0;
  const trabalhar = async () => {
    while (fila.length && Date.now() < fim) {
      const { pergunta } = fila.shift();
      try {
        const sess = `detran-${t.slug}-aquecer-${formaCanonica(pergunta).replace(/\W+/g, "-").slice(0, 40)}`;
        const resp = await perguntarRapido(botayio, sess, pergunta, true, { simulacao: true });
        const r = montarResposta(resp, pergunta);
        await registrarUso(t.slug, "AQUECIMENTO", resp.uso);
        if (r.reply && !r.semBase && !r.transbordo && await guardarCache(t.slug, pergunta, { reply: r.final, categoria: resp.categoria || null }, { horas: 24 })) aquecidas++;
      } catch (e) { falhas++; console.warn(`[aquecer:${t.slug}]`, e.message); }
    }
  };
  await Promise.all(Array.from({ length: paralelo }, trabalhar));
  return { aquecidas, falhas, faltam: fila.length };
}
