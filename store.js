// ─────────────────────────────────────────────────────────────────────────────
// Armazenamento do conhecimento do Tutor — escalável para documentos GRANDES.
//
// Cada documento é guardado na sua própria "gaveta" (chave separada), com um
// índice leve por cima. Assim dá pra ter vários documentos enormes sem reescrever
// tudo a cada mudança e sem estourar o limite de tamanho por gravação.
//
// Modos: "kv" (Vercel KV / Upstash Redis, permanente), "file" (local), "none"
// (Vercel sem KV — só leitura). Migra automaticamente o formato antigo.
//
// Na conversa, só os TRECHOS relevantes à pergunta vão ao assistente
// (buildTutorContext), então o tamanho do documento não pesa no custo por resposta.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const FILE = join(DATA_DIR, "tutor-knowledge.json");

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const ON_VERCEL = Boolean(process.env.VERCEL);

const IDX_KEY = "detranpa:tutor:index";
const OLD_KEY = "detranpa:tutor:knowledge"; // formato antigo (array único)
const cKey = (id) => "detranpa:tutor:c:" + id;

const PREVIEW = 600;       // caracteres guardados no índice para pré-visualização
const CTX_BUDGET = 12000;   // teto do que vai no prompt por pergunta
const SMALL_ENTRY = 1600;  // entradas até isso vão inteiras
const CHUNK_SIZE = 750;    // tamanho de cada trecho de documento grande

export function storageMode() {
  if (KV_URL && KV_TOKEN) return "kv";
  if (!ON_VERCEL) return "file";
  return "none";
}

/* ── acesso ao KV (Upstash REST) ── */
async function kvCmd(cmd) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error("KV_HTTP_" + res.status);
  return (await res.json()).result;
}
const kvGet = (k) => kvCmd(["GET", k]);
const kvSet = (k, v) => kvCmd(["SET", k, v]);
const kvDel = (k) => kvCmd(["DEL", k]);
const kvMGet = (keys) => (keys.length ? kvCmd(["MGET", ...keys]) : Promise.resolve([]));

