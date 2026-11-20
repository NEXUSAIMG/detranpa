// ─────────────────────────────────────────────────────────────────────────────
// "Meu DETRAN" em MODO SIMULAÇÃO (só para DETRAN em demonstração).
//
// Mostra como ficariam as integrações oficiais (fase 2): consultas de veículo,
// CNH e débitos, emissão de guia e pagamento, protocolos com andamento,
// agendamento nas unidades, filas ao vivo e o painel das integrações.
//
// Regras de segurança (para nunca ser confundido com o serviço real):
//   - só cidadãos FICTÍCIOS, escolhidos numa lista (não aceita CPF/placa real);
//   - guias e comprovantes "SEM VALOR", código de barras e PIX falsos;
//   - protocolos começam com SIM-; toda resposta traz simulacao: true;
//   - desligado em DETRAN cliente (demonstracao = false) -> 404.
// O estado (pagamentos, guias, protocolos, agendamentos) é por navegador,
// guardado no KV por 7 dias.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, randomBytes } from "node:crypto";
import { comTenant } from "./tenants.js";
import { kvGetStr, kvSetEx } from "../store.js";
import { conselhoDe } from "./prompts.js";

const DIA = 86400000;
const TTL = 7 * 86400;
const brl = (n) => "R$ " + Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const hash = (s) => parseInt(createHash("sha1").update(String(s)).digest("hex").slice(0, 8), 16);
const addDias = (n, base = Date.now()) => new Date(base + n * DIA);

// Órgãos e unidades por UF (o resto usa nomes genéricos).
const ORGAOS = {
  GO: {
    fazenda: "Secretaria de Estado da Economia de Goiás", fazendaSigla: "Economia-GO", rodovias: "GOINFRA", municipal: "SMM Goiânia",
    capital: "Goiânia",
    unidades: [
      { id: "vv-araguaia", nome: "Vapt Vupt Araguaia Shopping", cidade: "Goiânia", tipo: "Vapt Vupt" },
      { id: "vv-buriti", nome: "Vapt Vupt Buriti Shopping", cidade: "Aparecida de Goiânia", tipo: "Vapt Vupt" },
      { id: "vv-anapolis", nome: "Vapt Vupt Anápolis", cidade: "Anápolis", tipo: "Vapt Vupt" },
      { id: "expresso-gyn", nome: "Posto Expresso DETRAN-GO", cidade: "Goiânia", tipo: "Expresso" },
      { id: "sede", nome: "DETRAN-GO — Sede", cidade: "Goiânia", tipo: "DETRAN" },
    ],
  },
  PA: {
    fazenda: "Secretaria de Estado da Fazenda do Pará", fazendaSigla: "SEFA-PA", rodovias: "DER-PA", municipal: "SEMOB Belém",
    capital: "Belém",
    unidades: [
      { id: "sede", nome: "DETRAN-PA — Sede (Av. Augusto Montenegro)", cidade: "Belém", tipo: "DETRAN" },
      { id: "posto-castanheira", nome: "Posto Shopping Castanheira", cidade: "Belém", tipo: "Expresso" },
      { id: "posto-pátio", nome: "Posto Pátio Belém", cidade: "Belém", tipo: "Expresso" },
      { id: "ciretran-ananindeua", nome: "CIRETRAN Ananindeua", cidade: "Ananindeua", tipo: "DETRAN" },
    ],
  },
};
function orgaosDe(t) {
  const uf = String(t.uf).toUpperCase();
  const o = ORGAOS[uf] || {
    fazenda: `Secretaria da Fazenda do Estado`, fazendaSigla: `SEFAZ-${uf}`, rodovias: `DER-${uf}`, municipal: "Prefeitura da capital", capital: (t.cidadeSede || "").split("/")[0] || "Capital",
    unidades: [
      { id: "sede", nome: `${t.sigla} — Sede`, cidade: (t.cidadeSede || "").split("/")[0], tipo: "DETRAN" },
      { id: "posto-1", nome: "Posto de Atendimento Centro", cidade: (t.cidadeSede || "").split("/")[0], tipo: "Expresso" },
      { id: "posto-2", nome: "Posto de Atendimento Shopping", cidade: (t.cidadeSede || "").split("/")[0], tipo: "Expresso" },
    ],
  };
  return { ...o, conselho: conselhoDe(t), uf };
}

