// ─────────────────────────────────────────────────────────────────────────────
// Custo REAL da IA por resposta (22/11/2026).
// O BotAyio devolve, em cada resposta, os tokens gastos (`uso`). Aqui cada resposta
// vira uma linha (`usoia:<slug>:<AAAA-MM>`) e o painel soma o mês.
// Custo em R$ = tokens × preço do modelo. Preços de referência abaixo (US$ por
// milhão de tokens: entrada, saída, cache lido); ajuste com PRECOS_IA (JSON) e a
// cotação com COTACAO_USD. Modelo sem preço: mostra os tokens e avisa.
// Nada de dado pessoal: só contagens.
// ─────────────────────────────────────────────────────────────────────────────
import { anotarLinha, somarLinhas } from "../store.js";

const PRECOS_REF = {
  "claude-haiku-4-5": [1, 5, 0.1],
  "claude-sonnet": [3, 15, 0.3],
  "deepseek": [0.28, 0.42, 0.028],
};
export function precos() {
  let extra = {};
  try { extra = JSON.parse(process.env.PRECOS_IA || "{}"); } catch { extra = {}; }
  return { ...PRECOS_REF, ...extra };
}
export const cotacao = () => Number(process.env.COTACAO_USD) || 5.07;
export function precoDo(modelo) {
  const m = String(modelo || "").toLowerCase(), tab = precos();
  const chave = Object.keys(tab).filter((k) => m.startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  return chave ? { chave, por: tab[chave] } : null;
}
export function custoReais({ entrada = 0, saida = 0, cache_lido = 0 }, modelo) {
  const p = precoDo(modelo); if (!p) return null;
  const [e, s, c] = p.por;
  return ((entrada * e + saida * s + cache_lido * (c ?? e)) / 1e6) * cotacao();
}

const mes = (d = new Date()) => d.toISOString().slice(0, 7);
export async function registrarUso(slug, canal, uso) {
  if (!uso || !uso.chamadas) return;
  const modelo = (uso.modelos || [])[0] || "desconhecido";
  const linha = { canal, modelo, entrada: uso.entrada | 0, saida: uso.saida | 0, cache_lido: uso.cache_lido | 0, cache_gravado: uso.cache_gravado | 0, chamadas: uso.chamadas | 0 };
  await anotarLinha(`usoia:${slug}:${mes()}`, linha, 400 * 86400).catch((e) => console.warn("[uso-ia]", e.message));
}

export async function resumoUso(slug, quando = mes()) {
  const grupos = await somarLinhas(`usoia:${slug}:${quando}`, ["entrada", "saida", "cache_lido", "cache_gravado", "chamadas"], "modelo");
  let respostas = 0, custo = 0, semPreco = [];
  const porModelo = grupos.map((g) => {
    respostas += g.n;
    const c = custoReais(g, g.grupo);
    if (c == null) semPreco.push(g.grupo); else custo += c;
    return { modelo: g.grupo, respostas: g.n, entrada: g.entrada, saida: g.saida, cacheLido: g.cache_lido, custoReais: c == null ? null : Math.round(c * 100) / 100 };
  });
  const tot = (k) => grupos.reduce((a, g) => a + g[k], 0);
  return {
    mes: quando, respostas,
    tokens: { entrada: tot("entrada"), saida: tot("saida"), cacheLido: tot("cache_lido") },
    custoReais: Math.round(custo * 100) / 100,
    custoPorResposta: respostas && !semPreco.length ? Math.round((custo / respostas) * 10000) / 10000 : null,
    semPreco, porModelo, cotacao: cotacao(),
  };
}
