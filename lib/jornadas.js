// "Despachante Parente": jornadas guiadas que levam o serviço do começo ao fim.
// O assistente não só explica — conduz etapa por etapa, guarda onde a pessoa
// parou, calcula prazos, cria lembretes e volta a chamar quando trava.
//
// Motor independente de canal: o mesmo estado serve o site e o WhatsApp.
// Estado no KV (sem tabela nova): jor:<slug>:<dono>  (dono = "web:<sessão>" ou "wa:<telefone>").
// Funil: um Evento JORNADA por etapa alcançada (tema "<jornada>:<etapa>").
import { kvGetStr, kvSetEx, kvDel } from "../store.js";

const DIA = 86400000;
const TTL = 150 * 86400;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const br = (s) => String(s).slice(0, 10).split("-").reverse().join("/");
const somaDias = (s, n) => iso(new Date(new Date(String(s).slice(0, 10) + "T12:00:00Z").getTime() + n * DIA));
const hojeISO = () => iso(Date.now());

// Prorrogação da Resolução CONTRAN 1.033/2026.
const PROROG = { de: "2026-06-05", ate: "2026-12-08" };

export const JORNADAS = {
  venda: {
    id: "venda", icone: "🚗", titulo: "Vendi meu veículo",
    resumo: "Débitos, documento, intenção de venda, data da venda e comunicação ao DETRAN — com o prazo de 30 dias contado.",
    gatilho: /\b(vendi|vendendo|vender|venda d[oe])\b[^.?!]{0,40}\b(carro|moto|ve[ií]culo|caminhonete|caminh[aã]o|autom[oó]vel)\b|\b(carro|moto|ve[ií]culo)\b[^.?!]{0,25}\bvendi\b/i,
    etapas: [
      { id: "debitos", titulo: "Conferir débitos", tipo: "info", link: "portal",
        texto: (t) => `Antes de tudo, veja se o veículo tem multa, IPVA ou licenciamento em aberto: eles podem travar a transferência. Consulte digitando você mesmo o endereço do portal oficial (${t.portalUrl}). Recebeu cobrança por mensagem? Me mande que eu confiro se é golpe.` },
      { id: "documento", titulo: "Tipo de documento", tipo: "escolha", salvarEm: "documento",
        texto: () => "O documento do veículo é digital (ATPV-e, no app Carteira Digital de Trânsito) ou o CRV de papel (veículos registrados até 03/01/2021)?",
        opcoes: [{ id: "digital", rotulo: "Digital (ATPV-e)" }, { id: "papel", rotulo: "CRV de papel" }] },
      { id: "intencao", titulo: "Intenção de venda", tipo: "form", formId: "intencao-venda", so: (d) => d.documento === "digital",
        texto: () => "Registre a intenção de venda (ela gera a ATPV-e com os dados do comprador). Eu preencho o formulário com o que você me disser." },
      { id: "assinatura", titulo: "Assinar a ATPV-e", tipo: "info", so: (d) => d.documento === "digital",
        texto: () => "Vendedor e comprador assinam a ATPV-e no app Carteira Digital de Trânsito (CDT). Com a assinatura digital não precisa de cartório." },
      { id: "crv", titulo: "Preencher o CRV e reconhecer firma", tipo: "info", so: (d) => d.documento === "papel",
        texto: () => "Preencha o verso do CRV com os dados do comprador, a data e o valor — sem rasuras — e reconheçam firma (vendedor e comprador) em cartório, por autenticidade." },
      { id: "dataVenda", titulo: "Data da venda", tipo: "data", salvarEm: "dataVenda", passado: true,
        texto: () => "Qual foi a data da assinatura da venda? A partir dela o comprador tem 30 dias para transferir, e você deve comunicar a venda." },
      { id: "comunicacao", titulo: "Comunicar a venda ao DETRAN", tipo: "conferir", servico: "comunicacao-venda", formId: "comunicacao-venda",
        texto: (t, d) => `Comunique a venda ao ${t.sigla}${d.dataVenda ? ` até ${br(somaDias(d.dataVenda, 30))}` : " em até 30 dias"}: é isso que tira de você a responsabilidade pelas multas e débitos depois da venda. Confira os documentos antes de ir.` },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: (t, d) => `Égua, resolvido! Venda comunicada.${d.dataVenda ? ` Lembre o comprador: a transferência para o nome dele vai até ${br(somaDias(d.dataVenda, 30))}.` : ""} Multas e débitos a partir da data da venda não são mais seus.` },
    ],
    prazos: (d) => (d.dataVenda ? [{ rotulo: "Transferência pelo comprador e comunicação de venda", data: somaDias(d.dataVenda, 30) }] : []),
  },

  renovacao: {
    id: "renovacao", icone: "🪪", titulo: "Renovar minha CNH",
    resumo: "Validade (com a prorrogação de 2026), documentos, guia, exame médico e biometria — com lembrete do vencimento.",
    gatilho: /\b(renovar|renova[cç][aã]o|renovo|vencid[ao]|venceu|vai vencer)\b[^.?!]{0,30}\b(cnh|carteira|habilita[cç][aã]o)\b|\b(cnh|carteira de motorista)\b[^.?!]{0,30}\b(vencid[ao]|venceu|vencendo|renovar)\b/i,
    etapas: [
      { id: "validade", titulo: "Data de validade", tipo: "data", salvarEm: "validade", lembrete: "CNH",
        texto: () => "Qual é a data de validade da sua CNH (está impressa na carteira ou no app CDT)?" },
      { id: "documentos", titulo: "Conferir documentos", tipo: "conferir", servico: "renovacao-cnh",
        texto: () => "Separe os documentos. Mande as fotos aqui que eu confiro se estão certos e no prazo (comprovante de residência recente, documento com foto)." },
      { id: "guia", titulo: "Emitir e pagar a guia", tipo: "info", link: "portal",
        texto: (t) => `Emita a guia da renovação no portal oficial (${t.portalUrl}) e pague. Antes de pagar, se quiser, me mande o código de barras que eu confiro se é verdadeiro.` },
      { id: "exame", titulo: "Exame médico", tipo: "data", salvarEm: "exame", futuro: true, opcional: true,
        texto: (t) => `Agende o exame médico em clínica credenciada${t.telefone ? ` (${t.telefone})` : ""}. Me diga a data marcada que eu te lembro. Categorias C, D e E também fazem o toxicológico.` },
      { id: "biometria", titulo: "Biometria e foto", tipo: "info",
        texto: (t) => `Compareça para a coleta da biometria/foto quando o ${t.sigla} pedir (ou conforme o agendamento). Leve os documentos originais.` },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, resolvido! Agora é aguardar a CNH nova — a versão digital aparece no app Carteira Digital de Trânsito." },
    ],
    prazos: (d) => {
      const out = [];
      if (d.validade) {
        if (d.validade >= PROROG.de && d.validade <= PROROG.ate) out.push({ rotulo: "Sua CNH está no período prorrogado pela Resolução CONTRAN 1.033/2026 — confirme o novo prazo no portal", data: d.validade, aviso: true });
        else out.push({ rotulo: "Vencimento da CNH (dá para dirigir até 30 dias depois)", data: d.validade });
      }
      if (d.exame) out.push({ rotulo: "Exame médico", data: d.exame });
      return out;
    },
  },

  defesa: {
    id: "defesa", icone: "⚖️", titulo: "Contestar uma multa",
    resumo: "Prazo contado da notificação, fase certa (defesa prévia ou JARI), provas, rascunho da peça e protocolo.",
    gatilho: /\b(contestar|recorrer|recurso|defesa|defender)\b[^.?!]{0,30}\b(multa|autua[cç][aã]o|notifica[cç][aã]o|infra[cç][aã]o)\b|\b(multa|notifica[cç][aã]o)\b[^.?!]{0,30}\b(injusta|errada|indevida|contestar|recorrer)\b/i,
    etapas: [
      { id: "recebimento", titulo: "Data em que recebeu", tipo: "data", salvarEm: "recebimento", passado: true, lembrete: "DEFESA",
        texto: () => "Em que data você recebeu a notificação? É dela que contam os 30 dias para a defesa." },
      { id: "fase", titulo: "Qual notificação é", tipo: "escolha", salvarEm: "fase",
        texto: () => "A notificação é de AUTUAÇÃO (a primeira, ainda sem valor de multa) ou de PENALIDADE (já com o valor da multa)?",
        opcoes: [{ id: "autuacao", rotulo: "Autuação (defesa prévia)" }, { id: "penalidade", rotulo: "Penalidade (recurso à JARI)" }] },
      { id: "provas", titulo: "Separar provas", tipo: "info",
        texto: () => "Junte a notificação (frente e verso), documento com foto e tudo que ajuda: fotos do local e da sinalização, comprovantes, testemunhas. Erros na notificação (placa, local, data, prazo) também contam." },
      { id: "rascunho", titulo: "Rascunho da peça", tipo: "defesa",
        texto: (t, d) => `Eu gero um rascunho de ${d.fase === "penalidade" ? "recurso à JARI" : "defesa prévia"} com base na conversa. Revise, complete com os seus dados e assine.` },
      { id: "protocolo", titulo: "Protocolar", tipo: "info", link: "portal",
        texto: (t, d) => `Protocole pelo canal oficial (${t.portalUrl})${d.recebimento ? ` até ${br(somaDias(d.recebimento, 30))}` : ""}. Guarde o número do protocolo.` },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, protocolado! Agora é acompanhar o resultado. Se for indeferido, ainda cabe a próxima instância — é só me chamar que a gente faz juntos." },
    ],
    prazos: (d) => (d.recebimento ? [{ rotulo: d.fase === "penalidade" ? "Prazo do recurso à JARI (confira na notificação)" : "Prazo da defesa prévia", data: somaDias(d.recebimento, 30) }] : []),
  },
};

