// "Despachante Parente": jornadas guiadas que levam o serviço do começo ao fim.
// O assistente não só explica — conduz etapa por etapa, guarda onde a pessoa
// parou, calcula prazos, cria lembretes e volta a chamar quando trava.
//
// Motor independente de canal: o mesmo estado serve o site e o WhatsApp.
// Estado no KV (sem tabela nova): jor:<slug>:<dono>  (dono = "web:<sessão>" ou "wa:<telefone>").
// Funil: um Evento JORNADA por etapa alcançada (tema "<jornada>:<etapa>").
import { kvGetStr, kvSetEx, kvDel } from "../store.js";
import { configDe } from "./gestao-config.js";

const DIA = 86400000;
const TTL = 150 * 86400;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const br = (s) => String(s).slice(0, 10).split("-").reverse().join("/");
const somaDias = (s, n) => iso(new Date(new Date(String(s).slice(0, 10) + "T12:00:00Z").getTime() + n * DIA));
const hojeISO = () => iso(Date.now());

// Prorrogação da Resolução CONTRAN 1.033/2026.
const PROROG = { de: "2026-06-05", ate: "2026-12-08" };

// Vencimento do licenciamento pelo calendário do DETRAN (Configurações da Central):
// final da placa -> "dd/mm". Sem calendário cadastrado, devolve null.
function vencimentoLicenciamento(t, final) {
  const v = (configDe(t || {}).calendarioLicenciamento || {})[String(final)];
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const hoje = hojeISO();
  const ano = +hoje.slice(0, 4);
  const p = (a) => `${a}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return p(ano) >= hoje ? p(ano) : p(ano + 1);
}
const FINAIS = Array.from({ length: 10 }, (_, i) => ({ id: String(i), rotulo: `Final ${i}` }));

export const JORNADAS = {
  venda: {
    id: "venda", icone: "🚗", titulo: "Vendi meu veículo",
    palavras: ["venda", "vendi", "vender", "carro", "veiculo"], servicos: () => ["comunicacao-venda"],
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

  // 22/11/2026: novas jornadas, a partir da base de conhecimento do DETRAN-PA
  // (serviços detalhados, IN 01/2018 e instruções do assistente).
  compra: {
    id: "compra", icone: "🚙", titulo: "Comprei um veículo",
    palavras: ["compra", "comprei", "transferencia", "transferir"], servicos: () => ["transferencia"],
    levarExtra: () => ["Comprovante de pagamento do DAE"],
    resumo: "Débitos, documento (ATPV-e ou CRV), vistoria, conferência e DAE — com o prazo de 30 dias da transferência contado.",
    gatilho: /\b(comprei|comprando|comprar|compra d[oe])\b[^.?!]{0,40}\b(carro|moto|ve[ií]culo|caminhonete|caminh[aã]o|autom[oó]vel|usado)\b|\btransfer[eê]ncia(?! de jurisdi)\b[^.?!]{0,30}\b(propriedade|carro|moto|ve[ií]culo)\b|\btransferir\b[^.?!]{0,30}\b(carro|moto|ve[ií]culo)\b|\b(passar|colocar)\b[^.?!]{0,25}\b(para|pro|no) (o )?meu nome\b/i,
    etapas: [
      { id: "debitos", titulo: "Conferir débitos e financiamento", tipo: "info", link: "portal",
        texto: (t) => `Antes de pagar qualquer coisa, consulte o veículo no portal oficial (${t.portalUrl}): IPVA, multas e licenciamento precisam estar quitados, e o financiamento (gravame) precisa estar baixado — senão a transferência não sai. Combine com o vendedor quem quita o que.` },
      { id: "documento", titulo: "Tipo de documento", tipo: "escolha", salvarEm: "documento",
        texto: () => "O veículo é transferido pela ATPV-e (digital, veículos registrados a partir de 04/01/2021) ou pelo CRV de papel (registrados até 03/01/2021)?",
        opcoes: [{ id: "digital", rotulo: "Digital (ATPV-e)" }, { id: "papel", rotulo: "CRV de papel" }] },
      { id: "assinatura", titulo: "Assinar a ATPV-e", tipo: "info", so: (d) => d.documento === "digital",
        texto: () => "O vendedor registra a intenção de venda com os seus dados e os dois assinam a ATPV-e no app Carteira Digital de Trânsito (CDT), com conta gov.br prata ou ouro. Assim não precisa de cartório." },
      { id: "crv", titulo: "CRV preenchido e firma reconhecida", tipo: "info", so: (d) => d.documento === "papel",
        texto: () => "Confira o CRV: todos os campos preenchidos, assinado e datado, sem rasura. Vendedor e comprador reconhecem firma em cartório por autenticidade. CRV rasurado ou rasgado não é aceito (aí o vendedor precisa tirar a 2ª via)." },
      { id: "dataCompra", titulo: "Data da compra", tipo: "data", salvarEm: "dataCompra", passado: true, lembrete: "TRANSFERENCIA",
        texto: () => "Qual é a data da compra (a data da assinatura da ATPV-e ou do CRV)? Você tem 30 dias a partir dela para transferir: depois disso é multa (art. 233 do CTB)." },
      { id: "vistoria", titulo: "Vistoria", tipo: "data", salvarEm: "vistoria", opcional: true,
        texto: () => "Faça a vistoria do veículo numa empresa credenciada (ECV) ou no DETRAN. O laudo vale 30 dias. Me diga a data da vistoria (marcada ou já feita) que eu conto a validade." },
      { id: "documentos", titulo: "Conferir documentos", tipo: "conferir", servico: "transferencia",
        texto: () => "Separe os documentos: identidade com foto, CPF, comprovante de residência recente, o laudo da vistoria e a ATPV-e ou o CRV. Mande as fotos que eu confiro antes de você ir." },
      { id: "guia", titulo: "Pagar o DAE", tipo: "info", link: "portal",
        texto: (t) => `Faça o atendimento no ${t.sigla} (ou CIRETRAN) e pague o DAE da transferência. Pague só guia emitida no portal oficial (${t.portalUrl}); se quiser, me mande o código de barras que eu confiro. Depois do pagamento, a conclusão leva cerca de 2 dias úteis.` },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, o veículo é seu no papel também! O CRLV-e novo aparece no app Carteira Digital de Trânsito. Aproveite para conferir se o endereço cadastrado está certo: é para ele que vão as notificações." },
    ],
    prazos: (d) => {
      const out = [];
      if (d.dataCompra) out.push({ rotulo: "Prazo da transferência (depois disso é multa)", data: somaDias(d.dataCompra, 30) });
      if (d.vistoria) out.push({ rotulo: "Validade do laudo de vistoria", data: somaDias(d.vistoria, 30) });
      return out;
    },
  },

  licenciamento: {
    id: "licenciamento", icone: "📄", titulo: "Licenciar meu veículo (CRLV-e)",
    palavras: ["licenciamento", "licenciar", "crlv", "documento"],
    levarExtra: () => ["Placa e RENAVAM (estão no CRLV ou no boleto do IPVA)", "IPVA do ano pago", "Nada mais: o licenciamento é todo online"],
    resumo: "Vencimento pelo final da placa, IPVA, multas, guia (DAE) e o CRLV-e no celular — com lembrete do vencimento.",
    gatilho: /\b(licenciar|licenciamento|crlv(-?e)?)\b/i,
    etapas: [
      { id: "final", titulo: "Final da placa", tipo: "escolha", salvarEm: "final", opcoes: FINAIS,
        depois: (t, d) => { const v = vencimentoLicenciamento(t, d.final); if (v) { d.vencLic = v; delete d.semCalendario; } else { delete d.vencLic; d.semCalendario = true; } },
        lembrete: (d) => (d.vencLic ? { lembrete: "LICENCIAMENTO", final: d.final, data: d.vencLic } : null),
        texto: () => "Qual é o último número da placa? O vencimento do licenciamento segue o calendário do DETRAN por final de placa." },
      { id: "vencimento", titulo: "Data de vencimento", tipo: "data", salvarEm: "vencLic", futuro: true, opcional: true, so: (d) => d.semCalendario, lembrete: "LICENCIAMENTO",
        texto: (t) => `Veja no calendário de licenciamento do portal oficial (${t.portalUrl}) a data do seu final de placa e me diga, que eu conto o prazo e te lembro.` },
      { id: "debitos", titulo: "IPVA e multas", tipo: "info", link: "portal",
        texto: () => "O IPVA do ano (pago à SEFA) e as multas vencidas precisam estar quitados, senão o licenciamento não sai. Multa de outro órgão (PRF, prefeitura) também trava: consulte e pague no órgão que multou." },
      { id: "guia", titulo: "Emitir e pagar o DAE", tipo: "info", link: "portal",
        texto: (t) => `Emita o DAE do licenciamento (a taxa anual) no portal oficial (${t.portalUrl}) — nunca por link recebido em mensagem — e pague no banco. Me mande o código de barras se quiser que eu confira antes.` },
      { id: "crlv", titulo: "Baixar o CRLV-e", tipo: "info",
        texto: () => "Depois do pagamento, o CRLV-e fica disponível no app Carteira Digital de Trânsito em até 3 dias úteis (cerca de 72 horas). Ele substitui o papel; se quiser, dá para imprimir em papel comum pelo portal. Não há vistoria anual para veículo particular no Pará." },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, veículo licenciado! Deixe o CRLV-e no celular. No ano que vem eu te lembro de novo, se você ativou o lembrete." },
    ],
    prazos: (d) => (d.vencLic ? [{ rotulo: `Vencimento do licenciamento${d.final != null ? ` (final ${d.final})` : ""}`, data: d.vencLic }] : []),
  },

  renovacao: {
    id: "renovacao", icone: "🪪", titulo: "Renovar minha CNH",
    palavras: ["cnh", "renovacao", "renovar", "carteira"], servicos: () => ["renovacao-cnh"],
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

  primeira: {
    id: "primeira", icone: "🎓", titulo: "Tirar a primeira CNH",
    palavras: ["habilitacao", "primeira", "autoescola", "1cnh"], servicos: () => ["primeira-habilitacao"],
    levarExtra: () => ["Documentos originais e cópias, legíveis e sem danos", "Comprovantes de pagamento dos boletos de cada fase"],
    resumo: "Da 1ª guia à CNH em casa: biometria, exames, curso teórico, provas e aulas — com as datas de cada exame lembradas.",
    gatilho: /\bprimeira (habilita[cç][aã]o|cnh|carteira)\b|\btirar (a |minha |uma )?(cnh|carteira de motorista|habilita[cç][aã]o|carteira)\b|\b(auto ?escola|cfc|ladv|cnh pai d.?[eé]gua)\b/i,
    etapas: [
      { id: "documentos", titulo: "Conferir documentos", tipo: "conferir", servico: "primeira-habilitacao",
        texto: (t) => `Para começar você precisa ter 18 anos, saber ler e escrever e morar no Pará. Separe identidade com foto, CPF e comprovante de residência de até 90 dias (originais e cópias). Mande as fotos que eu confiro. Quer a CNH gratuita? Veja se há edital aberto do programa CNH Pai D'Égua no portal oficial (${t.portalUrl}).` },
      { id: "guia1", titulo: "Guia da 1ª fase", tipo: "info", link: "portal",
        texto: (t) => `Emita e pague o boleto da 1ª fase (exames) no portal oficial (${t.portalUrl}), na sede ou numa CIRETRAN. Pague só guia emitida no canal oficial; se quiser, me mande o código de barras que eu confiro.` },
      { id: "biometria", titulo: "Coleta da biometria", tipo: "info",
        texto: () => "Com o boleto pago, agende a coleta da biometria e da foto: em Belém pelo site; no interior, na CIRETRAN, levando os documentos originais e as cópias." },
      { id: "exames", titulo: "Exames médico e psicológico", tipo: "data", salvarEm: "exames", futuro: true, opcional: true,
        texto: (t) => `Agende os exames médico e psicológico numa clínica credenciada${t.telefone ? ` pelo telefone ${t.telefone}` : ""}. Me diga a data marcada que eu te lembro.` },
      { id: "toxicologico", titulo: "Exame toxicológico", tipo: "info",
        texto: () => "Desde 1º/06/2026 a 1ª habilitação nas categorias A e B também exige o exame toxicológico (Lei 15.153/2025). Pode ser feito em qualquer fase, desde que antes da emissão da PPD. Confirme no portal se já vale para o seu caso." },
      { id: "curso", titulo: "Curso teórico", tipo: "info",
        texto: () => "Aprovado nos exames, faça o curso teórico de legislação (cerca de 45 horas-aula) num CFC credenciado ou pelo app CNH do Brasil." },
      { id: "provaTeorica", titulo: "Prova teórica", tipo: "data", salvarEm: "provaTeorica", futuro: true, opcional: true,
        texto: () => "Pague o boleto da 2ª fase, faça a validação dos documentos e marque a prova teórica: são 30 questões e é preciso acertar 21. Chegue 30 minutos antes. Me diga a data que eu te lembro." },
      { id: "aulas", titulo: "Aulas práticas", tipo: "info",
        texto: () => "Aprovado na teórica, você recebe a LADV (licença de aprendizagem) e faz as aulas práticas com instrutor de CFC ou instrutor autônomo credenciado, cumprindo a carga horária da categoria." },
      { id: "provaPratica", titulo: "Prova prática", tipo: "data", salvarEm: "provaPratica", futuro: true, opcional: true,
        texto: () => "Marque a prova prática de direção (pelo CFC, pelo site ou na CIRETRAN). Me diga a data que eu te lembro." },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, aprovado! Você recebe a PPD (permissão para dirigir), que vale 1 ano. Sem infração grave ou gravíssima nem reincidência em média nesse período, ela vira a CNH definitiva. A versão digital aparece no app Carteira Digital de Trânsito." },
    ],
    prazos: (d) => [
      d.exames && { rotulo: "Exames médico e psicológico", data: d.exames },
      d.provaTeorica && { rotulo: "Prova teórica (chegue 30 min antes)", data: d.provaTeorica },
      d.provaPratica && { rotulo: "Prova prática", data: d.provaPratica },
    ].filter(Boolean),
  },

  segundavia: {
    id: "segundavia", icone: "📇", titulo: "2ª via da CNH",
    palavras: ["2via", "segundavia", "via", "perdi", "roubo"], servicos: () => ["segunda-via-cnh"],
    resumo: "Perdeu, foi roubada ou estragou: boletim de ocorrência quando precisa, documentos, guia e a CNH nova.",
    gatilho: /\b(2[ªºa]?|segunda) via\b[^.?!]{0,25}\b(cnh|carteira|habilita[cç][aã]o)\b|\b(perdi|roubaram|furtaram|extraviei|extraviou|molhou|rasgou|estragou|quebrou)\b[^.?!]{0,30}\b(cnh|carteira de motorista|habilita[cç][aã]o)\b|\b(cnh|carteira de motorista)\b[^.?!]{0,30}\b(perdid[ao]|roubad[ao]|furtad[ao]|extraviad[ao]|rasgad[ao]|danificad[ao])\b/i,
    etapas: [
      { id: "motivo", titulo: "O que aconteceu", tipo: "escolha", salvarEm: "motivo",
        texto: () => "O que aconteceu com a sua CNH?",
        opcoes: [{ id: "roubo", rotulo: "Roubada ou furtada" }, { id: "perda", rotulo: "Perdi" }, { id: "dano", rotulo: "Estragou (rasgou, molhou)" }] },
      { id: "bo", titulo: "Boletim de ocorrência", tipo: "info", so: (d) => d.motivo === "roubo" || d.motivo === "perda",
        texto: (t, d) => `${d.motivo === "roubo" ? "Registre o boletim de ocorrência" : "Se puder, registre o boletim de ocorrência da perda"} (pode ser pela delegacia virtual). Ele entra na lista de documentos, mas não substitui a CNH para dirigir.` },
      { id: "validade", titulo: "A CNH está na validade?", tipo: "escolha", salvarEm: "validade",
        texto: () => "A CNH que você perdeu ou estragou ainda estava dentro da validade?",
        opcoes: [{ id: "valida", rotulo: "Sim, estava válida" }, { id: "vencida", rotulo: "Não, estava vencida" }] },
      { id: "renovar", titulo: "Faça a renovação", tipo: "info", so: (d) => d.validade === "vencida",
        texto: () => "Com a CNH vencida, o caminho é a renovação (com exame médico), e não a 2ª via: a carteira nova já sai renovada. Você pode parar esta jornada e começar \"Renovar minha CNH\"." },
      { id: "documentos", titulo: "Conferir documentos", tipo: "conferir", servico: "segunda-via-cnh",
        texto: () => "Separe identidade com foto, CPF, comprovante de residência recente e o boletim de ocorrência, se tiver. Mande as fotos que eu confiro." },
      { id: "guia", titulo: "Emitir e pagar a guia", tipo: "info", link: "portal",
        texto: (t) => `Abra o serviço de 2ª via no portal oficial (${t.portalUrl}), emita a guia e pague. Se quiser, me mande o código de barras que eu confiro antes.` },
      { id: "validacao", titulo: "Validação", tipo: "info",
        texto: (t) => `Faça a validação dos documentos no ${t.sigla} quando for pedido. Em regra, a 2ª via não exige exame novo, porque os dados não mudam.` },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, pronto! A CNH nova chega pelos Correios no endereço cadastrado, e a digital fica no app Carteira Digital de Trânsito." },
    ],
  },

  endereco: {
    id: "endereco", icone: "🏠", titulo: "Mudei de endereço ou de estado",
    palavras: ["endereco", "mudanca", "mudei", "jurisdicao", "estado"],
    servicos: (d) => (d.destino === "chegou" ? ["jurisdicao"] : d.destino === "para" ? ["endereco-veiculo"] : []),
    resumo: "Endereço do veículo e da CNH, ou veículo vindo de outro estado (transferência de jurisdição) — com o prazo de 30 dias.",
    gatilho: /\b(mudei|mudan[cç]a|mudar|atualizar|alterar|trocar)\b[^.?!]{0,25}\b(endere[cç]o|cidade|munic[ií]pio)\b|\btransfer[eê]ncia de jurisdi[cç][aã]o\b|\b(carro|moto|ve[ií]culo)\b[^.?!]{0,20}\bde outro estado\b|\bmudei (de|para o?) (estado|par[aá])\b/i,
    etapas: [
      { id: "destino", titulo: "Qual é a mudança", tipo: "escolha", salvarEm: "destino",
        texto: () => "O que mudou?",
        opcoes: [{ id: "para", rotulo: "Mudei de endereço no Pará" }, { id: "chegou", rotulo: "Vim de outro estado com o veículo" }, { id: "saiu", rotulo: "Vou morar em outro estado" }] },
      { id: "dataMudanca", titulo: "Data da mudança", tipo: "data", salvarEm: "dataMudanca", passado: true, opcional: true,
        texto: () => "Quando foi a mudança? Mudando de município, a lei dá 30 dias para atualizar o registro do veículo (art. 123 do CTB). Se não souber, pode pular." },
      { id: "outroEstado", titulo: "Procure o DETRAN do novo estado", tipo: "info", so: (d) => d.destino === "saiu",
        texto: () => "A transferência de jurisdição é feita no DETRAN do estado para onde você vai, com vistoria. Antes de ir, deixe o veículo sem débitos aqui no Pará (IPVA, multas e licenciamento), senão a transferência trava." },
      { id: "consulta", titulo: "Consultar impedimentos", tipo: "info", link: "portal", so: (d) => d.destino === "chegou",
        texto: (t) => `Faça a consulta para transferência de jurisdição no portal oficial (${t.portalUrl}), com placa e RENAVAM: ela mostra se há algum impedimento antes de você ir.` },
      { id: "vistoria", titulo: "Vistoria", tipo: "info", so: (d) => d.destino === "chegou",
        texto: () => "Faça a vistoria do veículo numa empresa credenciada (ECV) ou no DETRAN. O laudo vale 30 dias." },
      { id: "documentos", titulo: "Conferir documentos", tipo: "conferir", so: (d) => d.destino !== "saiu",
        servicoDe: (d) => (d.destino === "chegou" ? "jurisdicao" : "endereco-veiculo"),
        texto: (t, d) => (d.destino === "chegou"
          ? "Separe o CRV original do outro estado, o laudo de vistoria, identidade, CPF e comprovante de residência no Pará. Mande as fotos que eu confiro."
          : "Separe o comprovante de residência atualizado em seu nome e a identidade. Mande as fotos que eu confiro.") },
      { id: "atendimento", titulo: "Atendimento e pagamento", tipo: "info", link: "portal", so: (d) => d.destino !== "saiu",
        texto: (t, d) => `Abra o serviço de ${d.destino === "chegou" ? "transferência de jurisdição" : "atualização de endereço do veículo"} no portal oficial (${t.portalUrl}) ou no atendimento, e pague a guia. Pague só guia emitida no canal oficial.` },
      { id: "cnh", titulo: "Endereço da CNH também", tipo: "info",
        texto: () => "Atualize também o endereço da sua CNH (serviço de alteração de dados): a carteira e as notificações são enviadas para o endereço cadastrado. CNH de outro estado? Para renovar ou mudar de categoria aqui, antes é preciso trazer o prontuário (transferência de jurisdição da CNH)." },
      { id: "fim", titulo: "Concluído", tipo: "fim",
        texto: () => "Égua, tudo atualizado! Agora as notificações chegam no endereço certo, e você não perde prazo de defesa por carta extraviada." },
    ],
    prazos: (d) => (d.dataMudanca && d.destino !== "saiu" ? [{ rotulo: "Prazo para atualizar o registro do veículo", data: somaDias(d.dataMudanca, 30) }] : []),
  },

  defesa: {
    id: "defesa", icone: "⚖️", titulo: "Contestar uma multa",
    palavras: ["multa", "defesa", "recurso"],
    levarExtra: () => ["A notificação (frente e verso)", "Documento oficial com foto do proprietário ou do condutor", "As provas que você juntou (fotos, comprovantes)", "A defesa assinada (o rascunho que eu gero, revisado por você)"],
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

// "ACOMPANHAR <palavra>" no WhatsApp -> id da jornada (ou null).
const semAcento = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").trim();
export function jornadaPorPalavra(p) {
  const s = semAcento(p).replace(/\s+/g, "");
  if (!s) return null;
  for (const j of Object.values(JORNADAS)) if (j.id === s || (j.palavras || []).includes(s)) return j.id;
  if (/^(2|segunda)via/.test(s)) return "segundavia";
  return null;
}
export const palavraDe = (j) => (j.palavras?.[0] || j.id).toUpperCase();

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
    etapa: { id: e.id, titulo: e.titulo, tipo: e.tipo, texto: e.texto(t, est.dados), opcoes: e.opcoes || null, formId: e.formId || null, servico: e.servico || (e.servicoDe ? e.servicoDe(est.dados) : null),
      link: e.link === "portal" ? t.portalUrl : null, lembrete: typeof e.lembrete === "string" ? e.lembrete : null, opcional: Boolean(e.opcional), valor: e.salvarEm ? est.dados[e.salvarEm] || null : null },
    progresso: { atual: idx + 1, total: etapas.length, etapas: etapas.map((x, i) => ({ id: x.id, titulo: x.titulo, feito: i < idx, atual: i === idx })) },
    prazos: (j.prazos ? j.prazos(est.dados, t) : []).map((p) => ({ ...p, dataBR: br(p.data), faltam: Math.round((new Date(p.data + "T12:00:00Z") - new Date(hojeISO() + "T12:00:00Z")) / DIA) })),
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
    e.depois?.(t, est.dados);
    const a = typeof e.lembrete === "function" ? e.lembrete(est.dados) : null;
    if (a) avisos.push(a);
  } else if (acao === "data") {
    if (e.tipo !== "data") return { est, erro: "Esta etapa não pede data." };
    const d = lerDataLivre(valor);
    if (!d) return { est, erro: "Não entendi a data. Use dd/mm/aaaa." };
    if (e.passado && d > hojeISO()) return { est, erro: "Essa data está no futuro." };
    if (e.futuro && d < hojeISO()) return { est, erro: "Essa data já passou." };
    est.dados[e.salvarEm] = d; est.idx++;
    if (typeof e.lembrete === "string") avisos.push({ lembrete: e.lembrete, data: d });
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
    if (e.tipo === "conferir" && c.levar?.itens?.length) s += `\n📋 Responda *LEVAR* para receber a lista do que levar.`;
    s += `\n\nQuando terminar, responda *OK*.`;
  }
  return s + `\n_VOLTAR: etapa anterior${c.levar?.itens?.length ? " · LEVAR: o que levar" : ""} · SAIR: parar o acompanhamento_`;
}

