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
const CTX_BUDGET = 8000;   // teto do que vai no prompt por pergunta
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
    return m;
  } else if (mode === "file") {
    const data = fileRead();
    const m = data.index.find((x) => x.id === id);
    if (!m) return null;
    if (title != null) m.title = String(title).trim();
    if (content != null) { const c = String(content); data.contents[id] = c; m.chars = c.length; m.preview = c.slice(0, PREVIEW); }
    m.updatedAt = Date.now();
    fileSave(data);
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
  const out = [];
  let used = 0;
  const bigs = [];

  for (const e of entries) {
    const content = e.content || "";
    if (content.length <= SMALL_ENTRY) {
      const block = `• ${e.title}\n${content}`;
      if (used + block.length <= CTX_BUDGET) { out.push(block); used += block.length; }
    } else {
      bigs.push(e);
    }
  }

  if (bigs.length && used < CTX_BUDGET) {
    const scored = [];
    for (const e of bigs) {
      const titleNorm = normalize(e.title);
      const titleHit = terms.some((t) => titleNorm.includes(t)) ? 2 : 0;
      const chunks = chunkText(e.content, CHUNK_SIZE);
      chunks.forEach((c, i) => {
        const nc = normalize(c);
        let score = titleHit;
        for (const t of terms) score += countTerm(nc, t);
        scored.push({ score, order: i, title: e.title, text: c });
      });
    }
    const anyHit = terms.length > 0 && scored.some((s) => s.score > 0);
    let picked;
    if (anyHit) {
      picked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
    } else {
      const seen = new Set();
      picked = scored.filter((s) => { if (seen.has(s.title) || s.order !== 0) return false; seen.add(s.title); return true; });
    }
    for (const p of picked) {
      const block = `• ${p.title} (trecho relevante)\n${p.text}`;
      if (used + block.length > CTX_BUDGET) break;
      out.push(block); used += block.length;
    }
  }
  return out.join("\n\n");
}

// Compat (não usado no chat).
export async function knowledgeText() {
  const entries = await loadFull();
  if (!entries.length) return "";
  return entries.map((e) => `• ${e.title}\n${e.content}`).join("\n\n");
}
