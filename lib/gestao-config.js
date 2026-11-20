// Configuração da Central de Gestão de cada DETRAN (Tenant.configGestao),
// com valores padrão para quem ainda não configurou nada.

export const PRIORIDADES = ["BAIXA", "NORMAL", "ALTA", "URGENTE"];
export const STATUS_CHAMADO = ["ABERTO", "EM_ANDAMENTO", "AGUARDANDO_CIDADAO", "RESOLVIDO", "CANCELADO"];
export const STATUS_TEXTO = {
  ABERTO: "Aberto", EM_ANDAMENTO: "Em andamento", AGUARDANDO_CIDADAO: "Aguardando você",
  RESOLVIDO: "Resolvido", CANCELADO: "Cancelado",
};

export const PADRAO = {
  fuso: "America/Sao_Paulo",
  pesquisaSatisfacao: true,
  mensagemPesquisa: "Antes de ir: de 1 a 5, que nota você dá para este atendimento? Responda só com o número. 😊",
  agradecimentoPesquisa: "Obrigado pela sua nota! Ela ajuda o DETRAN a melhorar o atendimento.",
  avisarChamado: true,
  categorias: ["Habilitação (CNH)", "Veículos", "Multas e recursos", "Licenciamento e IPVA", "Vistoria", "Agendamento", "Reclamação", "Outros"],
  // Prazo (em horas) para resolver um chamado, por prioridade.
  slaHoras: { BAIXA: 120, NORMAL: 72, ALTA: 24, URGENTE: 4 },
  // Minutos de espera na fila para ficar amarelo / vermelho.
  esperaAlertaMin: 5,
  esperaCriticaMin: 15,
  // LGPD: por quanto tempo guardar (a limpeza roda sozinha todo dia).
  retencaoConversasDias: 180, // conversas e mensagens sem atividade; fichas e registros do balcão
  retencaoChamadosDias: 365, // depois de resolvido/cancelado, o chamado perde os dados pessoais
  encarregado: "", // contato do encarregado de dados (DPO) do DETRAN: e-mail ou link
  politicaUrl: "", // política de privacidade oficial do DETRAN, se houver
  avisoWhatsApp: true, // avisa no 1º contato pelo WhatsApp que a conversa fica registrada
  horario: {
    ativo: false,
    dias: [1, 2, 3, 4, 5], // 0 = domingo
    inicio: "08:00",
    fim: "17:00",
    mensagemFora: "Nosso atendimento com pessoas funciona de segunda a sexta, das 8h às 17h. Sua mensagem ficou registrada e um atendente responde assim que o expediente começar.",
  },
};

const FUSOS = new Set(["America/Sao_Paulo", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Maceio",
  "America/Araguaina", "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha"]);
const FUSO_UF = { PA: "America/Belem", AP: "America/Belem", AM: "America/Manaus", RR: "America/Boa_Vista", RO: "America/Porto_Velho", AC: "America/Rio_Branco",
  MT: "America/Cuiaba", MS: "America/Campo_Grande", CE: "America/Fortaleza", RN: "America/Fortaleza", PB: "America/Fortaleza", MA: "America/Fortaleza", PI: "America/Fortaleza",
  PE: "America/Recife", AL: "America/Maceio", SE: "America/Maceio", BA: "America/Bahia", TO: "America/Araguaina" };

export function configDe(tenant) {
  const c = (tenant && typeof tenant.configGestao === "object" && tenant.configGestao) || {};
  return {
    ...PADRAO, ...c,
    fuso: FUSOS.has(c.fuso) ? c.fuso : FUSO_UF[tenant?.uf] || PADRAO.fuso,
    slaHoras: { ...PADRAO.slaHoras, ...(c.slaHoras || {}) },
    horario: { ...PADRAO.horario, ...(c.horario || {}) },
    categorias: Array.isArray(c.categorias) && c.categorias.length ? c.categorias : PADRAO.categorias,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const txt = (v, max, padrao) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : padrao);
const num = (v, min, max, padrao) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : padrao);