const SERVICOS_AGENDA = ["Renovação de CNH", "Primeira habilitação (biometria)", "Transferência de veículo", "Vistoria veicular", "2ª via de documento", "Atendimento de multas"];

// ── Cidadãos fictícios ──────────────────────────────────────────────────────
// Valores de multa: tabela do CTB (leve 88,38; média 130,16; grave 195,23; gravíssima 293,47).
function personas(t) {
  const Y = new Date().getFullYear();
  const uf = String(t.uf).toUpperCase();
  const o = orgaosDe(t);
  return [
    {
      id: "ana", nome: "Ana Clara Rodrigues", cpf: "111.444.777-35", resumo: "Tudo em dia: veículo licenciado, IPVA pago, CNH sem pontos.",
      veiculo: { placa: "SIM1A23", renavam: "00011122233", modelo: "HYUNDAI/HB20 1.0 COMFORT", ano: "2021/2022", cor: "Branca", combustivel: "Flex", municipio: `${o.capital}/${uf}`,
        situacao: "Em circulação", licenciadoAte: `${Y}`, restricoes: [], recall: [] },
      debitos: [],
      pagos: [{ id: "ipva-unica", tipo: "IPVA", desc: `IPVA ${Y} — cota única`, valor: 1874.4, pagoEm: iso(new Date(Y, 1, 10)) }, { id: "lic", tipo: "LICENCIAMENTO", desc: `Licenciamento ${Y}`, valor: 0, pagoEm: iso(new Date(Y, 2, 5)) }],
      cnh: { registro: "00000000011", categoria: "B", situacao: "Regular", validade: iso(new Date(Y + 6, 4, 18)), primeiraHab: "2012-03-07", pontos: 0, observacoes: "—", exameToxicologico: null },
      infracoes: [], processosCnh: [],
      protocolos: [],
    },
    {
      id: "carlos", nome: "Carlos Eduardo Lima", cpf: "123.456.789-09", resumo: "Com pendências: IPVA em atraso, licenciamento em aberto, 3 multas, 14 pontos.",
      veiculo: { placa: "SIM2B45", renavam: "00044455566", modelo: "FIAT/STRADA FREEDOM 1.3", ano: "2019/2019", cor: "Prata", combustivel: "Flex", municipio: `${o.capital}/${uf}`,
        situacao: "Em circulação", licenciadoAte: `${Y - 1}`, restricoes: ["Licenciamento do exercício em atraso"], recall: [] },
      debitos: [
        { id: "ipva-2", tipo: "IPVA", desc: `IPVA ${Y} — parcela 2/3`, valor: 412.73, vencimento: iso(addDias(-18)), orgao: o.fazendaSigla },
        { id: "ipva-3", tipo: "IPVA", desc: `IPVA ${Y} — parcela 3/3`, valor: 412.73, vencimento: iso(addDias(12)), orgao: o.fazendaSigla },
        { id: "lic", tipo: "LICENCIAMENTO", desc: `Taxa de licenciamento ${Y}`, valor: 148.66, vencimento: iso(addDias(-5)), orgao: t.sigla },
        { id: "multa-sinal", tipo: "MULTA", desc: "Avançar o sinal vermelho do semáforo (art. 208)", valor: 293.47, vencimento: iso(addDias(9)), orgao: t.sigla, ait: "SIM-E00418273", pontos: 7, natureza: "Gravíssima", fase: "PENALIDADE" },
        { id: "multa-estac", tipo: "MULTA", desc: "Estacionar em local proibido pela sinalização (art. 181, XVIII)", valor: 88.38, vencimento: iso(addDias(21)), orgao: o.municipal, ait: "SIM-M77120044", pontos: 3, natureza: "Leve", fase: "PENALIDADE" },
      ],
      pagos: [{ id: "ipva-1", tipo: "IPVA", desc: `IPVA ${Y} — parcela 1/3`, valor: 412.73, pagoEm: iso(new Date(Y, 1, 20)) }],
      cnh: { registro: "00000000022", categoria: "AB", situacao: "Regular", validade: iso(new Date(Y + 3, 8, 2)), primeiraHab: "2006-08-21", pontos: 14, observacoes: "EAR — exerce atividade remunerada", exameToxicologico: null },
      infracoes: [
        { data: iso(addDias(-48)), desc: "Avançar o sinal vermelho do semáforo", natureza: "Gravíssima", pontos: 7, orgao: t.sigla, ait: "SIM-E00418273", fase: "Penalidade — cabe recurso à JARI" },
        { data: iso(addDias(-35)), desc: "Estacionar em local proibido pela sinalização", natureza: "Leve", pontos: 3, orgao: o.municipal, ait: "SIM-M77120044", fase: "Penalidade" },
        { data: iso(addDias(-12)), desc: "Transitar em velocidade superior à máxima permitida em até 20% (art. 218, I)", natureza: "Média", pontos: 4, orgao: o.rodovias, ait: "SIM-R55031987", fase: "Autuação — prazo de defesa prévia" },
      ],
      processosCnh: [],
      protocolos: [],
    },
    {
      id: "marina", nome: "Marina Souza Alves", cpf: "529.982.247-25", resumo: "CNH suspensa (recusa ao bafômetro), recurso negado na JARI, veículo financiado com vistoria pendente.",
      veiculo: { placa: "SIM3C67", renavam: "00077788899", modelo: "TOYOTA/COROLLA XEI 2.0", ano: "2020/2020", cor: "Preta", combustivel: "Flex", municipio: `${o.capital}/${uf}`,
        situacao: "Em circulação", licenciadoAte: `${Y}`, restricoes: ["Alienação fiduciária — BANCO FICTÍCIO S.A.", "Vistoria de transferência pendente"], recall: ["Recall do airbag do passageiro (fabricante) — pendente"] },
      debitos: [
        { id: "multa-165a", tipo: "MULTA", desc: "Recusar-se a teste de etilômetro (art. 165-A)", valor: 2934.7, vencimento: iso(addDias(4)), orgao: t.sigla, ait: "SIM-E00399120", pontos: 7, natureza: "Gravíssima (x10)", fase: "PENALIDADE" },
      ],
      pagos: [{ id: "ipva-unica", tipo: "IPVA", desc: `IPVA ${Y} — cota única`, valor: 3120.9, pagoEm: iso(new Date(Y, 0, 30)) }],
      cnh: { registro: "00000000033", categoria: "B", situacao: "Suspensa", validade: iso(new Date(Y + 2, 10, 11)), primeiraHab: "2015-01-14", pontos: 7, observacoes: "Direito de dirigir suspenso por 12 meses (art. 165-A)", exameToxicologico: null },
      infracoes: [{ data: iso(addDias(-160)), desc: "Recusar-se a teste de etilômetro", natureza: "Gravíssima (x10)", pontos: 7, orgao: t.sigla, ait: "SIM-E00399120", fase: "Recurso à JARI indeferido — cabe recurso ao " + o.conselho }],
      processosCnh: [{ tipo: "Suspensão do direito de dirigir", numero: `SIM-${uf}-PSDD-${Y}-0412`, situacao: "Penalidade aplicada — 12 meses", desde: iso(addDias(-20)), prazoRecurso: iso(addDias(10)) }],
      protocolos: [
        { numero: `SIM-${uf}-${Y}-0007731`, tipo: "Recurso à JARI", criadoEm: addDias(-70).toISOString(), etapasFixas: ["Protocolado", "Em análise na JARI", "Julgado: INDEFERIDO"], obs: `Decisão publicada. Cabe recurso ao ${o.conselho} em 30 dias.` },
        { numero: `SIM-${uf}-${Y}-0011905`, tipo: "Transferência de propriedade", criadoEm: addDias(-3).toISOString(), etapasFixas: ["Protocolado", "Vistoria pendente"], obs: "Aguardando o laudo de vistoria para seguir." },
      ],
    },
  ];
}

