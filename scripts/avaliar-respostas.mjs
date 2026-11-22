#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Avaliação objetiva do assistente: roda o conjunto oficial de perguntas e dá a
// taxa de acerto (e a nota de 0 a 10) por categoria.
//
// Caminho (--via):
//   chat     (padrão) o MESMO caminho do cidadão no site: antigolpe, cache desligado,
//            BotAyio e montagem da resposta. Vai com o cabeçalho X-Avaliacao: nada é
//            gravado (conversa, estatística, custo) e o BotAyio não registra no Inbox.
//   tutoria  só o bot, pela ferramenta "testar" da Tutoria.
//
// Uso (PowerShell) — a senha você digita, ninguém mais vê:
//   $env:AVALIACAO_LOGIN="<login com perfil Tutor ou Gestor>"; $env:AVALIACAO_SENHA="<senha>"
//   node scripts/avaliar-respostas.mjs --slug pa [--url https://detranpa.vercel.app] [--meta 95] [--so cnh] [--via tutoria]
// Com verificação em 2 etapas: o script pede o código do aplicativo (ou use $env:AVALIACAO_CODIGO).
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
const VIA = arg("via", process.env.AVALIACAO_VIA || "chat");

// O que o cidadão vê: o site tira os marcadores de formulário/defesa/jornada e quebra as partes.
export const limparResposta = (r) => String(r || "")
  .replace(/\s*\[\[(FORM:[\w-]+|DEFESA|JORNADA:[\w-]+)\]\]/gi, "").replace(/\[\[BREAK\]\]/g, "\n\n").trim();
export const nota010 = (taxa) => Math.round(taxa) / 10;

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
  if (r.ok && j.precisaCadastrar2fa) throw new Error("Este usuário precisa ativar a verificação em 2 etapas pela Central antes (botão 🔐).");
  if (r.ok && j.precisa2fa && j.desafio) {
    let codigo = process.env.AVALIACAO_CODIGO;
    if (!codigo) {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      codigo = await rl.question("Código de 6 dígitos do aplicativo autenticador: "); rl.close();
    }
    const r2 = await fetch(`${URL_BASE}/api/t/${SLUG}/auth/2fa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desafio: j.desafio, codigo: String(codigo).trim() }) });
    const j2 = await r2.json().catch(() => ({}));
    if (!r2.ok || !j2.token) throw new Error(`Código recusado (${r2.status}): ${j2.error || ""}`);
    return j2.token;
  }
  if (!r.ok || !j.token) throw new Error(`Login recusado (${r.status}): ${j.error || ""}`);
  return j.token;
}

async function perguntar(tok, pergunta, id) {
  const t0 = Date.now();
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const viaChat = VIA === "chat";
      const r = await fetch(viaChat ? `${URL_BASE}/api/t/${SLUG}/chat` : `${URL_BASE}/api/t/${SLUG}/gestao/tutoria/testar`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}`, ...(viaChat ? { "X-Avaliacao": "1" } : {}) },
        body: JSON.stringify(viaChat ? { messages: [{ role: "user", content: pergunta }], sessionId: `aval-${id}-${Date.now().toString(36)}` } : { pergunta }),
        signal: AbortSignal.timeout(90000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return { resposta: viaChat ? limparResposta(j.reply) : String(j.resposta || ""), ms: Date.now() - t0, origem: j.origem };
      if (tentativa === 2) return { resposta: "", ms: Date.now() - t0, erro: `HTTP ${r.status}: ${j.error || ""}` };
    } catch (e) { if (tentativa === 2) return { resposta: "", ms: Date.now() - t0, erro: e.message }; }
    await new Promise((z) => setTimeout(z, 3000));
  }
}

async function main() {
  const conjunto = JSON.parse(readFileSync(ARQ, "utf8"));
  const itens = conjunto.perguntas.filter((p) => !FILTRO || p.id.startsWith(FILTRO) || normalizar(p.cat).includes(normalizar(FILTRO)));
  console.log(`Avaliando ${itens.length} perguntas em ${URL_BASE}/${SLUG} pelo caminho "${VIA}" (meta ${META}%)…`);
  const tok = await entrar();
  const resultados = new Array(itens.length);
  let prox = 0;
  await Promise.all(Array.from({ length: PARALELO }, async () => {
    while (prox < itens.length) {
      const i = prox++, item = itens[i];
      const { resposta, ms, erro, origem } = await perguntar(tok, item.p, item.id);
      const nota = erro ? { ok: false, faltou: [], proibido: [], motivo: erro } : corrigir(item, resposta);
      resultados[i] = { id: item.id, cat: item.cat, pergunta: item.p, ok: nota.ok, faltou: nota.faltou, proibido: nota.proibido, motivo: nota.motivo, ms, origem, resposta };
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
    `**Nota: ${nota010(taxa).toLocaleString("pt-BR")} de 10** — taxa de acerto ${taxa}% (${acertos} de ${resultados.length}) · meta ${META}% · ${taxa >= META ? "✅ dentro da meta" : "❌ abaixo da meta"}`, "",
    `- Caminho avaliado: ${VIA === "chat" ? "o mesmo do cidadão no site (sem gravar nada)" : "só o bot, pela Tutoria"}`,
    `- Não inventou quando não sabia: ${naoInventou.filter((r) => r.ok).length} de ${naoInventou.length}`,
    `- Tempo de resposta: mediana ${Math.round(tempos[Math.floor(tempos.length / 2)] / 100) / 10} s · 95% abaixo de ${Math.round(p95 / 100) / 10} s`,
    `- Conjunto: ${conjunto.versao} (${conjunto.status})`, "",
    "## Por categoria", "", "| Categoria | Acertos | Taxa | Nota |", "| --- | --- | --- | --- |",
    ...Object.entries(porCat).map(([c, v]) => `| ${c} | ${v.ok}/${v.total} | ${Math.round((v.ok / v.total) * 100)}% | ${nota010((v.ok / v.total) * 100).toLocaleString("pt-BR")} |`), "",
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
  writeFileSync(join(dir, `${SLUG}-${quando}.json`), JSON.stringify({ slug: SLUG, url: URL_BASE, via: VIA, nota: nota010(taxa), taxa, meta: META, acertos, total: resultados.length, p95ms: p95, porCat, resultados }, null, 2), "utf8");
  console.log(`Nota ${nota010(taxa)} de 10 — taxa de acerto ${taxa}% (${acertos}/${resultados.length}). Relatório: tests/avaliacao/resultados/${SLUG}-${quando}.md`);
  process.exit(taxa >= META ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(2); });