/* ── acesso ao arquivo local ── */
function fileLoad() {
  if (existsSync(FILE)) { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return null; } }
  return null;
}
function fileSave(obj) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(obj, null, 2), "utf8");
}
function metaFrom(e) {
  const c = e.content || "";
  return { id: e.id, title: e.title, source: e.source || "texto", chars: c.length, preview: c.slice(0, PREVIEW), createdAt: e.createdAt, updatedAt: e.updatedAt };
}
// Lê o arquivo local no formato { index, contents }, migrando o formato antigo (array).
function fileRead() {
  let data = fileLoad();
  if (Array.isArray(data)) {
    const contents = {}; const index = [];
    for (const e of data) { contents[e.id] = e.content || ""; index.push(metaFrom(e)); }
    data = { index, contents };
    fileSave(data);
  }
  if (!data || typeof data !== "object") data = { index: [], contents: {} };
  if (!Array.isArray(data.index)) data.index = [];
  if (!data.contents) data.contents = {};
  return data;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ── índice (metadados) ── */
async function readIndex() {
  const mode = storageMode();
  if (mode === "kv") {
    const raw = await kvGet(IDX_KEY);
    if (!raw) {
      // migração do formato antigo (array único) → gavetas separadas
      const oldRaw = await kvGet(OLD_KEY);
      if (oldRaw) {
        const arr = JSON.parse(oldRaw);
        const index = [];
        for (const e of arr) { await kvSet(cKey(e.id), e.content || ""); index.push(metaFrom(e)); }
        await kvSet(IDX_KEY, JSON.stringify(index));
        await kvDel(OLD_KEY);
        return index;
      }
      return [];
    }
    return JSON.parse(raw);
  }
  return fileRead().index; // file / none
}

export async function listEntries() {
  const idx = await readIndex();
  return idx.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function addEntry({ title, content, source }) {
  const mode = storageMode();
  const id = genId();
  const now = Date.now();
  content = String(content);
  const m = { id, title: String(title).trim(), source: source ? String(source) : "texto", chars: content.length, preview: content.slice(0, PREVIEW), createdAt: now, updatedAt: now };

  if (mode === "kv") {
    const idx = await readIndex();
    await kvSet(cKey(id), content);
    idx.push(m);
    await kvSet(IDX_KEY, JSON.stringify(idx));
  } else if (mode === "file") {
    const data = fileRead();
    data.contents[id] = content;
    data.index.push(m);
    fileSave(data);
  } else {
    throw new Error("PERSIST_NONE");
  }
  try { await embedAndStore(id, m.title, content); } catch (_) {}
  return m;
}

export async function updateEntry(id, { title, content }) {
  const mode = storageMode();
  if (mode === "kv") {
    const idx = await readIndex();
    const m = idx.find((x) => x.id === id);
    if (!m) return null;
    if (title != null) m.title = String(title).trim();
    if (content != null) { const c = String(content); await kvSet(cKey(id), c); m.chars = c.length; m.preview = c.slice(0, PREVIEW); }
    m.updatedAt = Date.now();
    await kvSet(IDX_KEY, JSON.stringify(idx));
    try { if (content != null) await embedAndStore(id, m.title, String(content)); } catch (_) {}
    return m;
  } else if (mode === "file") {
    const data = fileRead();
    const m = data.index.find((x) => x.id === id);
    if (!m) return null;
    if (title != null) m.title = String(title).trim();
    if (content != null) { const c = String(content); data.contents[id] = c; m.chars = c.length; m.preview = c.slice(0, PREVIEW); }
    m.updatedAt = Date.now();
    fileSave(data);
    try { if (content != null) await embedAndStore(id, m.title, String(content)); } catch (_) {}
    return m;
  }
  throw new Error("PERSIST_NONE");
}

export async function deleteEntry(id) {
  const mode = storageMode();
  if (mode === "kv") {
    const idx = await readIndex();
    const next = idx.filter((x) => x.id !== id);
    if (next.length === idx.length) return false;
    await kvDel(cKey(id));
    await kvSet(IDX_KEY, JSON.stringify(next));
    return true;
  } else if (mode === "file") {
    const data = fileRead();
    if (!data.index.find((x) => x.id === id)) return false;
    data.index = data.index.filter((x) => x.id !== id);
    delete data.contents[id];
    fileSave(data);
    return true;
  }
  throw new Error("PERSIST_NONE");
}

// Carrega índice + conteúdo completo (para a seleção de trechos).
async function loadFull() {
  const mode = storageMode();
  const idx = await readIndex();
  if (!idx.length) return [];
  if (mode === "kv") {
    const vals = await kvMGet(idx.map((m) => cKey(m.id)));
    return idx.map((m, i) => ({ ...m, content: (vals && vals[i]) || "" }));
  }
  const data = fileRead();
  return idx.map((m) => ({ ...m, content: data.contents[m.id] || "" }));
}

/* ── Seleção inteligente de contexto ── */
const STOP = new Set([
  "de","da","do","das","dos","e","o","a","os","as","um","uma","uns","umas","que","para","por","com",
  "no","na","nos","nas","em","se","ao","aos","à","às","é","ou","como","qual","quais","meu","minha",
  "seu","sua","tem","ter","the","of","and","preciso","quero","onde","quando","quanto","posso","fazer",
  "sobre","pelo","pela","este","essa","esse","esta","isso","aqui","tá","tô","pra","pro",
]);
function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function chunkText(text, size) {
  const paras = String(text).split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks = []; let cur = "";
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2) > size) { chunks.push(cur); cur = ""; }
    if (p.length > size) {
      if (cur) { chunks.push(cur); cur = ""; }
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [String(text).slice(0, size)];
}
function countTerm(hay, term) {
  let idx = 0, c = 0;
  while ((idx = hay.indexOf(term, idx)) !== -1) { c++; idx += term.length; }
  return c;
}

export async function buildTutorContext(question) {
  const entries = await loadFull();
  if (!entries.length) return "";
  const terms = [...new Set(normalize(question).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))];

  // Camada semântica (embeddings) — opcional. Casa por SIGNIFICADO, não só palavra.
  let qVec = null, embMap = {};
  if (VOYAGE_KEY) {
    try { const vs = await voyageEmbed([question]); qVec = (vs && vs[0]) || null; if (qVec) embMap = await loadEmbeddings(entries.map((e) => e.id)); } catch (_) { qVec = null; }
  }
  const semScore = (e) => { if (!qVec) return 0; const ev = embMap[e.id]; return ev ? cosine(qVec, ev) * SEM_WEIGHT : 0; };

  // Candidatos rankeáveis: entradas pequenas inteiras + trechos das grandes.
  // TUDO é pontuado por relevância à pergunta — assim a base pode ter centenas de
  // itens e só os mais relevantes entram no prompt (não os mais antigos por ordem).
  const cands = [];
  for (const e of entries) {
    const content = e.content || "";
    const titleNorm = normalize(e.title);
    const titleHit = terms.reduce((a, t) => a + (titleNorm.includes(t) ? 2 : 0), 0);
    const upd = e.updatedAt || e.createdAt || 0;
    const sem = semScore(e);
    if (content.length <= SMALL_ENTRY) {
      const nc = normalize(content);
      let score = titleHit + sem;
      for (const t of terms) score += countTerm(nc, t);
      cands.push({ score, upd, title: e.title, text: content });
    } else {
      const chunks = chunkText(content, CHUNK_SIZE);
      chunks.forEach((c, i) => {
        const ncc = normalize(c);
        let score = titleHit + sem;
        for (const t of terms) score += countTerm(ncc, t);
        cands.push({ score, upd, order: i, title: e.title + " (trecho relevante)", text: c });
      });
    }
  }

  const anyHit = terms.length > 0 && cands.some((c) => c.score > 0);
  let picked;
  if (anyHit) {
    picked = cands.filter((c) => c.score > 0).sort((a, b) => (b.score - a.score) || (b.upd - a.upd));
  } else {
    picked = cands.filter((c) => c.order === undefined || c.order === 0).sort((a, b) => b.upd - a.upd);
  }

  const out = [];
  let used = 0;
  for (const p of picked) {
    const block = `• ${p.title}\n${p.text}`;
    if (used + block.length > CTX_BUDGET) continue;
    out.push(block);
    used += block.length;
    if (used >= CTX_BUDGET) break;
  }
  return out.join("\n\n");
}

