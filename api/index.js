// ─────────────────────────────────────────────────────────────────────────────
// Aplicação Express do Assistente DETRAN-PA.
//
// Roda local (server.js chama app.listen) e no Vercel (export default = função).
// A chave da Anthropic vive só no servidor. O navegador fala apenas com /api/*.
//
// Sala do Tutor: conhecimento ensinado por senha (texto ou documento). Documentos
// grandes são aceitos; na conversa, só os trechos relevantes à pergunta são
// enviados ao assistente (store.js → buildTutorContext).
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import express from "express";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FORMS, FORM_INDEX } from "../forms-data.js";
import { storageMode, listEntries, addEntry, updateEntry, deleteEntry, buildTutorContext, logGap, listGaps, clearGaps } from "../store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 2048);
const TUTOR_PASSWORD = process.env.TUTOR_PASSWORD || "";

const MAX_MESSAGES = 24;
const MAX_CHARS_PER_MSG = 4000;
const MAX_ENTRY_CHARS = 120000; // documentos bem maiores são aceitos
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;

// ── Base de conhecimento estática (pasta /knowledge) ────────────────────────
function carregarBaseConhecimento() {
  const dir = join(ROOT, "knowledge");
  if (!existsSync(dir)) { console.warn("[aviso] Pasta /knowledge não encontrada."); return ""; }
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  return arquivos
    .map((f) => `\n\n===== ARQUIVO: ${f} =====\n\n${readFileSync(join(dir, f), "utf8")}`)
    .join("");
}

const BASE_CONHECIMENTO = carregarBaseConhecimento();
const LISTA_FORMS = FORM_INDEX.map((f) => `   - ${f.id}: ${f.title} — ${f.desc}`).join("\n");

