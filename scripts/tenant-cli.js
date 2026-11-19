// ─────────────────────────────────────────────────────────────────────────────
// Ferramenta de linha de comando para cadastrar DETRANs (até a fase do /admin).
//
//   node scripts/tenant-cli.js seed <slug>
//       Cria/atualiza o DETRAN a partir de tenants/<slug>.json
//       (+ tenants/<slug>.conteudo.json e os formulários indicados).
//
//   SENHA=... node scripts/tenant-cli.js usuario <slug|-> <login> <PERFIL> "<Nome>"
//       Cria/atualiza um usuário. PERFIL: ADMIN | GESTOR | TUTOR | BALCAO | SUPERADMIN
//       (SUPERADMIN usa "-" no lugar do slug). A senha vem da variável SENHA,
//       para não ficar no histórico do terminal.
//
//   node scripts/tenant-cli.js integracao <slug>
//       Grava as integrações a partir das variáveis (só as que estiverem definidas):
//       BOTAYIO_URL, BOTAYIO_SECRET, BOTAYIO_TUTOR_URL,
//       ZAPAYIO_BASE_URL, ZAPAYIO_INSTANCE_ID, ZAPAYIO_TOKEN,
//       ZAPAYIO_CLIENT_TOKEN, ZAPAYIO_WEBHOOK_SECRET
//       Segredos são cifrados com APP_ENCRYPTION_KEY antes de ir ao banco.
//
//   node scripts/tenant-cli.js listar
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "../lib/db.js";
import { cifrar, hashSenha } from "../lib/cripto.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , cmd, ...args] = process.argv;
const PERFIS = ["SUPERADMIN", "ADMIN", "GESTOR", "TUTOR", "BALCAO"];

async function seed(slug) {
  const arq = join(ROOT, "tenants", `${slug}.json`);
  if (!existsSync(arq)) throw new Error(`Não achei ${arq}`);
  const d = JSON.parse(readFileSync(arq, "utf8"));
  const arqConteudo = join(ROOT, "tenants", `${slug}.conteudo.json`);
  const conteudo = existsSync(arqConteudo) ? JSON.parse(readFileSync(arqConteudo, "utf8")) : {};
  const dados = {
    uf: d.uf, sigla: d.sigla, nome: d.nome, governo: d.governo, cidadeSede: d.cidadeSede,
    assistente: d.assistente, portalUrl: d.portalUrl, telefone: d.telefone,
    logoUrl: d.logoUrl || null, marcaUrl: d.marcaUrl || null, corPrimaria: d.corPrimaria || null,
    personaTom: d.personaTom || null, orientacoes: d.orientacoes || null, conteudo,
  };
  const t = await prisma.tenant.upsert({ where: { slug }, create: { slug, ...dados }, update: dados });

  let forms = [];
  if (d.formularios) {
    const mod = await import(pathToFileURL(join(ROOT, d.formularios)).href);
    forms = mod.FORMS || [];
  }
  for (const [i, f] of forms.entries()) {
    await prisma.formulario.upsert({
      where: { tenantId_chave: { tenantId: t.id, chave: f.id } },
      create: { tenantId: t.id, chave: f.id, ordem: i, definicao: f },
      update: { ordem: i, definicao: f, ativo: true },
    });
  }
  console.log(`DETRAN "${slug}" salvo (${t.sigla}) com ${forms.length} formulário(s).`);
}

async function usuario(slug, login, perfil, nome) {
  const senha = process.env.SENHA;
  if (!login || !perfil || !nome) throw new Error('Uso: SENHA=... node scripts/tenant-cli.js usuario <slug|-> <login> <PERFIL> "<Nome>"');
  if (!senha || senha.length < 8) throw new Error("Defina SENHA (mínimo 8 caracteres).");
  const p = String(perfil).toUpperCase();
  if (!PERFIS.includes(p)) throw new Error(`Perfil inválido. Use: ${PERFIS.join(", ")}`);
  let tenantId = null;
  if (p === "SUPERADMIN") { if (slug !== "-") throw new Error('SUPERADMIN usa "-" no lugar do slug.'); }
  else {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    if (!t) throw new Error(`DETRAN "${slug}" não existe.`);
    tenantId = t.id;
  }
  const l = String(login).trim().toLowerCase();
  const existente = await prisma.usuario.findFirst({ where: { tenantId, login: l } });
  const dados = { nome, perfil: p, senhaHash: hashSenha(senha), ativo: true };
  if (existente) await prisma.usuario.update({ where: { id: existente.id }, data: dados });
  else await prisma.usuario.create({ data: { tenantId, login: l, ...dados } });
  console.log(`Usuário "${l}" (${p}) ${existente ? "atualizado" : "criado"}${tenantId ? ` no DETRAN "${slug}"` : ""}.`);
}

async function integracao(slug) {
  const t = await prisma.tenant.findUnique({ where: { slug } });
  if (!t) throw new Error(`DETRAN "${slug}" não existe.`);
  const e = (k) => (process.env[k] !== undefined ? String(process.env[k]).trim() : undefined);
  const dados = {};
  const set = (campo, v, segredo = false) => { if (v !== undefined) dados[campo] = v === "" ? null : (segredo ? cifrar(v) : v); };
  set("botayioUrl", e("BOTAYIO_URL"));
  set("botayioSecretEnc", e("BOTAYIO_SECRET"), true);
  set("botayioTutorUrlEnc", e("BOTAYIO_TUTOR_URL"), true);
  set("zapayioBaseUrl", e("ZAPAYIO_BASE_URL"));
  set("zapayioInstanceId", e("ZAPAYIO_INSTANCE_ID"));
  set("zapayioTokenEnc", e("ZAPAYIO_TOKEN"), true);
  set("zapayioClientEnc", e("ZAPAYIO_CLIENT_TOKEN"), true);
  set("zapayioWebhookEnc", e("ZAPAYIO_WEBHOOK_SECRET"), true);
  if (!Object.keys(dados).length) throw new Error("Nenhuma variável de integração definida.");
  await prisma.tenantIntegracao.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id, ...dados }, update: dados });
  console.log(`Integrações do DETRAN "${slug}" atualizadas: ${Object.keys(dados).map((k) => k.replace(/Enc$/, "")).join(", ")}.`);
}

async function listar() {
  const ts = await prisma.tenant.findMany({ include: { integracao: true, _count: { select: { usuarios: true, formularios: true } } }, orderBy: { slug: "asc" } });
  for (const t of ts) {
    const i = t.integracao || {};
    console.log(`${t.slug.padEnd(6)} ${t.sigla.padEnd(12)} ativo=${t.ativo} usuarios=${t._count.usuarios} formularios=${t._count.formularios} botayio=${Boolean(i.botayioUrl)} zapayio=${Boolean(i.zapayioInstanceId)}`);
  }
}

try {
  if (cmd === "seed") await seed(args[0]);
  else if (cmd === "usuario") await usuario(...args);
  else if (cmd === "integracao") await integracao(args[0]);
  else if (cmd === "listar") await listar();
  else console.log("Comandos: seed <slug> | usuario <slug|-> <login> <PERFIL> \"<Nome>\" | integracao <slug> | listar");
} catch (err) {
  console.error("Erro:", err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
