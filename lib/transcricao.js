// Transcrição de áudio do WhatsApp (o cidadão manda áudio em vez de digitar).
// Provedor plugável por variável de ambiente — sem chave, fica desligado e o
// WhatsApp segue pedindo texto, como antes:
//   GROQ_API_KEY   -> Groq, modelo whisper-large-v3-turbo (barato e rápido)
//   OPENAI_API_KEY -> OpenAI, modelo whisper-1
// O áudio não é guardado: baixa, transcreve e descarta.

const MAX_BYTES = 12 * 1024 * 1024; // ~10 min de áudio do WhatsApp

export function provedorStt() {
  if (process.env.GROQ_API_KEY) return { nome: "groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", chave: process.env.GROQ_API_KEY, modelo: process.env.STT_MODELO || "whisper-large-v3-turbo" };
  if (process.env.OPENAI_API_KEY) return { nome: "openai", url: "https://api.openai.com/v1/audio/transcriptions", chave: process.env.OPENAI_API_KEY, modelo: process.env.STT_MODELO || "whisper-1" };
  return null;
}
export const sttConfigurado = () => Boolean(provedorStt());

// Só baixa de https (o link vem no webhook autenticado do Zapayio).
export async function transcreverUrl(url, { fetchImpl = fetch } = {}) {
  const p = provedorStt();
  if (!p) throw new Error("transcrição não configurada");
  let u;
  try { u = new URL(String(url)); } catch { throw new Error("link de áudio inválido"); }
  if (u.protocol !== "https:") throw new Error("link de áudio precisa ser https");

  const r = await fetchImpl(u.href, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`não consegui baixar o áudio (${r.status})`);
  const tam = Number(r.headers.get("content-length") || 0);
  if (tam > MAX_BYTES) throw new Error("áudio longo demais");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("áudio longo demais");
  const tipo = (r.headers.get("content-type") || "audio/ogg").split(";")[0];
  const ext = tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") || tipo.includes("m4a") ? "m4a" : tipo.includes("wav") ? "wav" : "ogg";

  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: tipo }), `audio.${ext}`);
  fd.append("model", p.modelo);
  fd.append("language", "pt");
  fd.append("response_format", "json");
  const t = await fetchImpl(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.chave}` }, body: fd, signal: AbortSignal.timeout(45000) });
  const d = await t.json().catch(() => ({}));
  if (!t.ok) throw new Error(`transcrição recusada (${t.status})`);
  return String(d.text || "").trim();
}
