// Conta rápida do cidadão: "Meus pedidos" (25/11/2026).
//
// O cidadão entra só com o número do WhatsApp: recebe um código de 6 números
// no próprio WhatsApp (isso prova que o número é dele) e vê os pedidos e
// protocolos abertos com aquele número, a linha do tempo pública de cada um, e
// pode responder ou mandar o documento que a Central pediu. Sem senha.
//
// Segurança:
//  - código de 6 dígitos, vale 10 minutos, no máximo 5 tentativas; no KV fica só o hash;
//  - no máximo 3 códigos por número por hora e 5 pedidos de código por IP por minuto;
//  - sessão: cookie HttpOnly, SameSite=Strict, Secure em https, assinado com
//    AUTH_SECRET, válido por 30 dias e só para /api/t/<slug>/conta;
//    "Sair de todos os aparelhos" troca a versão da conta e derruba as outras sessões;
//  - DETRAN sem WhatsApp ligado: só a consulta simples (protocolo + telefone),
//    que mostra situação e previsão, sem mensagens nem anexos.
//
//   POST /api/t/<slug>/conta/codigo                       { telefone }
//   POST /api/t/<slug>/conta/entrar                       { telefone, codigo }
//   GET  /api/t/<slug>/conta                              -> { logado, telefone, pedidos, jornadas }
//   POST /api/t/<slug>/conta/sair                         { todos? }
//   POST /api/t/<slug>/conta/pedidos/:protocolo/mensagem  { texto, anexos }
//   POST /api/t/<slug>/conta/consultar                    { protocolo, telefone }
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./db.js";
import { comTenant, integracoes } from "./tenants.js";
import { assinarToken, lerToken } from "./cripto.js";
import { STATUS_TEXTO } from "./gestao-config.js";
import { JORNADAS, lerJornada, cartao } from "./jornadas.js";
import { normalizarFone, lerAnexo, garantirTabelaAnexos } from "./protocolo-jornada.js";
import { kvGetStr, kvSetEx, kvDel } from "../store.js";

const DIAS_SESSAO = 30;
const CODIGO_MIN = 10;
const MAX_TENTATIVAS = 5;
const MAX_CODIGOS_HORA = 3;
const ENCERRADOS = ["RESOLVIDO", "CANCELADO"];
const PROTOCOLO_RE = /^[A-Z]{2}-\d{4}-\d{6}$/;
const MAX_ANEXOS_MSG = 4;
const MAX_TOTAL_MSG = 4_000_000;

const k = {
  cod: (slug, f) => `conta-cod:${slug}:${f}`,
  n: (slug, f) => `conta-n:${slug}:${f}`,
  ver: (slug, f) => `conta-ver:${slug}:${f}`,
  msg: (slug, f) => `conta-msg:${slug}:${f}`,
};
const nomeCookie = (slug) => `detran_conta_${slug}`;
const hash = (slug, fone, codigo) => createHash("sha256").update(`${slug}|${fone}|${codigo}`).digest();
const lerJson = async (chave) => { try { return JSON.parse((await kvGetStr(chave)) || "null"); } catch { return null; } };

// O mesmo celular pode estar gravado com ou sem o 9 da frente (WhatsApp antigo).
export function variantesFone(fone) {
  const f = normalizarFone(fone);
  if (!f) return [];
  const ddd = f.slice(2, 4), resto = f.slice(4);
  if (resto.length === 9 && resto[0] === "9") return [f, `55${ddd}${resto.slice(1)}`];
  if (resto.length === 8 && /^[6-9]/.test(resto)) return [f, `55${ddd}9${resto}`];
  return [f];
}
// "(91) •••••-7641"
export function mascararFone(fone) {
  const f = normalizarFone(fone) || "";
  return f ? `(${f.slice(2, 4)}) •••••-${f.slice(-4)}` : "";
}
export const whatsappLigado = (t) => { const z = integracoes(t).zapayio; return Boolean(z.instanceId && z.token); };
export const linkConta = (t) => `${(process.env.PUBLIC_URL || "").replace(/\/+$/, "")}/${t.slug}/conta`;

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie || "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0 && parte.slice(0, i).trim() === nome) { try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}
const seguro = (req) => req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
function gravarSessao(req, res, t, valor, maxAge) {
  res.append("Set-Cookie", `${nomeCookie(t.slug)}=${encodeURIComponent(valor)}; Path=/api/t/${t.slug}/conta; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${seguro(req) ? "; Secure" : ""}`);
}