const SYSTEM_PROMPT = `Você é o "Assistente DETRAN-PA", um atendente virtual que ajuda os cidadãos do Pará a entender e resolver os serviços do Departamento de Trânsito do Estado (habilitação/CNH, veículos, multas e licenciamento).

PÚBLICO: pessoas leigas, que não conhecem os termos técnicos do trânsito. Escreva como se estivesse explicando com calma para alguém que nunca lidou com o DETRAN.

TOM PARAENSE (o jeito de falar):
- Fale com o jeitão acolhedor e caloroso do paraense, de Belém do Pará — como quem ajuda um vizinho, um parente.
- Use o tratamento "tu", conjugando de forma natural: "tu precisa", "tu vai", "tu pode", "tu já tem", "se tu quiser".
- Pode usar, com naturalidade e SEM exagero, expressões típicas da região, como: "égua", "arre égua" (surpresa), "pai d'égua" (muito bom/excelente), "vixe", "rapaz", "parente", "mana"/"maninho", "bora", "partiu", "tá ligado?", "no capricho". Use 1 ou 2 por resposta, no máximo — é tempero, não é o prato.
- Comece de um jeito caloroso quando fizer sentido (ex.: "Égua, parente, bora resolver isso!" ou "Salve! Deixa eu te explicar...").
- IMPORTANTE: a gíria NUNCA pode atrapalhar o entendimento. Documentos, prazos, valores e links têm que ficar claríssimos e corretos. Não vire caricatura nem force a barra.
- Em assuntos delicados (multa, prazo curto, perda de documento, algo que dá dor de cabeça), pega leve no regionalismo e foca em acolher e ajudar com cuidado.

ENTREGA EM PARTES (como uma pessoa conversando no WhatsApp):
- Responda como gente de verdade conversa: em vez de um textão só, quebre a resposta em mensagens CURTAS, enviadas uma depois da outra.
- Separe cada mensagem com uma linha contendo APENAS o marcador: [[BREAK]]
- Cada parte deve ser curta: 1 a 3 frases, ou uma listinha pequena. Para pergunta simples, 1 parte basta. Para explicação com passo a passo, use de 2 a 4 partes (raramente mais que isso).
- Não avise que vai dividir; apenas mande as mensagens naturalmente, como quem digita e envia várias vezes.
- Não exagere: não pique demais nem deixe partes com uma palavra só.

COMO RESPONDER (linguagem simples e detalhada):
1. Responda SEMPRE em português do Brasil, no jeito paraense (tratamento "tu"), com tom acolhedor, paciente e gentil.
2. Use palavras do dia a dia. Evite "juridiquês" e termos técnicos; quando precisar usar uma sigla ou termo do trânsito, EXPLIQUE entre parênteses na primeira vez. Exemplos:
   - CNH (a carteira de motorista)
   - CRLV (o documento anual do veículo, que prova que ele está licenciado)
   - CRV (o antigo "documento/recibo" do carro, usado para passar o veículo para outra pessoa)
   - ATPV-e (a autorização digital para transferir o veículo na hora da venda)
   - DAE (o boleto de pagamento das taxas do estado)
   - Portal Venus (o site do DETRAN onde tu contesta multas pela internet)
   - JARI (a junta que julga os recursos contra multas)
   - EAR (anotação na carteira de quem dirige trabalhando, tipo motorista de app, ônibus ou caminhão)
   - PPD (a carteira provisória, válida no primeiro ano)
3. Seja detalhado quando precisar, mas distribuído nas partes curtas. Em processos, explique o passo a passo (pode ser uma listinha numa das partes). Ao longo da resposta, cubra quando fizer sentido: o que é, documentos necessários, passo a passo, prazos (e o risco de perder o prazo), custo aproximado (só referência) e onde fazer / link oficial.
4. Quando a resposta for longa, feche com um resumo curto ("Resumindo:") numa das últimas partes, e ofereça o próximo passo ("Quer que eu te explique como fazer X?").
5. Se algo tem prazo curto ou risco de multa, destaque isso de forma clara.

REGRAS DE CONTEÚDO (não podem ser quebradas):
6. Baseie-se EXCLUSIVAMENTE na BASE DE CONHECIMENTO abaixo (incluindo o que o Tutor ensinou). NÃO invente taxas, prazos, documentos ou links. Se algo não estiver na base, diga com sinceridade que não tem essa informação específica e oriente a confirmar no portal https://www.detran.pa.gov.br ou pelo telefone 154.
7. Valores de taxas são apenas uma REFERÊNCIA — explique que o valor exato é o que aparece no boleto/DAE gerado no site oficial.
8. Encaminhe para o lugar certo:
   - IPVA, DPVAT e impostos do veículo NÃO são com o DETRAN, e sim com a SEFA-PA (Secretaria da Fazenda). Site: app.sefa.pa.gov.br/consulta-ipva — Telefone: 0800-725-5533.
   - Multas: o DETRAN só resolve as multas aplicadas por ele mesmo (pelo Portal Venus). Multas de rodovia estadual são com o DER-PA; de rodovia federal (BR), com a PRF; de ruas da cidade, com a Prefeitura/SEMOB. Explique isso de forma simples se o caso pedir.
   - Para contestar multa (defesa ou recurso): Portal Venus (cidadao.detran.pa.gov.br), com login da conta gov.br.
9. Inclua os links oficiais quando ajudarem.
10. Você é um assistente informativo: ajuda a entender e a se organizar, mas não substitui o atendimento oficial e não dá aconselhamento jurídico. Diga isso de forma leve quando for um caso mais delicado.

DOCUMENTOS QUE O USUÁRIO PODE PREENCHER NA TELA:
A interface tem um preenchedor de documentos. Quando UM destes formulários for claramente útil para o que a pessoa pediu (ex.: vender o veículo, comunicar a venda, declarar residência, dar procuração), inclua NO FINAL da resposta, em UMA LINHA ISOLADA, o marcador [[FORM:id]] com o id correto. Esse marcador vai sozinho na ÚLTIMA linha, depois de tudo (não precisa de [[BREAK]] antes dele). Regras: no máximo um [[FORM:id]] por resposta; só quando fizer sentido; nunca explique o marcador. Ids válidos:
${LISTA_FORMS}

ANÁLISE DE FOTOS/IMAGENS (quando o usuário enviar uma foto de documento):
- Identifique o tipo (Notificação de Autuação ou de Penalidade de multa, CRLV, CRV, boleto/DAE, CNH, comprovante etc.).
- Leia os dados visíveis (placa, RENAVAM, datas, valores, código/descrição da infração, prazos) e explique em linguagem simples, no tom paraense.
- Se for MULTA: diga em que fase está (Notificação de Autuação -> cabe Defesa Prévia; Notificação de Penalidade -> cabe Recurso à JARI), destaque o PRAZO e o risco de perdê-lo, e confira o órgão autuador (o Portal Venus só trata multas do próprio DETRAN-PA).
- Se for boleto/DAE: explique de que é a taxa e como pagar, lembrando que os valores mudam.
- NUNCA invente o que não estiver visível. Se algo estiver ilegível ou cortado, peça uma foto mais nítida ou de perto.


REGISTRO INTERNO (o usuário NÃO vê):
- Quando você NÃO encontrar a informação pedida na BASE DE CONHECIMENTO e tiver que orientar a pessoa a confirmar no portal oficial ou no telefone 154, acrescente ao final, sozinho em uma linha, o marcador [[SEMBASE]]. Ele é retirado antes de chegar ao usuário e serve só para o DETRAN mapear as dúvidas que faltam na base. NÃO use [[SEMBASE]] quando você respondeu com base na informação disponível.


BASE DE CONHECIMENTO:
${BASE_CONHECIMENTO}`;

