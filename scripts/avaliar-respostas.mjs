#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Avaliação objetiva do assistente: roda o conjunto oficial de perguntas pela
// Tutoria (não cria conversa de cidadão nem entra nos relatórios do DETRAN) e
// calcula a taxa de acerto por categoria.
//
// Uso (PowerShell):
//   $env:AVALIACAO_LOGIN="<login com perfil Tutor ou Gestor>"; $env:AVALIACAO_SENHA="<senha>"
//   node scripts/avaliar-respostas.mjs --slug pa [--url https://detranpa.vercel.app] [--meta 95] [--so cnh]
//
// Gera tests/avaliacao/resultados/<slug>-<data>.md e .json. Sai com código 1 se
// a taxa de acerto ficar abaixo da meta (para usar em rotina automática).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, padrao) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : padrao; };
const SLUG = arg("slug", process.env.AVALIACAO_SLUG || "pa");
const URL_BASE = String(arg("url", process.env.AVALIACAO_URL || "https://detranpa.vercel.app")).replace(/\/+$/, "");
const META = Number(arg("meta", process.env.AVALIACAO_META || 95));
const FILTRO = arg("so", "");
const PARALELO = Number(arg("paralelo", 2));
const ARQ = arg("arquivo", join(RAIZ, "tests", "avaliacao", `perguntas-${SLUG}.json`));

export const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

// Regra objetiva: precisa de ao menos uma alternativa de cada grupo "deve" e
// de nenhuma das expressões "nao". Respostas vazias contam como erro.
export function corrigir(item, resposta) {
  const r = normalizar(resposta);
  if (!r.trim()) return { ok: false, motivo: "resposta vazia" };
  const faltou = (item.deve || []).filter((grupo) => !grupo.some((alt) => r.includes(normalizar(alt))));
  const proibido = (item.nao || []).filter((x) => r.includes(normalizar(x)));
  if (/\[\[(sembase|jornada|break|form)/i.test(resposta)) proibido.push("marcador interno [[...]] apareceu");
  return { ok: !faltou.length && !proibido.length, faltou: faltou.map((g) => g.join(" | ")), proibido };
}

async function entrar() {
  const login = process.env.AVALIACAO_LOGIN, senha = process.env.AVALIACAO_SENHA;
  if (!login || !senha) throw new Error("Defina AVALIACAO_LOGIN e AVALIACAO_SENHA (usuário com perfil Tutor ou Gestor).");
  const r = await fetch(`${URL_BASE}/api/t/${SLUG}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, senha }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(`Login recusado (${r.status}): ${j.error || ""}`);
  return j.token;
}

async function perguntar(tok, pergunta) {
  const t0 = Date.now();
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = await fetch(`${URL_BASE}/api/t/${SLUG}/gestao/tutoria/testar`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ pergunta }), signal: AbortSignal.timeout(90000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { resposta: String(j.resposta || ""), ms: Date.now() - t0 };
      if (tentativa === 2) return { resposta: "", ms: Date.now() - t0, erro: `HTTP ${r.status}: ${j.error || ""}` };
    } catch (e) { if (tentativa === 2) return { resposta: "", ms: Date.now() - t0, erro: e.message }; }
    await new Promise((z) => setTimeout(z, 3000));
  }
}

async function main() {
  const conjunto = JSON.parse(readFileSync(ARQ, "utf8"));
  const itens = conjunto.perguntas.filter((p) => !FILTRO || p.id.startsWith(FILTRO) || normalizar(p.cat).includes(normalizar(FILTRO)));
  console.log(`Avaliando ${itens.length} perguntas em ${URL_BASE}/${SLUG} (meta ${META}%)…`);
  const tok = await entrar();
  const resultados = new Array(itens.length);
  let prox = 0;
  await Promise.all(Array.from({ length: PARALELO }, async () => {
    while (prox < itens.length) {
      const i = prox++, item = itens[i];
      const { resposta, ms, erro } = await perguntar(tok, item.p);
      const nota = erro ? { ok: false, faltou: [], proibido: [], motivo: erro } : corrigir(item, resposta);
      resultados[i] = { id: item.id, cat: item.cat, pergunta: item.p, ok: nota.ok, faltou: nota.faltou, proibido: nota.proibido, motivo: nota.motivo, ms, resposta };
      process.stdout.write(nota.ok ? "." : "x");
    }
  }));
  console.log("");

  const porCat = {};
  for (const r of resultados) { const c = (porCat[r.cat] ||= { total: 0, ok: 0 }); c.total++; if (r.ok) c.ok++; }
  const acertos = resultados.filter((r) => r.ok).length;
  const taxa = Math.round((acertos / resultados.length) * 1000) / 10;
  const tempos = resultados.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = tempos[Math.min(tempos.length - 1, Math.floor(tempos.length * 0.95))];
  const naoInventou = resultados.filter((r) => r.id.startsWith("sab-"));
  const quando = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  const linhas = [
    `# Avaliação do assistente — ${SLUG.toUpperCase()} — ${new Date().toLocaleString("pt-BR")}`, "",
    `**Taxa de acerto: ${taxa}%** (${acertos} de ${resultados.length}) · meta ${META}% · ${taxa >= META ? "✅ dentro da meta" : "❌ abaixo da meta"}`, "",
    `- Não inventou quando não sabia: ${naoInventou.filter((r) => r.ok).length} de ${naoInventou.length}`,
    `- Tempo de resposta: mediana ${Math.round(tempos[Math.floor(tempos.length / 2)] / 100) / 10} s · 95% abaixo de ${Math.round(p95 / 100) / 10} s`,
    `- Conjunto: ${conjunto.versao} (${conjunto.status})`, "",
    "## Por categoria", "", "| Categoria | Acertos | Taxa |", "| --- | --- | --- |",
    ...Object.entries(porCat).map(([c, v]) => `| ${c} | ${v.ok}/${v.total} | ${Math.round((v.ok / v.total) * 100)}% |`), "",
    "## Erros (para revisar ou ensinar pela Tutoria)", "",
    ...resultados.filter((r) => !r.ok).flatMap((r) => [
      `### ${r.id} — ${r.pergunta}`,
      r.motivo ? `- Motivo: ${r.motivo}` : "",
      r.faltou?.length ? `- Faltou: ${r.faltou.join("; ")}` : "",
      r.proibido?.length ? `- Não devia aparecer: ${r.proibido.join("; ")}` : "",
      `- Resposta: ${r.resposta.replace(/\s+/g, " ").slice(0, 600) || "(vazia)"}`, "",
    ].filter(Boolean)),
  ];
  const dir = join(RAIZ, "tests", "avaliacao", "resultados");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SLUG}-${quando}.md`), linhas.join("\n"), "utf8");
  writeFileSync(join(dir, `${SLUG}-${quando}.json`), JSON.stringify({ slug: SLUG, url: URL_BASE, taxa, meta: META, acertos, total: resultados.length, p95ms: p95, porCat, resultados }, null, 2), "utf8");
  console.log(`Taxa de acerto: ${taxa}% (${acertos}/${resultados.length}). Relatório: tests/avaliacao/resultados/${SLUG}-${quando}.md`);
  process.exit(taxa >= META ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(2); });
