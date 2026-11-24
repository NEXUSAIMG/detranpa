// Lista padrão dos serviços por assunto (site e WhatsApp). Só dados, sem imports.
export const ASSUNTOS_PADRAO = [
  { id: "veiculos", icone: "🚗", titulo: "Veículos", itens: [
    { t: "Comprei um veículo", d: "Transferência para o seu nome", j: "compra" },
    { t: "Vendi meu veículo", d: "Comunicação de venda", j: "venda" },
    { t: "Primeiro emplacamento", d: "Veículo zero quilômetro", q: "Como faço o primeiro emplacamento de um veículo zero quilômetro?" },
    { t: "Baixa de gravame", d: "Financiamento quitado", q: "Quitei o financiamento. Como faço a baixa do gravame do veículo?" },
    { t: "Inclusão de gravame", d: "Veículo financiado ou alienado", q: "Como funciona a inclusão de gravame (alienação fiduciária) no documento do veículo?" },
    { t: "Veículo de outro estado", d: "Transferência de jurisdição", q: "Trouxe um veículo de outro estado. Como faço a transferência para cá?" },
    { t: "2ª via do documento", d: "CRV ou CRLV perdido", q: "Perdi o documento do veículo. Como tiro a segunda via?" },
    { t: "Mudar cor ou característica", d: "Alteração no veículo", q: "Como faço para mudar a cor ou outra característica do meu veículo?" },
    { t: "Vistoria", d: "Quando e onde fazer", q: "Quando preciso fazer vistoria do veículo e onde faço?" },
    { t: "Baixa definitiva", d: "Veículo sem condição de uso", q: "Como dou baixa definitiva em um veículo que não vai mais rodar?" },
  ] },
  { id: "habilitacao", icone: "🪪", titulo: "Habilitação", itens: [
    { t: "Primeira habilitação", d: "Do processo à CNH", j: "primeira" },
    { t: "Renovar a CNH", d: "Exames e documentos", j: "renovacao" },
    { t: "2ª via da CNH", d: "Perda, roubo ou dano", j: "segundavia" },
    { t: "Mudar ou adicionar categoria", d: "Moto, caminhão, ônibus", q: "Como faço para adicionar ou mudar a categoria da minha CNH?" },
    { t: "Mudei de endereço", d: "Atualizar CNH e veículo", j: "endereco" },
    { t: "CNH Social", d: "Habilitação gratuita", q: "Como funciona a CNH Social e quem pode participar?" },
    { t: "Permissão Internacional (PID)", d: "Dirigir no exterior", q: "Como tiro a Permissão Internacional para Dirigir (PID)?" },
    { t: "CNH suspensa ou cassada", d: "Como voltar a dirigir", q: "Minha CNH foi suspensa. O que preciso fazer para voltar a dirigir?" },
  ] },
  { id: "multas", icone: "🧾", titulo: "Multas", itens: [
    { t: "Contestar uma multa", d: "Defesa prévia e recursos", j: "defesa" },
    { t: "Indicar o condutor", d: "Quem estava dirigindo", q: "Como faço a indicação do condutor de uma multa?" },
    { t: "Consultar pontos", d: "Pontuação da CNH", q: "Como consulto os pontos da minha CNH?" },
    { t: "Recurso à JARI", d: "Depois da defesa prévia", q: "Como faço recurso de multa à JARI?" },
    { t: "Parcelar multas", d: "Pagamento em parcelas", q: "Posso parcelar multas de trânsito? Como?" },
    { t: "Multa de carro que vendi", d: "Veículo já vendido", q: "Recebi uma multa de um carro que já vendi. O que faço?" },
  ] },
  { id: "licenciamento", icone: "📄", titulo: "Licenciamento e IPVA", itens: [
    { t: "Licenciamento anual", d: "CRLV-e do ano", j: "licenciamento" },
    { t: "Calendário pela placa", d: "Mês pelo final da placa", q: "Qual o calendário de licenciamento pelo final da placa?" },
    { t: "IPVA", d: "Consultar, pagar ou parcelar", q: "Como consulto e pago o IPVA do meu veículo? Posso parcelar?" },
    { t: "Emitir o CRLV-e", d: "Documento digital", q: "Como emito o CRLV-e digital do meu veículo?" },
    { t: "Débitos do veículo", d: "O que está pendente", q: "Como consulto os débitos do meu veículo?" },
    { t: "Isenção de IPVA", d: "Pessoa com deficiência e outros casos", q: "Quem tem direito à isenção de IPVA e como pedir?" },
  ] },
];

