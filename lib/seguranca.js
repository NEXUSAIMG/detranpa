// ─────────────────────────────────────────────────────────────────────────────
// Segurança das áreas internas:
//  • Verificação em duas etapas (código de 6 dígitos do Google Authenticator,
//    Microsoft Authenticator etc. — padrão TOTP/RFC 6238, sem custo).
//    Opcional para todos; obrigatória para os perfis em EXIGIR_2FA
//    (ex.: EXIGIR_2FA="SUPERADMIN,ADMIN,GESTOR").
//  • Trilha de auditoria: logins, tentativas, mudanças e consultas a dados de
//    cidadãos, com quem/quando/o quê (sem conteúdo das mensagens).
// Segredos e trilha ficam no MySQL (store.persistente), nunca só no KV.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";
import { cifrar, decifrar, assinarToken, lerToken } from "./cripto.js";
import { persistente, anotarLinha, lerLinhas } from "../store.js";

// ── TOTP ──
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf) {
  let bits = 0, valor = 0, out = "";
  for (const b of buf) { valor = (valor << 8) | b; bits += 8; while (bits >= 5) { out += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(valor << (5 - bits)) & 31];
  return out;
}
export function deBase32(txt) {
  const s = String(txt || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, valor = 0; const out = [];
  for (const c of s) { valor = (valor << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function codigoTotp(segredo, quando = Date.now(), passo = 30) {
  const contador = Math.floor(quando / 1000 / passo);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac("sha1", deBase32(segredo)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
// Aceita o código atual e o vizinho (±30 s) para relógio de celular atrasado.
export function conferirTotp(segredo, codigo, quando = Date.now()) {
  const c = String(codigo || "").replace(/\D/g, "");
  if (c.length !== 6 || !segredo) return false;
  return [-1, 0, 1].some((d) => {
    const esperado = Buffer.from(codigoTotp(segredo, quando + d * 30000));
    return timingSafeEqual(esperado, Buffer.from(c));
  });
}
export const novoSegredo = () => base32(randomBytes(20));

// ── Cadastro do segundo fator (por usuário) ──
const K = (uid) => `2fa:${uid}`;
async function lerCadastro(uid) {
  try { const v = await persistente.get(K(uid)); return v ? JSON.parse(decifrar(v)) : null; } catch { return null; }
}
async function gravarCadastro(uid, dados) { await persistente.set(K(uid), cifrar(JSON.stringify(dados))); }
export async function tem2fa(uid) { const c = await lerCadastro(uid); return Boolean(c?.ativo); }
const exigidos = () => String(process.env.EXIGIR_2FA || "").toUpperCase().split(/[,\s]+/).filter(Boolean);
export const obrigatorio2fa = (perfil) => exigidos().includes(String(perfil || "").toUpperCase());

// Depois de usuário+senha corretos: entrega o token, ou um "desafio" curto
// (10 min) que só serve para concluir a segunda etapa. O desafio não tem o
// campo `perfil`, então não abre nenhuma rota protegida.
export async function etapaPosSenha(r, { slug, uid }) {
  const ativo = await tem2fa(uid);
  if (!ativo && !obrigatorio2fa(r.usuario.perfil)) return r;
  const { perfil, ...resto } = lerToken(r.token) || {};
  const desafio = assinarToken({ etapa: ativo ? "2fa" : "cadastro2fa", uid, slug, perfilPendente: perfil, ...resto }, 1 / 6);
  return ativo ? { precisa2fa: true, desafio, usuario: r.usuario } : { precisaCadastrar2fa: true, desafio, usuario: r.usuario };
}

// Conclui a segunda etapa e devolve o token de verdade.
export async function concluir2fa(desafio, codigo) {
  const d = lerToken(desafio);
  if (!d || d.etapa !== "2fa" || !d.uid) return { erro: "Sessão de login expirada. Entre de novo.", status: 401 };
  const c = await lerCadastro(d.uid);
  if (!c?.ativo || !conferirTotp(c.segredo, codigo)) return { erro: "Código incorreto. Confira o aplicativo e tente de novo.", status: 401 };
  return { token: tokenFinal(d) };
}
function tokenFinal(d) {
  const { etapa, perfilPendente, uid, iat, exp, ...resto } = d;
  return assinarToken({ ...resto, uid, perfil: perfilPendente });
}

// Quem é o dono do pedido de cadastro: usuário logado (Bearer) ou desafio de cadastro obrigatório.
function donoDoPedido(req) {
  const h = String(req.headers.authorization || "");
  const t = h.startsWith("Bearer ") ? lerToken(h.slice(7)) : null;
  if (t?.uid && t.perfil) return { uid: t.uid, token: t };
  const d = lerToken(String(req.body?.desafio || ""));
  if (d?.etapa === "cadastro2fa" && d.uid) return { uid: d.uid, desafio: d };
  return null;
}

// Rotas: /api/t/:slug/auth/2fa/* (por DETRAN) e /api/admin/2fa/* (equipe Ayio).
export function registrarSeguranca(app, { comTenant, exigir, exigirSuper, limitar }) {
  const rotas = (base, pre = []) => {
    app.post(`${base}/2fa`, ...pre, async (req, res) => {
      if (limitar(`2fa:${req.ip}`, 10)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
      const r = await concluir2fa(req.body?.desafio, req.body?.codigo);
      const d = lerToken(String(req.body?.desafio || ""));
      auditar({ slug: d?.slug || null, uid: d?.uid, acao: r.token ? "login-2fa-ok" : "login-2fa-falhou", ip: req.ip });
      if (r.erro) return res.status(r.status).json({ error: r.erro });
      res.json({ token: r.token });
    });
    app.get(`${base}/2fa/estado`, ...pre, async (req, res) => {
      const dono = donoDoPedido(req); if (!dono?.token) return res.status(401).json({ error: "Faça login para continuar." });
      const c = await lerCadastro(dono.uid);
      res.json({ ativo: Boolean(c?.ativo), obrigatorio: obrigatorio2fa(dono.token.perfil), desde: c?.desde || null });
    });
    app.post(`${base}/2fa/iniciar`, ...pre, async (req, res) => {
      const dono = donoDoPedido(req); if (!dono) return res.status(401).json({ error: "Faça login para continuar." });
      const atual = await lerCadastro(dono.uid);
      if (atual?.ativo) return res.status(409).json({ error: "A verificação em duas etapas já está ativa." });
      const u = await prisma.usuario.findUnique({ where: { id: dono.uid }, select: { login: true } }).catch(() => null);
      const segredo = novoSegredo();
      await gravarCadastro(dono.uid, { ativo: false, segredo });
      const rotulo = encodeURIComponent(`Assistente DETRAN:${u?.login || "usuario"}`);
      res.json({ segredo, uri: `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent("Assistente DETRAN")}&digits=6&period=30` });
    });
    app.post(`${base}/2fa/ativar`, ...pre, async (req, res) => {
      if (limitar(`2fa-ativar:${req.ip}`, 10)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
      const dono = donoDoPedido(req); if (!dono) return res.status(401).json({ error: "Faça login para continuar." });
      const c = await lerCadastro(dono.uid);
      if (!c?.segredo || !conferirTotp(c.segredo, req.body?.codigo)) return res.status(400).json({ error: "Código incorreto. Confira o aplicativo e tente de novo." });
      await gravarCadastro(dono.uid, { ativo: true, segredo: c.segredo, desde: new Date().toISOString() });
      auditar({ slug: dono.token?.slug || dono.desafio?.slug || null, uid: dono.uid, acao: "2fa-ativada", ip: req.ip });
      // No cadastro obrigatório, já sai logado.
      res.json({ ok: true, ...(dono.desafio ? { token: tokenFinal({ ...dono.desafio, etapa: "2fa" }) } : {}) });
    });
    app.post(`${base}/2fa/desativar`, ...pre, async (req, res) => {
      const dono = donoDoPedido(req); if (!dono?.token) return res.status(401).json({ error: "Faça login para continuar." });
      if (obrigatorio2fa(dono.token.perfil)) return res.status(403).json({ error: "Para o seu perfil a verificação em duas etapas é obrigatória." });
      const c = await lerCadastro(dono.uid);
      if (!c?.ativo || !conferirTotp(c.segredo, req.body?.codigo)) return res.status(400).json({ error: "Código incorreto." });
      await persistente.del(K(dono.uid));
      auditar({ slug: dono.token.slug || null, uid: dono.uid, acao: "2fa-desativada", ip: req.ip });
      res.json({ ok: true });
    });
  };
  rotas("/api/t/:slug/auth", [comTenant]);
  rotas("/api/admin/auth");

  // Trilha de auditoria: o admin do DETRAN vê a do seu DETRAN; a equipe Ayio vê tudo.
  app.get("/api/t/:slug/gestao/auditoria", comTenant, exigir("admin"), async (req, res) => {
    res.json({ itens: await lerLinhas(`audit:${req.tenant.slug}`, req.query.limite || 200) });
  });
  app.get("/api/admin/auditoria", exigirSuper, async (req, res) => {
    const slug = String(req.query.slug || "_geral").replace(/[^a-z_-]/g, "").slice(0, 20) || "_geral";
    res.json({ itens: await lerLinhas(`audit:${slug}`, req.query.limite || 200) });
  });
}

// ── Auditoria ──
const SENSIVEL = /\/(conversas|cidadaos|mensagens|exportar|contatos|atendimento|auditoria|usuarios|lgpd|privacidade)/i;
export function auditar({ slug, uid, perfil, acao, rota, metodo, status, ip }) {
  const item = { em: new Date().toISOString(), uid: uid || null, perfil: perfil || null, acao, rota: rota ? String(rota).replace(/\/\d{6,}/g, "/•").slice(0, 120) : undefined, metodo, status, ip: ip ? String(ip).replace(/\.\d+$/, ".x").replace(/:[0-9a-f]+$/i, ":x") : undefined };
  return anotarLinha(`audit:${slug || "_geral"}`, item).catch((e) => console.error("[auditoria] não gravou:", e.message));
}
// Chamado pelos middlewares de login (exigir/exigirSuper) depois de autenticar.
export function auditarAcesso(req, res, dados) {
  const metodo = req.method;
  if (metodo === "GET" && !SENSIVEL.test(req.path)) return; // leituras comuns (painéis ao vivo) não entram
  res.on("finish", () => auditar({ slug: req.tenant?.slug || dados.slug || null, uid: dados.uid, perfil: dados.perfil, acao: metodo === "GET" ? "consulta" : "alteracao", rota: req.originalUrl.split("?")[0], metodo, status: res.statusCode, ip: req.ip }));
}
