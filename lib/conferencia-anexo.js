// Conferência por IA dos anexos do protocolo (25/11/2026).
//
// Cada foto anexada ao pedido (site ou WhatsApp) é lida pela IA, como na
// Conferência de documentos: que documento é, se está legível, se não ficou
// cortada e se é um dos documentos pedidos naquele serviço. Só AVISA o cidadão
// na hora; não impede o envio. A leitura vai junto no chamado, para a Central
// já saber o que chegou e o que falta.
//
// A leitura fica guardada 30 minutos pelo "resumo" (sha256) da imagem, para o
// envio do pedido reaproveitar sem chamar a IA de novo e sem confiar no navegador.
import { createHash } from "node:crypto";
import { chamarLLM, llmConfigurado } from "./llm.js";
import { JORNADAS } from "./jornadas.js";
import { servicosDoTenant } from "./conferencia.js";
import { kvGetStr, kvSetEx } from "../store.js";

const IMAGEM = /^image\/(jpeg|png|webp)$/;
const chave = (slug, h) => `conf-anexo:${slug}:${h}`;
export const resumoImagem = (buf) => createHash("sha256").update(buf).digest("hex");
export const iaDisponivel = () => llmConfigurado();

// Documentos com foto pedidos nas etapas de conferência da jornada.
export function itensEsperados(t, jornadaId) {
  const j = JORNADAS[jornadaId];
  if (!j) return [];
  const ids = [...new Set(j.etapas.map((e) => e.servico).filter(Boolean))];
  const vistos = new Map();
  for (const s of servicosDoTenant(t).filter((x) => ids.includes(x.id))) {
    for (const i of s.itens) {
      if (i.foto === false || vistos.has(i.id)) continue;
      vistos.set(i.id, { id: i.id, nome: i.nome, desc: i.desc, condicional: i.condicional || null });
    }
  }
  return [...vistos.values()];
}

function prompt(t, j, itens) {
  const lista = itens.length ? itens.map((i) => `- ${i.id}: ${i.nome} (${i.desc})`).join("\n") : "(sem lista: só diga que documento é)";
  return `Você confere a FOTO de um documento anexado a um pedido de "${j.titulo}" no ${t.sigla}.
Documentos esperados neste pedido:
${lista}
Responda SOMENTE com JSON, sem texto fora dele:
{"documento": "que documento a foto mostra, em poucas palavras",
 "item": "o id da lista acima que corresponde a esta foto" ou null (se não for nenhum deles),
 "legivel": true|false (dá para ler os dados principais?),
 "cortado": true|false (falta um pedaço do documento na foto?),
 "observacao": "uma frase curta e útil para o cidadão"}
Regras: NÃO invente o que não estiver visível. NÃO repita números de documentos (CPF, RG, RENAVAM, placa) nem nomes de pessoas na resposta.`;
}

// Decide o aviso a partir da leitura (a IA só descreve).
export function avaliarAnexo(itens, L = {}) {
  const item = itens.find((i) => i.id === L.item) || null;
  const doc = String(L.documento || "").slice(0, 80);
  if (L.legivel === false) return { status: "ILEGIVEL", item: item?.id || null, documento: doc, motivo: "A foto não está legível. Tire outra com boa luz, sem reflexo e com o documento inteiro." };
  if (L.cortado === true) return { status: "CORTADO", item: item?.id || null, documento: doc, motivo: "Parte do documento ficou fora da foto. Tire outra mostrando o documento inteiro." };
  if (!item && itens.length) return { status: "OUTRO", item: null, documento: doc, motivo: `Parece ser ${doc ? `"${doc}"` : "outro documento"}, que não está na lista deste pedido. Confira se é o arquivo certo.` };
  return { status: "OK", item: item?.id || null, documento: item?.nome || doc, motivo: item ? `${item.nome}: legível.` : "Documento legível." };
}

// Texto curto para o chamado (Central).
export const linhaCentral = (r) => (r ? `IA: ${r.documento || "documento"}${r.status === "OK" ? ", legível" : ` (${{ ILEGIVEL: "ilegível", CORTADO: "cortado", OUTRO: "fora da lista" }[r.status] || r.status})`}` : "");

// Lê uma imagem; devolve o aviso ou null (sem IA, PDF ou falha: o envio segue sem aviso).
export async function conferirAnexo(t, jornadaId, { mime, dados }, { llm = chamarLLM } = {}) {
  const j = JORNADAS[jornadaId];
  if (!j || !IMAGEM.test(String(mime)) || !dados?.length || (llm === chamarLLM && !llmConfigurado())) return null;
  const h = resumoImagem(dados);
  try { const c = await kvGetStr(chave(t.slug, h)); if (c) return JSON.parse(c); } catch { /* segue */ }
  const itens = itensEsperados(t, jornadaId);
  try {
    const txt = await llm({
      system: prompt(t, j, itens), maxTokens: 250,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: dados.toString("base64") } }, { type: "text", text: "Confira esta foto." }] }],
    });
    let L = {};
    try { L = JSON.parse((String(txt).match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { L = {}; }
    const r = avaliarAnexo(itens, L);
    await kvSetEx(chave(t.slug, h), JSON.stringify(r), 1800).catch(() => {});
    return r;
  } catch (e) {
    console.warn("[conferencia-anexo]", String(e?.message || e).slice(0, 120));
    return null;
  }
}

// Leitura já feita desta imagem (no envio do pedido).
export async function leituraGuardada(t, dados) {
  try { const c = await kvGetStr(chave(t.slug, resumoImagem(dados))); return c ? JSON.parse(c) : null; } catch { return null; }
}

// O que ainda falta, dos documentos obrigatórios (sem condição), dadas as leituras.
export function faltando(itens, leituras) {
  const achados = new Set(leituras.filter((r) => r && r.item && r.status !== "ILEGIVEL").map((r) => r.item));
  return itens.filter((i) => !i.condicional && !achados.has(i.id)).map((i) => i.nome);
}
