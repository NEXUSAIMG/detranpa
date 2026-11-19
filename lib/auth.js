// Login por usuário e perfil, por DETRAN. Substitui a senha única do Tutor.
// Token assinado no header: Authorization: Bearer <token>
import { prisma } from "./db.js";
import { conferirSenha, assinarToken, lerToken } from "./cripto.js";

const HIERARQUIA = { SUPERADMIN: 5, ADMIN: 4, GESTOR: 3, TUTOR: 2, BALCAO: 1 };

// Quem pode entrar em cada área (ADMIN e SUPERADMIN entram em todas).
export const AREAS = {
  tutor: ["TUTOR", "GESTOR", "ADMIN", "SUPERADMIN"],
  painel: ["GESTOR", "ADMIN", "SUPERADMIN"],
  balcao: ["BALCAO", "GESTOR", "ADMIN", "SUPERADMIN"],
  admin: ["ADMIN", "SUPERADMIN"],
};

export async function login(tenant, loginTxt, senha) {
  const l = String(loginTxt || "").trim().toLowerCase();
  if (!l || !senha) return null;
  const candidatos = await prisma.usuario.findMany({
    where: { login: l, ativo: true, OR: [{ tenantId: tenant.id }, { perfil: "SUPERADMIN", tenantId: null }] },
  });
  const u = candidatos.find((c) => conferirSenha(senha, c.senhaHash));
  if (!u) return null;
  prisma.usuario.update({ where: { id: u.id }, data: { ultimoAcesso: new Date() } }).catch(() => {});
  const token = assinarToken({ uid: u.id, tid: u.tenantId, slug: tenant.slug, perfil: u.perfil });
  return { token, usuario: { nome: u.nome, perfil: u.perfil } };
}

// Middleware: exige login no MESMO DETRAN da URL e um dos perfis da área.
export function exigir(area) {
  const permitidos = AREAS[area] || [];
  return (req, res, next) => {
    const h = String(req.headers.authorization || "");
    const dados = h.startsWith("Bearer ") ? lerToken(h.slice(7)) : null;
    if (!dados) return res.status(401).json({ error: "Faça login para continuar." });
    const mesmoTenant = dados.perfil === "SUPERADMIN" || dados.tid === req.tenant?.id;
    if (!mesmoTenant) return res.status(403).json({ error: "Acesso negado para este DETRAN." });
    if (!permitidos.includes(dados.perfil)) return res.status(403).json({ error: "Seu perfil não tem acesso a esta área." });
    req.usuario = dados;
    next();
  };
}

export function podeAcessar(perfil, area) {
  return (AREAS[area] || []).includes(perfil);
}
export { HIERARQUIA };