// Etapas de cada tipo de protocolo novo (avançam sozinhas a cada ~2 minutos na demonstração).
const ETAPAS = {
  "Transferência de propriedade": ["Protocolado", "Documentação conferida", "Vistoria aprovada", "Taxas confirmadas", "Concluído — CRLV-e disponível na CDT"],
  "2ª via do CRLV-e": ["Protocolado", "Taxa confirmada", "Concluído — CRLV-e disponível na CDT"],
  "Renovação de CNH": ["Protocolado", "Exame médico agendado", "Exame médico: apto", "Em emissão", "Concluído — CNH digital disponível"],
  "Defesa prévia": ["Protocolado", "Em análise pela autoridade de trânsito", "Aguardando julgamento"],
  "Recurso à JARI": ["Protocolado", "Distribuído à JARI", "Em pauta de julgamento"],
  "Recurso ao CETRAN": ["Protocolado", "Encaminhado ao Conselho", "Em pauta de julgamento"],
};
const MIN_ETAPA = 2;

// ── Estado por navegador ────────────────────────────────────────────────────
const chaveEstado = (t, sess, p) => `sim:${t.slug}:${sess}:${p}`;
async function lerEstado(t, sess, p) {
  try { return JSON.parse((await kvGetStr(chaveEstado(t, sess, p))) || "null") || { pagos: {}, guias: [], protocolos: [], agendamentos: [] }; }
  catch { return { pagos: {}, guias: [], protocolos: [], agendamentos: [] }; }
}
const gravarEstado = (t, sess, p, e) => kvSetEx(chaveEstado(t, sess, p), JSON.stringify(e), TTL);