export function detectarJornada(texto) {
  const t = String(texto || "");
  for (const j of Object.values(JORNADAS)) if (j.gatilho.test(t)) return j.id;
  return null;
}

// ── Estado ──
const chave = (slug, dono) => `jor:${slug}:${dono}`;
const chaveIdx = (slug) => `jor:${slug}:idx`;
export const donoValido = (d) => /^(web:[A-Za-z0-9-]{8,48}|wa:\d{10,15})$/.test(String(d || ""));

export async function lerJornada(slug, dono) {
  try { return JSON.parse((await kvGetStr(chave(slug, dono))) || "null"); } catch { return null; }
}
async function gravar(slug, est) {
  await kvSetEx(chave(slug, est.dono), JSON.stringify(est), TTL);
  if (est.dono.startsWith("wa:")) {
    let idx = []; try { idx = JSON.parse((await kvGetStr(chaveIdx(slug))) || "[]"); } catch { idx = []; }
    if (!idx.includes(est.dono)) { idx.push(est.dono); await kvSetEx(chaveIdx(slug), JSON.stringify(idx.slice(-3000)), TTL); }
  }
}
export async function donosWhatsApp(slug) { try { return JSON.parse((await kvGetStr(chaveIdx(slug))) || "[]"); } catch { return []; } }

