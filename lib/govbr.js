// Login gov.br (OpenID Connect, fluxo "authorization code" com PKCE).
// Usado pelo "Meu DETRAN" real: só depois do login gov.br o sistema consulta os
// dados da pessoa na API do DETRAN — CPF digitado no chat NÃO prova identidade.
//
// Requer credenciamento do DETRAN no gov.br (client_id e client_secret, e a URL
// de retorno cadastrada: <PUBLIC_URL>/api/t/<slug>/govbr/retorno).
import { createHash, randomBytes, createPublicKey, verify as verificarAssinatura } from "node:crypto";

export const AMBIENTES = {
  producao: "https://sso.acesso.gov.br",
  homologacao: "https://sso.staging.acesso.gov.br",
};
export const ESCOPOS = "openid email profile govbr_confiabilidades";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const deB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function baseGovbr(cfg) { return cfg.govbrBaseUrl || AMBIENTES[cfg.govbrAmbiente] || AMBIENTES.homologacao; }

// Início do login: state/nonce/verifier ficam guardados no servidor (KV) por 10 min.
export function montarAutorizacao(cfg, redirectUri) {
  const state = b64url(randomBytes(24)), nonce = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: cfg.govbrClientId, scope: ESCOPOS, redirect_uri: redirectUri,
    state, nonce, code_challenge: challenge, code_challenge_method: "S256" });
  return { url: `${baseGovbr(cfg)}/authorize?${q}`, state, nonce, verifier };
}

// Valida o id_token (RS256) com a chave pública do gov.br (JWKS).
export function validarIdToken(idToken, jwks, { iss, aud, nonce, agora = Date.now() }) {
  const partes = String(idToken || "").split(".");
  if (partes.length !== 3) throw new Error("id_token malformado");
  const cab = JSON.parse(deB64url(partes[0]).toString("utf8"));
  const corpo = JSON.parse(deB64url(partes[1]).toString("utf8"));
  if (cab.alg !== "RS256") throw new Error("algoritmo não aceito");
  const jwk = (jwks?.keys || []).find((k) => k.kid === cab.kid) || (jwks?.keys || []).length === 1 && jwks.keys[0];
  if (!jwk) throw new Error("chave do gov.br não encontrada");
  const ok = verificarAssinatura("RSA-SHA256", Buffer.from(`${partes[0]}.${partes[1]}`), createPublicKey({ key: jwk, format: "jwk" }), deB64url(partes[2]));
  if (!ok) throw new Error("assinatura inválida");
  if (corpo.iss !== iss && corpo.iss !== `${iss}/`) throw new Error("emissor inválido");
  const auds = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!auds.includes(aud)) throw new Error("audiência inválida");
  if (!corpo.exp || corpo.exp * 1000 < agora - 60000) throw new Error("token expirado");
  if (corpo.nonce !== nonce) throw new Error("nonce inválido");
  const cpf = String(corpo.sub || "").replace(/\D/g, "");
  if (cpf.length !== 11) throw new Error("CPF ausente no token");
  return { cpf, nome: corpo.name || corpo.social_name || "", email: corpo.email || null };
}

// Troca o "code" pelo id_token e valida.
export async function concluirLogin(cfg, { code, redirectUri, verifier, nonce, fetchImpl = fetch }) {
  const base = baseGovbr(cfg);
  const basic = Buffer.from(`${cfg.govbrClientId}:${cfg.govbrClientSecret}`).toString("base64");
  const r = await fetchImpl(`${base}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id_token) throw new Error(`gov.br recusou o login (${r.status})`);
  const jw = await fetchImpl(`${base}/jwk`, { signal: AbortSignal.timeout(15000) });
  const jwks = await jw.json().catch(() => ({}));
  return validarIdToken(d.id_token, jwks, { iss: base, aud: cfg.govbrClientId, nonce });
}
