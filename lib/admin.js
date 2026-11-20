// ─────────────────────────────────────────────────────────────────────────────
// Administração dos DETRANs.
//
//   /api/admin/...              equipe Ayio (SUPERADMIN): lista e cria DETRANs
//   /api/t/<slug>/admin/...     admin do DETRAN (ou SUPERADMIN): dados, integrações,
//                               usuários e formulários DAQUELE DETRAN
//
// Segredos (tokens do Zapayio, segredo e link de tutoria do BotAyio) entram
// cifrados e nunca voltam para o navegador: a API só diz se estão cadastrados.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "./db.js";
import { cifrar, hashSenha } from "./cripto.js";
import { comTenant, limparCacheTenant, statusIntegracoes, integracoes, urlImagem, SLUG_RE } from "./tenants.js";
import { exigir, exigirSuper, loginSuper } from "./auth.js";
import { perguntarAoBot } from "./botayio.js";
import { chaveDemo, chaveSim } from "./demo.js";

const PERFIS_DETRAN = ["ADMIN", "GESTOR", "TUTOR", "BALCAO"];
const CAMPOS_TENANT = ["uf", "sigla", "nome", "governo", "cidadeSede", "assistente", "portalUrl", "telefone",
  "logoUrl", "marcaUrl", "corPrimaria", "corDestaque", "personaTom", "orientacoes"];
const OBRIGATORIOS = ["uf", "sigla", "nome", "governo", "cidadeSede", "assistente", "portalUrl"];
const TIPOS_IMAGEM = { "image/png": true, "image/jpeg": true, "image/webp": true }; // SVG não: pode carregar script
const MAX_IMAGEM = 600 * 1024;

const txt = (v, n) => (v == null ? null : String(v).trim().slice(0, n));
const urlOk = (u) => !u || /^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s]*$/.test(u);

// Valida e normaliza os dados de um DETRAN vindos do formulário.
function dadosTenant(b, { parcial = false } = {}) {
  const erros = [];
  const d = {};
  const limites = { uf: 2, sigla: 40, nome: 160, governo: 160, cidadeSede: 80, assistente: 80, portalUrl: 255, telefone: 40, logoUrl: 255, marcaUrl: 255, corPrimaria: 9, corDestaque: 9, personaTom: 8000, orientacoes: 12000 };
  for (const c of CAMPOS_TENANT) {
    if (b[c] === undefined) continue;
    const v = txt(b[c], limites[c]);
    d[c] = v === "" ? null : v;
  }
  if (!parcial) for (const c of OBRIGATORIOS) if (!d[c]) erros.push(`Preencha: ${c}`);
  if (d.uf) { if (!/^[A-Za-z]{2}$/.test(d.uf)) erros.push("UF deve ter 2 letras."); d.uf = d.uf.toUpperCase(); }
  for (const c of ["portalUrl", "logoUrl", "marcaUrl"]) if (d[c] && !urlOk(d[c])) erros.push(`${c} precisa ser um endereço http(s) ou começar com /`);
  for (const c of ["corPrimaria", "corDestaque"]) if (d[c] && !/^#[0-9a-fA-F]{6}$/.test(d[c])) erros.push("Cores no formato #RRGGBB.");
  if (d.telefone === null) d.telefone = "";
  if (b.conteudo !== undefined) {
    let c = b.conteudo;
    if (typeof c === "string") { try { c = c.trim() ? JSON.parse(c) : {}; } catch { erros.push("Conteúdo da tela não é um JSON válido."); c = null; } }
    if (c && (typeof c !== "object" || Array.isArray(c))) erros.push("Conteúdo da tela deve ser um objeto JSON.");
    else if (c) {
      for (const k of ["sugestoes", "guias", "atalhos", "canais"]) if (c[k] !== undefined && !Array.isArray(c[k])) erros.push(`conteudo.${k} deve ser uma lista.`);
      if (JSON.stringify(c).length > 200_000) erros.push("Conteúdo da tela muito grande.");
      d.conteudo = c;
    }
  }
  if (b.ativo !== undefined) d.ativo = Boolean(b.ativo);
  if (b.demonstracao !== undefined) d.demonstracao = Boolean(b.demonstracao);
  if (!parcial && d.telefone === undefined) d.telefone = "";
  return { d, erros };
}

const resumoTenant = (t) => ({
  slug: t.slug, uf: t.uf, sigla: t.sigla, nome: t.nome, governo: t.governo, cidadeSede: t.cidadeSede,
  assistente: t.assistente, portalUrl: t.portalUrl, telefone: t.telefone, logoUrl: t.logoUrl, marcaUrl: t.marcaUrl,
  corPrimaria: t.corPrimaria, corDestaque: t.corDestaque, personaTom: t.personaTom, orientacoes: t.orientacoes, conteudo: t.conteudo || {},
  ativo: t.ativo, demonstracao: t.demonstracao, criadoEm: t.criadoEm,
  imagens: { logo: urlImagem(t, "logo"), marca: urlImagem(t, "marca") },
});
// O que pode ser mostrado das integrações (sem segredos).
const resumoIntegracao = (t) => {
  const i = t.integracao || {};
  return {
    ...statusIntegracoes(t),
    botayioUrl: i.botayioUrl || "",
    zapayioBaseUrl: i.zapayioBaseUrl || "",
    zapayioInstanceId: i.zapayioInstanceId || "",
    zapayioClientToken: Boolean(i.zapayioClientEnc),
    webhook: i.zapayioWebhookEnc ? `/api/t/${t.slug}/zapayio/webhook/••••••` : null,
  };
};
const resumoUsuario = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, ativo: u.ativo, ultimoAcesso: u.ultimoAcesso, criadoEm: u.criadoEm });