const visiveis = (j, d) => j.etapas.filter((e) => !e.so || e.so(d));

// Cartão da etapa atual (igual para site e WhatsApp).
export function cartao(t, est) {
  const j = JORNADAS[est.jornada]; if (!j) return null;
  const etapas = visiveis(j, est.dados);
  const idx = Math.min(est.idx, etapas.length - 1);
  const e = etapas[idx];
  return {
    slug: t.slug,
    jornada: { id: j.id, titulo: j.titulo, icone: j.icone },
    etapa: { id: e.id, titulo: e.titulo, tipo: e.tipo, texto: e.texto(t, est.dados), opcoes: e.opcoes || null, formId: e.formId || null, servico: e.servico || null,
      link: e.link === "portal" ? t.portalUrl : null, lembrete: e.lembrete || null, opcional: Boolean(e.opcional), valor: e.salvarEm ? est.dados[e.salvarEm] || null : null },
    progresso: { atual: idx + 1, total: etapas.length, etapas: etapas.map((x, i) => ({ id: x.id, titulo: x.titulo, feito: i < idx, atual: i === idx })) },
    prazos: (j.prazos ? j.prazos(est.dados) : []).map((p) => ({ ...p, dataBR: br(p.data), faltam: Math.round((new Date(p.data + "T12:00:00Z") - new Date(hojeISO() + "T12:00:00Z")) / DIA) })),
    concluida: e.tipo === "fim",
    dados: { ...est.dados },
  };
}