// Compat (não usado no chat).
export async function knowledgeText() {
  const entries = await loadFull();
  if (!entries.length) return "";
  return entries.map((e) => `• ${e.title}\n${e.content}`).join("\n\n");
}

/* ── Perguntas sem resposta (lacunas) — para o DETRAN ── */
const GAPS_KEY = "detranpa:gaps";
const GAPS_FILE = join(DATA_DIR, "gaps.json");

export async function logGap(question) {
  const q = String(question || "").trim().slice(0, 300);
  if (!q) return;
  const item = { q, at: Date.now() };
  const mode = storageMode();
  try {
    if (mode === "kv") {
      const raw = await kvGet(GAPS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(item);
      if (arr.length > 500) arr.splice(0, arr.length - 500);
      await kvSet(GAPS_KEY, JSON.stringify(arr));
    } else if (mode === "file") {
      let arr = [];
      if (existsSync(GAPS_FILE)) { try { arr = JSON.parse(readFileSync(GAPS_FILE, "utf8")); } catch { arr = []; } }
      arr.push(item);
      if (arr.length > 500) arr.splice(0, arr.length - 500);
      if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(GAPS_FILE, JSON.stringify(arr, null, 2), "utf8");
    }
  } catch (_) {}
}

export async function listGaps() {
  const mode = storageMode();
  try {
    if (mode === "kv") { const raw = await kvGet(GAPS_KEY); return raw ? JSON.parse(raw) : []; }
    if (mode === "file" && existsSync(GAPS_FILE)) { try { return JSON.parse(readFileSync(GAPS_FILE, "utf8")); } catch { return []; } }
  } catch (_) {}
  return [];
}

export async function clearGaps() {
  const mode = storageMode();
  try {
    if (mode === "kv") await kvDel(GAPS_KEY);
    else if (mode === "file" && existsSync(GAPS_FILE)) writeFileSync(GAPS_FILE, "[]", "utf8");
  } catch (_) {}
}

/* ── Analytics (painel do gestor) ── */
const EV_KEY = "detranpa:events";
const EV_FILE = join(DATA_DIR, "events.json");
const EV_MAX = 3000;

async function evLoad() {
  const mode = storageMode();
  try {
    if (mode === "kv") { const raw = await kvGet(EV_KEY); return raw ? JSON.parse(raw) : []; }
    if (mode === "file" && existsSync(EV_FILE)) { try { return JSON.parse(readFileSync(EV_FILE, "utf8")); } catch { return []; } }
  } catch (_) {}
  return [];
}
async function evSave(arr) {
  const mode = storageMode();
  if (arr.length > EV_MAX) arr.splice(0, arr.length - EV_MAX);
  try {
    if (mode === "kv") await kvSet(EV_KEY, JSON.stringify(arr));
    else if (mode === "file") { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(EV_FILE, JSON.stringify(arr), "utf8"); }
  } catch (_) {}
}
export async function logEvent(ev) {
  const item = Object.assign({ at: Date.now() }, ev || {});
  const arr = await evLoad(); arr.push(item); await evSave(arr);
}
export async function getStats() {
  const arr = await evLoad();
  const st = { total: 0, resolved: 0, unresolved: 0, up: 0, down: 0, byTheme: {}, byHour: {} };
  for (const e of arr) {
    if (e.k === "fb") { if (e.up) st.up++; else st.down++; continue; }
    st.total++;
    if (e.r) st.resolved++; else st.unresolved++;
    const t = e.t || "outros"; st.byTheme[t] = (st.byTheme[t] || 0) + 1;
    const h = new Date(e.at).getHours(); st.byHour[h] = (st.byHour[h] || 0) + 1;
  }
  return st;
}
export async function resetStats() {
  const mode = storageMode();
  try {
    if (mode === "kv") await kvDel(EV_KEY);
    else if (mode === "file" && existsSync(EV_FILE)) writeFileSync(EV_FILE, "[]", "utf8");
  } catch (_) {}
}


/* ── Busca semântica (embeddings via Voyage AI) — opcional ── */
const VOYAGE_KEY = process.env.VOYAGE_API_KEY || "";
const VOYAGE_MODEL = process.env.VOYAGE_MODEL || "voyage-3-lite";
const SEM_WEIGHT = 14;
const eKey = (id) => "detranpa:tutor:e:" + id;
const EMB_FILE = join(DATA_DIR, "tutor-embeddings.json");

export function semanticEnabled() { return !!VOYAGE_KEY; }

function cosine(a, b) {
  let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function voyageEmbed(texts) {
  if (!VOYAGE_KEY || !texts.length) return null;
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + VOYAGE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL }),
  });
  if (!res.ok) throw new Error("VOYAGE_" + res.status);
  const data = await res.json();
  return (data.data || []).slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

