// Antigolpe: o cidadão cola a mensagem, o link ou o código do boleto que recebeu
// e o sistema aponta sinais de golpe ANTES de ele pagar.
//
// Regras determinísticas (sem IA): domínio do link, encurtador, pedido de PIX,
// senha ou código, ameaça/urgência, desconto fora do normal e a linha digitável
// (tipo de guia, segmento e dígitos verificadores). Nunca diz "é seguro": no
// melhor caso, "não achei sinais de golpe — confira no canal oficial".

const ENCURTADORES = ["bit.ly", "tinyurl.com", "cutt.ly", "encurtador.com.br", "rb.gy", "is.gd", "t.co", "ow.ly",
  "shorturl.at", "s.id", "tiny.cc", "u.to", "abre.ai", "l1nk.dev", "migre.me", "goo.gl", "t.ly", "short.gy", "linktr.ee"];
const TLDS_SUSPEITOS = [".xyz", ".top", ".click", ".online", ".site", ".shop", ".icu", ".live", ".buzz", ".store", ".info",
  ".fun", ".vip", ".monster", ".rest", ".cfd", ".sbs", ".lol", ".link", ".app"];
// Bancos digitais/intermediadores muito usados em boleto de golpe (taxa de órgão
// público não costuma ser emitida por eles).
const BANCOS = {
  "001": "Banco do Brasil", "104": "Caixa", "237": "Bradesco", "341": "Itaú", "033": "Santander", "037": "Banpará",
  "070": "BRB", "756": "Sicoob", "748": "Sicredi", "041": "Banrisul", "004": "Banco do Nordeste", "021": "Banestes",
  "260": "Nubank", "077": "Inter", "336": "C6 Bank", "290": "PagSeguro/PagBank", "323": "Mercado Pago",
  "380": "PicPay", "197": "Stone", "403": "Cora", "212": "Banco Original", "208": "BTG Pactual", "655": "Neon/Votorantim",
};
const BANCOS_DIGITAIS = new Set(["260", "077", "336", "290", "323", "380", "197", "403", "212", "655"]);
const SEGMENTOS = { 1: "prefeitura", 2: "saneamento", 3: "energia elétrica ou gás", 4: "telecomunicações",
  5: "órgão do governo", 6: "carnê/empresa", 7: "multa de trânsito", 9: "uso do banco" };

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── Dígitos verificadores ───────────────────────────────────────────────────
export function mod10(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    let p = Number(num[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p; peso = peso === 2 ? 1 : 2;
  }
  const r = soma % 10;
  return r === 0 ? 0 : 10 - r;
}
function mod11Arrecadacao(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r === 0 || r === 1 ? 0 : r === 10 ? 1 : 11 - r;
}
function mod11Boleto(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = 11 - (soma % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

const reais = (centavos) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Linha digitável: 48 dígitos começando com 8 = guia de arrecadação (tributos,
// taxas, multas); 47 dígitos = boleto bancário comum.
export function analisarLinhaDigitavel(digitos) {
  const d = String(digitos || "").replace(/\D/g, "");
  if (d.length === 48 && d[0] === "8") {
    const blocos = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 12));
    const ref = d[2];
    const fn = ref === "6" || ref === "7" ? mod10 : ref === "8" || ref === "9" ? mod11Arrecadacao : null;
    const dvOk = fn ? blocos.every((b) => fn(b.slice(0, 11)) === Number(b[11])) : false;
    const barras = blocos.map((b) => b.slice(0, 11)).join("");
    const valor = ref === "6" || ref === "8" ? Number(barras.slice(4, 15)) : null;
    const seg = Number(d[1]);
    return { tipo: "arrecadacao", valido: dvOk, segmento: seg, segmentoNome: SEGMENTOS[seg] || "desconhecido", valorCentavos: valor };
  }
  if (d.length === 47) {
    const c1 = d.slice(0, 10), c2 = d.slice(10, 21), c3 = d.slice(21, 32);
    const camposOk = mod10(c1.slice(0, 9)) === Number(c1[9]) && mod10(c2.slice(0, 10)) === Number(c2[10]) && mod10(c3.slice(0, 10)) === Number(c3[10]);
    const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + c1.slice(4, 9) + c2.slice(0, 10) + c3.slice(0, 10);
    const geralOk = mod11Boleto(barras.slice(0, 4) + barras.slice(5)) === Number(barras[4]);
    const banco = d.slice(0, 3);
    return { tipo: "boleto", valido: camposOk && geralOk, banco, bancoNome: BANCOS[banco] || `banco ${banco}`,
      bancoDigital: BANCOS_DIGITAIS.has(banco), valorCentavos: Number(d.slice(37, 47)) || null };
  }
  return null;
}

function extrairLinhas(texto) {
  const out = new Set();
  const re = /(?:\d[\d.\s-]{40,70}\d)/g;
  for (const m of String(texto).match(re) || []) {
    const d = m.replace(/\D/g, "");
    if (d.length === 47 || d.length === 48) out.add(d);
  }
  return [...out];
}

function extrairLinks(texto) {
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"')]+|[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{2,63})*\.(?:com|net|org|br|xyz|top|click|online|site|shop|icu|live|buzz|store|info|fun|vip|app|link|me|io|co|ly|gl|cc|to|gy)(?:\/[^\s<>"')]*)?)/gi;
  const out = [];
  const semEmail = String(texto).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, " ");
  for (const m of semEmail.match(re) || []) {
    let u = m.replace(/[.,;:!?]+$/, "");
    if (/@/.test(u)) continue; // e-mail, não link
    try {
      const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
      out.push({ bruto: u, host: url.hostname.toLowerCase().replace(/^www\./, ""), https: /^https:\/\//i.test(u) });
    } catch (_) { /* ignora */ }
  }
  const vistos = new Set();
  return out.filter((l) => (vistos.has(l.host) ? false : vistos.add(l.host)));
}

// Domínios oficiais: *.gov.br, o portal do DETRAN e o próprio assistente.
export function dominiosOficiais(tenant, extras = []) {
  const lista = new Set(["gov.br"]);
  for (const u of [tenant?.portalUrl, process.env.PUBLIC_URL, ...extras]) {
    try { if (u) lista.add(new URL(u).hostname.toLowerCase().replace(/^www\./, "")); } catch (_) {}
  }
  return [...lista];
}
const ehOficial = (host, oficiais) => oficiais.some((d) => host === d || host.endsWith(`.${d}`));

// ── Análise principal ───────────────────────────────────────────────────────
export function analisarSuspeita(texto, tenant, opts = {}) {
  const t = String(texto || "").slice(0, 6000);
  const n = norm(t);
  const sigla = tenant?.sigla || "DETRAN";
  const oficiais = dominiosOficiais(tenant, opts.dominiosExtras || []);
  const sinais = [];
  const add = (peso, txt) => sinais.push({ peso, texto: txt });

  const links = extrairLinks(t);
  for (const l of links) {
    if (ehOficial(l.host, oficiais)) { l.oficial = true; continue; }
    if (ENCURTADORES.some((e) => l.host === e || l.host.endsWith(`.${e}`))) add(3, `Link encurtado (${l.host}) — esconde o endereço verdadeiro. Órgão público não manda cobrança assim.`);
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(l.host)) add(3, `Link para um número de IP (${l.host}), não para um site oficial.`);
    else if (l.host.startsWith("xn--") || l.host.includes(".xn--")) add(3, `Endereço com letras disfarçadas (${l.host}).`);
    else if (/detran|denatran|senatran|multa|ipva|licenciamento|cnh|gov|sefa|sefaz|transito/.test(l.host)) add(3, `O link (${l.host}) imita um órgão de trânsito, mas NÃO termina em .gov.br.`);
    else if (TLDS_SUSPEITOS.some((s) => l.host.endsWith(s))) add(2, `Endereço com final incomum para órgão público (${l.host}).`);
    else add(1, `O link (${l.host}) não é de um site oficial do governo.`);
    if (!l.https && /^http:\/\//i.test(l.bruto)) add(1, "O link não usa conexão segura (https).");
  }

  const linhas = extrairLinhas(t).map(analisarLinhaDigitavel).filter(Boolean);
  for (const b of linhas) {
    if (!b.valido) add(2, "O código de barras tem dígito verificador errado: pode ser erro de digitação ou boleto adulterado.");
    if (b.tipo === "arrecadacao") {
      if (![5, 7].includes(b.segmento)) add(2, `É uma guia de ${b.segmentoNome}, não de órgão do governo ou multa de trânsito.`);
    } else if (b.tipo === "boleto") {
      if (b.bancoDigital) add(3, `Boleto bancário emitido por ${b.bancoNome}. Taxas e multas do ${sigla} não costumam ser cobradas por conta de banco digital.`);
      else add(1, `É um boleto bancário comum (${b.bancoNome}). Confira se o beneficiário é o órgão público, e não uma pessoa ou empresa.`);
    }
  }

  const tem = (arr) => arr.some((p) => n.includes(p));
  if (/chave pix|pix copia e cola|via pix|pelo pix|no pix|faca o pix|faz o pix|pague (o |com )?pix/.test(n)) add(3, "Pede pagamento por PIX numa mensagem. Pagamento ao órgão é feito pela guia oficial emitida no portal.");
  if (/(chave|pix)[^\n]{0,30}(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\(?\d{2}\)?\s?9?\d{4}-?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+)/i.test(t)) add(3, "A chave PIX é um CPF, telefone ou e-mail — de pessoa, não do órgão.");
  if (tem(["senha", "codigo de verificacao", "codigo que voce recebeu", "codigo enviado", "token", "numero do cartao", "cvv", "dados do cartao", "codigo de seguranca"])) add(3, "Pede senha, código ou dados de cartão. Nenhum órgão pede isso por mensagem.");
  if (/(desconto|abatimento)[^\n]{0,25}(50|60|70|80|90)\s?%|(50|60|70|80|90)\s?%[^\n]{0,25}(desconto|off)/.test(n)) add(2, "Promete desconto alto. O desconto oficial de multa é de 20% (ou 40% pelo app SNE, quando aderido).");
  if (tem(["bloqueio", "bloqueada", "bloqueado", "suspensao imediata", "sera suspensa", "apreensao", "sera apreendido", "cancelamento da cnh", "ultimo aviso", "ultimas horas", "hoje ainda", "evite", "imediatamente", "protesto em cartorio", "negativacao", "nome sujo"])) add(1, "Usa ameaça ou pressa (bloqueio, apreensão, último aviso) para você pagar sem pensar.");
  if (tem(["clique no link", "acesse o link", "regularize pelo link", "pague pelo link", "regularize agora"])) add(1, "Manda resolver tudo por um link da própria mensagem.");
  if (tem(["whatsapp", "zap"]) && tem(["multa", "debito", "ipva", "licenciamento"]) && tem(["pague", "pagar", "quitar", "regularizar"])) add(1, "Cobrança chegando por WhatsApp. Confirme sempre no portal oficial antes de pagar.");

  const evidencia = links.length > 0 || linhas.length > 0 || sinais.length > 0;
  const score = sinais.reduce((s, x) => s + x.peso, 0);
  const forte = sinais.some((x) => x.peso >= 3);
  const nivel = !evidencia ? "sem_dados" : forte || score >= 4 ? "golpe" : score >= 1 ? "atencao" : "sem_sinais";

  const oficialTxt = tenant?.portalUrl ? `o portal oficial ${tenant.portalUrl}` : `o portal oficial do ${sigla}`;
  const oQueFazer = nivel === "sem_dados"
    ? [`Cole aqui o texto da mensagem, o link ou o número do código de barras que você recebeu.`]
    : [
        nivel === "golpe" ? "NÃO pague e não clique no link." : "Antes de pagar, confira o débito por conta própria.",
        `Consulte seus débitos digitando você mesmo o endereço do portal oficial${tenant?.portalUrl ? ` (${tenant.portalUrl})` : ` do ${sigla}`}${tenant?.telefone ? ` ou ligue ${tenant.telefone}` : ""} — não use o link da mensagem.`,
        "Na guia, confira o beneficiário: deve ser o órgão público (DETRAN, Secretaria da Fazenda ou Governo do Estado).",
        ...(nivel === "golpe" ? ["Se já pagou, procure seu banco na hora (peça a contestação/MED do PIX) e registre boletim de ocorrência."] : []),
      ];
  const titulo = { golpe: "Muito provável que seja GOLPE", atencao: "Atenção: há sinais suspeitos", sem_sinais: "Não achei sinais de golpe", sem_dados: "Preciso ver a mensagem" }[nivel];
  const resumoBoletos = linhas.map((b) => ({
    tipo: b.tipo === "arrecadacao" ? `Guia de arrecadação (${b.segmentoNome})` : `Boleto bancário (${b.bancoNome})`,
    valido: b.valido, valor: b.valorCentavos ? reais(b.valorCentavos) : null,
  }));
  return {
    nivel, titulo, sinais: sinais.sort((a, b) => b.peso - a.peso).map((s) => s.texto), oQueFazer,
    links: links.map((l) => ({ host: l.host, oficial: Boolean(l.oficial) })), boletos: resumoBoletos,
    aviso: nivel === "sem_sinais" ? `Isso não garante que é verdadeiro: na dúvida, confira em ${oficialTxt}.` : null,
  };
}

// Quando a mensagem do chat é um pedido de verificação (tem link, código de
// barras ou pergunta "é golpe?" com a mensagem colada).
export function pareceVerificacao(texto) {
  const t = String(texto || "");
  const n = norm(t);
  if (extrairLinhas(t).length) return true;
  const perguntaGolpe = /\bgolpe|\bfraude|\bverdadeir|\bfalso\b|\bfalsa\b|\bconfiavel|\blegitim|\bseguro (esse|este|isso)|e do detran\?/.test(n);
  if (extrairLinks(t).some((l) => !/gov\.br$/.test(l.host)) && (perguntaGolpe || /pag|multa|debito|ipva|licenc|cnh|regulariz|boleto|pix/.test(n))) return true;
  return perguntaGolpe && t.length >= 80 && /pag|pix|link|boleto|multa|debito|ipva/.test(n);
}

// Texto pronto para o chat do site / WhatsApp (partes separadas por [[BREAK]]).
// Negrito: "**" no site, "*" no WhatsApp.
export function textoParaChat(r, { negrito = "**" } = {}) {
  const icone = { golpe: "🚨", atencao: "⚠️", sem_sinais: "✅", sem_dados: "🔎" }[r.nivel];
  const partes = [`${icone} ${negrito}${r.titulo}${negrito}`];
  if (r.sinais.length) partes.push(`O que eu encontrei:\n${r.sinais.slice(0, 6).map((s) => `• ${s}`).join("\n")}`);
  if (r.boletos.length) partes.push(r.boletos.map((b) => `• ${b.tipo}${b.valor ? ` — valor ${b.valor}` : ""}${b.valido ? "" : " — código com erro"}`).join("\n"));
  partes.push(`O que fazer:\n${r.oQueFazer.map((s) => `• ${s}`).join("\n")}`);
  if (r.aviso) partes.push(r.aviso);
  return partes.join("\n[[BREAK]]\n");
}
