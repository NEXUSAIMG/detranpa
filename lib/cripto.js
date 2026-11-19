// Criptografia dos segredos das integrações (tokens do Zapayio, segredo e link
// de tutoria do BotAyio) e hash de senhas. Só usa o módulo nativo do Node.
//
// APP_ENCRYPTION_KEY: 32 bytes em base64 ou hex (64 caracteres).
// Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

function chave() {
  const raw = String(process.env.APP_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("APP_ENCRYPTION_KEY não definida");
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY precisa ter 32 bytes");
  return buf;
}

// Formato: v1.<iv>.<tag>.<dados> (base64url)
export function cifrar(texto) {
  if (texto == null || texto === "") return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(String(texto), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dados.toString("base64url")].join(".");
}

export function decifrar(valor) {
  if (!valor) return "";
  const [v, iv, tag, dados] = String(valor).split(".");
  if (v !== "v1" || !iv || !tag || !dados) throw new Error("valor cifrado inválido");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
}

// ── Senhas (scrypt) ──────────────────────────────────────────────────────────
export function hashSenha(senha) {
  const sal = randomBytes(16);
  const h = scryptSync(String(senha), sal, 64);
  return `scrypt$${sal.toString("base64url")}$${h.toString("base64url")}`;
}
export function conferirSenha(senha, guardado) {
  const [alg, sal, h] = String(guardado || "").split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const esperado = Buffer.from(h, "base64url");
  const calc = scryptSync(String(senha), Buffer.from(sal, "base64url"), esperado.length);
  return timingSafeEqual(esperado, calc);
}

// ── Token de sessão (assinado, sem estado no servidor) ──────────────────────
function segredoAuth() {
  const s = String(process.env.AUTH_SECRET || "").trim();
  if (s.length < 32) throw new Error("AUTH_SECRET precisa ter pelo menos 32 caracteres");
  return s;
}
export function assinarToken(dados, horas = 12) {
  const corpo = Buffer.from(JSON.stringify({ ...dados, exp: Date.now() + horas * 3600_000 })).toString("base64url");
  const sig = createHmac("sha256", segredoAuth()).update(corpo).digest("base64url");
  return `${corpo}.${sig}`;
}
export function lerToken(token) {
  const [corpo, sig] = String(token || "").split(".");
  if (!corpo || !sig) return null;
  const esperado = createHmac("sha256", segredoAuth()).update(corpo).digest();
  const recebido = Buffer.from(sig, "base64url");
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}

// Comparação de segredos em tempo constante (webhooks).
export function mesmoSegredo(a, b) {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}
