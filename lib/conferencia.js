// ─────────────────────────────────────────────────────────────────────────────
// Conferência de documentos antes do protocolo.
//
// O cidadão escolhe o serviço, vê o checklist e, para cada item, manda a foto
// do documento. A IA só LÊ a foto (que documento é, se está legível, datas de
// emissão/validade, se tem assinatura); quem decide se está vencido é o código,
// com a regra do item (ex.: comprovante de residência de até 90 dias).
// A foto não é guardada.
//
//   GET  /api/t/<slug>/conferencia            -> serviços e itens
//   POST /api/t/<slug>/conferencia/analisar   { servico, item, imagem }
//
// Cada DETRAN pode trocar a lista em Tenant.conteudo.conferencias (pelo /admin).
// ─────────────────────────────────────────────────────────────────────────────
import { comTenant } from "./tenants.js";
import { chamarLLM, llmConfigurado } from "./llm.js";
import { registrarEvento } from "./registro.js";

// Peças reaproveitadas entre serviços.
const D = {
  identidade: { id: "identidade", nome: "Documento de identidade com foto", desc: "RG, CNH dentro da validade, carteira de trabalho ou certificado de reservista. Original.", foto: true, regra: { tipo: "validade" } },
  cpf: { id: "cpf", nome: "CPF", desc: "Pode ser o número no RG ou na CNH. Se não constar, leve o comprovante de inscrição no CPF.", foto: true },
  comprovante: { id: "comprovante", nome: "Comprovante de residência", desc: "Conta de água, luz, telefone ou internet com CEP, emitida há no máximo 90 dias.", foto: true, regra: { tipo: "emissao", dias: 90 } },
  toxicologico: (quando) => ({ id: "toxicologico", nome: "Exame toxicológico", desc: `Laudo de laboratório credenciado. A coleta precisa ter sido feita há no máximo 90 dias. ${quando}`, foto: true, regra: { tipo: "emissao", dias: 90 }, condicional: quando }),
  procuracao: { id: "procuracao", nome: "Procuração (se outra pessoa for por você)", desc: "Com firma reconhecida por autenticidade e indicando o serviço.", foto: true, condicional: "Só se for representado por outra pessoa.", form: "procuracao" },
  bo: { id: "bo", nome: "Boletim de ocorrência", desc: "Se o documento foi roubado, furtado ou perdido.", foto: true, condicional: "Só em caso de roubo, furto ou perda." },
  vistoria: { id: "vistoria", nome: "Laudo de vistoria", desc: "Feito em ECV credenciada ou no DETRAN, com o decalque do chassi e do motor legível.", foto: true },
};