function andamento(p) {
  if (p.etapasFixas) return p.etapasFixas.map((nome, i) => ({ nome, feito: true, atual: i === p.etapasFixas.length - 1 }));
  const chave = /^Recurso ao (?!JARI)/.test(p.tipo) ? "Recurso ao CETRAN" : p.tipo;
  const etapas = ETAPAS[chave] || ["Protocolado", "Em análise", "Concluído"];
  const n = Math.min(etapas.length, 1 + Math.floor((Date.now() - new Date(p.criadoEm)) / (MIN_ETAPA * 60000)));
  return etapas.map((nome, i) => ({ nome, feito: i < n, atual: i === n - 1, em: i < n ? new Date(new Date(p.criadoEm).getTime() + i * MIN_ETAPA * 60000).toISOString() : null }));
}

// Monta o "Meu DETRAN" do cidadão fictício, aplicando o que ele já fez nesta simulação.
export async function painel(t, sess, pid) {
  const p = personas(t).find((x) => x.id === pid); if (!p) return null;
  const e = await lerEstado(t, sess, pid);
  const debitos = p.debitos.map((d) => {
    const pago = e.pagos[d.id];
    const vencido = !pago && d.vencimento < iso(Date.now());
    const juros = vencido && d.tipo !== "MULTA" ? Math.round(d.valor * 0.0033 * Math.max(1, Math.round((Date.now() - new Date(d.vencimento)) / DIA)) * 100) / 100 : 0;
    const desconto = !vencido && d.tipo === "MULTA" ? Math.round(d.valor * 0.2 * 100) / 100 : 0;
    return { ...d, situacao: pago ? "PAGO" : vencido ? "VENCIDO" : "A VENCER", pagoEm: pago?.em || null, juros, desconto, total: Math.round((d.valor + juros - desconto) * 100) / 100 };
  });
  const emAberto = debitos.filter((d) => d.situacao !== "PAGO");
  const licPago = !p.debitos.find((d) => d.id === "lic") || e.pagos.lic;
  const veiculo = { ...p.veiculo, licenciadoAte: licPago ? String(new Date().getFullYear()) : p.veiculo.licenciadoAte, restricoes: p.veiculo.restricoes.filter((r) => !(licPago && /Licenciamento/.test(r))) };
  const protocolos = [...p.protocolos, ...e.protocolos].map((x) => ({ numero: x.numero, tipo: x.tipo, criadoEm: x.criadoEm, obs: x.obs || null, etapas: andamento(x) }));
  return {
    simulacao: true, orgaos: orgaosDe(t),
    cidadao: { id: p.id, nome: p.nome + " (fictício)", cpf: p.cpf },
    veiculo, cnh: p.cnh, infracoes: p.infracoes, processosCnh: p.processosCnh,
    debitos, totalEmAberto: Math.round(emAberto.reduce((s, d) => s + d.total, 0) * 100) / 100,
    pagos: [...p.pagos, ...debitos.filter((d) => d.situacao === "PAGO").map((d) => ({ id: d.id, tipo: d.tipo, desc: d.desc, valor: d.total, pagoEm: d.pagoEm }))],
    guias: e.guias, protocolos, agendamentos: e.agendamentos,
  };
}

