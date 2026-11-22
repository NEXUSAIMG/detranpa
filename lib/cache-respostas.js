// ─────────────────────────────────────────────────────────────────────────────
// Cache das perguntas frequentes + medição do tempo de resposta.
//
// Só entra no cache a PRIMEIRA pergunta de uma conversa, sem foto, sem dados
// pessoais (Meu DETRAN/simulação ficam de fora), sem transbordo e com resposta
// da base. A chave leva a "versão da base" do DETRAN: ensinar algo na Tutoria
// troca a versão e invalida tudo na hora. Validade: 6 horas.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { kvGetStr, kvSetEx } from "../store.js";

const VALIDADE = 6 * 3600;
const ANO = 365 * 86400;
export const normalizarPergunta = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
const chaveVersao = (slug) => `cache:${slug}:versao`;

async function versao(slug) { return (await kvGetStr(chaveVersao(slug)).catch(() => null)) || "0"; }
const chave = (slug, ver, pergunta) => `cache:${slug}:${ver}:${createHash("sha256").update(normalizarPergunta(pergunta)).digest("hex").slice(0, 32)}`;

// Pergunta que pode ir para o cache: curta, sem números longos (CPF, placa,
// telefone, protocolo) e sem e-mail.
export function cacheavel(pergunta) {
  if (process.env.CACHE_RESPOSTAS === "0") return false; // desligado (ex.: testes ponta a ponta)
  const p = String(pergunta || "");
  return p.length >= 6 && p.length <= 200 && !/\d{5,}|@|[a-z]{3}\d[a-z0-9]\d{2}/i.test(p.replace(/\s/g, ""));
}

export async function lerCache(slug, pergunta) {
  if (!cacheavel(pergunta)) return null;
  try { const v = await kvGetStr(chave(slug, await versao(slug), pergunta)); return v ? JSON.parse(v) : null; } catch { return null; }
}
export async function guardarCache(slug, pergunta, dados) {
  if (!cacheavel(pergunta) || /\d{8,}/.test(dados?.reply || "")) return false;
  try { await kvSetEx(chave(slug, await versao(slug), pergunta), JSON.stringify(dados), VALIDADE); return true; } catch { return false; }
}
// Chamado quando a base muda (Tutoria ensinou, desligou, subiu documento, norma).
export async function invalidarCache(slug) {
  try { await kvSetEx(chaveVersao(slug), String(Date.now()), ANO); } catch (e) { console.error(`[cache:${slug}] não invalidou:`, e.message); }
}

// ── Tempo de resposta (últimas 300 por DETRAN) ──
const chaveTempos = (slug) => `lat:${slug}`;
export async function registrarTempo(slug, ms, origem) {
  try {
    let lista = []; try { lista = JSON.parse((await kvGetStr(chaveTempos(slug))) || "[]"); } catch { lista = []; }
    lista.unshift([Math.round(ms), origem === "cache" ? 1 : 0, Date.now()]);
    await kvSetEx(chaveTempos(slug), JSON.stringify(lista.slice(0, 300)), 30 * 86400);
  } catch { /* medição é acessória */ }
}
export async function resumoTempos(slug) {
  let lista = []; try { lista = JSON.parse((await kvGetStr(chaveTempos(slug))) || "[]"); } catch { lista = []; }
  const desde = Date.now() - 7 * 86400000;
  const ms = lista.filter((x) => x[2] >= desde).map((x) => x[0]).sort((a, b) => a - b);
  if (!ms.length) return { n: 0 };
  const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
  return { n: ms.length, medianaMs: q(0.5), p95Ms: q(0.95), abaixo8s: Math.round((ms.filter((x) => x <= 8000).length / ms.length) * 100), doCache: lista.filter((x) => x[2] >= desde && x[1]).length };
}
