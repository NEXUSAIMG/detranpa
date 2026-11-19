// ─────────────────────────────────────────────────────────────────────────────
// Migração do sistema antigo (um DETRAN só, dados no Redis/Upstash ou em data/)
// para a estrutura multi-tenant.
//
//   node scripts/migrar-legado.js --tenant pa               (SIMULAÇÃO: só mostra)
//   node scripts/migrar-legado.js --tenant pa --aplicar     (grava)
//
// Opções:
//   --fonte kv|arquivo   de onde ler o legado (padrão: kv se houver KV_REST_API_URL)
//   --so dados|conhecimento   roda só uma parte
//   --forcar            refaz etapas já registradas como migradas
//
// O que faz:
//   1. Eventos (perguntas e 👍/👎) e atendimentos do balcão -> MySQL do DETRAN
//   2. Conhecimento -> bot do DETRAN no BotAyio:
//        - base oficial: knowledge/<slug>/*.md
//        - o que foi ensinado na Sala do Tutor antiga
//      em trechos de ~900 caracteres (o mesmo tamanho que o BotAyio usa)
//   3. Perguntas sem resposta (lacunas) -> relatório migracao-<slug>-lacunas.md
//      para o tutor revisar na tutoria do bot
//
// O Redis antigo é só LIDO (nada é apagado). Cada etapa fica registrada na
// tabela MigracaoLegado; rodar de novo não duplica.
//
// Para o BotAyio, além da integração do DETRAN já cadastrada (URL do bot),
// defina BOTAYIO_EMAIL e BOTAYIO_SENHA de um usuário editor/admin do BotAyio.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "../lib/db.js";
import { integracoes } from "../lib/tenants.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : null; };
const SLUG = String(opt("tenant") || "").toLowerCase();
const APLICAR = Boolean(opt("aplicar"));
const FORCAR = Boolean(opt("forcar"));
const SO = opt("so");
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const FONTE = opt("fonte") || (KV_URL && KV_TOKEN ? "kv" : "arquivo");
const CHUNK = 900;
const log = (...a) => console.log(...a);

// ── Leitura do legado (somente leitura) ─────────────────────────────────────
async function kvGet(chave) {
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(["GET", chave]) });
  if (!r.ok) throw new Error(`KV HTTP ${r.status}`);
  return (await r.json()).result;
}
const json = (txt, padrao) => { try { return txt ? JSON.parse(txt) : padrao; } catch { return padrao; } };
const arquivo = (nome, padrao) => { const p = join(ROOT, "data", nome); return existsSync(p) ? json(readFileSync(p, "utf8"), padrao) : padrao; };

async function lerLegado() {
  if (FONTE === "kv") {
    if (!KV_URL || !KV_TOKEN) throw new Error("Sem KV_REST_API_URL/KV_REST_API_TOKEN para ler o legado.");
    let indice = json(await kvGet("detranpa:tutor:index"), null);
    let tutor = [];
    if (indice) {
      for (const m of indice) tutor.push({ ...m, content: (await kvGet(`detranpa:tutor:c:${m.id}`)) || "" });
    } else {
      tutor = json(await kvGet("detranpa:tutor:knowledge"), []); // formato bem antigo
    }
    return {
      tutor,
      eventos: json(await kvGet("detranpa:events"), []),
      lacunas: json(await kvGet("detranpa:gaps"), []),
      balcao: json(await kvGet("detranpa:balcao"), []),
    };
  }
  const t = arquivo("tutor-knowledge.json", { index: [], contents: {} });
  const tutor = Array.isArray(t) ? t : (t.index || []).map((m) => ({ ...m, content: (t.contents || {})[m.id] || "" }));
  return { tutor, eventos: arquivo("events.json", []), lacunas: arquivo("gaps.json", []), balcao: arquivo("balcao.json", []) };
}

// ── Controle de etapas ──────────────────────────────────────────────────────
async function jaMigrado(tenantId, etapa) {
  if (FORCAR) return false;
  return Boolean(await prisma.migracaoLegado.findUnique({ where: { tenantId_etapa: { tenantId, etapa } } }));
}
async function registrar(tenantId, etapa, total, detalhe) {
  await prisma.migracaoLegado.upsert({
    where: { tenantId_etapa: { tenantId, etapa } },
    create: { tenantId, etapa, total, detalhe }, update: { total, detalhe, executadaEm: new Date() },
  });
}

