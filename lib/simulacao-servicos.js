// ─────────────────────────────────────────────────────────────────────────────
// Catálogo completo de serviços do "Meu DETRAN" em SIMULAÇÃO.
// Mapeado a partir do portal, do Protocolo Digital e do app do DETRAN-GO (nov/2026).
// Cada serviço é: consulta, documento (certidão SEM VALOR), protocolo (com taxa
// opcional que vira débito e só deixa o processo andar depois de paga), agenda,
// aba (atalho para uma tela) ou info. Taxas = valores de REFERÊNCIA da simulação.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes } from "node:crypto";
import { comTenant } from "./tenants.js";
import { orgaosDe, personasDe, painel, lerEstado, gravarEstado, EMPRESAS_PARCELAMENTO, JUROS_CARTAO, protocoloConcluido } from "./simulacao.js";

const DIA = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const dBR = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hash = (s) => parseInt(createHash("sha1").update(String(s)).digest("hex").slice(0, 8), 16);
const codigo = (pref) => `SIM-${pref}-${randomBytes(4).toString("hex").toUpperCase()}`;

const CATS = ["Habilitação (CNH)", "Veículos", "Multas e débitos", "Certidões e consultas", "Atendimento e outros"];
const [CNH, VEI, MUL, CER, ATD] = CATS;

// Empresas e listas fictícias (não usamos nomes reais de credenciadas).
const CURSOS = [
  { nome: "Direção defensiva", horas: 20, modo: "EAD" }, { nome: "Primeiros socorros no trânsito", horas: 8, modo: "presencial" },
  { nome: "Motociclista seguro", horas: 12, modo: "presencial" }, { nome: "Trânsito para educadores", horas: 16, modo: "EAD" },
];
const FABRICANTES_PLACAS = ["Placas Exemplo Ltda. (fictícia)", "Mercosul Placas Modelo (fictícia)", "Estampadora Demonstração (fictícia)"];
const VANS = [
  { placa: "SIM5E01", condutor: "Condutor fictício 1", escola: "Escola Modelo (fictícia)", situacao: "REGULAR", validade: 180 },
  { placa: "SIM5E02", condutor: "Condutor fictício 2", escola: "Colégio Exemplo (fictício)", situacao: "AUTORIZAÇÃO VENCIDA", validade: -12 },
  { placa: "SIM5E03", condutor: "Condutor fictício 3", escola: "Escola Demonstração (fictícia)", situacao: "VISTORIA SEMESTRAL PENDENTE", validade: 40 },
];

// ── Definição dos serviços ──────────────────────────────────────────────────
// campos[].opcoes: lista fixa ou um nome resolvido por cidadão (pessoas, aits, aitsIndicaveis, municipios, bairros, orgaosMulta, vans).
// Resultado dos julgamentos: alguns casos de demonstração têm desfecho fixo; os outros, sorteio estável por auto.
const DESFECHO = { "SIM-E00399120|cetran": true, "SIM-E00418273|jari": false, "SIM-R55031987|defesa": false };
function julgar(inst, nome, proxima, pct, base) {
  return ({ campos, d }) => {
    const inf = d.infracoes.find((i) => i.ait === campos.ait);
    const k = `${campos.ait}|${inst}`;
    const deferido = k in DESFECHO ? DESFECHO[k] : hash(k) % 100 < pct;
    return {
      efeito: { tipo: "julgamento", ait: campos.ait, instancia: nome, deferido, proxima },
      etapas: [...base, deferido ? "Julgado: DEFERIDO — auto cancelado" : `Julgado: INDEFERIDO${proxima ? ` — cabe ${proxima}` : ""}`],
      obs: `${campos.orgao || inf?.orgao || ""} · AIT ${campos.ait} — ${inf?.desc || ""}`,
    };
  };
}