function embFileLoad() { if (existsSync(EMB_FILE)) { try { return JSON.parse(readFileSync(EMB_FILE, "utf8")); } catch { return {}; } } return {}; }
function embFileSave(o) { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(EMB_FILE, JSON.stringify(o), "utf8"); }

async function storeEmbedding(id, vec) {
  const mode = storageMode();
  if (mode === "kv") await kvSet(eKey(id), JSON.stringify(vec));
  else if (mode === "file") { const o = embFileLoad(); o[id] = vec; embFileSave(o); }
}
async function loadEmbeddings(ids) {
  const mode = storageMode(); const out = {};
  if (!ids.length) return out;
  if (mode === "kv") {
    const vals = await kvMGet(ids.map(eKey));
    ids.forEach((id, i) => { const raw = vals && vals[i]; if (raw) { try { out[id] = JSON.parse(raw); } catch (_) {} } });
  } else if (mode === "file") {
    const o = embFileLoad(); ids.forEach((id) => { if (o[id]) out[id] = o[id]; });
  }
  return out;
}
async function embedAndStore(id, title, content) {
  if (!VOYAGE_KEY) return;
  const vecs = await voyageEmbed([(String(title || "") + "\n" + String(content || "")).slice(0, 2000)]);
  if (vecs && vecs[0]) await storeEmbedding(id, vecs[0]);
}

// Gera embeddings para os itens que ainda não têm (botão de reindexar).
export async function reindexEmbeddings() {
  if (!VOYAGE_KEY) return { enabled: false };
  const entries = await loadFull();
  const have = await loadEmbeddings(entries.map((e) => e.id));
  const todo = entries.filter((e) => !have[e.id]);
  let feitos = 0;
  for (let i = 0; i < todo.length; i += 32) {
    const batch = todo.slice(i, i + 32);
    const vecs = await voyageEmbed(batch.map((e) => (e.title + "\n" + (e.content || "")).slice(0, 2000)));
    if (vecs) { for (let j = 0; j < batch.length; j++) { if (vecs[j]) { await storeEmbedding(batch[j].id, vecs[j]); feitos++; } } }
  }
  return { enabled: true, total: entries.length, feitos, jaTinham: entries.length - todo.length };
}

/* ── Atendimentos do balcão (registro + painel) ── */
const BALCAO_KEY = "detranpa:balcao";
const BALCAO_FILE = join(DATA_DIR, "balcao.json");
const BALCAO_MAX = 2000;
async function balcaoLoad() {
  const mode = storageMode();
  try {
    if (mode === "kv") { const raw = await kvGet(BALCAO_KEY); return raw ? JSON.parse(raw) : []; }
    if (mode === "file" && existsSync(BALCAO_FILE)) { try { return JSON.parse(readFileSync(BALCAO_FILE, "utf8")); } catch { return []; } }
  } catch (_) {}
  return [];
}
async function balcaoSave(arr) {
  const mode = storageMode();
  if (arr.length > BALCAO_MAX) arr.splice(0, arr.length - BALCAO_MAX);
  try {
    if (mode === "kv") await kvSet(BALCAO_KEY, JSON.stringify(arr));
    else if (mode === "file") { if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(BALCAO_FILE, JSON.stringify(arr), "utf8"); }
  } catch (_) {}
}
export async function logAtendimento(rec) {
  const item = Object.assign({ id: genId(), at: Date.now() }, rec);
  const arr = await balcaoLoad(); arr.push(item); await balcaoSave(arr); return item;
}
export async function listAtendimentos() {
  const arr = await balcaoLoad(); return arr.slice().sort((a, b) => b.at - a.at);
}