// Junta a base estática com o conhecimento (trechos) do Tutor relevantes à pergunta.
function buildSystem(tutorTexto) {
  if (tutorTexto && tutorTexto.trim()) {
    return `${SYSTEM_PROMPT}

===== CONHECIMENTO ADICIONADO PELO TUTOR (trechos relevantes) =====
(Use com a mesma confiança da base oficial. Se contradisser a base oficial, prefira o que o Tutor ensinou, pois é mais recente. São apenas os trechos que parecem ligados à pergunta atual.)

${tutorTexto}`;
  }
  return SYSTEM_PROMPT;
}

// ── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(ROOT, "public")));

const hits = new Map();
function rateLimited(ip) {
  const agora = Date.now();
  const reg = hits.get(ip) || { count: 0, reset: agora + RATE_WINDOW_MS };
  if (agora > reg.reset) { reg.count = 0; reg.reset = agora + RATE_WINDOW_MS; }
  reg.count += 1; hits.set(ip, reg);
  return reg.count > RATE_MAX;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, keyConfigured: Boolean(API_KEY), tutor: Boolean(TUTOR_PASSWORD), storage: storageMode() });
});

// ── Catálogo de documentos preenchíveis ─────────────────────────────────────
app.get("/api/forms", (_req, res) => res.json({ forms: FORM_INDEX }));
app.get("/api/forms/:id", (req, res) => {
  const form = FORMS.find((f) => f.id === req.params.id);
  if (!form) return res.status(404).json({ error: "Documento não encontrado." });
  res.json({ form });
});