export const SERVICOS_PADRAO = [
  { id: "transferencia", icone: "🚗", titulo: "Transferência de veículo (comprei um carro)", resumo: "Quem faz é o comprador, em até 30 dias depois de assinar a ATPV.",
    itens: [
      { id: "crv", nome: "CRV assinado (ou ATPV-e)", desc: "CRV original preenchido, assinado, datado e sem rasura, com firma reconhecida por autenticidade do vendedor e do comprador. Ou a ATPV-e assinada pelo app Carteira Digital de Trânsito.", foto: true, regra: { tipo: "assinatura" } },
      D.vistoria, D.identidade, D.cpf, D.comprovante, D.procuracao,
      { id: "pj", nome: "Contrato social e ata (empresa)", desc: "Se o comprador for pessoa jurídica: contrato social/estatuto e ata de eleição da diretoria.", foto: true, condicional: "Só se o comprador for empresa." },
    ] },
  { id: "comunicacao-venda", icone: "🤝", titulo: "Comunicação de venda (vendi um carro)", resumo: "Quem faz é o vendedor, em até 30 dias depois da venda, para não responder pelas multas do comprador.",
    itens: [
      { id: "crv-copia", nome: "Cópia autenticada do CRV (ou ATPV-e)", desc: "Preenchido e assinado pelo vendedor e pelo comprador.", foto: true, regra: { tipo: "assinatura" } },
      { id: "requerimento", nome: "Requerimento de comunicação de venda", desc: "O formulário oficial preenchido. Dá para preencher aqui no assistente.", foto: true, form: "comunicacao-venda" },
      { id: "dados-comprador", nome: "Dados completos do comprador", desc: "Nome, CPF, endereço, telefone e e-mail de quem comprou.", foto: false },
      D.identidade,
    ] },
  { id: "renovacao-cnh", icone: "🪪", titulo: "Renovação da CNH", resumo: "Exame médico em clínica credenciada e, para C, D e E, exame toxicológico.",
    itens: [D.identidade, { id: "cnh", nome: "CNH atual", desc: "A carteira que vai ser renovada (ou boletim de ocorrência, se foi perdida/roubada).", foto: true }, D.comprovante, D.toxicologico("Obrigatório para as categorias C, D e E.")] },
  { id: "primeira-habilitacao", icone: "🎓", titulo: "Primeira habilitação", resumo: "Para quem vai tirar a CNH pela primeira vez.",
    itens: [D.identidade, D.cpf, D.comprovante, D.toxicologico("Exigido também para A e B pela regra nova (Lei 15.153/2025): confirme no portal se já vale para o seu caso.")] },
  { id: "categoria-cnh", icone: "🚚", titulo: "Mudança ou adição de categoria na CNH", resumo: "Exames e prova prática na nova categoria.",
    itens: [{ id: "cnh", nome: "CNH atual (original)", desc: "Ativa, sem suspensão, cassação ou bloqueio.", foto: true, regra: { tipo: "validade" } }, D.identidade, D.cpf, D.comprovante, D.toxicologico("Obrigatório se a nova categoria for C, D ou E."), D.bo] },
  { id: "segunda-via-cnh", icone: "🔁", titulo: "Segunda via da CNH", resumo: "Quando a carteira foi perdida, roubada ou danificada.",
    itens: [D.identidade, D.cpf, D.comprovante, D.bo] },
  { id: "jurisdicao", icone: "🗺️", titulo: "Transferência de jurisdição (veículo de outro estado)", resumo: "Para registrar aqui um veículo que vem de outro estado.",
    itens: [{ id: "crv", nome: "CRV original", desc: "Do veículo que vem de outra UF.", foto: true }, D.vistoria, D.identidade, D.cpf, D.comprovante, D.procuracao] },
  { id: "endereco-veiculo", icone: "🏠", titulo: "Atualização de endereço do veículo", resumo: "Para receber as notificações no endereço certo.",
    itens: [D.comprovante, D.identidade] },
  { id: "emplacamento", icone: "🆕", titulo: "Primeiro emplacamento (veículo 0 km)", resumo: "Registro de veículo novo.",
    itens: [{ id: "nf", nome: "Nota fiscal do veículo", desc: "Nota fiscal de venda em nome do comprador.", foto: true }, D.identidade, D.cpf, D.comprovante, D.vistoria, { id: "guias", nome: "Guias de IPVA e licenciamento pagas", desc: "Comprovantes de pagamento.", foto: true }] },
];

export function servicosDoTenant(t) {
  const c = t?.conteudo?.conferencias;
  return Array.isArray(c) && c.length ? c : SERVICOS_PADRAO;
}

const hojeISO = () => new Date().toISOString().slice(0, 10);
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dias = (iso) => Math.floor((Date.now() - new Date(iso + "T12:00:00Z")) / 86400000);
const br = (iso) => iso.split("-").reverse().join("/");

// Decide a situação do item a partir do que a IA leu (a IA não decide validade).
export function avaliar(item, leitura) {
  const L = leitura || {};
  if (L.legivel === false) return { status: "ILEGIVEL", motivo: "A foto não está legível. Tire outra com boa luz, sem reflexo e com o documento inteiro." };
  if (L.corresponde === false) return { status: "OUTRO", motivo: `Parece ser ${L.documento ? `"${L.documento}"` : "outro documento"}, não ${item.nome.toLowerCase()}.` };
  // Rasura ou emenda faz o documento ser recusado no balcão.
  if (L.rasura === true) return { status: "PENDENTE", motivo: "Parece ter rasura, emenda ou corretivo. Documento rasurado costuma ser recusado: providencie outro." };
  const r = item.regra || {};
  if (r.tipo === "emissao") {
    if (!DATA.test(L.dataEmissao || "")) return { status: "CONFERIR", motivo: `Não consegui ler a data. Confira: precisa ter no máximo ${r.dias} dias.` };
    const d = dias(L.dataEmissao);
    if (d > r.dias) return { status: "VENCIDO", motivo: `É de ${br(L.dataEmissao)} (${d} dias). O limite é ${r.dias} dias: providencie um mais recente.` };
    if (d < -1) return { status: "CONFERIR", motivo: `A data lida (${br(L.dataEmissao)}) está no futuro. Confira o documento.` };
    return { status: "OK", motivo: `De ${br(L.dataEmissao)}: dentro do prazo de ${r.dias} dias (vale até ${br(new Date(new Date(L.dataEmissao + "T12:00:00Z").getTime() + r.dias * 86400000).toISOString().slice(0, 10))}).` };
  }
  if (r.tipo === "validade" && DATA.test(L.dataValidade || "")) {
    if (L.dataValidade < hojeISO()) return { status: "VENCIDO", motivo: `Venceu em ${br(L.dataValidade)}.` };
    return { status: "OK", motivo: `Válido até ${br(L.dataValidade)}.` };
  }
  if (r.tipo === "assinatura" && L.assinaturas === "faltando") return { status: "PENDENTE", motivo: L.observacao || "Faltam assinaturas ou o reconhecimento de firma." };
  return { status: "OK", motivo: L.observacao || "Documento identificado." };
}

