// Demonstração fechada: DETRAN que ainda não é cliente só abre por link
// privado (/go?demo=CHAVE). A chave é derivada do AUTH_SECRET, então não fica
// guardada em lugar nenhum; quem abre pelo link recebe um cookie de 30 dias.
import { createHmac, timingSafeEqual } from "node:crypto";
import { lerToken } from "./cripto.js";

const DIAS = 30;
const nomeCookie = (slug) => `detran_demo_${slug}`;

export function chaveDemo(slug) {
  const s = String(process.env.AUTH_SECRET || "");
  return createHmac("sha256", s).update(`demo:${slug}`).digest("base64url").slice(0, 14);
}

const igual = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return "";
}

export const chaveNaUrl = (req, t) => igual(req.query?.demo, chaveDemo(t.slug));

// Pode ver este DETRAN? Clientes (sem demonstração) sempre; demonstração só
// com a chave (na URL ou no cookie) ou com login (Authorization).
export function liberadoDemo(req, t) {
  if (!t.demonstracao) return true;
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ") && lerToken(h.slice(7))) return true; // logado (o perfil é conferido depois)
  return chaveNaUrl(req, t) || igual(lerCookie(req, nomeCookie(t.slug)), chaveDemo(t.slug));
}

export function gravarCookieDemo(req, res, t) {
  const seguro = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.append("Set-Cookie", `${nomeCookie(t.slug)}=${encodeURIComponent(chaveDemo(t.slug))}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; SameSite=Lax${seguro ? "; Secure" : ""}`);
}

export function paginaRestrita(t) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const portal = /^https?:\/\//i.test(t.portalUrl || "") ? t.portalUrl : "#";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Demonstração restrita</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#F4F6FA;font:15px/1.5 system-ui,sans-serif;color:#1B2236;padding:16px}.c{max-width:440px;background:#fff;border:1px solid #E3E8F0;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(16,24,40,.08)}h1{font-size:20px;margin:0 0 8px;color:#192662}a{color:#167D70;font-weight:600}</style></head>
<body><div class="c"><h1>Demonstração restrita</h1><p>Esta é uma demonstração privada e não é um canal oficial do ${esc(t.sigla)}.</p><p>Para serviços e informações oficiais, acesse <a href="${esc(portal)}" rel="noopener noreferrer">o portal do ${esc(t.sigla)}</a>.</p></div></body></html>`;
}