function catalogo(t) {
  const o = orgaosDe(t);
  const G = o.guia;
  return [
    // ── Habilitação ──
    { id: "cnh-dados", cat: CNH, nome: "Consultar dados da CNH", tipo: "aba", aba: "cnh", app: true, desc: "Situação, validade, categoria, pontos e infrações." },
    { id: "cnh-primeira", cat: CNH, nome: "Primeira habilitação / adição de categoria", tipo: "protocolo", taxa: 289.25, desc: "Abre o processo no RENACH. Depois vêm biometria, exames, prova de legislação e exame prático.",
      anexos: ["Documento de identidade","Comprovante de endereço"],
      requisitos: ["Ter 18 anos", "Saber ler e escrever", "Documento de identidade e CPF", "Comprovante de endereço"],
      campos: [{ id: "categoria", rotulo: "Categoria", opcoes: ["A", "B", "AB", "Adição de A", "Adição de B"] }],
      etapas: ["Protocolado", "Biometria e foto", "Exames médico e psicológico", "Prova de legislação", "Exame prático", "Permissão para Dirigir emitida"] },
    { id: "cnh-renovacao", cat: CNH, nome: "Renovar a CNH", tipo: "protocolo", taxa: 194.67, desc: "Renovação com exame médico em clínica credenciada (exame pago à clínica).",
      requisitos: ["CNH vencida ou a vencer em até 30 dias", "Exame médico (e psicológico para EAR)"],
      etapas: ["Protocolado", "Exame médico agendado", "Exame médico: apto", "Em emissão", "Concluído — CNH digital disponível"] },
    { id: "cnh-2via", cat: CNH, nome: "Segunda via da CNH", tipo: "protocolo", taxa: 128.9, desc: "Para perda, roubo, furto ou dano. A CNH digital fica disponível logo após a emissão.",
      anexos: ["Documento de identidade","Boletim de ocorrência (roubo ou furto)"],
      campos: [{ id: "motivo", rotulo: "Motivo", opcoes: ["Perda / extravio", "Roubo ou furto", "Dano", "Alteração de dados"] }],
      etapas: ["Protocolado", "Taxa confirmada", "Em emissão", "Concluído — CNH digital disponível"] },
    { id: "cnh-troca", cat: CNH, nome: "Trocar a Permissão para Dirigir pela CNH definitiva", tipo: "protocolo", taxa: 0, desc: "Gratuita. Exige 1 ano sem infração grave, gravíssima ou reincidência em média.",
      etapas: ["Protocolado", "Prontuário verificado: sem impedimentos", "Concluído — CNH definitiva (digital) emitida"],
      run: ({ d }) => (d.cnh.situacao !== "Permissão para Dirigir" ? { erro: "Disponível só para quem tem Permissão para Dirigir (CNH provisória)." } : { efeito: { tipo: "troca" } }) },
    { id: "cnh-pid", cat: CNH, nome: "Permissão Internacional para Dirigir (PID)", tipo: "protocolo", taxa: 254.1, desc: "Para dirigir em países signatários da Convenção de Viena.",
      anexos: ["Documento de identidade","Foto 3x4 recente"],
      etapas: ["Protocolado", "Taxa confirmada", "Em confecção", "Concluído — retirar na unidade escolhida"],
      run: ({ d }) => (!/Regular/.test(d.cnh.situacao) ? { erro: `Não é possível: CNH ${d.cnh.situacao.toLowerCase()}. A PID exige CNH definitiva e regular.` } : {}) },
    { id: "cnh-condutor", cat: CNH, nome: "Indicar o real condutor (transferir pontuação)", tipo: "protocolo", taxa: 0, app: true,
      anexos: ["CNH do condutor indicado","Formulário de identificação do condutor assinado"],
      desc: "O proprietário indica quem dirigia. Prazo: até a data limite da notificação de autuação (30 dias). O condutor indicado precisa assinar.",
      campos: [{ id: "ait", rotulo: "Auto de infração", opcoes: "aitsIndicaveis" }, { id: "condutor", rotulo: "Condutor que dirigia", opcoes: "pessoas" }],
      etapas: ["Protocolado", "Assinatura do condutor confirmada", "Indicação deferida — pontos transferidos"],
      run: ({ campos, nomePessoa }) => ({ efeito: { tipo: "indicar", ait: campos.ait, condutor: campos.condutor, condutorNome: nomePessoa(campos.condutor) }, obs: `AIT ${campos.ait} → ${nomePessoa(campos.condutor)}` }) },
    { id: "cnh-prova-agendar", cat: CNH, nome: "Agendar prova de legislação (presencial)", tipo: "agenda", agenda: "Prova de legislação (teórica)", desc: "Escolha a unidade e o horário da prova teórica." },
    { id: "cnh-pratico-agendar", cat: CNH, nome: "Agendar exame prático de direção", tipo: "agenda", agenda: "Exame prático de direção", desc: "Depois de aprovado na prova de legislação." },
    { id: "cnh-prova-resultado", cat: CNH, nome: "Resultado da prova de legislação e do exame prático", tipo: "consulta", desc: "Resultados dos últimos 12 meses.",
      run: ({ p }) => ({ titulo: "Resultados de exames", fonte: "RENACH",
        tabela: p.provas?.length ? { cab: ["Exame", "Data", "Resultado", "Detalhe"], linhas: p.provas.map((x) => [x.tipo, dBR(x.data), x.resultado, x.detalhe]) } : null,
        alertas: p.provas?.length ? (p.provas.some((x) => x.resultado === "REPROVADO") ? [["al", "Há exame reprovado: peça o reteste. O 1º reteste é gratuito."]] : []) : [["ok", "Nenhum exame realizado nos últimos 12 meses."]] }) },
    { id: "cnh-reteste", cat: CNH, nome: "Taxa de reteste (legislação ou prático)", tipo: "protocolo", taxa: 0, taxaVariavel: "1º reteste gratuito; a partir do 2º, R$ 48,65", desc: "O primeiro reteste é gratuito; a partir do segundo, há taxa.",
      campos: [{ id: "exame", rotulo: "Exame", opcoes: ["Prova de legislação", "Exame prático de direção"] }],
      etapas: ["Protocolado", "Reteste liberado — agende o novo exame"],
      run: ({ e, campos }) => {
        const n = e.protocolos.filter((x) => x.servico === "cnh-reteste" && x.obs?.includes(campos.exame)).length;
        return { taxa: n ? 48.65 : 0, obs: `${campos.exame} — ${n + 1}º reteste${n ? "" : " (gratuito)"}` };
      } },
    { id: "cnh-junta", cat: CNH, nome: "Perícia na Junta Médica do DETRAN", tipo: "agenda", agenda: "Perícia na Junta Médica", desc: "Para recurso de exame médico, PcD e casos especiais." },
    { id: "cnh-laudo", cat: CNH, nome: "Emitir laudo da Junta Médica / exame médico", tipo: "documento", desc: "Laudo do último exame médico ou perícia.",
      run: ({ p }) => (p.laudos?.length ? { titulo: "Laudo médico", linhas: p.laudos.map((l) => [l.tipo, `${l.resultado} — ${l.detalhe} (${dBR(l.data)})`]) } : { erro: "Nenhum laudo médico registrado para este condutor nos últimos 5 anos." }) },
    { id: "cnh-processos", cat: CNH, nome: "Consultar processos de habilitação (RENACH)", tipo: "consulta", app: true, desc: "Processos de habilitação, renovação, suspensão e cassação.",
      run: ({ d }) => ({ titulo: "Processos no RENACH", fonte: "SENATRAN — RENACH",
        tabela: d.processosCnh.length ? { cab: ["Processo", "Número", "Situação", "Desde"], linhas: d.processosCnh.map((x) => [x.tipo, x.numero, x.situacao, dBR(x.desde)]) } : null,
        alertas: d.processosCnh.length ? [] : [["ok", "Nenhum processo de habilitação em andamento."]] }) },
    { id: "cnh-reciclagem", cat: CNH, nome: "Fazer curso de reciclagem", tipo: "protocolo", taxa: 0, desc: "Obrigatório para quem teve a CNH suspensa. Curso de 30 h (EAD ou presencial em CFC) + prova.",
      etapas: ["Inscrição confirmada", "Aulas concluídas (30 h)", "Prova final: aprovado", "Concluído — certificado registrado no RENACH"],
      run: ({ d }) => (d.cnh.situacao !== "Suspensa" ? { erro: "O curso de reciclagem só é exigido de quem está com a CNH suspensa ou cassada." } : { efeito: { tipo: "reciclagem" } }) },
    { id: "cnh-apreendida", cat: CNH, nome: "Liberação de CNH apreendida / fim da suspensão", tipo: "protocolo", taxa: 0, desc: "Depois de cumprir o prazo da penalidade e concluir o curso de reciclagem.",
      anexos: ["Certificado do curso de reciclagem"],
      etapas: ["Protocolado", "Prazo da penalidade e reciclagem conferidos", "Concluído — CNH liberada"],
      run: ({ d, e }) => {
        if (d.cnh.situacao !== "Suspensa") return { erro: "Não há CNH suspensa ou apreendida para este condutor." };
        const rec = e.protocolos.find((x) => x.efeito?.tipo === "reciclagem");
        if (!rec || !protocoloConcluido(rec, e.pagos)) return { erro: "Antes, conclua o curso de reciclagem (é obrigatório para liberar a CNH)." };
        if (!d.processosCnh.some((pc) => pc.prazoCumprido)) return { erro: "A suspensão de 12 meses ainda está em curso. Use “⏩ Avançar o tempo → 12 meses” para simular o fim do prazo." };
        if (e.protocolos.some((x) => x.efeito?.tipo === "liberar")) return { erro: "A liberação já foi pedida — acompanhe em Processos." };
        return { efeito: { tipo: "liberar" } };
      } },
    { id: "cnh-desbloqueio", cat: CNH, nome: "Desbloqueio de RENACH / regularizar processo de CNH", tipo: "protocolo", taxa: 0, desc: "Para processos travados por divergência de dados, biometria ou bloqueio administrativo.",
      anexos: ["Documento de identidade"],
      campos: [{ id: "motivo", rotulo: "Situação", opcoes: ["Divergência de dados cadastrais", "Falha na biometria", "Bloqueio administrativo", "Outro"] }],
      etapas: ["Protocolado", "Em análise na Gerência de Habilitação", "Desbloqueado"], run: ({ campos }) => ({ efeito: { tipo: "desbloqueio", motivo: campos.motivo } }) },
    { id: "cnh-cursos", cat: CNH, nome: "Cursos da Escola Pública de Trânsito", tipo: "info", desc: "Cursos gratuitos para condutores e a comunidade.",
      run: () => ({ titulo: "Escola Pública de Trânsito", linhas: CURSOS.map((c) => [c.nome, `${c.horas} h · gratuito · ${c.modo}`]), texto: "Para se inscrever, use o serviço “Inscrição em curso da Escola Pública de Trânsito” (turmas fictícias)." }) },
    { id: "cnh-curso-inscricao", cat: CNH, nome: "Inscrição em curso da Escola Pública de Trânsito", tipo: "protocolo", taxa: 0, desc: "Inscrição gratuita; o certificado sai ao final.",
      campos: [{ id: "curso", rotulo: "Curso", opcoes: CURSOS.map((c) => c.nome) }],
      etapas: ["Inscrição confirmada", "Curso em andamento", "Avaliação final: aprovado", "Concluído — certificado disponível"], run: ({ campos }) => ({ obs: campos.curso }) },

    // ── Veículos ──
    { id: "vei-consulta", cat: VEI, nome: "Consultar veículo (IPVA, multas e CRLV)", tipo: "aba", aba: "veiculo", app: true, desc: "Dados do registro, restrições, débitos e licenciamento." },
    { id: "vei-crlv", cat: VEI, nome: "Obter o CRLV-e (documento digital)", tipo: "documento", desc: "Disponível com o licenciamento do ano pago.",
      run: ({ d }) => (String(d.veiculo.licenciadoAte) !== String(new Date().getFullYear()) ? { erro: `CRLV-e bloqueado: licenciamento ${new Date().getFullYear()} em aberto. Pague a taxa em "Débitos e guias".` }
        : { titulo: `CRLV-e ${new Date().getFullYear()}`, linhas: [["Placa", d.veiculo.placa], ["RENAVAM", d.veiculo.renavam], ["Marca/modelo", d.veiculo.modelo], ["Ano", d.veiculo.ano], ["Cor", d.veiculo.cor], ["Município", d.veiculo.municipio], ["Proprietário", d.cidadao.nome], ["Exercício", d.veiculo.licenciadoAte]] }) },
    { id: "vei-transf-prop", cat: VEI, nome: "Transferência de propriedade", tipo: "protocolo", taxa: 285.1, desc: "Comprador transfere em até 30 dias. Exige vistoria e ATPV-e assinada.",
      anexos: ["ATPV-e assinada", "Laudo de vistoria"],
      campos: [{ id: "comprador", rotulo: "Novo proprietário", opcoes: "pessoas" }],
      etapas: ["Protocolado", "Documentação conferida", "Vistoria aprovada", "Taxas confirmadas", "Concluído — CRLV-e em nome do comprador"],
      run: ({ campos, nomePessoa }) => ({ efeito: { tipo: "propriedade", compradorNome: nomePessoa(campos.comprador) } }) },
    { id: "vei-transf-mun", cat: VEI, nome: `Transferência de município (dentro de ${o.uf})`, tipo: "protocolo", taxa: 98.3, desc: "Quando o proprietário muda de cidade no mesmo estado.",
      anexos: ["Comprovante de endereço no novo município"],
      campos: [{ id: "municipio", rotulo: "Novo município", opcoes: "municipios" }],
      etapas: ["Protocolado", "Taxa confirmada", "Concluído — novo CRLV-e emitido"],
      run: ({ campos }) => ({ efeito: { tipo: "municipio", municipio: campos.municipio } }) },
    { id: "vei-transf-uf", cat: VEI, nome: `Transferência de veículo de outro estado para ${o.uf}`, tipo: "protocolo", taxa: 285.1, desc: "Prazo de 30 dias após a mudança. Exige vistoria e baixa no estado de origem.",
      anexos: ["CRV/ATPV-e do estado de origem","Comprovante de endereço no estado"],
      requisitos: ["CRV/ATPV-e de origem", "Vistoria em ECV credenciada", "Comprovante de endereço no estado"],
      etapas: ["Protocolado", "Vistoria aprovada", "Liberação do estado de origem (RENAVAM)", "Concluído — veículo registrado no estado"],
      run: ({ d }) => (/\/(..)$/.exec(d.veiculo.municipio)?.[1] === o.uf ? { erro: `O veículo já está registrado em ${o.uf}.` } : { efeito: { tipo: "transfUF" } }) },
    { id: "vei-endereco", cat: VEI, nome: "Alterar endereço do veículo (mesmo município)", tipo: "protocolo", taxa: 0, app: true, desc: "Gratuito e imediato.",
      campos: [{ id: "bairro", rotulo: "Novo bairro", opcoes: "bairros" }],
      etapas: ["Endereço atualizado"], imediato: true, run: ({ campos }) => ({ efeito: { tipo: "endereco", bairro: campos.bairro } }) },
    { id: "vei-venda", cat: VEI, nome: "Comunicado de venda", tipo: "protocolo", taxa: 0, app: true, desc: "O vendedor comunica a venda e deixa de responder por multas e débitos a partir da data.",
      campos: [{ id: "comprador", rotulo: "Comprador", opcoes: "pessoas" }],
      etapas: ["Comunicado registrado no RENAVAM"], imediato: true,
      run: ({ campos, nomePessoa }) => ({ efeito: { tipo: "venda", compradorNome: nomePessoa(campos.comprador) } }) },
    { id: "vei-gravame", cat: VEI, nome: "Consultar gravame (financiamento)", tipo: "consulta", desc: "Alienação fiduciária, arrendamento ou reserva de domínio.",
      run: ({ p, d }) => ({ titulo: `Gravame — placa ${d.veiculo.placa}`, fonte: "SNG — Sistema Nacional de Gravames",
        linhas: p.contrato ? [["Tipo", p.contrato.tipo], ["Credor", p.contrato.credor], ["Contrato", p.contrato.numero], ["Registrado em", dBR(p.contrato.registradoEm)], ["Situação", p.contrato.situacao]] : [],
        alertas: p.contrato ? [["al", "Com gravame ativo, a transferência depende da baixa pelo credor."]] : [["ok", "Nada consta: o veículo não tem gravame."]] }) },
    { id: "vei-contrato", cat: VEI, nome: "Consulta de registro de contrato", tipo: "consulta", desc: "Registro do contrato de financiamento no DETRAN.",
      run: ({ p }) => ({ titulo: "Registro de contrato", fonte: `${t.sigla} — Registro de Contratos`,
        linhas: p.contrato ? [["Contrato", p.contrato.numero], ["Credor", p.contrato.credor], ["Registro", dBR(p.contrato.registradoEm)], ["Situação", "Registrado"]] : [],
        alertas: p.contrato ? [] : [["ok", "Nenhum contrato registrado para este veículo."]] }) },
    { id: "vei-certidao", cat: VEI, nome: "Certidão de propriedade veicular", tipo: "documento", desc: "Comprova quem é o proprietário e os ônus do veículo.",
      run: ({ p, d }) => ({ titulo: "Certidão de propriedade veicular", linhas: [["Proprietário", d.cidadao.nome], ["CPF", d.cidadao.cpf], ["Placa", d.veiculo.placa], ["RENAVAM", d.veiculo.renavam], ["Modelo", d.veiculo.modelo], ["Gravame", p.contrato ? `${p.contrato.tipo} — ${p.contrato.credor}` : "Nada consta"], ["Restrições", d.veiculo.restricoes.join("; ") || "Nada consta"]] }) },
    { id: "vei-posse", cat: VEI, nome: "Certidão de posse", tipo: "documento", app: true, desc: "Declara a posse do veículo em nome do condutor.",
      run: ({ d }) => ({ titulo: "Certidão de posse", linhas: [["Possuidor", d.cidadao.nome], ["Placa", d.veiculo.placa], ["Modelo", d.veiculo.modelo], ["Desde", "Registro atual"]] }) },
    { id: "vei-2via-crv", cat: VEI, nome: "Segunda via do CRV / ATPV-e", tipo: "protocolo", taxa: 132.4, desc: "Para perda do documento de transferência.",
      anexos: ["Documento de identidade","Boletim de ocorrência (se houver)"],
      etapas: ["Protocolado", "Taxa confirmada", "Vistoria de identificação", "Concluído — nova ATPV-e emitida"] },
    { id: "vei-2via-crlv", cat: VEI, nome: "Segunda via do CRLV-e", tipo: "protocolo", taxa: 0, desc: "Reemissão do documento digital (licenciamento pago).",
      etapas: ["Protocolado", "Concluído — CRLV-e disponível na CDT"] },
    { id: "vei-caracteristica", cat: VEI, nome: "Alteração de característica do veículo", tipo: "protocolo", taxa: 156.2, desc: "Cor, combustível (GNV), carroceria, suspensão. Exige CSV e vistoria.",
      anexos: ["CSV — Certificado de Segurança Veicular", "Nota fiscal do serviço"],
      campos: [{ id: "alteracao", rotulo: "Alteração", opcoes: ["Cor: Branca", "Cor: Prata", "Cor: Preta", "Cor: Vermelha", "Cor: Azul", "Instalação de GNV", "Carroceria", "Suspensão"] }],
      etapas: ["Protocolado", "CSV (Certificado de Segurança Veicular) conferido", "Vistoria aprovada", "Concluído — novo CRLV-e"],
      run: ({ campos, d }) => (campos.alteracao === `Cor: ${d.veiculo.cor}` ? { erro: `O veículo já é ${d.veiculo.cor.toLowerCase()}.` } : { efeito: { tipo: "caracteristica", alteracao: campos.alteracao }, obs: campos.alteracao }) },
    { id: "vei-baixa", cat: VEI, nome: "Baixa de veículo", tipo: "protocolo", taxa: 0, desc: "Para veículo irrecuperável, sucata ou desmontado. Placas e chassi são inutilizados.",
      anexos: ["Requerimento de baixa (RQ14)", "Termo fotográfico (RQ15)", "Termo de inutilização de placas e chassi (RQ16)"],
      etapas: ["Protocolado", "Termo fotográfico (RQ15) conferido", "Placas e chassi inutilizados (RQ16)", "Concluído — baixa registrada no RENAVAM"],
      run: ({ d, e }) => (d.veiculo.situacao === "Baixado" || e.protocolos.some((x) => x.efeito?.tipo === "baixa") ? { erro: "A baixa deste veículo já foi pedida." }
        : d.debitos.some((x) => x.situacao !== "PAGO") ? { erro: "Para dar baixa, quite antes todos os débitos do veículo." } : { efeito: { tipo: "baixa" } }) },
    { id: "vei-chassi", cat: VEI, nome: "Regravação de chassi", tipo: "protocolo", taxa: 120.5, desc: "Quando a numeração está ilegível ou adulterada. Exige perícia.",
      anexos: ["Laudo pericial"],
      etapas: ["Protocolado", "Perícia agendada", "Regravação autorizada", "Concluído — vistoria final aprovada"] },
    { id: "vei-embargo", cat: VEI, nome: "Impedimento de licenciamento (embargo / desembargo)", tipo: "protocolo", taxa: 0, desc: "Averbação ou cancelamento de impedimento por ordem judicial ou administrativa.",
      anexos: ["Decisão judicial ou ofício"],
      campos: [{ id: "pedido", rotulo: "Pedido", opcoes: ["Averbação (embargo)", "Cancelamento (desembargo)"] }],
      etapas: ["Protocolado", "Documento de origem conferido", "Concluído — RENAVAM atualizado"] },
    { id: "vei-clonagem", cat: VEI, nome: "Defesa por clonagem de veículo", tipo: "protocolo", taxa: 0, desc: "Quando chegam multas de onde o veículo nunca esteve. Exige boletim de ocorrência.",
      anexos: ["Boletim de ocorrência", "Fotos do veículo (frente, traseira e placa)"],
      campos: [{ id: "ait", rotulo: "Autuação que não é sua", opcoes: "aitsLivres" }],
      etapas: ["Protocolado", "Boletim de ocorrência conferido", "Perícia comparativa das imagens", "Concluído — autuação cancelada e troca de placa autorizada"],
      run: ({ campos }) => ({ efeito: { tipo: "cancelarAit", ait: campos.ait }, obs: `AIT ${campos.ait}` }) },
    { id: "vei-vistoria", cat: VEI, nome: "Agendar vistoria veicular", tipo: "agenda", agenda: "Vistoria veicular", desc: "Transferência, alteração de característica e regularizações." },
    { id: "vei-calendario", cat: VEI, nome: "Calendário de licenciamento e IPVA", tipo: "info", desc: "Datas por final de placa.",
      run: () => ({ titulo: `Calendário ${new Date().getFullYear()} — IPVA e licenciamento`, fonte: o.fazendaSigla,
        tabela: { cab: ["Final de placa", "Cota única com desconto", "Parcelamento", "Cota única sem desconto"], linhas: [["1 e 2", "até 15/01 (8% de desconto)", "até 9 parcelas", "até 15/09"], ["3 a 0", "até 15/01 (8% de desconto)", "até 10 parcelas", "até 15/10"]] },
        texto: "A taxa de licenciamento pode ser parcelada junto com o IPVA. Pague só pelos canais oficiais." }) },
    { id: "vei-placas", cat: VEI, nome: "Empresas autorizadas a fabricar placas", tipo: "info", desc: "Estampadoras credenciadas para placas Mercosul.",
      run: () => ({ titulo: "Estampadoras credenciadas (fictícias)", linhas: FABRICANTES_PLACAS.map((n, i) => [n, `${o.municipios[i % o.municipios.length]} · credenciamento válido`]) }) },
    { id: "vei-escolar", cat: VEI, nome: "Regularidade do transporte escolar", tipo: "consulta", desc: "Pais e escolas conferem se a van está autorizada.",
      campos: [{ id: "van", rotulo: "Placa da van (fictícia)", opcoes: "vans" }],
      run: ({ campos }) => { const v = VANS.find((x) => x.placa === campos.van); return { titulo: `Transporte escolar — ${v.placa}`, linhas: [["Condutor", v.condutor], ["Atende", v.escola], ["Situação", v.situacao], ["Autorização até", dBR(iso(Date.now() + v.validade * DIA))]], alertas: [[v.situacao === "REGULAR" ? "ok" : "er", v.situacao === "REGULAR" ? "Veículo e condutor autorizados." : "Não utilize: situação irregular."]] }; } },

    // ── Multas e débitos ──
    { id: "mul-debitos", cat: MUL, nome: `Débitos, emissão de guia (${G}) e pagamento`, tipo: "aba", aba: "debitos", desc: "IPVA, licenciamento, multas, taxas e dívida ativa." },
    { id: "mul-outra-uf", cat: MUL, nome: "Multas de veículo em outro estado (RENAINF)", tipo: "consulta", desc: "Autuações de órgãos de outras UFs.",
      run: ({ d }) => { const m = d.debitos.filter((x) => x.outraUF); return { titulo: "Multas de outras UFs", fonte: "SENATRAN — RENAINF",
        tabela: m.length ? { cab: ["AIT", "Infração", "Órgão", "Valor", "Situação"], linhas: m.map((x) => [x.ait, x.desc, x.orgao, brl(x.total), x.situacao]) } : null,
        alertas: m.length ? [["al", "Multas de outra UF também bloqueiam o licenciamento. Podem ser pagas na guia do estado."]] : [["ok", "Nada consta no RENAINF."]] }; } },
    { id: "mul-edital", cat: MUL, nome: "Consultar edital de notificação", tipo: "consulta", desc: "Notificações publicadas em edital quando a carta não chega.",
      run: ({ p }) => ({ titulo: "Editais de notificação", fonte: `Diário Oficial — ${t.sigla}`,
        tabela: p.editais?.length ? { cab: ["Edital", "Tipo", "AIT", "Publicado", "Prazo de defesa"], linhas: p.editais.map((x) => [x.numero, x.tipo, x.ait, dBR(x.publicadoEm), dBR(x.prazoDefesa)]) } : null,
        alertas: p.editais?.length ? [["al", `${p.editais[0].motivo}. O prazo começa a contar da publicação — atualize o endereço.`]] : [["ok", "Nenhum edital publicado em seu nome."]] }) },
    { id: "mul-defesa", cat: MUL, nome: "Defesa prévia", tipo: "protocolo", taxa: 0, app: true, desc: "Primeira contestação, antes da multa ser aplicada. Vai ao órgão que autuou (DETRAN, rodovias, prefeitura, PRF ou DNIT).",
      anexos: ["Notificação de autuação", "Documento do proprietário", "Provas (fotos, documentos)"],
      campos: [{ id: "orgao", rotulo: "Órgão autuador", opcoes: "orgaos:aitsDefesa" }, { id: "ait", rotulo: "Auto de infração", opcoes: "aitsDefesa", dependeDe: "orgao" }],
      run: julgar("defesa", "Defesa prévia", "recurso à JARI", 25, ["Protocolado", "Encaminhado ao órgão autuador", "Em análise pela autoridade de trânsito"]) },
    { id: "mul-jari", cat: MUL, nome: "Recurso à JARI", tipo: "protocolo", taxa: 0, app: true, desc: "Depois da notificação de penalidade (multa aplicada). Cada órgão autuador tem sua JARI.",
      anexos: ["Notificação de penalidade", "Documento do proprietário", "Provas (fotos, documentos)"],
      campos: [{ id: "orgao", rotulo: "Órgão autuador", opcoes: "orgaos:aitsJari" }, { id: "ait", rotulo: "Auto de infração", opcoes: "aitsJari", dependeDe: "orgao" }],
      run: julgar("jari", "Recurso à JARI", `recurso ao ${o.conselho}`, 35, ["Protocolado", "Distribuído à JARI do órgão", "Em pauta de julgamento"]) },
    { id: "mul-cetran", cat: MUL, nome: `Recurso ao ${o.conselho}`, tipo: "protocolo", taxa: 0, desc: "Segunda instância, depois da decisão da JARI. Inclui a Junta Especial de Saúde.",
      anexos: ["Decisão da JARI", "Documento do proprietário"],
      campos: [{ id: "tipo", rotulo: "Tipo", opcoes: ["Recurso comum", "Junta Especial de Saúde"] }, { id: "ait", rotulo: "Auto de infração", opcoes: "aitsCetran" }],
      run: julgar("cetran", `Recurso ao ${o.conselho}`, null, 30, ["Protocolado", "Encaminhado ao Conselho", "Em pauta de julgamento"]) },
    { id: "mul-divida", cat: MUL, nome: `Regularizar dívida ativa junto ao ${t.sigla}`, tipo: "consulta", desc: "Débitos não pagos inscritos em dívida ativa (CDA).",
      run: ({ d }) => { const m = d.debitos.filter((x) => x.tipo === "DIVIDA_ATIVA"); return { titulo: "Dívida ativa", fonte: `${t.sigla} — Dívida Ativa`,
        tabela: m.length ? { cab: ["Débito", "Original", "Acréscimos", "Total", "Situação"], linhas: m.map((x) => [x.desc, brl(x.valor), brl(x.juros), brl(x.total), x.situacao]) } : null,
        alertas: m.length ? [["er", `Pague em "Débitos e guias" (o ${G} já inclui multa e juros) ou apresente defesa/recurso.`]] : [["ok", "Nada consta em dívida ativa."]] }; } },
    { id: "mul-divida-defesa", cat: MUL, nome: "Defesa ou recurso contra dívida ativa", tipo: "protocolo", taxa: 0, desc: "Contesta a inscrição em dívida ativa.",
      campos: [{ id: "tipo", rotulo: "Pedido", opcoes: ["Defesa", "Recurso"] }],
      anexos: ["Comprovantes que justificam o pedido"],
      etapas: ["Protocolado", "Em análise na Dívida Ativa", "Aguardando decisão"],
      run: ({ d }) => (d.debitos.some((x) => x.tipo === "DIVIDA_ATIVA" && x.situacao !== "PAGO") ? {} : { erro: "Não há débito em dívida ativa para contestar." }) },
    { id: "mul-parcelamento", cat: MUL, nome: "Empresas de parcelamento de débitos", tipo: "info", desc: "Parcelamento no cartão por empresas credenciadas.",
      run: () => ({ titulo: "Empresas credenciadas (fictícias)", linhas: EMPRESAS_PARCELAMENTO.map((n) => [n, `até 12x no cartão · ${String(JUROS_CARTAO * 100).replace(".", ",")}% a.m.`]), texto: "Para parcelar: em “Débitos e guias”, escolha os débitos e clique em “Parcelar no cartão”. O débito é quitado na hora no DETRAN; as parcelas ficam com a empresa." }) },
    { id: "mul-parcelar", cat: MUL, nome: "Parcelar débitos no cartão de crédito", tipo: "aba", aba: "debitos", desc: "Em até 12x por empresa credenciada; o DETRAN recebe à vista." },
    { id: "mul-restituicao", cat: MUL, nome: "Restituição / ressarcimento de multa ou taxa paga", tipo: "protocolo", taxa: 0, desc: "Pagamento em duplicidade, multa cancelada (inclusive GOINFRA e DNIT) ou serviço não prestado.",
      anexos: ["Comprovante de pagamento", "Dados bancários do titular"],
      campos: [{ id: "orgao", rotulo: "Órgão que recebeu", opcoes: "orgaosMulta" }, { id: "motivo", rotulo: "Motivo", opcoes: ["Pagamento em duplicidade", "Multa cancelada em recurso", "Serviço não prestado"] }],
      etapas: ["Protocolado", "Pagamento conferido", "Restituição aprovada", "Crédito em conta (até 30 dias)"] },
    { id: "mul-acidente", cat: MUL, nome: "Certidão de acidente de trânsito (estadual)", tipo: "documento", desc: "Registro de acidentes em rodovias estaduais.",
      run: ({ d }) => ({ titulo: "Certidão de acidente de trânsito", linhas: [["Requerente", d.cidadao.nome], ["Placa", d.veiculo.placa], ["Resultado", "NADA CONSTA — nenhum registro de acidente nos últimos 5 anos"]] }) },

    // ── Certidões e consultas ──
    { id: "cer-prontuario", cat: CER, nome: "Certidão de prontuário da CNH", tipo: "documento", desc: "Para emprego, seguro ou aposentadoria.",
      run: ({ d }) => ({ titulo: "Certidão de prontuário do condutor", linhas: [["Condutor", d.cidadao.nome], ["CPF", d.cidadao.cpf], ["Registro CNH", d.cnh.registro], ["Categoria", d.cnh.categoria], ["Situação", d.cnh.situacao], ["Validade", dBR(d.cnh.validade)], ["Pontos (12 meses)", String(d.cnh.pontos)], ["Infrações (12 meses)", d.infracoes.map((i) => `${dBR(i.data)} ${i.desc} (${i.natureza})`).join("; ") || "Nada consta"]] }) },
    { id: "cer-validar", cat: CER, nome: "Validar certidão / prontuário", tipo: "consulta", desc: "Confere se uma certidão emitida aqui é autêntica.",
      campos: [{ id: "codigo", rotulo: "Código da certidão", tipo: "texto" }],
      run: async ({ campos, t, sessao, pessoas }) => {
        const cod = String(campos.codigo).trim().toUpperCase();
        for (const x of pessoas) {
          const c = (await lerEstado(t, sessao, x.id)).certidoes?.find((y) => y.codigo === cod);
          if (c) return { titulo: "Validação de certidão", linhas: [["Código", c.codigo], ["Documento", c.titulo], ["Em nome de", `${x.nome} (fictício)`], ["Emitida em", new Date(c.emitidoEm).toLocaleString("pt-BR")], ["Válida até", dBR(iso(new Date(c.emitidoEm).getTime() + 30 * DIA))]],
            alertas: [["ok", "Certidão autêntica — emitida neste ambiente de simulação (SEM VALOR legal)."]] };
        }
        return { titulo: "Validação de certidão", alertas: [["er", "Código não encontrado: esta certidão não foi emitida aqui ou foi digitada errado."]] };
      } },
    { id: "cer-sei", cat: CER, nome: "Consultar processo SEI", tipo: "consulta", desc: "Processos administrativos no Sistema Eletrônico de Informações.",
      run: ({ d }) => ({ titulo: "Processos SEI", fonte: "SEI",
        tabela: d.protocolos.length ? { cab: ["SEI", "Assunto", "Aberto", "Andamento"], linhas: d.protocolos.map((x) => [`SIM-SEI ${x.numero.replace(/\D/g, "").slice(-11).replace(/^(\d{4})(\d+)$/, "$1.$2")}`, x.tipo, dBR(x.criadoEm), x.etapas.filter((y) => y.feito).pop()?.nome || "—"]) } : null,
        alertas: d.protocolos.length ? [] : [["ok", "Nenhum processo SEI em seu nome."]] }) },
    { id: "cer-processo", cat: CER, nome: "Consultar processo (protocolo)", tipo: "aba", aba: "processos", app: true, desc: "Acompanhamento de todos os pedidos." },

    // ── Atendimento e outros ──
    { id: "atd-agendar", cat: ATD, nome: "Agendar atendimento presencial (DETRAN, Vapt Vupt, Expresso)", tipo: "aba", aba: "agenda", desc: "Marcar, remarcar e cancelar." },
    { id: "atd-filas", cat: ATD, nome: "Filas nas unidades agora", tipo: "aba", aba: "filas", desc: "Tempo de espera em cada unidade." },
    { id: "atd-achados", cat: ATD, nome: "Achados e perdidos", tipo: "consulta", app: true, desc: "Documentos encontrados e entregues nas unidades.",
      run: ({ p }) => ({ titulo: "Achados e perdidos", tabela: p.achados?.length ? { cab: ["Documento", "Onde retirar", "Encontrado em", "Retirar até"], linhas: p.achados.map((x) => [x.documento, x.local, dBR(x.encontradoEm), dBR(x.retirarAte)]) } : null,
        alertas: p.achados?.length ? [["ok", "Encontramos um documento seu! Leve documento com foto para retirar."]] : [["ok", "Nenhum documento seu foi entregue nas unidades."]] }) },
    { id: "atd-estacionamento", cat: ATD, nome: "Cartão de estacionamento (idoso / PcD)", tipo: "protocolo", taxa: 0, app: true, desc: "Para municípios sem órgão municipal de trânsito. Gratuito.",
      anexos: ["Documento com data de nascimento (idoso) ou laudo médico (PcD)"],
      campos: [{ id: "tipo", rotulo: "Tipo", opcoes: ["Idoso (60+)", "Pessoa com deficiência"] }],
      etapas: ["Protocolado", "Documentação conferida", "Concluído — cartão digital emitido"] },
    { id: "atd-copia", cat: ATD, nome: "Cópia de processo ou documento", tipo: "protocolo", taxa: 0, desc: "Pedido de acesso a documentos do seu processo.",
      etapas: ["Protocolado", "Documentos localizados", "Concluído — cópia disponível para download"] },
    { id: "atd-generico", cat: ATD, nome: "Requerimento geral (outros assuntos)", tipo: "protocolo", taxa: 0, desc: "Para pedidos que não têm formulário próprio.",
      campos: [{ id: "assunto", rotulo: "Assunto", opcoes: ["Habilitação", "Veículo", "Multa", "Atendimento", "Outro"] }, { id: "mensagem", rotulo: "Descreva o pedido", tipo: "textarea", max: 500 }],
      etapas: ["Protocolado", "Encaminhado à área responsável", "Em análise"], run: ({ campos }) => ({ obs: `${campos.assunto}: “${campos.mensagem.slice(0, 140)}”` }) },
    { id: "atd-oficio", cat: ATD, nome: "Mandado judicial ou ofício", tipo: "protocolo", taxa: 0, desc: "Cumprimento de ordem judicial ou ofício de outro órgão.",
      anexos: ["Mandado ou ofício"],
      etapas: ["Protocolado", "Encaminhado à Procuradoria", "Em cumprimento"] },
    { id: "atd-ouvidoria", cat: ATD, nome: "Ouvidoria (reclamação, elogio, sugestão, denúncia)", tipo: "protocolo", taxa: 0, desc: "Prazo de resposta: até 30 dias.",
      campos: [{ id: "tipo", rotulo: "Tipo", opcoes: ["Reclamação", "Elogio", "Sugestão", "Denúncia", "Solicitação"] }, { id: "mensagem", rotulo: "Sua manifestação", tipo: "textarea", max: 500 }],
      etapas: ["Manifestação registrada", "Encaminhada à área", "Respondida — resposta enviada no seu e-mail (simulado)"], run: ({ campos }) => ({ obs: `${campos.tipo}: “${campos.mensagem.slice(0, 140)}”` }) },
    { id: "atd-esic", cat: ATD, nome: "Pedido de acesso à informação (e-SIC)", tipo: "protocolo", taxa: 0, desc: "Lei de Acesso à Informação: resposta em até 20 dias.",
      campos: [{ id: "mensagem", rotulo: "Que informação você quer?", tipo: "textarea", max: 500 }],
      etapas: ["Pedido registrado", "Em análise", "Respondido — resposta enviada no seu e-mail (simulado)"], run: ({ campos }) => ({ obs: `“${campos.mensagem.slice(0, 140)}”` }) },
    { id: "atd-fale", cat: ATD, nome: "Fale conosco", tipo: "protocolo", taxa: 0, desc: "Dúvidas e orientações por escrito.",
      campos: [{ id: "mensagem", rotulo: "Sua mensagem", tipo: "textarea", max: 500 }],
      etapas: ["Mensagem recebida", "Respondida — resposta enviada no seu e-mail (simulado)"], run: ({ campos }) => ({ obs: `“${campos.mensagem.slice(0, 140)}”` }) },
  ];
}

