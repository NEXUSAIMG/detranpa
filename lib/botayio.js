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
  if (!restart || soSaudacao(texto)) {
    const r = await chamarBotAyio(cfg, { session_id: sessionId, text: texto, restart, ...extra });
    // A sessão tinha expirado no BotAyio: ele só cumprimentou e a pergunta se
    // perdeu (`texto_ignorado`). Reenvia a mesma pergunta e junta as respostas.
    // "/start" e outros comandos já reiniciam no BotAyio: não reenvia.
    if (restart || !r.texto_ignorado || soSaudacao(texto) || /^\//.test(String(texto).trim())) return r;
    try {
      const resp = await chamarBotAyio(cfg, { session_id: sessionId, text: texto, restart: false, ...extra });
      return { ...resp, contents: [...(r.contents || []), ...(resp.contents || [])], uso: somarUso(r.uso, resp.uso) };
    } catch (err) {
      console.warn("[BotAyio] reenvio da pergunta após sessão nova falhou:", err.message);
      return r;
    }
  }
  const saudacao = await chamarBotAyio(cfg, { session_id: sessionId, text: "", restart: true, ...sim });
  try {
    const resp = await chamarBotAyio(cfg, { session_id: sessionId, text: texto, restart: false, ...extra });
    return { ...resp, contents: [...(saudacao.contents || []), ...(resp.contents || [])], uso: somarUso(saudacao.uso, resp.uso) };
  } catch (err) {
    console.warn("[BotAyio] pergunta após restart falhou; segue só com a saudação:", err.message);
    return saudacao;
  }
}

// Primeira pergunta em UMA chamada (22/11/2026): `sem_saudacao` + `reiniciar` fazem
// o BotAyio responder direto, sem gerar a saudação com IA antes (antes eram 2
// chamadas de IA em sequência). BotAyio antigo ignora os campos: a sessão nova
// devolve `texto_ignorado` e a pergunta é reenviada (comportamento de antes).
export async function perguntarRapido(cfg, sessionId, texto, primeira, extra = {}, aoPedaco = null) {
  const corpo = { session_id: sessionId, text: texto, restart: false, ...extra, ...(primeira ? { sem_saudacao: true, reiniciar: true } : {}) };
  let r = aoPedaco ? await chamarBotAyioStream(cfg, corpo, aoPedaco) : await chamarBotAyio(cfg, corpo);
  if (r.texto_ignorado && !soSaudacao(texto)) {
    const resp = await chamarBotAyio(cfg, { ...corpo, sem_saudacao: false, reiniciar: false });
    r = { ...resp, contents: [...(r.contents || []), ...(resp.contents || [])], uso: somarUso(r.uso, resp.uso) };
  }
  return r;
}

// Transmissão: POST {url}/stream -> linhas JSON {"delta"} ... {"fim": <resposta normal>}.
// Se o BotAyio ainda não tiver o /stream (404/405), faz a chamada normal.
export async function chamarBotAyioStream({ url, secret }, body, aoPedaco) {
  if (!url || !secret) throw new Error("BotAyio não configurado para este DETRAN");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url.replace(/\/+$/, "") + "/stream", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (r.status === 404 || r.status === 405) { clearTimeout(timer); return chamarBotAyio({ url, secret }, body); }
    if (!r.ok || !r.body) throw new Error(`BotAyio HTTP ${r.status}`);
    const dec = new TextDecoder(); let resto = ""; let fim = null;
    for await (const pedaco of r.body) {
      resto += dec.decode(pedaco, { stream: true });
      let i;
      while ((i = resto.indexOf("\n")) >= 0) {
        const linha = resto.slice(0, i).trim(); resto = resto.slice(i + 1);
        if (!linha) continue;
        let ev; try { ev = JSON.parse(linha); } catch { continue; }
        if (ev.delta) { try { aoPedaco(ev.delta); } catch { /* quem ouve não derruba */ } }
        else if (ev.fim) fim = ev.fim;
        else if (ev.erro) throw new Error(`BotAyio: ${ev.erro}`);
      }
    }
    if (!fim) throw new Error("BotAyio: transmissão terminou sem resposta final");
    return fim;
  } finally { clearTimeout(timer); }
}

export function somarUso(a, b) {
  if (!a) return b || null; if (!b) return a;
  const out = { ...a, modelos: [...new Set([...(a.modelos || []), ...(b.modelos || [])])] };
  for (const k of ["entrada", "saida", "cache_lido", "cache_gravado", "chamadas"]) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

// Botões viram uma listinha numerada (funciona no site e em qualquer WhatsApp).
export function textoComBotoes(item) {
  const txt = String(item?.text || "").trim();
  const btns = Array.isArray(item?.buttons) ? item.buttons.filter((b) => b && (b.title || b.value)) : [];
  if (!btns.length) return txt;
  return `${txt}${txt ? "\n\n" : ""}${btns.map((b, i) => `${i + 1}. ${b.title || b.value}`).join("\n")}`;
}