// ── 1. Dados -> MySQL ───────────────────────────────────────────────────────
async function migrarEventos(t, eventos) {
  const linhas = eventos.filter((e) => e && e.at).map((e) => e.k === "fb"
    ? { tenantId: t.id, tipo: "FEEDBACK", canal: "WEB", positivo: Boolean(e.up), criadoEm: new Date(e.at) }
    : { tenantId: t.id, tipo: "PERGUNTA", canal: "WEB", tema: e.t || "outros", resolvido: e.r !== 0, criadoEm: new Date(e.at) });
  const perguntas = linhas.filter((l) => l.tipo === "PERGUNTA").length;
  log(`  Eventos: ${linhas.length} (${perguntas} perguntas, ${linhas.length - perguntas} avaliações)`);
  if (await jaMigrado(t.id, "eventos")) return log("  -> já migrados antes (use --forcar para refazer)");
  if (!APLICAR || !linhas.length) return;
  for (let i = 0; i < linhas.length; i += 500) await prisma.evento.createMany({ data: linhas.slice(i, i + 500) });
  await registrar(t.id, "eventos", linhas.length);
  log("  -> gravados");
}

async function migrarBalcao(t, balcao) {
  const s = (v, n) => (v == null || v === "" ? null : String(v).slice(0, n));
  const linhas = balcao.filter((b) => b && (b.servico || b.resumo)).map((b) => ({
    tenantId: t.id, guiche: s(b.guiche, 40), atendente: s(b.atendente, 60), servico: s(b.servico, 120),
    cidadao: s(b.cidadao, 80), cpf: s(b.cpf, 20), protocolo: s(b.protocolo, 40), resumo: s(b.resumo, 1500),
    criadoEm: new Date(b.at || Date.now()),
  }));
  log(`  Atendimentos do balcão: ${linhas.length}`);
  if (await jaMigrado(t.id, "balcao")) return log("  -> já migrados antes (use --forcar para refazer)");
  if (!APLICAR || !linhas.length) return;
  await prisma.atendimentoBalcao.createMany({ data: linhas });
  await registrar(t.id, "balcao", linhas.length);
  log("  -> gravados");
}

function relatorioLacunas(t, lacunas) {
  const vistas = new Map();
  for (const g of lacunas) {
    const q = String(g?.q || "").trim();
    if (!q) continue;
    const k = q.toLowerCase();
    const v = vistas.get(k) || { q, n: 0, ultima: 0 };
    v.n++; v.ultima = Math.max(v.ultima, g.at || 0); vistas.set(k, v);
  }
  const itens = [...vistas.values()].sort((a, b) => b.n - a.n || b.ultima - a.ultima);
  log(`  Perguntas sem resposta: ${lacunas.length} registros, ${itens.length} distintas`);
  if (!APLICAR || !itens.length) return;
  const arq = join(ROOT, `migracao-${t.slug}-lacunas.md`);
  const linhas = itens.map((i) => `- (${i.n}x${i.ultima ? `, última em ${new Date(i.ultima).toLocaleDateString("pt-BR")}` : ""}) ${i.q.replace(/\n/g, " ")}`);
  writeFileSync(arq, `# Perguntas que o assistente antigo não soube responder — ${t.sigla}\n\nUse esta lista na tutoria do bot no BotAyio para completar a base.\n\n${linhas.join("\n")}\n`, "utf8");
  log(`  -> relatório: ${arq} (não vai para o Git: contém perguntas de cidadãos)`);
}

// ── 2. Conhecimento -> BotAyio ──────────────────────────────────────────────
// Divide o texto em trechos de até ~900 caracteres, preferindo quebrar em
// parágrafos e mantendo o título da seção (## ...) como parte do tópico.
export function fatiar(titulo, texto) {
  const secoes = [];
  let atual = { titulo, linhas: [] };
  for (const linha of String(texto || "").replace(/\r\n/g, "\n").split("\n")) {
    const h = linha.match(/^#{1,3}\s+(.+)/);
    if (h) { if (atual.linhas.join("").trim()) secoes.push(atual); atual = { titulo: `${titulo} — ${h[1].trim()}`, linhas: [] }; continue; }
    atual.linhas.push(linha);
  }
  if (atual.linhas.join("").trim()) secoes.push(atual);
  const trechos = [];
  for (const sec of secoes) {
    const paragrafos = sec.linhas.join("\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    const soltar = () => { if (buf.trim()) trechos.push({ titulo: sec.titulo, conteudo: buf.trim() }); buf = ""; };
    for (const p of paragrafos) {
      if (p.length > CHUNK) {
        soltar();
        for (let i = 0; i < p.length; i += CHUNK) trechos.push({ titulo: sec.titulo, conteudo: p.slice(i, i + CHUNK).trim() });
        continue;
      }
      if ((buf + "\n\n" + p).length > CHUNK) soltar();
      buf += (buf ? "\n\n" : "") + p;
    }
    soltar();
  }
  // Numera quando uma seção vira vários trechos; tópico tem no máximo 200 caracteres.
  const porTitulo = new Map();
  for (const t of trechos) porTitulo.set(t.titulo, (porTitulo.get(t.titulo) || 0) + 1);
  const cont = new Map();
  return trechos.map((t) => {
    const n = porTitulo.get(t.titulo);
    const i = (cont.get(t.titulo) || 0) + 1; cont.set(t.titulo, i);
    const suf = n > 1 ? ` (parte ${i}/${n})` : "";
    return { topico: (t.titulo.slice(0, 200 - suf.length) + suf).trim(), conteudo: t.conteudo };
  });
}

function itensConhecimento(t, tutor) {
  const itens = [];
  const dir = join(ROOT, "knowledge", t.slug);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
      const nome = f.replace(/\.md$/, "").replace(/[_-]+/g, " ");
      itens.push(...fatiar(`[Base ${t.sigla}] ${nome}`, readFileSync(join(dir, f), "utf8")));
    }
  }
  for (const e of tutor) {
    if (!e?.content?.trim()) continue;
    itens.push(...fatiar(`[Tutor] ${String(e.title || "Sem título").trim()}`, e.content));
  }
  return itens;
}