export async function iniciar(t, dono, jornadaId, { canal = "WEB", registrar } = {}) {
  const j = JORNADAS[jornadaId]; if (!j) throw new Error("Jornada desconhecida.");
  const est = { jornada: j.id, dono, idx: 0, dados: {}, canal, iniciadaEm: new Date().toISOString(), atualizadaEm: new Date().toISOString(), lembradaEm: null };
  await gravar(t.slug, est);
  registrar?.({ tenantId: t.id, tipo: "JORNADA", canal, tema: `${j.id}:${visiveis(j, {})[0].id}` });
  return est;
}

function lerDataLivre(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const d = new Date(Date.UTC(a, +m[2] - 1, +m[1], 12));
  return d.getUTCMonth() === +m[2] - 1 ? iso(d) : null;
}

// acao: "feito" | "pular" | "voltar" | "opcao" (valor = id) | "data" (valor = data)
export async function responder(t, est, { acao, valor }, { registrar } = {}) {
  const j = JORNADAS[est.jornada]; if (!j) throw new Error("Jornada desconhecida.");
  let etapas = visiveis(j, est.dados);
  const e = etapas[Math.min(est.idx, etapas.length - 1)];
  const avisos = [];
  if (acao === "voltar") { est.idx = Math.max(0, est.idx - 1); }
  else if (e.tipo === "fim") { return { est, erro: "Esta jornada já foi concluída." }; }
  else if (acao === "opcao") {
    if (e.tipo !== "escolha" || !e.opcoes.some((o) => o.id === valor)) return { est, erro: "Escolha uma das opções." };
    est.dados[e.salvarEm] = valor; est.idx++;
  } else if (acao === "data") {
    if (e.tipo !== "data") return { est, erro: "Esta etapa não pede data." };
    const d = lerDataLivre(valor);
    if (!d) return { est, erro: "Não entendi a data. Use dd/mm/aaaa." };
    if (e.passado && d > hojeISO()) return { est, erro: "Essa data está no futuro." };
    if (e.futuro && d < hojeISO()) return { est, erro: "Essa data já passou." };
    est.dados[e.salvarEm] = d; est.idx++;
    if (e.lembrete) avisos.push({ lembrete: e.lembrete, data: d });
  } else if (acao === "feito" || (acao === "pular" && (e.opcional || (e.tipo !== "escolha" && e.tipo !== "data")))) {
    if (e.tipo === "data" && acao === "feito" && !e.opcional) return { est, erro: "Me diga a data para eu contar o prazo." };
    if (e.tipo === "escolha" && acao === "feito") return { est, erro: "Escolha uma das opções." };
    est.idx++;
  } else return { est, erro: "Não entendi. Use os botões da etapa." };
  etapas = visiveis(j, est.dados);
  est.idx = Math.min(est.idx, etapas.length - 1);
  est.atualizadaEm = new Date().toISOString(); est.lembradaEm = null;
  await gravar(t.slug, est);
  if (acao !== "voltar") registrar?.({ tenantId: t.id, tipo: "JORNADA", canal: est.canal, tema: `${j.id}:${etapas[est.idx].id}` });
  return { est, avisos };
}

export async function sair(t, dono) { await kvDel(chave(t.slug, dono)); }