// "O que levar": lista pronta (WhatsApp, impressão).
export function textoLevar(c) {
  if (!c?.levar?.itens?.length) return "Esta jornada não tem documentos para levar: é tudo pelo portal oficial.";
  return `📋 *O que levar — ${c.jornada.titulo}*\n\n${c.levar.itens.map((i) => `☐ ${i.nome}${i.condicional ? ` _(${i.condicional.replace(/\.$/, "")})_` : ""}`).join("\n")}`
    + (c.prazos.length ? `\n\n📅 ${c.prazos.map((x) => `${x.rotulo}: *${x.dataBR}*`).join("\n📅 ")}` : "")
    + "\n\n_Leve os originais. Na dúvida, mande a foto aqui que eu confiro._";
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
// 22/11/2026: a partir do 2º aviso na MESMA etapa, oferece ajuda (dúvida aqui ou o
// telefone oficial); depois de 4 avisos na mesma etapa, só volta a chamar se o prazo apertar.
export const MAX_CUTUCADAS = 4;
export function textoCutucada(t, c, n, prazoPerto) {
  const base = `🧭 Oi! Passando para lembrar do *${c.jornada.titulo}*: você está na etapa *${c.etapa.titulo}* (${c.progresso.atual} de ${c.progresso.total}).${prazoPerto ? `\n⏰ ${prazoPerto.rotulo}: *${prazoPerto.dataBR}* (faltam ${prazoPerto.faltam} dias).` : ""}`;
  const ajuda = n >= 1 ? `\n\nTravou nessa etapa? Me escreva aqui a sua dúvida, do seu jeito, que eu te ajudo${t.telefone ? `. Se preferir falar com uma pessoa, ligue ${t.telefone}` : ""}.` : "";
  return `${base}${ajuda}\n\nResponda *OK* quando concluir esta etapa, *JORNADA* para ver os detalhes ou *SAIR* para parar.`;
}
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
    // Contagem por etapa: muda de etapa, zera.
    const n = est.cutucadas?.etapa === c.etapa.id ? est.cutucadas.n : 0;
    if (n >= MAX_CUTUCADAS && !prazoPerto) continue;
    try {
      await enviar(dono.slice(3), textoCutucada(t, c, n, prazoPerto));
      est.cutucadas = { etapa: c.etapa.id, n: n + 1 };
      est.lembradaEm = new Date().toISOString();
      await kvSetEx(chave(t.slug, dono), JSON.stringify(est), TTL);
      enviados++;
    } catch (e) { console.warn(`[jornadas:${t.slug}]`, e.message); }
  }
  return { enviados };
}