// Texto curto para o assistente do chat responder com os dados do cidadão fictício.
export async function contextoParaChat(t, sess, pid) {
  const d = await painel(t, sess, pid); if (!d) return "";
  const deb = d.debitos.filter((x) => x.situacao !== "PAGO").map((x) => `- ${x.desc}: ${brl(x.total)} (${x.situacao.toLowerCase()}, vence ${x.vencimento.split("-").reverse().join("/")}${x.desconto ? `, já com 20% de desconto se pagar até o vencimento` : ""}${x.juros ? `, com ${brl(x.juros)} de acréscimo` : ""})`).join("\n") || "- nenhum";
  return `\n\nSIMULAÇÃO DE INTEGRAÇÕES (demonstração; dados FICTÍCIOS do cidadão escolhido na tela "Meu DETRAN"):
Cidadão: ${d.cidadao.nome}. Veículo ${d.veiculo.modelo} placa ${d.veiculo.placa}, ${d.veiculo.situacao}, licenciado até ${d.veiculo.licenciadoAte}. Restrições: ${d.veiculo.restricoes.join("; ") || "nenhuma"}. Recall: ${d.veiculo.recall.join("; ") || "nenhum"}.
CNH categoria ${d.cnh.categoria}, situação ${d.cnh.situacao}, validade ${d.cnh.validade.split("-").reverse().join("/")}, ${d.cnh.pontos} pontos nos últimos 12 meses. ${d.cnh.observacoes}
Infrações: ${d.infracoes.map((i) => `${i.desc} (${i.natureza}, ${i.pontos} pts, ${i.orgao}, ${i.fase})`).join("; ") || "nenhuma"}.
Débitos em aberto (total ${brl(d.totalEmAberto)}):\n${deb}
Processos: ${d.protocolos.map((p) => `${p.numero} ${p.tipo} — ${p.etapas.filter((e) => e.feito).pop()?.nome}`).join("; ") || "nenhum"}.
Agendamentos: ${d.agendamentos.map((a) => `${a.servico} em ${a.unidadeNome}, ${a.data.split("-").reverse().join("/")} ${a.hora}`).join("; ") || "nenhum"}.
Ao responder sobre a situação desta pessoa, use ESTES dados, deixe claro que é uma simulação com dados fictícios e indique a tela "Meu DETRAN (simulação)" para emitir guia, pagar, protocolar ou agendar.`;
}

