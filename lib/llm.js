// IA do próprio app (DeepSeek por padrão, Anthropic como alternativa).
// Com o BotAyio como cérebro, ela fica para o que o BotAyio não faz:
// leitura de fotos, extração para formulários, rascunho de defesa, termo de
// exigência e copiloto do balcão. Também é o plano B do chat quando o DETRAN
// ainda não tem bot no BotAyio.
const PROVIDERS = {
  deepseek: {
    nome: "DeepSeek",
    keyVar: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/anthropic/v1/messages",
    // deepseek-flash lê imagens (fotos de documentos). deepseek-v4-pro NÃO lê.
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    extra: { thinking: { type: process.env.DEEPSEEK_THINKING === "1" ? "enabled" : "disabled" } },
  },
  anthropic: {
    nome: "Anthropic",
    keyVar: "ANTHROPIC_API_KEY",
    url: "https://api.anthropic.com/v1/messages",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    extra: {},
  },
};

export const PROVIDER_ID = (() => {
  const p = String(process.env.LLM_PROVIDER || "").trim().toLowerCase();
  if (PROVIDERS[p]) return p;
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "deepseek";
})();
export const PROVIDER = PROVIDERS[PROVIDER_ID];
export const MODEL = PROVIDER.model;
export const MAX_TOKENS = Number(process.env.MAX_TOKENS || 2048);
export const llmConfigurado = () => Boolean(process.env[PROVIDER.keyVar]);
export const SEM_CHAVE = `Servidor sem ${PROVIDER.keyVar}.`;

export async function chamarLLM({ system, messages, maxTokens = MAX_TOKENS }) {
  const r = await fetch(PROVIDER.url, {
    method: "POST",
    headers: { "x-api-key": process.env[PROVIDER.keyVar], "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ ...PROVIDER.extra, model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!r.ok) {
    const detalhe = await r.text();
    console.error(`[${PROVIDER_ID}]`, r.status, detalhe.slice(0, 500));
    const e = new Error("LLM_HTTP_" + r.status); e.status = r.status; throw e;
  }
  const data = await r.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// Higieniza o histórico vindo do navegador (texto + até N imagens base64).
const IMGS = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export function limparHistorico(messages, { maxMsgs = 24, maxChars = 4000, maxImgs = 2 } = {}) {
  const limpa = (content) => {
    if (typeof content === "string") return content.slice(0, maxChars);
    if (Array.isArray(content)) {
      const out = []; let n = 0;
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string") out.push({ type: "text", text: b.text.slice(0, maxChars) });
        else if (b.type === "image" && b.source?.type === "base64" && IMGS.has(b.source.media_type)
          && typeof b.source.data === "string" && b.source.data.length <= 5 * 1024 * 1024 && n < maxImgs) {
          n++; out.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
        }
      }
      return out;
    }
    return "";
  };
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && (typeof m.content === "string" || Array.isArray(m.content)))
    .slice(-maxMsgs)
    .map((m) => ({ role: m.role, content: limpa(m.content) }))
    .filter((m) => m.content.length > 0);
}

export const textoDe = (content) => typeof content === "string"
  ? content
  : (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() : "");
export const temImagem = (content) => Array.isArray(content) && content.some((b) => b.type === "image");