// Opções que dependem do cidadão.
function opcoes(spec, ctx) {
  if (Array.isArray(spec)) return spec.map((v) => ({ v, l: v }));
  const { t, o, d, p, pessoas } = ctx;
  if (String(spec).startsWith("orgaos:")) return [...new Set(opcoes(spec.slice(7), ctx).map((x) => x.g))].map((v) => ({ v, l: v }));
  const livres = d.infracoes.filter((i) => !i.emAnalise && !i.cancelada);
  const op = (i) => ({ v: i.ait, l: `${i.ait} — ${i.desc}`, g: i.orgao });
  switch (spec) {
    case "pessoas": return pessoas.filter((x) => x.id !== p.id).map((x) => ({ v: x.id, l: `${x.nome} (fictício)` }));
    case "aits": return d.infracoes.map(op);
    case "aitsLivres": return livres.map(op);
    case "aitsDefesa": return livres.filter((i) => /Autuação|defesa prévia/i.test(i.fase) && !/DEFERIDO|INDEFERIDO/.test(i.fase)).map(op);
    case "aitsJari": return livres.filter((i) => (/^Penalidade/.test(i.fase) && !/indeferido/i.test(i.fase)) || /cabe recurso à JARI/i.test(i.fase)).map(op);
    case "aitsCetran": return livres.filter((i) => /indeferido/i.test(i.fase) && /cabe recurso ao/i.test(i.fase)).map(op);
    case "aitsIndicaveis": return d.infracoes.filter((i) => i.indicavel).map((i) => ({ v: i.ait, l: `${i.ait} — ${i.desc} (${i.pontos} pts)` }));
    case "municipios": return o.municipios.filter((m) => !d.veiculo.municipio.startsWith(m + "/")).map((v) => ({ v, l: v }));
    case "bairros": return o.bairros.map((v) => ({ v, l: v }));
    case "orgaosMulta": return [t.sigla, o.rodovias, ...o.municipais, "PRF", "DNIT"].map((v) => ({ v, l: v }));
    case "vans": return VANS.map((x) => ({ v: x.placa, l: x.placa }));
    default: return [];
  }
}