// ── Agenda e filas (determinísticas: mudam com o tempo, iguais para todos) ──
function horarios(t, unidade, data) {
  const out = [];
  const dow = new Date(data + "T12:00:00Z").getUTCDay();
  if (dow === 0) return out;
  const fim = dow === 6 ? 12 : 17;
  for (let h = 8; h < fim; h++) for (const m of [0, 20, 40]) {
    const hora = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    out.push({ hora, livre: hash(`${t.slug}|${unidade}|${data}|${hora}`) % 100 > 62 });
  }
  return out;
}
export function filas(t) {
  const o = orgaosDe(t);
  const agora = new Date();
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora)) % 24;
  const minuto = Math.floor(agora.getTime() / 60000);
  const pico = h >= 8 && h < 18 ? 1 - Math.abs(h - 11.5) / 8 : 0.05;
  return o.unidades.map((u, i) => {
    const base = 6 + (hash(u.id + t.slug) % 18);
    const ruido = (hash(`${u.id}|${minuto}`) % 7) - 3;
    const aguardando = Math.max(0, Math.round(base * pico * 1.5 + ruido));
    const guiches = 4 + (hash(u.id) % 8);
    const abertos = h >= 8 && h < 18 ? Math.max(2, guiches - (hash(`${u.id}|${Math.floor(minuto / 30)}`) % 3)) : 0;
    const espera = abertos ? Math.round((aguardando / abertos) * 6 + (hash(`${u.id}|e|${minuto}`) % 4)) : 0;
    return { ...u, aberta: abertos > 0, aguardando, guichesAbertos: abertos, guiches, esperaMin: espera, atendidosHoje: Math.round(base * 12 * Math.min(1, Math.max(0, (h - 8) / 9))) + (hash(`${u.id}|${agora.toDateString()}`) % 20), status: !abertos ? "Fechada" : espera > 40 ? "Lotada" : espera > 20 ? "Movimentada" : "Tranquila" };
  });
}
export function integracoes(t) {
  const o = orgaosDe(t);
  const min = Math.floor(Date.now() / 60000);
  const itens = [
    ["SENATRAN — RENAVAM", "Cadastro nacional de veículos"], ["SENATRAN — RENACH", "Cadastro nacional de condutores"], ["SENATRAN — RENAINF", "Infrações interestaduais"],
    [`${o.fazendaSigla} — IPVA`, "Débitos e guias de IPVA"], ["Arrecadação bancária / PIX", "Baixa de pagamentos"],
    ["ECV credenciadas — vistoria", "Laudos de vistoria"], [`${o.rodovias}`, "Multas em rodovias estaduais"], [`${o.municipal}`, "Multas municipais"],
    ["Agenda das unidades", `Vagas ${o.unidades.map((u) => u.tipo).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}`],
  ];
  return itens.map(([nome, desc]) => {
    const r = hash(`${t.slug}|${nome}|${Math.floor(min / 10)}`) % 100;
    const status = r > 93 ? "Instável" : "Operacional";
    return { nome, desc, status, latenciaMs: 80 + (hash(`${nome}|${min}`) % (status === "Operacional" ? 260 : 1800)), ultimaSync: new Date(Date.now() - (hash(`${nome}|s|${min}`) % 90) * 1000).toISOString(), chamadasHoje: 1200 + (hash(`${t.slug}|${nome}|${new Date().toDateString()}`) % 9000) };
  });
}