// ── WhatsApp ──
export function textoWhatsApp(c) {
  if (!c) return "";
  const { etapa: e, progresso: p } = c;
  const barra = "▰".repeat(p.atual) + "▱".repeat(Math.max(0, p.total - p.atual));
  let s = `${c.jornada.icone} *${c.jornada.titulo}* — etapa ${p.atual} de ${p.total}\n${barra}\n\n*${e.titulo}*\n${e.texto}`;
  if (c.prazos.length) s += `\n\n📅 ${c.prazos.map((x) => `${x.rotulo}: *${x.dataBR}*${x.faltam >= 0 ? ` (faltam ${x.faltam} dias)` : ""}`).join("\n📅 ")}`;
  if (c.concluida) return s + "\n\n_Para começar outra: escreva ACOMPANHAR._";
  const base = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  if (e.tipo === "escolha") s += `\n\nResponda com o número:\n${e.opcoes.map((o, i) => `*${i + 1}* — ${o.rotulo}`).join("\n")}`;
  else if (e.tipo === "data") s += `\n\nResponda com a data (dd/mm/aaaa)${e.opcional ? " ou PULAR" : ""}.`;
  else {
    if (e.formId && base) s += `\n\n📄 Preencher: ${base}/${c.slug || ""}?doc=${e.formId}`;
    if (e.servico && base) s += `\n✅ Conferir documentos: ${base}/${c.slug || ""}?acao=conferir&servico=${e.servico}`;
    if (e.tipo === "defesa" && base) s += `\n\n⚖️ Gerar o rascunho: ${base}/${c.slug || ""}?acao=defesa`;
    s += `\n\nQuando terminar, responda *OK*.`;
  }
  return s + "\n_VOLTAR: etapa anterior · SAIR: parar o acompanhamento_";
}

// Interpreta uma mensagem do WhatsApp como comando da jornada (ou null).
export function comandoWhatsApp(c, texto) {
  const s = String(texto || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.!]+$/, "");
  if (!c) return null;
  if (/^(sair|parar acompanhamento|cancelar jornada)$/.test(s)) return { acao: "sair" };
  if (/^voltar$/.test(s)) return { acao: "voltar" };
  if (c.concluida) return null;
  const e = c.etapa;
  if (e.tipo === "escolha" && /^\d$/.test(s) && e.opcoes[+s - 1]) return { acao: "opcao", valor: e.opcoes[+s - 1].id };
  if (e.tipo === "data" && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return { acao: "data", valor: s };
  if (/^pular$/.test(s)) return { acao: "pular" };
  if (/^(ok|feito|pronto|concluido|conclui|fiz|ja fiz|terminei)$/.test(s)) return { acao: "feito" };
  return null;
}

// Rotina diária: lembra quem parou numa etapa há 3+ dias (no máximo 1x a cada 3 dias).
export async function cutucarParados(t, enviar) {
  let enviados = 0;
  for (const dono of await donosWhatsApp(t.slug)) {
    const est = await lerJornada(t.slug, dono);
    if (!est) continue;
    const c = cartao(t, est); if (!c || c.concluida) continue;
    const parado = Date.now() - new Date(est.atualizadaEm).getTime() > 3 * DIA;
    const lembrado = est.lembradaEm && Date.now() - new Date(est.lembradaEm).getTime() < 3 * DIA;
    const prazoPerto = c.prazos.find((p) => p.faltam >= 0 && p.faltam <= 5);
    if ((!parado && !prazoPerto) || lembrado) continue;
    try {
      await enviar(dono.slice(3), `🧭 Oi! Passando para lembrar do *${c.jornada.titulo}*: você está na etapa *${c.etapa.titulo}* (${c.progresso.atual} de ${c.progresso.total}).${prazoPerto ? `\n⏰ ${prazoPerto.rotulo}: *${prazoPerto.dataBR}* (faltam ${prazoPerto.faltam} dias).` : ""}\n\nResponda *OK* quando concluir esta etapa, *JORNADA* para ver os detalhes ou *SAIR* para parar.`);
      est.lembradaEm = new Date().toISOString();
      await kvSetEx(chave(t.slug, dono), JSON.stringify(est), TTL);
      enviados++;
    } catch (e) { console.warn(`[jornadas:${t.slug}]`, e.message); }
  }
  return { enviados };
}
