// ─────────────────────────────────────────────────────────────────────────────
// Estado curto com expiração: mensagens do WhatsApp já processadas, ofertas,
// lembretes pendentes e jornadas do Despachante Parente.
//
// Ordem: Redis (Upstash / Vercel KV) → se o KV estiver fora do ar ou não
// configurado, tabela kv_estado no MySQL (criada sozinha se não existir) →
// sem banco, memória do processo (teste local).
//
// Os dados permanentes (DETRANs, usuários, eventos, balcão, conversas) ficam no
// MySQL (lib/db.js). O conhecimento do assistente fica no bot de cada DETRAN
// no BotAyio.
// ─────────────────────────────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const PAUSA_KV_MS = 5 * 60 * 1000; // KV falhou: tenta de novo só depois de 5 min

let kvFalhouEm = 0;

export function storageMode() {
  if (KV_URL && KV_TOKEN && Date.now() - kvFalhouEm > PAUSA_KV_MS) return "kv";
  return process.env.DATABASE_URL ? "mysql" : "memoria";
}

async function kvCmd(cmd) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error("KV_HTTP_" + res.status);
  return (await res.json()).result;
}

// ── MySQL ──
let tabela = null;
async function sql() {
  const { prisma } = await import("./lib/db.js");
  if (!tabela) {
    tabela = prisma.$executeRawUnsafe(
      "CREATE TABLE IF NOT EXISTS kv_estado (k VARCHAR(191) NOT NULL, v MEDIUMTEXT NOT NULL, exp DATETIME(3) NULL, PRIMARY KEY (k), INDEX kv_estado_exp (exp)) DEFAULT CHARSET=utf8mb4"
    ).catch((e) => { tabela = null; throw e; });
  }
  await tabela;
  return prisma;
}
const sqlGet = async (k) => {
  const p = await sql();
  const r = await p.$queryRawUnsafe("SELECT v FROM kv_estado WHERE k = ? AND (exp IS NULL OR exp > NOW(3))", k);
  return r[0]?.v ?? null;
};
const sqlSet = async (k, v, ttl) => {
  const p = await sql();
  await p.$executeRawUnsafe("INSERT INTO kv_estado (k, v, exp) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND)) ON DUPLICATE KEY UPDATE v = VALUES(v), exp = VALUES(exp)", k, String(v), Number(ttl));
  if (Math.random() < 0.02) p.$executeRawUnsafe("DELETE FROM kv_estado WHERE exp < NOW(3) LIMIT 500").catch(() => {});
  return "OK";
};
const sqlSetNx = async (k, v, ttl) => {
  const p = await sql();
  await p.$executeRawUnsafe("DELETE FROM kv_estado WHERE k = ? AND exp < NOW(3)", k);
  const n = await p.$executeRawUnsafe("INSERT IGNORE INTO kv_estado (k, v, exp) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))", k, String(v), Number(ttl));
  return n === 1;
};
const sqlDel = async (k) => { const p = await sql(); return p.$executeRawUnsafe("DELETE FROM kv_estado WHERE k = ?", k); };

// ── Memória ──
const mem = new Map(); // chave -> { v, exp }
function memGet(k) {
  const it = mem.get(k);
  if (!it) return null;
  if (it.exp && it.exp < Date.now()) { mem.delete(k); return null; }
  return it.v;
}
const memOps = {
  get: (k) => memGet(k),
  set: (k, v, ttl) => { mem.set(k, { v, exp: Date.now() + ttl * 1000 }); return "OK"; },
  setNx: (k, v, ttl) => { if (memGet(k) !== null) return false; mem.set(k, { v, exp: Date.now() + ttl * 1000 }); return true; },
  del: (k) => { mem.delete(k); return 1; },
};
const sqlOps = { get: sqlGet, set: sqlSet, setNx: sqlSetNx, del: sqlDel };

// Tenta o KV; se ele não responder, marca a pausa e usa o MySQL (ou memória).
async function executar(viaKv, op, ...args) {
  if (storageMode() === "kv") {
    try { return await viaKv(); }
    catch (e) {
      kvFalhouEm = Date.now();
      console.error("[store] KV indisponível, usando " + (process.env.DATABASE_URL ? "MySQL" : "memória") + ":", String(e?.message || e).slice(0, 80));
    }
  }
  return (process.env.DATABASE_URL ? sqlOps : memOps)[op](...args);
}

// ── Dados que NÃO podem sumir se o KV voltar ou cair (segundo fator, trilha
// de auditoria): sempre no MySQL; sem banco, memória (testes).
export const persistente = {
  async get(k) { return process.env.DATABASE_URL ? sqlGet(k) : memOps.get(k); },
  async set(k, v, ttlSec = 10 * 365 * 86400) { return process.env.DATABASE_URL ? sqlSet(k, v, ttlSec) : memOps.set(k, v, ttlSec); },
  async del(k) { return process.env.DATABASE_URL ? sqlDel(k) : memOps.del(k); },
};
// Linhas de registro (ex.: auditoria) com chave ordenável pelo tempo.
export async function anotarLinha(prefixo, obj, ttlSec = 365 * 86400) {
  const k = `${prefixo}:${Date.now().toString(36).padStart(9, "0")}:${Math.random().toString(36).slice(2, 7)}`;
  await persistente.set(k, JSON.stringify(obj), ttlSec);
  return k;
}
export async function lerLinhas(prefixo, limite = 200) {
  const lim = Math.max(1, Math.min(1000, Number(limite) || 200));
  if (process.env.DATABASE_URL) {
    const p = await sql();
    const r = await p.$queryRawUnsafe(`SELECT v FROM kv_estado WHERE k LIKE ? AND (exp IS NULL OR exp > NOW(3)) ORDER BY k DESC LIMIT ${lim}`, `${prefixo.replace(/[%_\\]/g, "\\$&")}:%`);
    return r.map((x) => { try { return JSON.parse(x.v); } catch { return null; } }).filter(Boolean);
  }
  return [...mem.keys()].filter((k) => k.startsWith(prefixo + ":")).sort().reverse().slice(0, lim)
    .map((k) => { try { return JSON.parse(memGet(k)); } catch { return null; } }).filter(Boolean);
}

// Grava só se a chave ainda não existir. Devolve true se gravou.
export async function kvSetNxEx(key, value, ttlSec) {
  return executar(async () => (await kvCmd(["SET", key, value, "NX", "EX", String(ttlSec)])) === "OK", "setNx", key, value, ttlSec);
}
export async function kvGetStr(key) {
  return executar(() => kvCmd(["GET", key]), "get", key);
}
export async function kvDel(key) {
  return executar(() => kvCmd(["DEL", key]), "del", key);
}
export async function kvSetEx(key, value, ttlSec) {
  return executar(() => kvCmd(["SET", key, value, "EX", String(ttlSec)]), "set", key, value, ttlSec);
}