// ── Rotas ───────────────────────────────────────────────────────────────────
export function registrarSimulacao(app) {
  const S = "/api/t/:slug/sim";
  const so = (req, res, next) => (req.tenant.demonstracao ? next() : res.status(404).json({ error: "Simulação disponível só em ambiente de demonstração." }));
  const sess = (req) => String(req.headers["x-sim-sessao"] || "").replace(/[^\w-]/g, "").slice(0, 40) || "anon";
  const pid = (req, res) => { const p = personas(req.tenant).find((x) => x.id === req.params.p); if (!p) res.status(404).json({ error: "Cidadão fictício não encontrado." }); return p; };
  const mw = [comTenant, so];

  app.get(S, ...mw, (req, res) => {
    const o = orgaosDe(req.tenant);
    res.json({ simulacao: true, orgaos: o, servicosAgenda: SERVICOS_AGENDA, tiposProtocolo: Object.keys(ETAPAS).map((k) => (k === "Recurso ao CETRAN" ? `Recurso ao ${o.conselho}` : k)),
      cidadaos: personas(req.tenant).map((p) => ({ id: p.id, nome: p.nome + " (fictício)", resumo: p.resumo, placa: p.veiculo.placa })) });
  });
  app.get(`${S}/filas`, ...mw, (req, res) => res.json({ simulacao: true, atualizadoEm: new Date().toISOString(), unidades: filas(req.tenant) }));
  app.get(`${S}/integracoes`, ...mw, (req, res) => res.json({ simulacao: true, itens: integracoes(req.tenant) }));
  app.get(`${S}/unidades/:u/horarios`, ...mw, (req, res) => {
    const u = orgaosDe(req.tenant).unidades.find((x) => x.id === req.params.u);
    const data = String(req.query.data || "");
    if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ error: "Unidade ou data inválida." });
    if (data < iso(Date.now()) || data > iso(addDias(30))) return res.status(400).json({ error: "Escolha uma data nos próximos 30 dias." });
    res.json({ simulacao: true, horarios: horarios(req.tenant, u.id, data) });
  });

  app.get(`${S}/:p`, ...mw, async (req, res) => { if (!pid(req, res)) return; res.json(await painel(req.tenant, sess(req), req.params.p)); });

  // Guia (DAE) com os débitos escolhidos.
  app.post(`${S}/:p/guias`, ...mw, async (req, res) => {
    if (!pid(req, res)) return;
    const d = await painel(req.tenant, sess(req), req.params.p);
    const ids = Array.isArray(req.body?.debitos) ? req.body.debitos : [];
    const itens = d.debitos.filter((x) => ids.includes(x.id) && x.situacao !== "PAGO");
    if (!itens.length) return res.status(400).json({ error: "Escolha ao menos um débito em aberto." });
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    const numero = `SIM${String(Date.now()).slice(-10)}`;
    const total = Math.round(itens.reduce((s, x) => s + x.total, 0) * 100) / 100;
    const guia = {
      numero, criadaEm: new Date().toISOString(), vencimento: iso(addDias(3)), total, situacao: "EMITIDA",
      itens: itens.map((x) => ({ id: x.id, desc: x.desc, valor: x.total, orgao: x.orgao })),
      linhaDigitavel: "SIMULAÇÃO SEM VALOR 00000.00000 00000.000000 00000.000000 0 00000000000000",
      pixCopiaECola: `SIMULACAO-SEM-VALOR-${randomBytes(6).toString("hex").toUpperCase()}`,
    };
    e.guias.unshift(guia); e.guias = e.guias.slice(0, 20);
    await gravarEstado(req.tenant, sess(req), req.params.p, e);
    res.status(201).json({ simulacao: true, guia });
  });

  // "Pagamento" simulado: baixa os débitos da guia e devolve o comprovante.
  app.post(`${S}/:p/guias/:n/pagar`, ...mw, async (req, res) => {
    if (!pid(req, res)) return;
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    const g = e.guias.find((x) => x.numero === req.params.n);
    if (!g) return res.status(404).json({ error: "Guia não encontrada nesta simulação." });
    if (g.situacao === "PAGA") return res.json({ simulacao: true, guia: g });
    const agora = new Date().toISOString();
    g.situacao = "PAGA"; g.pagaEm = agora; g.autenticacao = `SIM-${randomBytes(5).toString("hex").toUpperCase()}`;
    for (const it of g.itens) e.pagos[it.id] = { em: agora.slice(0, 10), guia: g.numero };
    await gravarEstado(req.tenant, sess(req), req.params.p, e);
    res.json({ simulacao: true, guia: g });
  });

  app.post(`${S}/:p/protocolos`, ...mw, async (req, res) => {
    if (!pid(req, res)) return;
    const o = orgaosDe(req.tenant);
    let tipo = String(req.body?.tipo || "");
    if (tipo === `Recurso ao ${o.conselho}`) tipo = "Recurso ao CETRAN";
    if (!ETAPAS[tipo]) return res.status(400).json({ error: "Tipo de serviço inválido." });
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    const numero = `SIM-${o.uf}-${new Date().getFullYear()}-${String(hash(Date.now() + Math.random()) % 9000000 + 1000000)}`;
    const p = { numero, tipo: tipo === "Recurso ao CETRAN" ? `Recurso ao ${o.conselho}` : tipo, criadoEm: new Date().toISOString() };
    e.protocolos.unshift(p); e.protocolos = e.protocolos.slice(0, 20);
    await gravarEstado(req.tenant, sess(req), req.params.p, e);
    res.status(201).json({ simulacao: true, protocolo: { ...p, etapas: andamento({ ...p, tipo }) } });
  });

  async function salvarAgendamento(req, res, existente) {
    const o = orgaosDe(req.tenant);
    const u = o.unidades.find((x) => x.id === req.body?.unidade) || (existente && o.unidades.find((x) => x.id === existente.unidade));
    const data = String(req.body?.data || ""), hora = String(req.body?.hora || "");
    const servico = existente ? existente.servico : String(req.body?.servico || "");
    if (!u || !SERVICOS_AGENDA.includes(servico)) return res.status(400).json({ error: "Escolha a unidade e o serviço." });
    const livre = /^\d{4}-\d{2}-\d{2}$/.test(data) && horarios(req.tenant, u.id, data).find((h) => h.hora === hora && h.livre);
    if (!livre || data < iso(Date.now())) return res.status(409).json({ error: "Esse horário não está mais disponível. Escolha outro." });
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    if (existente) Object.assign(e.agendamentos.find((a) => a.codigo === existente.codigo), { unidade: u.id, unidadeNome: u.nome, data, hora, remarcadoEm: new Date().toISOString() });
    else e.agendamentos.unshift({ codigo: `SIM-AG-${randomBytes(3).toString("hex").toUpperCase()}`, servico, unidade: u.id, unidadeNome: u.nome, cidade: u.cidade, data, hora, situacao: "CONFIRMADO", criadoEm: new Date().toISOString() });
    await gravarEstado(req.tenant, sess(req), req.params.p, e);
    res.status(existente ? 200 : 201).json({ simulacao: true, agendamentos: e.agendamentos });
  }
  app.post(`${S}/:p/agendamentos`, ...mw, async (req, res) => { if (!pid(req, res)) return; salvarAgendamento(req, res, null); });
  app.put(`${S}/:p/agendamentos/:c`, ...mw, async (req, res) => {
    if (!pid(req, res)) return;
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    const a = e.agendamentos.find((x) => x.codigo === req.params.c && x.situacao === "CONFIRMADO");
    if (!a) return res.status(404).json({ error: "Agendamento não encontrado." });
    salvarAgendamento(req, res, a);
  });
  app.delete(`${S}/:p/agendamentos/:c`, ...mw, async (req, res) => {
    if (!pid(req, res)) return;
    const e = await lerEstado(req.tenant, sess(req), req.params.p);
    const a = e.agendamentos.find((x) => x.codigo === req.params.c);
    if (!a) return res.status(404).json({ error: "Agendamento não encontrado." });
    a.situacao = "CANCELADO"; a.canceladoEm = new Date().toISOString();
    await gravarEstado(req.tenant, sess(req), req.params.p, e);
    res.json({ simulacao: true, agendamentos: e.agendamentos });
  });
}