export function registrarCatalogoSim(app) {
  const S = "/api/t/:slug/sim";
  const so = (req, res, next) => (req.tenant.demonstracao ? next() : res.status(404).json({ error: "Simulação disponível só em ambiente de demonstração." }));
  const sess = (req) => String(req.headers["x-sim-sessao"] || "").replace(/[^\w-]/g, "").slice(0, 40) || "anon";

  async function contexto(req, res) {
    const pessoas = personasDe(req.tenant);
    const p = pessoas.find((x) => x.id === req.params.p);
    if (!p) { res.status(404).json({ error: "Cidadão fictício não encontrado." }); return null; }
    const d = await painel(req.tenant, sess(req), p.id);
    const e = await lerEstado(req.tenant, sess(req), p.id);
    return { t: req.tenant, o: orgaosDe(req.tenant), p, d, e, pessoas, sessao: sess(req), nomePessoa: (id) => (pessoas.find((x) => x.id === id)?.nome || "—") + " (fictício)" };
  }

  // Catálogo com as opções já resolvidas para o cidadão escolhido.
  app.get(`${S}/:p/catalogo`, comTenant, so, async (req, res) => {
    const ctx = await contexto(req, res); if (!ctx) return;
    const livre = (c) => c.tipo === "texto" || c.tipo === "textarea";
    const itens = catalogo(req.tenant).map(({ run, ...s }) => ({ ...s, campos: (s.campos || []).map((c) => ({ ...c, opcoes: livre(c) ? undefined : opcoes(c.opcoes, ctx) })) }));
    res.json({ simulacao: true, categorias: CATS, total: itens.length, servicos: itens });
  });

  // Executa um serviço.
  app.post(`${S}/:p/servicos/:id`, comTenant, so, async (req, res) => {
    const ctx = await contexto(req, res); if (!ctx) return;
    const s = catalogo(req.tenant).find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: "Serviço não encontrado." });
    if (["aba", "agenda"].includes(s.tipo)) return res.json({ simulacao: true, tipo: s.tipo, aba: s.aba, agenda: s.agenda });
    // Valida campos
    const entrada = req.body?.campos || {};
    const campos = {};
    for (const c of s.campos || []) {
      const livre = c.tipo === "texto" || c.tipo === "textarea";
      const v = String(entrada[c.id] ?? "").trim().replace(/[<>]/g, "").slice(0, c.max || 80);
      if (!v) return res.status(400).json({ error: `Preencha: ${c.rotulo}.` });
      if (!livre) {
        const opt = opcoes(c.opcoes, ctx).find((x) => x.v === v);
        if (!opt) return res.status(400).json({ error: `Opção inválida em: ${c.rotulo}.` });
        if (c.dependeDe && opt.g !== campos[c.dependeDe]) return res.status(400).json({ error: `${c.rotulo} não pertence a ${campos[c.dependeDe]}.` });
      }
      campos[c.id] = v;
    }
    // Anexos: na simulação o arquivo NÃO sai do aparelho; recebemos só nome e tamanho.
    const anexos = [];
    for (const doc of s.anexos || []) {
      const a = (Array.isArray(req.body?.anexos) ? req.body.anexos : []).find((x) => x?.doc === doc);
      if (!a || !String(a.nome || "").trim()) return res.status(400).json({ error: `Anexe: ${doc}.` });
      anexos.push({ doc, nome: String(a.nome).replace(/[<>\\/]/g, "").slice(0, 80), tamanho: Math.max(0, Math.min(50e6, Number(a.tamanho) || 0)), exemplo: Boolean(a.exemplo) });
    }
    ctx.campos = campos;
    const r = (s.run ? await s.run(ctx) : {}) || {};
    if (r.erro) return res.status(422).json({ error: r.erro });

    if (s.tipo !== "protocolo") {
      const resultado = { ...r, ...(s.tipo === "documento" ? { codigo: codigo("CERT"), emitidoEm: new Date().toISOString() } : {}) };
      if (s.tipo === "documento") {
        ctx.e.certidoes = [{ codigo: resultado.codigo, titulo: resultado.titulo, emitidoEm: resultado.emitidoEm }, ...(ctx.e.certidoes || [])].slice(0, 30);
        await gravarEstado(ctx.t, sess(req), ctx.p.id, ctx.e);
      }
      return res.json({ simulacao: true, tipo: s.tipo, servico: s.nome, resultado });
    }
    // Protocolo (+ taxa como débito)
    const { e, o, t } = ctx;
    const Y = new Date().getFullYear();
    const numero = `SIM-${o.uf}-${Y}-${String(hash(Date.now() + Math.random()) % 9000000 + 1000000)}`;
    const taxa = Number(r.taxa ?? s.taxa ?? 0);
    const p = { numero, tipo: s.nome, etapas: r.etapas || s.etapas, criadoEm: new Date().toISOString(), obs: r.obs || null, efeito: r.efeito || null, imediato: Boolean(s.imediato), servico: s.id, anexos };
    let taxaItem = null;
    if (taxa > 0) {
      taxaItem = { id: `tx-${numero.slice(-7)}`, tipo: "TAXA", desc: `Taxa — ${s.nome} (protocolo ${numero})`, valor: taxa, vencimento: iso(Date.now() + 3 * DIA), orgao: t.sigla };
      e.taxas.unshift(taxaItem); p.taxaId = taxaItem.id;
    }
    e.protocolos.unshift(p); e.protocolos = e.protocolos.slice(0, 40); e.taxas = e.taxas.slice(0, 40);
    await gravarEstado(t, sess(req), ctx.p.id, e);
    const d2 = await painel(t, sess(req), ctx.p.id);
    res.status(201).json({ simulacao: true, tipo: "protocolo", servico: s.nome, protocolo: d2.protocolos.find((x) => x.numero === numero), taxa: taxaItem });
  });
}
