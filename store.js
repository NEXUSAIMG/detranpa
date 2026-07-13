// ─────────────────────────────────────────────────────────────────────────────
// Armazenamento do conhecimento ensinado pelo Tutor + seleção inteligente.
//
// Modos (escolhidos automaticamente):
//   • "kv"   — Vercel KV / Upstash Redis (REST). Permanente, recomendado p/ produção.
//   • "file" — arquivo local data/tutor-knowledge.json. Usado no seu PC.
//   • "none" — Vercel sem KV: leitura ok, gravar bloqueado (fs somente leitura).
//
// Documentos grandes: guardados por inteiro, mas na hora da conversa o assistente
// recebe só os TRECHOS relevantes à pergunta (buildTutorContext), para não pesar.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const FILE = join(DATA_DIR, "tutor-knowledge.json");

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_KEY = "detranpa:tutor:knowledge";
const ON_VERCEL = Boolean(process.env.VERCEL);

// Orçamento de contexto enviado ao assistente por pergunta (em caracteres).
const CTX_BUDGET = 8000;   // teto total do que vai no prompt
const SMALL_ENTRY = 1600;  // entradas até esse tamanho vão inteiras
const CHUNK_SIZE = 750;    // tamanho de cada trecho de documento grande

export function storageMode() {
  if (KV_URL && KV_TOKEN) return "kv";
  if (!ON_VERCEL) return "file";
  return "none";
}

async function kv(command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error("KV_HTTP_" + res.status);
  const data = await res.json();
  return data.result;
}

async function readAll() {
  const mode = storageMode();
  if (mode === "kv") {
    const raw = await kv(["GET", KV_KEY]);
    return raw ? JSON.parse(raw) : [];
  }
  if (existsSync(FILE)) {
    try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; }
  }
  return [];
}

async function writeAll(entries) {
  const mode = storageMode();
  if (mode === "kv") { await kv(["SET", KV_KEY, JSON.stringify(entries)]); return; }
  if (mode === "file") {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(entries, null, 2), "utf8");
    return;
  }
  throw new Error("PERSIST_NONE"); // Vercel sem KV
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listEntries() {
  const all = await readAll();
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function addEntry({ title, content, source }) {
  const entries = await readAll();
  const now = Date.now();
  const entry = {
    id: genId(),
    title: String(title).trim(),
    content: String(content).trim(),
    source: source ? String(source) : "texto",
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  await writeAll(entries);
  return entry;
}

export async function updateEntry(id, { title, content }) {
  const entries = await readAll();
  const e = entries.find((x) => x.id === id);
  if (!e) return null;
  if (title != null) e.title = String(title).trim();
  if (content != null) e.content = String(content).trim();
  e.updatedAt = Date.now();
  await writeAll(entries);
  return e;
}

export async function deleteEntry(id) {
  const entries = await readAll();
  const next = entries.filter((x) => x.id !== id);
  if (next.length === entries.length) return false;
  await writeAll(next);
  return true;
}

// ── Seleção inteligente de contexto ─────────────────────────────────────────

const STOP = new Set([
  "de","da","do","das","dos","e","o","a","os","as","um","uma","uns","umas","que","para","por","com",
  "no","na","nos","nas","em","se","ao","aos","à","às","é","ou","como","qual","quais","meu","minha",
  "seu","sua","tem","ter","the","of","and","preciso","quero","onde","quando","quanto","posso","fazer",
  "sobre","pelo","pela","este","essa","esse","esta","isso","aqui","tá","tô","pra","pro",
]);

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

// Monta o contexto do tutor para uma pergunta: entradas pequenas inteiras +
// os trechos mais relevantes das entradas grandes (respeitando um orçamento).
export async function buildTutorContext(question) {
  const entries = await readAll();
  if (!entries.length) return "";

  const terms = [...new Set(normalize(question).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))];
  const out = [];
  let used = 0;
  const bigs = [];

  // 1) Entradas pequenas: inteiras (são baratas e costumam ser avisos importantes)
  for (const e of entries) {
    const content = e.content || "";
    if (content.length <= SMALL_ENTRY) {
      const block = `• ${e.title}\n${content}`;
      if (used + block.length <= CTX_BUDGET) { out.push(block); used += block.length; }
    } else {
      bigs.push(e);
    }
  }

  // 2) Entradas grandes: escolhe os trechos mais relevantes à pergunta
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
      // Sem termos úteis: pega o começo de cada documento grande (visão geral).
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

// Mantido por compatibilidade (não usado no chat, que agora usa buildTutorContext).
export async function knowledgeText() {
  const entries = await readAll();
  if (!entries.length) return "";
  return entries.map((e) => `• ${e.title}\n${e.content}`).join("\n\n");
}
