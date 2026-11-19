// ─────────────────────────────────────────────────────────────────────────────
// Estado curto no Redis (Upstash / Vercel KV): mensagens do WhatsApp já
// processadas e última atividade por telefone. Tudo com expiração.
//
// Os dados permanentes (DETRANs, usuários, eventos, balcão, conversas) ficam no
// MySQL (lib/db.js). O conhecimento do assistente fica no bot de cada DETRAN
// no BotAyio. O que a versão antiga guardava aqui (Tutor, lacunas, eventos,
// balcão) é levado pelo scripts/migrar-legado.js.
//
// Sem KV configurado, usa memória do processo (serve para teste local).
// ─────────────────────────────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function storageMode() {
  return KV_URL && KV_TOKEN ? "kv" : "memoria";
}

async function kvCmd(cmd) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error("KV_HTTP_" + res.status);
  return (await res.json()).result;
}

const mem = new Map(); // chave -> { v, exp }
function memGet(k) {
  const it = mem.get(k);
  if (!it) return null;
  if (it.exp && it.exp < Date.now()) { mem.delete(k); return null; }
  return it.v;
}

// Grava só se a chave ainda não existir. Devolve true se gravou.
export async function kvSetNxEx(key, value, ttlSec) {
  if (storageMode() === "kv") return (await kvCmd(["SET", key, value, "NX", "EX", String(ttlSec)])) === "OK";
  if (memGet(key) !== null) return false;
  mem.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  return true;
}
export async function kvGetStr(key) {
  if (storageMode() === "kv") return kvCmd(["GET", key]);
  return memGet(key);
}
export async function kvSetEx(key, value, ttlSec) {
  if (storageMode() === "kv") return kvCmd(["SET", key, value, "EX", String(ttlSec)]);
  mem.set(key, { v: value, exp: Date.now() + ttlSec * 1000 });
  return "OK";
}