// Valida o que vem da tela de configurações (gestor/admin).
export function limparConfig(b = {}, atual = PADRAO) {
  const sla = {};
  for (const p of PRIORIDADES) sla[p] = num(b.slaHoras?.[p], 1, 2000, atual.slaHoras?.[p] ?? PADRAO.slaHoras[p]);
  const h = b.horario || {};
  const dias = Array.isArray(h.dias) ? [...new Set(h.dias.map(Number).filter((d) => d >= 0 && d <= 6))] : atual.horario?.dias || PADRAO.horario.dias;
  const categorias = Array.isArray(b.categorias)
    ? [...new Set(b.categorias.map((x) => String(x || "").trim().slice(0, 60)).filter(Boolean))].slice(0, 30)
    : atual.categorias;
  return {
    fuso: FUSOS.has(b.fuso) ? b.fuso : atual.fuso,
    pesquisaSatisfacao: b.pesquisaSatisfacao !== undefined ? Boolean(b.pesquisaSatisfacao) : atual.pesquisaSatisfacao,
    mensagemPesquisa: txt(b.mensagemPesquisa, 500, atual.mensagemPesquisa),
    agradecimentoPesquisa: txt(b.agradecimentoPesquisa, 500, atual.agradecimentoPesquisa),
    avisarChamado: b.avisarChamado !== undefined ? Boolean(b.avisarChamado) : atual.avisarChamado,
    categorias: categorias && categorias.length ? categorias : PADRAO.categorias,
    slaHoras: sla,
    esperaAlertaMin: num(b.esperaAlertaMin, 1, 240, atual.esperaAlertaMin),
    esperaCriticaMin: num(b.esperaCriticaMin, 2, 480, atual.esperaCriticaMin),
    retencaoConversasDias: num(b.retencaoConversasDias, 30, 1825, atual.retencaoConversasDias ?? PADRAO.retencaoConversasDias),
    retencaoChamadosDias: num(b.retencaoChamadosDias, 90, 3650, atual.retencaoChamadosDias ?? PADRAO.retencaoChamadosDias),
    encarregado: b.encarregado !== undefined ? String(b.encarregado || "").trim().slice(0, 200) : atual.encarregado || "",
    politicaUrl: b.politicaUrl !== undefined ? (/^https:\/\/[^\s"<>]+$/i.test(String(b.politicaUrl || "").trim()) ? String(b.politicaUrl).trim().slice(0, 300) : "") : atual.politicaUrl || "",
    avisoWhatsApp: b.avisoWhatsApp !== undefined ? Boolean(b.avisoWhatsApp) : atual.avisoWhatsApp ?? true,
    ultimaLimpeza: atual.ultimaLimpeza || null,
    ultimosLembretes: atual.ultimosLembretes || null,
    // Calendário de licenciamento: final da placa (0-9) -> "dd/mm" do vencimento
    calendarioLicenciamento: b.calendarioLicenciamento !== undefined
      ? Object.fromEntries(Object.entries(b.calendarioLicenciamento || {}).filter(([k, v]) => /^\d$/.test(k) && /^(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])$/.test(String(v || "").trim())).map(([k, v]) => [k, String(v).trim()]))
      : atual.calendarioLicenciamento || {},
    horario: {
      ativo: h.ativo !== undefined ? Boolean(h.ativo) : atual.horario.ativo,
      dias,
      inicio: HHMM.test(h.inicio) ? h.inicio : atual.horario.inicio,
      fim: HHMM.test(h.fim) ? h.fim : atual.horario.fim,
      mensagemFora: txt(h.mensagemFora, 600, atual.horario.mensagemFora),
    },
  };
}

// Dia da semana (0-6) e hora/minuto no fuso do DETRAN.
export function agoraNoFuso(fuso, data = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(data).map((x) => [x.type, x.value]));
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dia, hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

export function dentroDoHorario(cfg, data = new Date()) {
  if (!cfg.horario?.ativo) return true;
  const { dia, hora, minuto } = agoraNoFuso(cfg.fuso, data);
  if (!cfg.horario.dias.includes(dia)) return false;
  const agora = hora * 60 + minuto;
  const [hi, mi] = cfg.horario.inicio.split(":").map(Number);
  const [hf, mf] = cfg.horario.fim.split(":").map(Number);
  return agora >= hi * 60 + mi && agora < hf * 60 + mf;
}

export const RESPOSTAS_PADRAO = [
  { atalho: "ola", titulo: "Saudação", texto: "Olá! Aqui é do DETRAN, tudo bem? Vou te ajudar com isso agora. 😊" },
  { atalho: "docs-cnh", titulo: "Documentos para renovar a CNH", texto: "Para renovar a CNH você vai precisar de: documento oficial com foto, CPF, comprovante de residência atualizado e a CNH atual. O exame médico é feito na clínica credenciada." },
  { atalho: "aguarde", titulo: "Pedir um instante", texto: "Só um instante, por favor, estou verificando no sistema. ⏳" },
  { atalho: "protocolo", titulo: "Como acompanhar o protocolo", texto: "Para acompanhar, é só mandar aqui a palavra *protocolo* seguida do número (ex.: protocolo XX-2026-000001)." },
  { atalho: "fim", titulo: "Encerramento", texto: "Posso ajudar em mais alguma coisa? Se não, vou encerrar por aqui. Obrigado pelo contato!" },
];
export const ETIQUETAS_PADRAO = [
  { nome: "Prioridade legal", cor: "#7C3AED" },
  { nome: "Reclamação", cor: "#DC2626" },
  { nome: "Despachante", cor: "#0EA5E9" },
  { nome: "Retorno", cor: "#F59E0B" },
];