// ── Extrair dados da conversa para pré-preencher um documento ────────────────
app.post("/api/extract", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Servidor sem ANTHROPIC_API_KEY." });
  const { formId, messages } = req.body || {};
  const form = FORMS.find((f) => f.id === formId);
  if (!form) return res.status(404).json({ error: "Documento não encontrado." });

  const hist = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => {
      const c = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content) ? m.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : "";
      return `${m.role === "user" ? "Cidadão" : "Assistente"}: ${c}`;
    })
    .filter((l) => l.trim().length > 12)
    .slice(-20)
    .join("\n");
  if (!hist) return res.json({ values: {} });

  const campos = [];
  form.sections.forEach((sec) => sec.fields.forEach((f) => campos.push(f)));
  const esquema = campos.map((c) => {
    let l = `- ${c.key} (${c.label})`;
    if (c.type === "radio" && c.options) l += ` [escolha uma: ${c.options.join(" | ")}]`;
    if (c.type === "date") l += " [data AAAA-MM-DD]";
    return l;
  }).join("\n");

  const sys = `Você extrai dados de uma conversa para preencher o formulário "${form.title}" do DETRAN-PA.
Responda APENAS um objeto JSON no formato {"chave": "valor"} usando as CHAVES exatas listadas.
Regras:
- Use SOMENTE informações que o cidadão forneceu explicitamente. NÃO invente nem deduza.
- Se um campo não foi informado, NÃO inclua a chave.
- Campos de opção: use exatamente um dos valores entre colchetes.
- Datas no formato AAAA-MM-DD. Não escreva nada além do JSON.

CAMPOS DISPONÍVEIS:
${esquema}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: sys,
        messages: [{ role: "user", content: `CONVERSA:\n${hist}\n\nExtraia o JSON de preenchimento.` }] }),
    });
    if (!r.ok) return res.status(502).json({ error: "Falha ao extrair." });
    const data = await r.json();
    const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const mm = txt.match(/\{[\s\S]*\}/);
    let parsed = {};
    if (mm) { try { parsed = JSON.parse(mm[0]); } catch (_) {} }
    const byKey = new Map(campos.map((c) => [c.key, c]));
    const out = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      const campo = byKey.get(k);
      if (!campo || v == null) continue;
      const val = String(v).slice(0, 300);
      if (campo.type === "radio" && campo.options && !campo.options.includes(val)) continue;
      if (val.trim()) out[k] = val;
    }
    res.json({ values: out });
  } catch (e) {
    console.error("[extract]", e);
    res.status(500).json({ error: "Erro ao extrair." });
  }
});

// ── Sala do Tutor ───────────────────────────────────────────────────────────
function tutorAuth(req, res, next) {
  if (!TUTOR_PASSWORD) {
    return res.status(503).json({ error: "A Sala do Tutor está desativada. Defina TUTOR_PASSWORD nas variáveis de ambiente." });
  }
  const key = req.headers["x-tutor-key"];
  if (!key || key !== TUTOR_PASSWORD) {
    return res.status(401).json({ error: "Senha do tutor incorreta." });
  }
  next();
}
function persistError(res, err) {
  if (err && err.message === "PERSIST_NONE") {
    return res.status(503).json({ error: "Para salvar de forma permanente no Vercel, configure o armazenamento (Vercel KV / Upstash). Veja o DEPLOY.md." });
  }
  console.error("[tutor]", err);
  return res.status(500).json({ error: "Não foi possível salvar agora. Tente novamente." });
}

app.get("/api/tutor/status", (_req, res) => {
  res.json({ enabled: Boolean(TUTOR_PASSWORD), storage: storageMode() });
});

app.post("/api/tutor/auth", (req, res) => {
  if (!TUTOR_PASSWORD) return res.status(503).json({ error: "A Sala do Tutor está desativada. Defina TUTOR_PASSWORD nas variáveis de ambiente." });
  const { key } = req.body || {};
  if (key && key === TUTOR_PASSWORD) return res.json({ ok: true, storage: storageMode() });
  return res.status(401).json({ error: "Senha incorreta." });
});

// Lista com PRÉVIA (não manda o conteúdo inteiro dos documentos grandes)
app.get("/api/tutor/entries", tutorAuth, async (_req, res) => {
  try {
    const all = await listEntries();
    const entries = all.map((e) => ({
      id: e.id,
      title: e.title,
      source: e.source || "texto",
      chars: (e.content || "").length,
      preview: (e.content || "").slice(0, 600),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
    res.json({ entries, storage: storageMode() });
  } catch (err) { persistError(res, err); }
});

app.post("/api/tutor/entries", tutorAuth, async (req, res) => {
  const { title, content, source } = req.body || {};
  if (!title || !content || !String(title).trim() || !String(content).trim()) {
    return res.status(400).json({ error: "Informe o título e o conteúdo." });
  }
  if (String(content).length > MAX_ENTRY_CHARS) {
    return res.status(400).json({ error: `Conteúdo muito longo (máximo de ${MAX_ENTRY_CHARS.toLocaleString("pt-BR")} caracteres).` });
  }
  try { res.json({ entry: await addEntry({ title, content, source }) }); }
  catch (err) { persistError(res, err); }
});

app.put("/api/tutor/entries/:id", tutorAuth, async (req, res) => {
  const { title, content } = req.body || {};
  if (content != null && String(content).length > MAX_ENTRY_CHARS) {
    return res.status(400).json({ error: `Conteúdo muito longo (máximo de ${MAX_ENTRY_CHARS.toLocaleString("pt-BR")} caracteres).` });
  }
  try {
    const e = await updateEntry(req.params.id, { title, content });
    if (!e) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ entry: e });
  } catch (err) { persistError(res, err); }
});

app.delete("/api/tutor/entries/:id", tutorAuth, async (req, res) => {
  try {
    const ok = await deleteEntry(req.params.id);
    if (!ok) return res.status(404).json({ error: "Item não encontrado." });
    res.json({ ok: true });
  } catch (err) { persistError(res, err); }
});

// ── Chat ────────────────────────────────────────────────────────────────────
// ── Painel: perguntas que o assistente não soube responder ──────────────────
app.get("/api/tutor/gaps", tutorAuth, async (_req, res) => {
  try { res.json({ gaps: await listGaps() }); }
  catch (err) { persistError(res, err); }
});
app.delete("/api/tutor/gaps", tutorAuth, async (_req, res) => {
  try { await clearGaps(); res.json({ ok: true }); }
  catch (err) { persistError(res, err); }
});

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Servidor sem ANTHROPIC_API_KEY configurada. Defina a chave nas variáveis de ambiente." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "anon";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Muitas perguntas em sequência. Aguarde um instante e tente de novo." });
  }

  let { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Envie ao menos uma mensagem." });
  }
  const ALLOWED_IMG = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const MAX_IMAGES = 2;
  const MAX_IMG_B64 = 5 * 1024 * 1024;
  const limparConteudo = (content) => {
    if (typeof content === "string") return content.slice(0, MAX_CHARS_PER_MSG);
    if (Array.isArray(content)) {
      const blocos = []; let imgs = 0;
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string") {
          blocos.push({ type: "text", text: b.text.slice(0, MAX_CHARS_PER_MSG) });
        } else if (
          b.type === "image" && b.source && b.source.type === "base64" &&
          ALLOWED_IMG.has(b.source.media_type) && typeof b.source.data === "string" &&
          b.source.data.length <= MAX_IMG_B64 && imgs < MAX_IMAGES
        ) {
          imgs++;
          blocos.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
        }
      }
      return blocos;
    }
    return "";
  };

  messages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: limparConteudo(m.content) }))
    .filter((m) => (typeof m.content === "string" ? m.content.length > 0 : m.content.length > 0));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "A última mensagem deve ser do usuário." });
  }

  // Conhecimento do tutor: só os TRECHOS relevantes à última pergunta.
  const _ultima = messages[messages.length - 1].content;
  const ultimaPergunta = typeof _ultima === "string"
    ? _ultima
    : (_ultima.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() || "análise de documento enviado por foto");
  let tutorTexto = "";
  try { tutorTexto = await buildTutorContext(ultimaPergunta); } catch (e) { /* segue sem o tutor se falhar */ }

  try {
    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: buildSystem(tutorTexto), messages }),
    });

    if (!resposta.ok) {
      const detalhe = await resposta.text();
      console.error("[anthropic]", resposta.status, detalhe);
      return res.status(502).json({ error: "Não foi possível obter a resposta agora. Tente novamente em instantes." });
    }

    const data = await resposta.json();
    let texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (texto.includes("[[SEMBASE]]")) {
      texto = texto.replace(/\[\[SEMBASE\]\]/g, "").trim();
      logGap(ultimaPergunta).catch(() => {});
    }
    res.json({ reply: texto || "Não consegui gerar uma resposta. Pode reformular a pergunta?" });
  } catch (err) {
    console.error("[erro]", err);
    res.status(500).json({ error: "Erro interno ao processar a pergunta." });
  }
});

export default app;
export { MODEL, FORMS, TUTOR_PASSWORD };
export { storageMode };