async function carregar(slug) {
  return prisma.tenant.findUnique({ where: { slug }, include: { integracao: true } });
}
const falha = (res, err, msg = "Não foi possível salvar agora.") => { console.error("[admin]", err); res.status(500).json({ error: msg }); };

export function registrarAdmin(app, { limitar }) {
  // ═════════════ Equipe Ayio (SUPERADMIN) ═════════════
  app.post("/api/admin/login", async (req, res) => {
    if (limitar(`admin-login:${req.ip}`, 10)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    try {
      const r = await loginSuper(req.body?.login, req.body?.senha);
      if (!r) return res.status(401).json({ error: "Usuário ou senha incorretos." });
      res.json(r);
    } catch (err) { falha(res, err, "Não foi possível entrar agora."); }
  });

  app.get("/api/admin/tenants", exigirSuper, async (_req, res) => {
    try {
      const ts = await prisma.tenant.findMany({
        orderBy: { slug: "asc" },
        include: { integracao: true, _count: { select: { usuarios: true, formularios: true, conversas: true } } },
      });
      res.json({ tenants: ts.map((t) => ({ slug: t.slug, sigla: t.sigla, nome: t.nome, ativo: t.ativo, demonstracao: t.demonstracao, corPrimaria: t.corPrimaria, marca: urlImagem(t, "marca"), integracoes: statusIntegracoes(t), usuarios: t._count.usuarios, formularios: t._count.formularios, conversas: t._count.conversas })) });
    } catch (err) { falha(res, err, "Erro ao listar."); }
  });

  // Cria um DETRAN. Opcional: copiarFormulariosDe / copiarConteudoDe (slug de outro DETRAN).
  app.post("/api/admin/tenants", exigirSuper, async (req, res) => {
    const b = req.body || {};
    const slug = String(b.slug || "").trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "Endereço (slug) inválido: use só letras minúsculas, 2 a 20 (ex.: am)." });
    if (["api", "admin", "img", "public", "static"].includes(slug)) return res.status(400).json({ error: "Esse endereço é reservado." });
    const { d, erros } = dadosTenant(b);
    if (erros.length) return res.status(400).json({ error: erros.join(" ") });
    try {
      if (await prisma.tenant.findUnique({ where: { slug } })) return res.status(409).json({ error: "Já existe um DETRAN com esse endereço." });
      let conteudo = d.conteudo || {};
      if (b.copiarConteudoDe) {
        const origem = await prisma.tenant.findUnique({ where: { slug: String(b.copiarConteudoDe) } });
        if (origem?.conteudo) conteudo = origem.conteudo;
      }
      const t = await prisma.tenant.create({ data: { slug, ...d, conteudo } });
      let copiados = 0;
      if (b.copiarFormulariosDe) {
        const origem = await prisma.tenant.findUnique({ where: { slug: String(b.copiarFormulariosDe) }, include: { formularios: true } });
        if (origem) {
          await prisma.formulario.createMany({ data: origem.formularios.map((f) => ({ tenantId: t.id, chave: f.chave, ordem: f.ordem, definicao: f.definicao, ativo: f.ativo })) });
          copiados = origem.formularios.length;
        }
      }
      res.status(201).json({ tenant: resumoTenant(t), formulariosCopiados: copiados });
    } catch (err) { falha(res, err); }
  });

  // ═════════════ Admin do DETRAN (ou SUPERADMIN) ═════════════
  const A = "/api/t/:slug/admin";
  const adm = [comTenant, exigir("admin")];

  app.get(A, ...adm, async (req, res) => {
    try {
      const t = await carregar(req.tenant.slug);
      const souSuper = req.usuario.perfil === "SUPERADMIN";
      // Link privado da demonstração: só a equipe Ayio vê (é o que vai para o DETRAN na apresentação).
      res.json({ tenant: resumoTenant(t), integracao: resumoIntegracao(t), super: souSuper, linkDemo: souSuper && t.demonstracao ? `/${t.slug}?demo=${chaveDemo(t.slug)}` : null,
      // Link privado da simulação "Meu DETRAN" (útil em DETRAN cliente, onde ela fica escondida).
      linkSim: souSuper ? (t.demonstracao ? `/${t.slug}/servicos?demo=${chaveDemo(t.slug)}` : `/${t.slug}/servicos?sim=${chaveSim(t.slug)}`) : null });
    } catch (err) { falha(res, err, "Erro ao carregar."); }
  });

  app.put(`${A}/dados`, ...adm, async (req, res) => {
    const { d, erros } = dadosTenant(req.body || {}, { parcial: true });
    if (erros.length) return res.status(400).json({ error: erros.join(" ") });
    // Desativar um DETRAN (tira o site do ar) e tirar do modo demonstração
    // (passa a se apresentar como canal oficial): só a equipe Ayio.
    if (req.usuario.perfil !== "SUPERADMIN") { delete d.ativo; delete d.demonstracao; }
    try {
      const t = await prisma.tenant.update({ where: { id: req.tenant.id }, data: d });
      limparCacheTenant(t.slug);
      res.json({ tenant: resumoTenant(t) });
    } catch (err) { falha(res, err); }
  });

  // Integrações: campo vazio/ausente = mantém; "limpar": ["campo", ...] = apaga.
  app.put(`${A}/integracao`, ...adm, async (req, res) => {
    const b = req.body || {};
    const d = {};
    const erros = [];
    const abertos = { botayioUrl: "botayioUrl", zapayioBaseUrl: "zapayioBaseUrl", zapayioInstanceId: "zapayioInstanceId" };
    const segredos = { botayioSecret: "botayioSecretEnc", botayioTutorUrl: "botayioTutorUrlEnc", zapayioToken: "zapayioTokenEnc", zapayioClientToken: "zapayioClientEnc", zapayioWebhookSecret: "zapayioWebhookEnc" };
    for (const [k, col] of Object.entries(abertos)) {
      const v = txt(b[k], 255);
      if (v) d[col] = v;
    }
    if (d.botayioUrl && !/^https?:\/\/.+\/webhooks\/seucartorio\/[0-9a-f-]{36}\/?$/i.test(d.botayioUrl)) erros.push("URL do BotAyio deve terminar em /webhooks/seucartorio/<id do bot>.");
    if (d.zapayioBaseUrl && !/^https?:\/\//i.test(d.zapayioBaseUrl)) erros.push("URL do Zapayio inválida.");
    if (b.botayioTutorUrl && !/^https?:\/\//i.test(String(b.botayioTutorUrl))) erros.push("Link de tutoria inválido.");
    if (b.zapayioWebhookSecret && String(b.zapayioWebhookSecret).length < 24) erros.push("Use um segredo de webhook com pelo menos 24 caracteres.");
    if (erros.length) return res.status(400).json({ error: erros.join(" ") });
    try {
      for (const [k, col] of Object.entries(segredos)) {
        const v = txt(b[k], 2000);
        if (v) d[col] = cifrar(v);
      }
      for (const campo of Array.isArray(b.limpar) ? b.limpar : []) {
        const col = abertos[campo] || segredos[campo];
        if (col) d[col] = null;
      }
      if (!Object.keys(d).length) return res.status(400).json({ error: "Nada para alterar." });
      await prisma.tenantIntegracao.upsert({ where: { tenantId: req.tenant.id }, create: { tenantId: req.tenant.id, ...d }, update: d });
      limparCacheTenant(req.tenant.slug);
      const t = await carregar(req.tenant.slug);
      res.json({ integracao: resumoIntegracao(t) });
    } catch (err) { falha(res, err); }
  });

  // Identidade visual: envia logo ou marca (PNG, JPG ou WEBP, até 600 KB).
  // Corpo: { dataUrl: "data:image/png;base64,..." }. Fica guardado no MySQL.
  app.put(`${A}/arquivo/:tipo`, ...adm, async (req, res) => {
    const tipo = req.params.tipo;
    if (!["logo", "marca"].includes(tipo)) return res.status(404).json({ error: "Tipo inválido." });
    const m = String(req.body?.dataUrl || "").match(/^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
    if (!m || !TIPOS_IMAGEM[m[1]]) return res.status(400).json({ error: "Envie uma imagem PNG, JPG ou WEBP." });
    const dados = Buffer.from(m[2], "base64");
    if (!dados.length || dados.length > MAX_IMAGEM) return res.status(400).json({ error: "A imagem deve ter até 600 KB." });
    try {
      await prisma.tenantArquivo.upsert({
        where: { tenantId_tipo: { tenantId: req.tenant.id, tipo } },
        create: { tenantId: req.tenant.id, tipo, mime: m[1], dados }, update: { mime: m[1], dados },
      });
      // A imagem enviada passa a valer no lugar de um endereço fixo antigo.
      const campo = tipo === "logo" ? "logoUrl" : "marcaUrl";
      const t = await prisma.tenant.update({ where: { id: req.tenant.id }, data: { [campo]: null } });
      limparCacheTenant(t.slug);
      res.json({ ok: true, imagens: { logo: urlImagem(t, "logo"), marca: urlImagem(t, "marca") } });
    } catch (err) { falha(res, err); }
  });
  app.delete(`${A}/arquivo/:tipo`, ...adm, async (req, res) => {
    const tipo = req.params.tipo;
    if (!["logo", "marca"].includes(tipo)) return res.status(404).json({ error: "Tipo inválido." });
    try {
      await prisma.tenantArquivo.deleteMany({ where: { tenantId: req.tenant.id, tipo } });
      const t = await prisma.tenant.update({ where: { id: req.tenant.id }, data: { atualizadoEm: new Date() } });
      limparCacheTenant(t.slug);
      res.json({ ok: true, imagens: { logo: urlImagem(t, "logo"), marca: urlImagem(t, "marca") } });
    } catch (err) { falha(res, err); }
  });

  // Testa o bot do DETRAN no BotAyio (sessão isolada de teste).
  app.post(`${A}/botayio/teste`, ...adm, async (req, res) => {
    const t = await carregar(req.tenant.slug);
    const { botayio } = integracoes(t);
    if (!botayio.url || !botayio.secret) return res.status(400).json({ error: "Cadastre a URL e o segredo do BotAyio antes." });
    try {
      const r = await perguntarAoBot(botayio, `detran-${t.slug}-teste-${req.usuario.uid}`, String(req.body?.texto || "oi").slice(0, 1000), Boolean(req.body?.reiniciar));
      res.json({ ok: true, contents: r.contents || [], categoria: r.categoria || null, transbordo: Boolean(r.handed_off) });
    } catch (err) { res.status(502).json({ error: `O BotAyio não respondeu: ${err.message}` }); }
  });

  // ── Usuários do DETRAN ──
  app.get(`${A}/usuarios`, ...adm, async (req, res) => {
    try {
      const us = await prisma.usuario.findMany({ where: { tenantId: req.tenant.id }, orderBy: [{ ativo: "desc" }, { nome: "asc" }] });
      res.json({ usuarios: us.map(resumoUsuario) });
    } catch (err) { falha(res, err, "Erro ao listar."); }
  });

  app.post(`${A}/usuarios`, ...adm, async (req, res) => {
    const b = req.body || {};
    const login = String(b.login || "").trim().toLowerCase();
    const perfil = String(b.perfil || "").toUpperCase();
    if (!/^[a-z0-9._@-]{3,120}$/.test(login)) return res.status(400).json({ error: "Usuário: 3 a 120 caracteres (letras, números, ponto, hífen, @)." });
    if (!PERFIS_DETRAN.includes(perfil)) return res.status(400).json({ error: `Perfil inválido. Use: ${PERFIS_DETRAN.join(", ")}.` });
    if (!txt(b.nome, 120)) return res.status(400).json({ error: "Informe o nome." });
    if (String(b.senha || "").length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
    try {
      if (await prisma.usuario.findFirst({ where: { tenantId: req.tenant.id, login } })) return res.status(409).json({ error: "Já existe um usuário com esse login neste DETRAN." });
      const u = await prisma.usuario.create({ data: { tenantId: req.tenant.id, login, nome: txt(b.nome, 120), perfil, senhaHash: hashSenha(b.senha) } });
      res.status(201).json({ usuario: resumoUsuario(u) });
    } catch (err) { falha(res, err); }
  });

  app.put(`${A}/usuarios/:id`, ...adm, async (req, res) => {
    const b = req.body || {};
    try {
      const u = await prisma.usuario.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
      if (!u) return res.status(404).json({ error: "Usuário não encontrado neste DETRAN." });
      const d = {};
      if (b.nome !== undefined) { if (!txt(b.nome, 120)) return res.status(400).json({ error: "Informe o nome." }); d.nome = txt(b.nome, 120); }
      if (b.perfil !== undefined) {
        const p = String(b.perfil).toUpperCase();
        if (!PERFIS_DETRAN.includes(p)) return res.status(400).json({ error: "Perfil inválido." });
        d.perfil = p;
      }
      if (b.ativo !== undefined) d.ativo = Boolean(b.ativo);
      if (b.senha !== undefined) { if (String(b.senha).length < 8) return res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." }); d.senhaHash = hashSenha(b.senha); }
      // Não deixa o admin se trancar do lado de fora.
      if (u.id === req.usuario.uid && (d.ativo === false || (d.perfil && d.perfil !== "ADMIN"))) return res.status(400).json({ error: "Você não pode desativar nem rebaixar o seu próprio usuário." });
      const novo = await prisma.usuario.update({ where: { id: u.id }, data: d });
      res.json({ usuario: resumoUsuario(novo) });
    } catch (err) { falha(res, err); }
  });

  // ── Formulários do DETRAN ──
  app.get(`${A}/formularios`, ...adm, async (req, res) => {
    try {
      const fs = await prisma.formulario.findMany({ where: { tenantId: req.tenant.id }, orderBy: { ordem: "asc" } });
      res.json({ formularios: fs.map((f) => ({ chave: f.chave, titulo: f.definicao?.title || f.chave, ordem: f.ordem, ativo: f.ativo })) });
    } catch (err) { falha(res, err, "Erro ao listar."); }
  });
  app.put(`${A}/formularios/:chave`, ...adm, async (req, res) => {
    try {
      const f = await prisma.formulario.findUnique({ where: { tenantId_chave: { tenantId: req.tenant.id, chave: req.params.chave } } });
      if (!f) return res.status(404).json({ error: "Formulário não encontrado." });
      const d = {};
      if (req.body?.ativo !== undefined) d.ativo = Boolean(req.body.ativo);
      if (req.body?.ordem !== undefined) d.ordem = Math.max(0, Math.min(999, Number(req.body.ordem) || 0));
      await prisma.formulario.update({ where: { id: f.id }, data: d });
      res.json({ ok: true });
    } catch (err) { falha(res, err); }
  });
  // Copia formulários de outro DETRAN (só a equipe Ayio, que vê todos).
  app.post(`${A}/formularios/copiar`, ...adm, async (req, res) => {
    if (req.usuario.perfil !== "SUPERADMIN") return res.status(403).json({ error: "Só a equipe Ayio copia formulários entre DETRANs." });
    const de = String(req.body?.de || "").toLowerCase();
    try {
      const origem = await prisma.tenant.findUnique({ where: { slug: de }, include: { formularios: true } });
      if (!origem || origem.id === req.tenant.id) return res.status(400).json({ error: "Escolha outro DETRAN de origem." });
      let n = 0;
      for (const f of origem.formularios) {
        const existe = await prisma.formulario.findUnique({ where: { tenantId_chave: { tenantId: req.tenant.id, chave: f.chave } } });
        if (existe) continue;
        await prisma.formulario.create({ data: { tenantId: req.tenant.id, chave: f.chave, ordem: f.ordem, definicao: f.definicao, ativo: f.ativo } });
        n++;
      }
      res.json({ copiados: n });
    } catch (err) { falha(res, err); }
  });
}