// Sessão válida -> telefone (55DDDNÚMERO); senão null.
export async function sessaoConta(req, t) {
  const d = lerToken(lerCookie(req, nomeCookie(t.slug)));
  if (!d || d.tipo !== "conta" || d.slug !== t.slug || !normalizarFone(d.fone)) return null;
  const ver = Number(await kvGetStr(k.ver(t.slug, d.fone)).catch(() => 0)) || 0;
  return ver === (Number(d.v) || 0) ? d.fone : null;
}

// Pedidos (chamados) de um telefone, com a linha do tempo pública.
export async function pedidosDoFone(t, fone, { eventos = true, limite = 20 } = {}) {
  const contatos = variantesFone(fone);
  if (!contatos.length) return [];
  const chs = await prisma.chamado.findMany({ where: { tenantId: t.id, contato: { in: contatos } }, orderBy: { criadoEm: "desc" }, take: limite });
  const evs = eventos && chs.length
    ? await prisma.chamadoEvento.findMany({ where: { chamadoId: { in: chs.map((c) => c.id) }, publico: true }, orderBy: { criadoEm: "asc" } })
    : [];
  return chs.map((c) => ({
    protocolo: c.protocolo, assunto: c.assunto, status: c.status, statusTexto: STATUS_TEXTO[c.status] || c.status,
    aberto: !ENCERRADOS.includes(c.status), aguardandoVoce: c.status === "AGUARDANDO_CIDADAO",
    criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, prazoEm: c.prazoEm, resolvidoEm: c.resolvidoEm,
    eventos: evs.filter((e) => e.chamadoId === c.id).map((e) => ({ texto: e.texto, em: e.criadoEm, deVoce: /^Cidadão/.test(e.autorNome || "") })),
  }));
}

// Acompanhamentos (jornadas) do WhatsApp deste número.
async function jornadasDoFone(t, fone) {
  const out = [];
  for (const f of variantesFone(fone)) {
    const est = await lerJornada(t.slug, `wa:${f}`).catch(() => null);
    if (!est || !JORNADAS[est.jornada]) continue;
    const c = cartao(t, est);
    out.push({ titulo: c.jornada.titulo, icone: c.jornada.icone, concluida: c.concluida, etapa: c.etapa?.titulo || "", atual: c.progresso.atual, total: c.progresso.total, protocolo: c.dados?.protocolo || null, prazos: c.prazos });
  }
  return out;
}

// Texto de "MEUS PEDIDOS" no WhatsApp.
export async function textoMeusPedidos(t, fone) {
  const ps = await pedidosDoFone(t, fone, { eventos: false, limite: 10 });
  if (!ps.length) return `Não encontrei pedidos no ${t.sigla} com este número.\n\nPara começar um, escreva *MENU*.`;
  const linhas = [`📋 *Seus pedidos no ${t.sigla}*`, ""];
  for (const p of ps) {
    linhas.push(`• *${p.protocolo}*: ${p.assunto}`, `  ${p.aguardandoVoce ? "⚠️ " : ""}${p.statusTexto}${p.aberto && p.prazoEm ? ` (previsão ${new Date(p.prazoEm).toLocaleDateString("pt-BR")})` : ""}`);
  }
  linhas.push("", "Para ver os detalhes de um deles, mande: *protocolo NÚMERO*");
  if (process.env.PUBLIC_URL) linhas.push(`Para responder ou mandar documentos pelo site: ${linkConta(t)}`);
  return linhas.join("\n");
}

