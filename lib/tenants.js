// Resolução do DETRAN (tenant) a partir do caminho da URL: /pa, /api/t/pa/...
// Guarda em cache por 60s para não ir ao banco a cada requisição.
import { prisma } from "./db.js";
import { decifrar } from "./cripto.js";

const TTL_MS = Number(process.env.TENANT_CACHE_MS || 60000);
const cache = new Map(); // slug -> { valor, exp }

export const SLUG_RE = /^[a-z]{2,20}$/;

export async function buscarTenant(slug) {
  const s = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const c = cache.get(s);
  if (c && c.exp > Date.now()) return c.valor;
  const t = await prisma.tenant.findUnique({ where: { slug: s }, include: { integracao: true } });
  const valor = t && t.ativo ? t : null;
  cache.set(s, { valor, exp: Date.now() + TTL_MS });
  return valor;
}

export function limparCacheTenant(slug) {
  if (slug) cache.delete(String(slug).toLowerCase()); else cache.clear();
}

// Middleware: /api/t/:slug/... -> req.tenant
export async function comTenant(req, res, next) {
  try {
    const t = await buscarTenant(req.params.slug);
    if (!t) return res.status(404).json({ error: "DETRAN não encontrado." });
    req.tenant = t;
    next();
  } catch (err) {
    console.error("[tenant]", err);
    res.status(503).json({ error: "Serviço indisponível no momento." });
  }
}

// Credenciais decifradas (só no servidor; nunca vão para o navegador).
const seguro = (v) => { try { return decifrar(v); } catch (e) { console.error("[tenant] segredo ilegível:", e.message); return ""; } };
export function integracoes(t) {
  const i = t?.integracao || {};
  return {
    botayio: { url: i.botayioUrl || "", secret: seguro(i.botayioSecretEnc), tutorUrl: seguro(i.botayioTutorUrlEnc) },
    zapayio: {
      baseUrl: (i.zapayioBaseUrl || "https://zap.ondot.com.br").replace(/\/+$/, ""),
      instanceId: i.zapayioInstanceId || "",
      token: seguro(i.zapayioTokenEnc),
      clientToken: seguro(i.zapayioClientEnc),
      webhookSecret: seguro(i.zapayioWebhookEnc),
    },
  };
}
export function statusIntegracoes(t) {
  const i = t?.integracao || {};
  return {
    botayio: Boolean(i.botayioUrl && i.botayioSecretEnc),
    tutoria: Boolean(i.botayioTutorUrlEnc),
    zapayio: Boolean(i.zapayioInstanceId && i.zapayioTokenEnc),
    webhookProtegido: Boolean(i.zapayioWebhookEnc),
  };
}

// O que o navegador pode ver do tenant.
export function configPublica(t) {
  return {
    slug: t.slug, uf: t.uf, sigla: t.sigla, nome: t.nome, governo: t.governo,
    cidadeSede: t.cidadeSede, assistente: t.assistente, portalUrl: t.portalUrl,
    telefone: t.telefone, logoUrl: t.logoUrl, marcaUrl: t.marcaUrl,
    corPrimaria: t.corPrimaria, conteudo: t.conteudo || {},
  };
}