async function botayioApi(t) {
  const { botayio } = integracoes(t);
  const m = String(botayio.url || "").match(/^(https?:\/\/.+?)\/webhooks\/seucartorio\/([0-9a-f-]{36})\/?$/i);
  if (!m) throw new Error("A integração do BotAyio deste DETRAN não está cadastrada (ou a URL não é /webhooks/seucartorio/<bot_id>).");
  const [, base, botId] = m;
  const email = process.env.BOTAYIO_EMAIL, senha = process.env.BOTAYIO_SENHA;
  if (!email || !senha) throw new Error("Defina BOTAYIO_EMAIL e BOTAYIO_SENHA (usuário editor/admin do BotAyio).");
  const rl = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
  if (!rl.ok) throw new Error(`Login no BotAyio falhou (HTTP ${rl.status}).`);
  const { access_token: tok } = await rl.json();
  const h = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
  return {
    botId,
    async existentes() {
      const r = await fetch(`${base}/knowledge?bot_id=${botId}`, { headers: h });
      if (!r.ok) throw new Error(`Listar base do BotAyio falhou (HTTP ${r.status}).`);
      return new Set((await r.json()).map((i) => i.topico));
    },
    async criar(item) {
      const r = await fetch(`${base}/knowledge`, { method: "POST", headers: h, body: JSON.stringify({ bot_id: botId, ...item }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    },
  };
}

async function migrarConhecimento(t, tutor) {
  const itens = itensConhecimento(t, tutor);
  const base = itens.filter((i) => i.topico.startsWith("[Base")).length;
  log(`  Conhecimento para o bot no BotAyio: ${itens.length} trechos (${base} da base oficial, ${itens.length - base} do Tutor antigo, ${tutor.length} itens ensinados)`);
  if (itens.length) log(`    ex.: "${itens[0].topico}" (${itens[0].conteudo.length} caracteres)`);
  if (itens.length > 600) log("  ⚠ Muitos trechos: confira o custo de vetorização no BotAyio antes de aplicar.");
  if (await jaMigrado(t.id, "conhecimento")) return log("  -> já migrado antes (use --forcar para refazer)");
  if (!APLICAR || !itens.length) return;
  const api = await botayioApi(t);
  const ja = await api.existentes();
  let criados = 0, pulados = 0, falhas = 0;
  for (const it of itens) {
    if (ja.has(it.topico)) { pulados++; continue; }
    try { await api.criar(it); criados++; }
    catch (err) { falhas++; console.error(`    falhou "${it.topico}": ${err.message}`); }
  }
  log(`  -> BotAyio: ${criados} criados, ${pulados} já existiam, ${falhas} falharam`);
  if (!falhas) await registrar(t.id, "conhecimento", criados + pulados, `bot ${api.botId}`);
  else log("  -> etapa NÃO marcada como concluída por causa das falhas; rode de novo (os já criados são pulados).");
}

// ── Execução ────────────────────────────────────────────────────────────────
async function main() {
  if (!SLUG) throw new Error("Uso: node scripts/migrar-legado.js --tenant <slug> [--aplicar] [--fonte kv|arquivo] [--so dados|conhecimento] [--forcar]");
  const t = await prisma.tenant.findUnique({ where: { slug: SLUG }, include: { integracao: true } });
  if (!t) throw new Error(`DETRAN "${SLUG}" não existe. Rode antes: npm run tenant -- seed ${SLUG}`);
  log(`\n${APLICAR ? "APLICANDO" : "SIMULAÇÃO (nada será gravado; use --aplicar)"} — legado -> ${t.sigla} — fonte: ${FONTE}\n`);
  const leg = await lerLegado();
  if (!SO || SO === "dados") {
    log("Dados (MySQL):");
    await migrarEventos(t, leg.eventos);
    await migrarBalcao(t, leg.balcao);
    relatorioLacunas(t, leg.lacunas);
  }
  if (!SO || SO === "conhecimento") {
    log("\nConhecimento (BotAyio):");
    await migrarConhecimento(t, leg.tutor);
  }
  log("\nConcluído.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("Erro:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