export function registrarContaCidadao(app, { limitar, enviar } = {}) {
  const C = "/api/t/:slug/conta";
  const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const semCache = (res) => res.set("Cache-Control", "private, no-store");

  app.post(`${C}/codigo`, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    const fone = normalizarFone(req.body?.telefone);
    if (!fone) return res.status(400).json({ error: "Informe o WhatsApp com DDD." });
    if (!whatsappLigado(t) || !enviar) return res.status(409).json({ error: `O ${t.sigla} ainda não liberou a entrada por WhatsApp. Use a consulta pelo número do protocolo.`, semWhatsApp: true });
    if (limitar && limitar(`conta-cod:${t.slug}:${ip(req)}`, 5)) return res.status(429).json({ error: "Muitos pedidos de código. Aguarde um minuto." });
    const n = Number(await kvGetStr(k.n(t.slug, fone)).catch(() => 0)) || 0;
    if (n >= MAX_CODIGOS_HORA) return res.status(429).json({ error: "Já enviamos 3 códigos para este número na última hora. Aguarde e tente de novo." });
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await kvSetEx(k.cod(t.slug, fone), JSON.stringify({ h: hash(t.slug, fone, codigo).toString("base64"), tent: 0 }), CODIGO_MIN * 60);
    await kvSetEx(k.n(t.slug, fone), String(n + 1), 3600);
    try {
      await enviar(t, fone, `🔐 *${codigo}* é o seu código para entrar em "Meus pedidos" do ${t.sigla}. Vale por ${CODIGO_MIN} minutos.\n\nNão passe este código para ninguém, nem para quem disser que é do ${t.sigla}.`);
    } catch (e) {
      console.warn("[conta] código não enviado:", String(e?.message || e).slice(0, 120));
      await kvDel(k.cod(t.slug, fone)).catch(() => {});
      return res.status(502).json({ error: "Não consegui mandar o código no WhatsApp agora. Tente de novo em alguns minutos." });
    }
    res.json({ ok: true, enviadoPara: mascararFone(fone), validadeMin: CODIGO_MIN });
  });

  app.post(`${C}/entrar`, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    const fone = normalizarFone(req.body?.telefone);
    const codigo = String(req.body?.codigo || "").replace(/\D/g, "");
    if (!fone || codigo.length !== 6) return res.status(400).json({ error: "Informe o WhatsApp e o código de 6 números." });
    if (limitar && limitar(`conta-entrar:${t.slug}:${ip(req)}`, 10)) return res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
    const st = await lerJson(k.cod(t.slug, fone));
    if (!st) return res.status(400).json({ error: "Código vencido ou não pedido. Peça um novo." });
    const ok = (() => { try { const a = Buffer.from(st.h, "base64"), b = hash(t.slug, fone, codigo); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; } })();
    if (!ok) {
      st.tent = (st.tent || 0) + 1;
      if (st.tent >= MAX_TENTATIVAS) { await kvDel(k.cod(t.slug, fone)); return res.status(429).json({ error: "Código errado muitas vezes. Peça um novo." }); }
      await kvSetEx(k.cod(t.slug, fone), JSON.stringify(st), CODIGO_MIN * 60);
      return res.status(400).json({ error: `Código não confere. Restam ${MAX_TENTATIVAS - st.tent} tentativa(s).` });
    }
    await kvDel(k.cod(t.slug, fone));
    const v = Number(await kvGetStr(k.ver(t.slug, fone)).catch(() => 0)) || 0;
    gravarSessao(req, res, t, assinarToken({ tipo: "conta", slug: t.slug, fone, v }, DIAS_SESSAO * 24), DIAS_SESSAO * 86400);
    res.json({ ok: true });
  });

  app.get(C, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    const fone = await sessaoConta(req, t);
    if (!fone) return res.json({ logado: false, entrarPorWhatsApp: whatsappLigado(t) && Boolean(enviar) });
    try {
      const [pedidos, jornadas] = await Promise.all([pedidosDoFone(t, fone), jornadasDoFone(t, fone)]);
      res.json({ logado: true, telefone: mascararFone(fone), pedidos, jornadas });
    } catch (e) {
      console.error("[conta]", String(e?.message || e).slice(0, 160));
      res.status(500).json({ error: "Não consegui carregar os seus pedidos agora." });
    }
  });

  app.post(`${C}/sair`, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    const fone = await sessaoConta(req, t);
    if (fone && req.body?.todos === true) {
      const v = Number(await kvGetStr(k.ver(t.slug, fone)).catch(() => 0)) || 0;
      await kvSetEx(k.ver(t.slug, fone), String(v + 1), DIAS_SESSAO * 86400 * 2);
    }
    gravarSessao(req, res, t, "", 0);
    res.json({ ok: true });
  });

  // Resposta do cidadão (texto e/ou documentos) num pedido aberto.
  app.post(`${C}/pedidos/:protocolo/mensagem`, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    const fone = await sessaoConta(req, t);
    if (!fone) return res.status(401).json({ error: "Entre de novo para continuar." });
    const protocolo = String(req.params.protocolo || "").toUpperCase();
    if (!PROTOCOLO_RE.test(protocolo)) return res.status(400).json({ error: "Protocolo inválido." });
    const n = Number(await kvGetStr(k.msg(t.slug, fone)).catch(() => 0)) || 0;
    if (n >= 10) return res.status(429).json({ error: "Muitas mensagens seguidas. Aguarde alguns minutos." });
    const ch = await prisma.chamado.findFirst({ where: { tenantId: t.id, protocolo, contato: { in: variantesFone(fone) } } });
    if (!ch) return res.status(404).json({ error: "Pedido não encontrado para este número." });
    if (ENCERRADOS.includes(ch.status)) return res.status(409).json({ error: "Este pedido já foi encerrado. Para algo novo, comece outro pedido." });
    const texto = String(req.body?.texto || "").replace(/\r/g, "").trim().slice(0, 1500);
    const brutos = Array.isArray(req.body?.anexos) ? req.body.anexos : [];
    if (!texto && !brutos.length) return res.status(400).json({ error: "Escreva a mensagem ou junte um documento." });
    if (brutos.length > MAX_ANEXOS_MSG) return res.status(400).json({ error: `Envie no máximo ${MAX_ANEXOS_MSG} arquivos por vez.` });
    const anexos = [];
    for (const a of brutos) { const r = lerAnexo(a); if (r.erro) return res.status(400).json({ error: r.erro }); anexos.push(r); }
    if (anexos.reduce((s, a) => s + a.dados.length, 0) > MAX_TOTAL_MSG) return res.status(400).json({ error: "Os arquivos juntos passam de 4 MB. Envie menos ou menores." });
    try {
      if (anexos.length) await garantirTabelaAnexos();
      const partes = [texto, anexos.length ? `Documentos enviados: ${anexos.map((a) => a.nome).join(", ")}.` : ""].filter(Boolean);
      await prisma.chamadoEvento.create({ data: { chamadoId: ch.id, tipo: "COMENTARIO", autorNome: "Cidadão (Meus pedidos)", texto: partes.join("\n"), publico: true } });
      for (const a of anexos) {
        await prisma.$executeRawUnsafe("INSERT INTO chamado_anexo (id, tenantId, chamadoId, nome, mime, tamanho, dados) VALUES (?, ?, ?, ?, ?, ?, ?)",
          randomUUID(), t.id, ch.id, a.nome, a.mime, a.dados.length, a.dados);
      }
      let status = ch.status;
      if (ch.status === "AGUARDANDO_CIDADAO") {
        status = "EM_ANDAMENTO";
        await prisma.chamadoEvento.create({ data: { chamadoId: ch.id, tipo: "STATUS", autorNome: "Sistema", texto: "Recebemos a sua resposta. O pedido voltou para análise.", publico: true } });
      }
      await prisma.chamado.update({ where: { id: ch.id }, data: { status, atualizadoEm: new Date() } });
      await kvSetEx(k.msg(t.slug, fone), String(n + 1), 600);
      res.status(201).json({ ok: true, status, statusTexto: STATUS_TEXTO[status] || status });
    } catch (e) {
      console.error("[conta] mensagem:", String(e?.message || e).slice(0, 160));
      res.status(500).json({ error: "Não consegui enviar agora. Tente de novo em alguns minutos." });
    }
  });

  // Consulta simples, sem conta: só situação e previsão (nada de mensagens ou anexos).
  app.post(`${C}/consultar`, comTenant, async (req, res) => {
    semCache(res);
    const t = req.tenant;
    if (limitar && limitar(`conta-consulta:${t.slug}:${ip(req)}`, 10)) return res.status(429).json({ error: "Muitas consultas seguidas. Aguarde um minuto." });
    const protocolo = String(req.body?.protocolo || "").trim().toUpperCase();
    const fone = normalizarFone(req.body?.telefone);
    if (!PROTOCOLO_RE.test(protocolo) || !fone) return res.status(400).json({ error: "Informe o número do protocolo (ex.: PA-2026-000123) e o WhatsApp usado no pedido." });
    const ch = await prisma.chamado.findFirst({ where: { tenantId: t.id, protocolo, contato: { in: variantesFone(fone) } } });
    if (!ch) return res.status(404).json({ error: "Não encontrei esse protocolo com esse número. Confira os dois." });
    res.json({ protocolo: ch.protocolo, assunto: ch.assunto, statusTexto: STATUS_TEXTO[ch.status] || ch.status, aguardandoVoce: ch.status === "AGUARDANDO_CIDADAO", prazoEm: ENCERRADOS.includes(ch.status) ? null : ch.prazoEm, atualizadoEm: ch.atualizadoEm });
  });
}