function promptLeitura(t, servico, item) {
  return `Você confere a FOTO de um documento para o ${t.sigla}. Serviço: "${servico.titulo}". O cidadão diz que a foto é: "${item.nome}" (${item.desc}).
Responda SOMENTE com JSON, sem texto fora dele:
{"documento": "que documento a foto mostra, em poucas palavras",
 "corresponde": true|false (a foto é mesmo ${item.nome}? aceite equivalentes citados na descrição),
 "legivel": true|false,
 "dataEmissao": "AAAA-MM-DD" ou null (data de emissão/vencimento da conta no caso de comprovante; data da COLETA no toxicológico; data do documento nos demais),
 "dataValidade": "AAAA-MM-DD" ou null (só se o documento tiver data de validade impressa, como CNH),
 "assinaturas": "ok" | "faltando" | "nao_aplica",
 "rasura": true|false (há rasura, emenda, corretivo ou campo adulterado visível?),
 "titular": "PRIMEIRO e ÚLTIMO nome da pessoa a quem o documento pertence (titular da conta, do comprovante, da CNH etc.), em maiúsculas" ou null,
 "observacao": "uma frase curta e útil para o cidadão (ex.: rasura, campo em branco, falta firma reconhecida)"}
Regras: NÃO invente o que não estiver visível; se não der para ler uma data, use null. NÃO repita números de documentos (CPF, RG, RENAVAM) na observação.`;
}

export function registrarConferencia(app, { limitar } = {}) {
  const C = "/api/t/:slug/conferencia";
  app.get(C, comTenant, (req, res) => res.json({ servicos: servicosDoTenant(req.tenant), ia: llmConfigurado() }));

  app.post(`${C}/analisar`, comTenant, async (req, res) => {
    if (!llmConfigurado()) return res.status(503).json({ error: "A conferência por foto não está disponível agora. Marque os itens manualmente." });
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
    if (limitar && limitar(`conf:${req.tenant.slug}:${ip}`, 15)) return res.status(429).json({ error: "Muitas fotos em sequência. Aguarde um minuto." });
    const servico = servicosDoTenant(req.tenant).find((s) => s.id === req.body?.servico);
    const item = servico?.itens.find((i) => i.id === req.body?.item);
    if (!item) return res.status(400).json({ error: "Serviço ou documento inválido." });
    const m = String(req.body?.imagem || "").match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: "Envie uma foto (JPG, PNG ou WEBP)." });
    if (m[2].length > 7_000_000) return res.status(400).json({ error: "A foto ficou grande demais. Tente de novo." });
    try {
      const txt = await chamarLLM({
        system: promptLeitura(req.tenant, servico, item), maxTokens: 400,
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }, { type: "text", text: `Hoje é ${hojeISO()}. Leia o documento.` }] }],
      });
      let leitura = {};
      try { leitura = JSON.parse((txt.match(/\{[\s\S]*\}/) || ["{}"])[0]); } catch { leitura = {}; }
      const r = avaliar(item, leitura);
      registrarEvento({ tenantId: req.tenant.id, tipo: "PERGUNTA", canal: "WEB", tema: "conferencia", resolvido: r.status === "OK" });
      // Titular (só primeiro e último nome) volta para o navegador cruzar os documentos
      // entre si; não é gravado no servidor.
      const titular = String(leitura.titular || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim().split(" ");
      res.json({ ...r, documento: String(leitura.documento || "").slice(0, 80), titular: titular[0] ? (titular.length > 1 ? `${titular[0]} ${titular[titular.length - 1]}` : titular[0]).slice(0, 60) : null });
    } catch (err) {
      console.error("[conferencia]", err.message);
      res.status(502).json({ error: "Não consegui ler a foto agora. Tente de novo ou marque o item manualmente." });
    }
  });
}
