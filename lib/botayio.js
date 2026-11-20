// Cliente do BotAyio - o "cérebro" de cada DETRAN (mesmo contrato do Seu Cartório).
//   POST {url}   header X-Webhook-Secret: <segredo>
//   body { session_id, text, restart }
//   resp { contents: [{ text, buttons:[{title,value}], arquivo:{url,nome}|null }],
//          awaiting_input, handed_off, categoria }
const TIMEOUT_MS = Number(process.env.BOTAYIO_TIMEOUT_MS || 25000);

export async function chamarBotAyio({ url, secret }, body) {
  if (!url || !secret) throw new Error("BotAyio não configurado para este DETRAN");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
    if (!r.ok) throw new Error(`BotAyio HTTP ${r.status}: ${(data && (data.detail || data.erro)) || String(txt).slice(0, 200)}`);
    return data || {};
  } finally { clearTimeout(timer); }
}

// O BotAyio troca o texto por "/start" quando vem restart:true. Se a primeira
// mensagem já traz a pergunta ("oi, como renovo a CNH?"), ela se perderia.
// Igual ao Seu Cartório: restart sem texto (saudação) e depois a pergunta.
const SO_SAUDACAO_RE = /^(oi+|ola|opa|e ai|eai|bom dia|boa tarde|boa noite|salve|hey|hello|hi|tudo bem|td bem)( (tudo bem|td bem|bom dia|boa tarde|boa noite|pessoal|detran))*$/;
export function soSaudacao(texto) {
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9\s,.!?]/g, " ").replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
  if ((t.match(/[a-z0-9]/g) || []).length < 2) return true;
  return SO_SAUDACAO_RE.test(t);
}

// `extra` (opcional): campos a mais do contrato — `contexto` (dados do cidadão que a
// plataforma já tem) e `simulacao` (conversa de demonstração, não gravada no bot real).
// BotAyio antigo ignora os campos; o novo responde `contexto_aplicado: true`.
export async function perguntarAoBot(cfg, sessionId, texto, restart, extra = {}) {
  const sim = extra.simulacao ? { simulacao: true } : {};
  if (!restart || soSaudacao(texto)) return chamarBotAyio(cfg, { session_id: sessionId, text: texto, restart, ...extra });
  const saudacao = await chamarBotAyio(cfg, { session_id: sessionId, text: "", restart: true, ...sim });
  try {
    const resp = await chamarBotAyio(cfg, { session_id: sessionId, text: texto, restart: false, ...extra });
    return { ...resp, contents: [...(saudacao.contents || []), ...(resp.contents || [])] };
  } catch (err) {
    console.warn("[BotAyio] pergunta após restart falhou; segue só com a saudação:", err.message);
    return saudacao;
  }
}

// Botões viram uma listinha numerada (funciona no site e em qualquer WhatsApp).
export function textoComBotoes(item) {
  const txt = String(item?.text || "").trim();
  const btns = Array.isArray(item?.buttons) ? item.buttons.filter((b) => b && (b.title || b.value)) : [];
  if (!btns.length) return txt;
  return `${txt}${txt ? "\n\n" : ""}${btns.map((b, i) => `${i + 1}. ${b.title || b.value}`).join("\n")}`;
}
