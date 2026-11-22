// Frontend do Assistente DETRAN (multi-tenant).
// O servidor injeta window.TENANT (dados do DETRAN da URL) e window.API_BASE
// (/api/t/<slug>). Textos, guias, atalhos e documentos vêm do DETRAN.

const TENANT = window.TENANT || {};
const CONTEUDO = TENANT.conteudo || {};
const API = (p) => (window.API_BASE || "/api/t/pa") + p;
const LS = (k) => `detran_${TENANT.slug || "pa"}_${k}`;
// Id da conversa no site (o bot do DETRAN no BotAyio guarda o contexto por ele).
const SESSION_ID = (() => {
  try {
    let v = sessionStorage.getItem(LS("sid"));
    if (!v) { v = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); sessionStorage.setItem(LS("sid"), v); }
    return v;
  } catch (_) { return Date.now().toString(36); }
})();
const SUGESTOES = CONTEUDO.sugestoes || [];

// Marca do DETRAN para os documentos. O PA tem o emblema recriado em vetor
// (três anéis); os demais usam a imagem cadastrada.
const LOGO_SVG = (TENANT.slug && TENANT.slug !== "pa" && TENANT.marcaUrl) ? `<img class="detran-mark" src="${TENANT.marcaUrl}" alt="">` : `<svg class="detran-mark" viewBox="0 0 100 96" xmlns="http://www.w3.org/2000/svg" aria-label="DETRAN-PA"><g fill="none" stroke-width="7"><circle cx="50" cy="28" r="18" stroke="#E11B22"/><circle cx="33" cy="60" r="18" stroke="#3AAA35"/><circle cx="67" cy="60" r="18" stroke="#F6C400"/></g><g><circle cx="50" cy="28" r="3.6" fill="#E11B22"/><circle cx="33" cy="60" r="3.6" fill="#3AAA35"/><circle cx="67" cy="60" r="3.6" fill="#F6C400"/></g></svg>`;

const els = {
  scroll: document.getElementById("scroll"),
  thread: document.getElementById("thread"),
  empty: document.getElementById("empty"),
  suggestions: document.getElementById("suggestions"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  reset: document.getElementById("reset"),
  error: document.getElementById("error"),
  openDocs: document.getElementById("open-docs"),
  emptyDocs: document.getElementById("empty-docs"),
  overlay: document.getElementById("docs-overlay"),
  overlayBody: document.getElementById("docs-body"),
  overlayTitle: document.getElementById("docs-title"),
  docsBack: document.getElementById("docs-back"),
  docsClose: document.getElementById("docs-close"),
};

const conversa = [];
let carregando = false;
let formsCache = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ════════════════════════════ CHAT ════════════════════════════ */

SUGESTOES.forEach((s) => {
  const b = document.createElement("button");
  b.className = "suggestion";
  b.innerHTML = `<div class="area">${s.area}</div><div class="q">${escapeHtml(s.q)}</div>`;
  b.onclick = () => enviar(s.q);
  els.suggestions.appendChild(b);
});

els.input.addEventListener("input", () => {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
  els.send.disabled = !els.input.value.trim() || carregando;
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
});
els.send.onclick = () => enviar();
els.reset.onclick = () => location.reload();

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderRich(text) {
  return text.split("\n").map((line) => {
    let html = escapeHtml(line);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    if (line.trim() === "") return '<div class="blank"></div>';
    if (/^\s*[-*]\s+/.test(line)) return `<div class="li">${html.replace(/^\s*[-*]\s+/, "")}</div>`;
    return `<div>${html}</div>`;
  }).join("");
}

function addBubble(role, content, formId) {
  els.empty.classList.add("hidden");
  els.reset.classList.remove("hidden");

  const row = document.createElement("div");
  row.className = `row ${role === "user" ? "user" : "bot"}`;
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role === "user" ? "user" : "bot"}`;
  if (role === "user") {
    if (content && typeof content === "object") {
      let _h = "";
      if (content.img) _h += `<img class="chat-img" src="${content.img}" alt="foto enviada" />`;
      if (content.text) _h += `<div>${escapeHtml(content.text)}</div>`;
      bubble.innerHTML = _h || "📷 foto";
    } else {
      bubble.innerHTML = escapeHtml(content);
    }
  } else {
    bubble.innerHTML = renderRich(content);
  }

  if (formId) {
    const info = (formsCache || []).find((f) => f.id === formId);
    const btn = document.createElement("button");
    btn.className = "form-suggest";
    btn.innerHTML = `<span class="fs-doc">📄</span> Abrir e preencher: ${escapeHtml(info ? info.title : "documento")}`;
    btn.onclick = () => openForm(formId, true);
    bubble.appendChild(btn);
  }

  row.appendChild(bubble);
  els.thread.appendChild(row);
  scrollDown();
  return bubble;
}

function showTyping() {
  if (document.getElementById("typing-row")) return;
  const row = document.createElement("div");
  row.className = "row bot"; row.id = "typing-row";
  row.innerHTML = `<div class="bubble bot"><span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`;
  els.thread.appendChild(row); scrollDown();
}
function hideTyping() { document.getElementById("typing-row")?.remove(); }
function showError(msg) { els.error.textContent = msg; els.error.classList.remove("hidden"); }
function clearError() { els.error.classList.add("hidden"); }
function scrollDown() { els.scroll.scrollTo({ top: els.scroll.scrollHeight, behavior: "smooth" }); }

function splitReply(text) {
  let parts;
  if (text.includes("[[BREAK]]")) {
    parts = text.split(/\[\[BREAK\]\]/g);
  } else {
    const paras = text.split(/\n{2,}/);
    parts = [];
    for (const p of paras) {
      const t = p.trim();
      if (!t) continue;
      const isList = /^\s*([-*]|\d+[.)])\s+/.test(t);
      if (parts.length && (isList || t.length < 40)) parts[parts.length - 1] += "\n\n" + t;
      else parts.push(t);
    }
    if (parts.length > 5) {
      const head = parts.slice(0, 4);
      head.push(parts.slice(4).join("\n\n"));
      parts = head;
    }
  }
  return parts.map((s) => s.trim()).filter(Boolean);
}

// Pausa curta entre os balões (ritmo de conversa sem fazer o cidadão esperar):
// no máximo 0,7 s por balão; quem pediu menos movimento não espera nada.
const MENOS_MOVIMENTO = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
function delayFor(part) { return MENOS_MOVIMENTO ? 0 : Math.min(700, 250 + part.length * 4); }

async function revealParts(parts, formId, wantsDefesa) {
  for (let i = 0; i < parts.length; i++) {
    showTyping();
    await sleep(i === 0 ? (MENOS_MOVIMENTO ? 0 : 120) : delayFor(parts[i]));
    hideTyping();
    const _bb = addBubble("assistant", parts[i], i === parts.length - 1 ? formId : null);
    if (i === parts.length - 1) {
      if (wantsDefesa && window.__defesaButton) window.__defesaButton(_bb);
      if (window.__jornadaOferta && window.__jornadaButton) window.__jornadaButton(_bb, window.__jornadaOferta);
      if (window.__feedback) window.__feedback(_bb);
    }
  }
}

async function enviar(texto) {
  if (carregando) return;
  const pergunta = (texto ?? els.input.value).trim();
  const foto = window.__fotoPendente || null;
  if (!pergunta && !foto) return;
  clearError();
  let content;
  if (foto) {
    const t = pergunta || "Pode analisar essa foto de documento pra mim?";
    content = [
      { type: "text", text: t },
      { type: "image", source: { type: "base64", media_type: foto.mediaType, data: foto.data } },
    ];
    window.__ultTextoFoto = t + " (imagem enviada)";
    addBubble("user", { text: pergunta, img: foto.dataUrl });
  } else {
    content = pergunta;
    addBubble("user", pergunta);
  }
  conversa.push({ role: "user", content });
  els.input.value = ""; els.input.style.height = "auto";
  if (window.__limparFoto) window.__limparFoto();
  carregando = true; els.send.disabled = true; showTyping();
  try {
    const resp = await fetch(API("/chat"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversa, sessionId: SESSION_ID, ...simAtual() }),
    });
    const data = await resp.json().catch(() => ({}));
    hideTyping();
    if (!resp.ok) {
      showError(data.error || "Não foi possível obter a resposta. Tente novamente.");
      conversa.pop(); els.input.value = pergunta;
    } else {
      const _ult = conversa[conversa.length - 1];
      if (_ult && Array.isArray(_ult.content)) _ult.content = window.__ultTextoFoto || "(imagem enviada)";
      let reply = data.reply || "";
      let formId = null;
      const m = reply.match(/\[\[FORM:([a-z-]+)\]\]/i);
      if (m) { formId = m[1].toLowerCase(); reply = reply.replace(m[0], "").trim(); }
      const wantsDefesa = /\[\[DEFESA\]\]/i.test(reply);
      if (wantsDefesa) reply = reply.replace(/\[\[DEFESA\]\]/gi, "").trim();
      const mj = reply.match(/\[\[JORNADA:([a-z]+)\]\]/i);
      if (mj) reply = reply.replace(/\s*\[\[JORNADA:[a-z]+\]\]/gi, "").trim();
      window.__jornadaOferta = mj ? mj[1].toLowerCase() : null;
      const limpo = reply.replace(/\[\[BREAK\]\]/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
      conversa.push({ role: "assistant", content: limpo });
      const parts = splitReply(reply);
      await revealParts(parts, formId, wantsDefesa);
    }
  } catch (e) {
    hideTyping();
    showError("Não foi possível conectar ao servidor. Verifique se ele está rodando.");
    conversa.pop(); els.input.value = pergunta;
  } finally {
    carregando = false; els.send.disabled = !els.input.value.trim(); els.input.focus();
  }
}

/* ════════════════════════ DOCUMENTOS ════════════════════════ */

els.openDocs.onclick = () => openDocs();
els.emptyDocs.onclick = () => openDocs();
els.docsClose.onclick = () => closeDocs();
els.docsBack.onclick = () => openDocs();
els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay) closeDocs(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDocs(); });

function closeDocs() { els.overlay.classList.add("hidden"); }

async function openDocs() {
  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = "Documentos e formulários";
  els.docsBack.classList.add("hidden");
  els.overlayBody.innerHTML = `<p class="doc-intro">Carregando documentos…</p>`;
  try {
    if (!formsCache) {
      const resp = await fetch(API("/forms"));
      const data = await resp.json();
      formsCache = data.forms || [];
    }
    renderDocList();
  } catch (e) {
    els.overlayBody.innerHTML = `<p class="doc-intro">Não foi possível carregar os documentos. Verifique se o servidor está rodando.</p>`;
  }
}

function renderDocList() {
  const cards = formsCache.map((f) => `
    <button class="doc-card" data-id="${f.id}">
      <h4 role="heading" aria-level="3">${escapeHtml(f.title)}</h4>
      <p>${escapeHtml(f.desc)}</p>
      ${f.subtitle ? `<div class="doc-sub">${escapeHtml(f.subtitle)}</div>` : ""}
    </button>`).join("");
  els.overlayBody.innerHTML = `
    <p class="doc-intro">Escolha um documento para ver o conteúdo e, se quiser, preencher com ajuda — a pré-visualização aparece ao lado e você pode imprimir ou salvar em PDF.</p>
    <div class="doc-grid">${cards}</div>`;
  els.overlayBody.querySelectorAll(".doc-card").forEach((c) => {
    c.onclick = () => openForm(c.getAttribute("data-id"));
  });
}

async function openForm(id, fromChat) {
  els.overlay.classList.remove("hidden");
  els.docsBack.classList.remove("hidden");
  els.overlayBody.innerHTML = `<p class="doc-intro">Carregando documento…</p>`;
  try {
    const resp = await fetch(API(`/forms/${id}`));
    if (!resp.ok) throw new Error();
    const { form } = await resp.json();
    renderForm(form, fromChat);
  } catch (e) {
    els.overlayBody.innerHTML = `<p class="doc-intro">Não foi possível abrir este documento.</p>`;
  }
}

function renderForm(form, fromChat) {
  els.overlayTitle.textContent = form.title;
  const values = {};

  const fieldsHtml = form.sections.map((sec) => {
    const inner = sec.fields.map((f) => fieldControl(f)).join("");
    return `<fieldset><legend>${escapeHtml(sec.title)}</legend>${inner}</fieldset>`;
  }).join("");

  els.overlayBody.innerHTML = `
    <div class="doc-screen">
      <div class="doc-form">
        <div class="help">💬 Preencha o que souber — os campos em branco continuam como linhas para preencher à mão depois. Nada é enviado pela internet: o documento é montado aqui no seu navegador.</div>
        ${fieldsHtml}
      </div>
      <div class="doc-preview-wrap">
        <div class="preview-actions">
          <button class="btn btn-primary" id="btn-print">🖨️ Imprimir / Salvar PDF</button>
          <button class="btn btn-soft" id="btn-copy">📋 Copiar texto</button>
        </div>
        <div id="doc-paper"></div>
      </div>
    </div>`;

  els.overlayBody.querySelectorAll("[data-field]").forEach((el) => {
    const key = el.getAttribute("data-field");
    if (el.classList.contains("radio-row")) {
      el.querySelectorAll(".radio-chip").forEach((chip) => {
        chip.onclick = () => {
          const v = chip.getAttribute("data-val");
          values[key] = values[key] === v ? "" : v;
          el.querySelectorAll(".radio-chip").forEach((c) => c.classList.toggle("on", c.getAttribute("data-val") === values[key]));
          paint();
        };
      });
    } else {
      el.addEventListener("input", () => { values[key] = el.value; paint(); });
    }
  });

  const paint = () => { document.getElementById("doc-paper").innerHTML = buildDoc(form, values).html; };
  paint();

  document.getElementById("btn-print").onclick = () => printDoc(form, values);
  document.getElementById("btn-copy").onclick = async () => {
    const txt = buildDoc(form, values).text;
    try { await navigator.clipboard.writeText(txt); flashCopy(); }
    catch { fallbackCopy(txt); }
  };

  // ✨ Auto-preenchimento a partir da conversa
  function aplicarValores(vals) {
    Object.entries(vals).forEach(([key, val]) => {
      const el = els.overlayBody.querySelector(`[data-field="${key}"]`);
      if (!el) return;
      if (el.classList.contains("radio-row")) {
        values[key] = val;
        el.querySelectorAll(".radio-chip").forEach((c) => c.classList.toggle("on", c.getAttribute("data-val") === val));
      } else { el.value = val; values[key] = val; }
    });
    paint();
  }
  async function preencherComConversa(bFill) {
    if (!conversa.length) return;
    const old = bFill.innerHTML; bFill.disabled = true; bFill.innerHTML = "✨ Preenchendo…";
    try {
      const r = await fetch(API("/extract"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId: form.id, messages: conversa }),
      });
      const d = await r.json().catch(() => ({}));
      const vals = d.values || {};
      if (Object.keys(vals).length) { aplicarValores(vals); bFill.innerHTML = "✨ Preenchido — confira!"; }
      else bFill.innerHTML = "Não achei dados na conversa";
    } catch (_) { bFill.innerHTML = "Não deu pra preencher agora"; }
    finally { setTimeout(() => { bFill.disabled = false; bFill.innerHTML = old; }, 2400); }
  }
  const _actions = els.overlayBody.querySelector(".preview-actions");
  if (_actions && conversa.length) {
    const bFill = document.createElement("button");
    bFill.className = "btn btn-soft"; bFill.id = "btn-fill";
    bFill.innerHTML = "✨ Preencher com a nossa conversa";
    bFill.onclick = () => preencherComConversa(bFill);
    _actions.appendChild(bFill);
    if (fromChat) preencherComConversa(bFill);
  }
}

function fieldControl(f) {
  const key = f.key;
  if (f.type === "radio") {
    const chips = f.options.map((o) => `<button type="button" class="radio-chip" data-val="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join("");
    return `<div class="field"><label>${escapeHtml(f.label)}</label><div class="radio-row" data-field="${key}">${chips}</div></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="field"><label>${escapeHtml(f.label)}</label><textarea data-field="${key}" placeholder="${escapeHtml(f.label)}"></textarea></div>`;
  }
  const inputType = f.type === "date" ? "date" : "text";
  return `<div class="field"><label>${escapeHtml(f.label)}</label><input type="${inputType}" data-field="${key}" placeholder="${escapeHtml(f.label)}" /></div>`;
}

function flashCopy() {
  const b = document.getElementById("btn-copy");
  if (!b) return; const old = b.textContent; b.textContent = "✓ Copiado!";
  setTimeout(() => { b.textContent = old; }, 1600);
}
function fallbackCopy(txt) {
  const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta);
  ta.select(); try { document.execCommand("copy"); flashCopy(); } catch {}
  document.body.removeChild(ta);
}

function printDoc(form, values) {
  const { html } = buildDoc(form, values);
  let holder = document.getElementById("print-holder");
  if (holder) holder.remove();
  holder = document.createElement("div");
  holder.id = "print-holder";
  holder.innerHTML = html;
  document.body.appendChild(holder);
  document.body.classList.add("is-printing");
  const cleanup = () => {
    holder.remove();
    document.body.classList.remove("is-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  setTimeout(() => window.print(), 60);
  setTimeout(cleanup, 4000);
}

function fmtDate(v) {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

// Monta o documento no layout oficial do DETRAN (logo no topo + marca d'água).
function buildDoc(form, values) {
  const blankH = '<span class="dp-blank">__________________</span>';
  const blankT = "__________________";
  const H = []; const T = [];

  // Marca d'água (ao fundo)
  H.push(`<div class="dp-wm" aria-hidden="true">${LOGO_SVG}<span>${escapeHtml(TENANT.sigla || "DETRAN")}</span></div>`);
  H.push(`<div class="dp-content">`);

  // Cabeçalho oficial: logo + órgão
  H.push(`<div class="dp-head"><div class="dp-logo"><img class="detran-mark" src="${escapeHtml(TENANT.marcaUrl || "/img/detran-pa-mark.png")}" alt="${escapeHtml(TENANT.sigla || "")}"></div><div class="dp-gov">${escapeHtml(TENANT.governo || "")}<br>${escapeHtml(TENANT.nome || "")}<br>${escapeHtml(TENANT.sigla || "")}</div></div>`);
  T.push((TENANT.governo || "").toUpperCase());
  T.push((TENANT.nome || "").toUpperCase());
  T.push(`${TENANT.sigla || ""}\n`);

  H.push(`<div class="dp-title">${escapeHtml(form.title)}</div>`);
  T.push(form.title.toUpperCase());
  if (form.subtitle) { H.push(`<div class="dp-sub">${escapeHtml(form.subtitle)}</div>`); T.push(`(${form.subtitle})`); }
  T.push("");
  if (form.intro) { H.push(`<div class="dp-intro">${escapeHtml(form.intro)}</div>`); T.push(form.intro + "\n"); }

  form.sections.forEach((sec) => {
    H.push(`<div class="dp-section">${escapeHtml(sec.title)}</div>`);
    T.push("\n— " + sec.title.toUpperCase() + " —");
    sec.fields.forEach((f) => {
      let raw = values[f.key] || "";
      if (f.type === "date") raw = fmtDate(raw);
      if (f.type === "radio") {
        const optsH = f.options.map((o) => `<span class="opt">( ${values[f.key] === o ? "X" : "&nbsp;"} ) ${escapeHtml(o)}</span>`).join("");
        const optsT = f.options.map((o) => `( ${values[f.key] === o ? "X" : " "} ) ${o}`).join("   ");
        H.push(`<div class="dp-radio"><span class="lbl">${escapeHtml(f.label)}:</span> ${optsH}</div>`);
        T.push(`${f.label}: ${optsT}`);
      } else if (f.type === "textarea") {
        const valH = raw ? `<span class="dp-val">${escapeHtml(raw)}</span>` : blankH;
        H.push(`<div class="dp-line"><span class="lbl">${escapeHtml(f.label)}:</span><br>${valH}</div>`);
        T.push(`${f.label}:\n${raw || blankT}`);
      } else {
        const valH = raw ? `<span class="dp-val">${escapeHtml(raw)}</span>` : blankH;
        H.push(`<div class="dp-line"><span class="lbl">${escapeHtml(f.label)}:</span> ${valH}</div>`);
        T.push(`${f.label}: ${raw || blankT}`);
      }
    });
  });

  (form.signatures || []).forEach((cap) => {
    H.push(`<div class="dp-sign"><div class="sig-line"></div><div class="sig-cap">${escapeHtml(cap)}</div></div>`);
    T.push(`\n____________________________________\n${cap}`);
  });

  if (form.notes && form.notes.length) {
    H.push(`<div class="dp-notes"><div class="att">ATENÇÃO</div><ul>${form.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul></div>`);
    T.push("\nATENÇÃO:");
    form.notes.forEach((n) => T.push(" - " + n));
  }

  H.push(`</div>`); // fecha .dp-content
  return { html: H.join("\n"), text: T.join("\n") };
}

fetch(API("/forms")).then((r) => r.json()).then((d) => { formsCache = d.forms || []; }).catch(() => {});

/* ═══════════════════════ VOZ (falar e ouvir) ═══════════════════════ */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const composer = els.send.parentNode;

  function paraFala(t) {
    return String(t)
      .replace(/\[\[FORM:[^\]]+\]\]/gi, "")
      .replace(/\[\[BREAK\]\]/g, ". ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/https?:\/\/\S+/g, "o link no site oficial")
      .replace(/\s+/g, " ").trim();
  }

  // Ouvir respostas (TTS)
  let ttsOn = false;
  const btnFala = document.createElement("button");
  btnFala.type = "button"; btnFala.className = "voice-btn tts";
  btnFala.title = "Ouvir as respostas em voz"; btnFala.setAttribute("aria-label", "Ouvir as respostas");
  btnFala.innerHTML = "🔊";
  function falar(texto) {
    if (!ttsOn || !synth) return;
    const u = new SpeechSynthesisUtterance(paraFala(texto));
    u.lang = "pt-BR"; synth.speak(u);
  }
  btnFala.onclick = () => {
    ttsOn = !ttsOn; btnFala.classList.toggle("on", ttsOn);
    if (!ttsOn && synth) synth.cancel();
  };
  const _addBubble = addBubble;
  addBubble = function (role, content, formId) {
    const b = _addBubble(role, content, formId);
    if (role === "assistant") falar(content);
    return b;
  };

  // Falar a pergunta (STT)
  let rec = null, ouvindo = false, finalTxt = "";
  const btnMic = document.createElement("button");
  btnMic.type = "button"; btnMic.className = "voice-btn mic";
  btnMic.title = "Perguntar falando"; btnMic.setAttribute("aria-label", "Perguntar falando");
  btnMic.innerHTML = "🎤";
  if (SR) {
    rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { ouvindo = true; btnMic.classList.add("on"); };
    rec.onend = () => {
      ouvindo = false; btnMic.classList.remove("on");
      const t = (finalTxt || els.input.value).trim(); finalTxt = "";
      if (t) { els.input.value = t; enviar(); }
    };
    rec.onerror = () => { ouvindo = false; btnMic.classList.remove("on"); };
    rec.onresult = (e) => {
      let interim = ""; finalTxt = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript; else interim += r[0].transcript;
      }
      els.input.value = finalTxt || interim;
      els.input.dispatchEvent(new Event("input"));
    };
    btnMic.onclick = () => {
      if (ouvindo) { rec.stop(); return; }
      if (synth) synth.cancel();
      try { finalTxt = ""; els.input.value = ""; rec.start(); } catch (_) {}
    };
  } else {
    btnMic.title = "Ditado por voz não suportado neste navegador (use o Chrome).";
    btnMic.style.opacity = ".4";
  }

  composer.insertBefore(btnMic, els.send);
  composer.insertBefore(btnFala, els.send);
})();

/* ═══════════════════ FOTO (ler documento por imagem) ═══════════════════ */
(function () {
  const composer = els.send.parentNode;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.setAttribute("capture", "environment");
  input.style.display = "none";
  document.body.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "voice-btn foto";
  btn.title = "Enviar foto de um documento (multa, CRLV, boleto...)";
  btn.setAttribute("aria-label", "Enviar foto de documento");
  btn.innerHTML = "📷";
  btn.onclick = () => input.click();

  let chip = null;
  window.__limparFoto = function () {
    window.__fotoPendente = null;
    if (chip) { chip.remove(); chip = null; }
    input.value = "";
    els.input.placeholder = els.input.getAttribute("data-ph") || els.input.placeholder;
    els.send.disabled = !els.input.value.trim();
  };
  function mostrarChip(dataUrl) {
    if (chip) chip.remove();
    chip = document.createElement("div");
    chip.className = "foto-chip";
    chip.innerHTML = '<img alt="prévia"><span>Foto pronta — escreva uma dúvida ou toque em enviar</span><button type="button" aria-label="Remover">✕</button>';
    chip.querySelector("img").src = dataUrl;
    chip.querySelector("button").onclick = () => window.__limparFoto();
    composer.parentNode.insertBefore(chip, composer);
    els.send.disabled = false;
  }

  function comprimir(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1400;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const k = Math.min(MAX / w, MAX / h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = c.toDataURL("image/jpeg", 0.82);
        resolve({ dataUrl, mediaType: "image/jpeg", data: dataUrl.split(",")[1] });
      };
      img.onerror = reject; img.src = url;
    });
  }

  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const foto = await comprimir(file);
      window.__fotoPendente = foto;
      mostrarChip(foto.dataUrl);
      if (!els.input.getAttribute("data-ph")) els.input.setAttribute("data-ph", els.input.placeholder);
      els.input.placeholder = "Escreva uma dúvida sobre a foto (ou toque em enviar)…";
      els.input.focus();
    } catch (_) {
      showError("Não consegui ler essa imagem. Tente outra foto.");
    }
  };

  // mantém o enviar habilitado quando há foto pendente
  els.input.addEventListener("input", () => { if (window.__fotoPendente) els.send.disabled = false; });

  composer.insertBefore(btn, composer.firstChild);
})();

/* ═══════════════════ ACESSIBILIDADE (fonte + contraste) ═══════════════════ */
(function () {
  const actions = els.reset ? els.reset.parentNode : document.querySelector(".topbar-actions");
  if (!actions) return;
  let pref = {};
  try { pref = JSON.parse(localStorage.getItem(LS("a11y")) || "{}"); } catch (_) {}
  const ZOOMS = [1, 1.15, 1.3];
  let zi = ZOOMS.indexOf(pref.zoom); if (zi < 0) zi = 0;
  let hc = !!pref.hc;

  function salvar() { try { localStorage.setItem(LS("a11y"), JSON.stringify({ zoom: ZOOMS[zi], hc })); } catch (_) {} }
  function aplicar() {
    document.documentElement.style.zoom = ZOOMS[zi];
    document.body.classList.toggle("hc", hc);
    bHc.classList.toggle("on", hc);
    bFont.classList.toggle("on", zi > 0);
  }

  const bFont = document.createElement("button");
  bFont.type = "button"; bFont.className = "ghost-btn a11y"; bFont.title = "Aumentar o tamanho da letra";
  bFont.setAttribute("aria-label", "Aumentar a letra"); bFont.textContent = "A+";
  bFont.onclick = () => { zi = (zi + 1) % ZOOMS.length; salvar(); aplicar(); };

  const bHc = document.createElement("button");
  bHc.type = "button"; bHc.className = "ghost-btn a11y"; bHc.title = "Alto contraste";
  bHc.setAttribute("aria-label", "Alto contraste"); bHc.textContent = "◐";
  bHc.onclick = () => { hc = !hc; salvar(); aplicar(); };

  actions.insertBefore(bFont, actions.firstChild);
  actions.insertBefore(bHc, actions.firstChild);
  aplicar();
})();

/* ═══════════════════ FEEDBACK 👍/👎 (painel do gestor) ═══════════════════ */
window.__feedback = function (bubble) {
  if (!bubble) return;
  const row = document.createElement("div");
  row.className = "fb-row";
  row.innerHTML = '<span>Ajudou?</span><button type="button" class="fb-btn" data-up="1" aria-label="Ajudou">👍</button><button type="button" class="fb-btn" data-up="0" aria-label="Não ajudou">👎</button>';
  row.querySelectorAll(".fb-btn").forEach((b) => {
    b.onclick = () => {
      const up = b.getAttribute("data-up") === "1";
      row.querySelectorAll(".fb-btn").forEach((x) => { x.disabled = true; });
      b.classList.add("chosen");
      row.querySelector("span").textContent = "Valeu pelo retorno!";
      fetch(API("/feedback"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ up }) }).catch(() => {});
    };
  });
  bubble.appendChild(row);
};

/* ═══════════════════ DEFESA (rascunho de multa) ═══════════════════ */
window.__defesaButton = function (bubble) {
  if (!bubble) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "form-suggest defesa";
  btn.innerHTML = '<span class="fs-doc">📝</span> Gerar rascunho de defesa da multa';
  btn.onclick = () => escolherDefesa();
  bubble.appendChild(btn);
};
// Qual peça? Defesa prévia, JARI (1ª instância) ou CETRAN (2ª instância).
const CONSELHO = String(TENANT.uf || "").toUpperCase() === "DF" ? "CONTRANDIFE" : `CETRAN-${String(TENANT.uf || "").toUpperCase()}`;
function escolherDefesa() {
  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = "Rascunho de defesa de multa";
  els.docsBack.classList.add("hidden");
  const op = [
    ["defesa_previa", "1️⃣", "Recebi a Notificação de Autuação", "Ainda não é multa. Gera a <b>Defesa Prévia</b>. Prazo: 30 dias do recebimento."],
    ["jari", "2️⃣", "Recebi a Notificação de Penalidade (a multa)", "Gera o <b>Recurso à JARI</b> (1ª instância). Prazo: o que está na notificação."],
    ["cetran", "3️⃣", "A JARI negou o meu recurso", `Gera o <b>Recurso ao ${CONSELHO}</b> (2ª instância). Prazo: 30 dias da notificação da decisão da JARI.`],
    ["auto", "🤔", "Não sei em que fase estou", "Eu descubro pelo que você me contou na conversa."],
  ];
  els.overlayBody.innerHTML = `<p class="doc-intro">Em que fase está a sua multa? A peça muda conforme a fase.</p><div class="doc-grid">${op.map(([id, ic, t, d]) => `<button class="doc-card" data-tipo="${id}"><h4 role="heading" aria-level="3">${ic} ${t}</h4><p>${d}</p></button>`).join("")}</div><div id="def-status" class="doc-intro"></div>`;
  els.overlayBody.querySelectorAll("[data-tipo]").forEach((b) => (b.onclick = () => gerarDefesa(b.getAttribute("data-tipo"))));
}
async function gerarDefesa(tipo) {
  const st = document.getElementById("def-status");
  els.overlayBody.querySelectorAll("[data-tipo]").forEach((b) => (b.disabled = true));
  if (st) st.textContent = "📝 Gerando o rascunho… isso leva alguns segundos.";
  try {
    const r = await fetch(API("/defesa"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversa, tipo }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.defesa) throw new Error(d.error || "Não deu pra gerar agora.");
    abrirDefesa(d.defesa, tipo);
  } catch (e) {
    if (st) st.textContent = "⚠️ " + (e.message || "Erro ao gerar.") + " Tente de novo.";
    els.overlayBody.querySelectorAll("[data-tipo]").forEach((b) => (b.disabled = false));
  }
}
function abrirDefesa(texto, tipo) {
  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = { defesa_previa: "Rascunho — Defesa Prévia", jari: "Rascunho — Recurso à JARI", cetran: `Rascunho — Recurso ao ${CONSELHO}` }[tipo] || "Rascunho de defesa de multa";
  els.docsBack.classList.add("hidden");
  els.overlayBody.innerHTML = ''
    + '<div class="doc-screen defesa-screen">'
    + '  <div class="preview-actions">'
    + '    <button class="btn btn-primary" id="def-print">🖨️ Imprimir / Salvar PDF</button>'
    + '    <button class="btn btn-soft" id="def-copy">📋 Copiar texto</button>'
    + '  </div>'
    + '  <div id="def-paper" class="def-paper"></div>'
    + '</div>';
  document.getElementById("def-paper").textContent = texto;
  document.getElementById("def-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(texto); const b = document.getElementById("def-copy"); const o = b.textContent; b.textContent = "✓ Copiado!"; setTimeout(() => { b.textContent = o; }, 1600); }
    catch { fallbackCopy(texto); }
  };
  document.getElementById("def-print").onclick = () => {
    let holder = document.getElementById("print-holder"); if (holder) holder.remove();
    holder = document.createElement("div"); holder.id = "print-holder";
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap"; pre.style.fontFamily = "Georgia, 'Times New Roman', serif"; pre.style.fontSize = "13px"; pre.style.lineHeight = "1.6";
    pre.textContent = texto; holder.appendChild(pre); document.body.appendChild(holder);
    document.body.classList.add("is-printing");
    const cleanup = () => { holder.remove(); document.body.classList.remove("is-printing"); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 60); setTimeout(cleanup, 4000);
  };
}

/* ═══════════════════ TE LEVO PELA MÃO (guias) ═══════════════════ */
(function () {
  const GUIAS = CONTEUDO.guias || [];

  if (els.emptyDocs && GUIAS.length) {
    const cta = document.createElement("button");
    cta.className = "docs-cta guia-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🧭</span><span><strong>Te levo pela mão</strong><small>O passo a passo de um serviço inteiro, com prazos e documentos.</small></span>';
    cta.onclick = abrirGuias;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }

  function done(id) { try { return JSON.parse(localStorage.getItem(LS("guia_" + id)) || "[]"); } catch (_) { return []; } }
  function setDone(id, arr) { try { localStorage.setItem(LS("guia_" + id), JSON.stringify(arr)); } catch (_) {} }

  function abrirGuias() {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Te levo pela mão";
    els.docsBack.classList.add("hidden");
    const cards = GUIAS.map((g) => {
      const d = done(g.id).length, tot = g.steps.length;
      const prog = d ? `<div class="doc-sub">${d}/${tot} etapas concluídas</div>` : "";
      return `<button class="doc-card" data-g="${g.id}"><h4 role="heading" aria-level="3">${g.icon} ${g.title}</h4><p>${g.desc}</p>${prog}</button>`;
    }).join("");
    els.overlayBody.innerHTML = `<p class="doc-intro">Escolha uma jornada. Eu te levo etapa por etapa, com os links certos, os documentos e o prazo.</p><div class="doc-grid">${cards}</div>`;
    els.overlayBody.querySelectorAll("[data-g]").forEach((b) => { b.onclick = () => abrirGuia(b.getAttribute("data-g")); });
  }

  function abrirGuia(id) {
    const g = GUIAS.find((x) => x.id === id); if (!g) return;
    els.overlayTitle.textContent = g.title;
    const feitos = new Set(done(id));
    function render() {
      const steps = g.steps.map((s, i) => {
        const isDone = feitos.has(i);
        const link = s.link ? `<a class="gs-link" href="${s.link}" target="_blank" rel="noopener">↗ ${s.linkLabel || "Abrir link oficial"}</a>` : "";
        const doc = s.docs ? '<button class="gs-doc" data-docs="1">📄 Ver documentos</button>' : "";
        return `<div class="guia-step ${isDone ? "done" : ""}" data-i="${i}"><button class="guia-check" aria-label="marcar etapa">${isDone ? "✓" : ""}</button><div><div class="gs-title">${s.t}</div><div class="gs-desc">${s.d}</div>${(link || doc) ? `<div class="gs-actions">${link}${doc}</div>` : ""}</div></div>`;
      }).join("");
      const prazo = g.prazoDias ? `<div class="guia-prazo">⏰ <span>${g.prazoLabel}</span> <button class="btn btn-soft" id="guia-ics">📅 Adicionar prazo ao calendário</button></div>` : "";
      els.overlayBody.innerHTML = `<button class="guia-back">← Voltar aos guias</button><div class="guia-head"><div class="doc-intro" style="margin:0">${g.intro || ""}</div><div class="guia-prog">${feitos.size}/${g.steps.length} concluídas</div></div>${prazo}<div class="guia-steps">${steps}</div>`;
      els.overlayBody.querySelector(".guia-back").onclick = abrirGuias;
      els.overlayBody.querySelectorAll(".guia-step").forEach((st) => {
        st.querySelector(".guia-check").onclick = () => {
          const i = +st.getAttribute("data-i");
          if (feitos.has(i)) feitos.delete(i); else feitos.add(i);
          setDone(id, [...feitos]); render();
        };
      });
      els.overlayBody.querySelectorAll("[data-docs]").forEach((b) => { b.onclick = () => openDocs(); });
      const ics = els.overlayBody.querySelector("#guia-ics");
      if (ics) ics.onclick = () => baixarICS(g);
    }
    render();
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function baixarICS(g) {
    const d = new Date(); d.setDate(d.getDate() + g.prazoDias);
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const dn = new Date(d); dn.setDate(dn.getDate() + 1);
    const ymd2 = `${dn.getFullYear()}${pad(dn.getMonth() + 1)}${pad(dn.getDate())}`;
    const n = new Date();
    const stamp = `${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}T${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}`;
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${TENANT.sigla || "DETRAN"}//Assistente//PT-BR`, "BEGIN:VEVENT",
      `UID:${g.id}-${ymd}@detran-${TENANT.slug || "pa"}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${ymd2}`,
      `SUMMARY:Prazo DETRAN — ${g.title}`, `DESCRIPTION:${g.prazoLabel}. Confirme sempre no portal ${TENANT.portalUrl || "oficial"}`,
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Lembrete de prazo DETRAN", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `prazo-detran-${g.id}.ics`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
})();

/* ═══════════════════ DESPACHANTE PARENTE (jornadas guiadas) ═══════════════════
   O assistente conduz o serviço etapa por etapa e guarda onde a pessoa parou
   (neste navegador, por um código aleatório; nada de CPF). */
(function () {
  const escJ = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const DONO = (() => {
    try { let v = localStorage.getItem(LS("jornada")); if (!v) { v = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12); localStorage.setItem(LS("jornada"), v); } return v; }
    catch (_) { return SESSION_ID; }
  })();
  const api = async (p, body) => {
    const r = await fetch(API("/jornadas" + p + (body ? "" : `${p.includes("?") ? "&" : "?"}sessao=${encodeURIComponent(DONO)}`)), body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, sessao: DONO }) } : {});
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  let atual = null, catalogo = [];

  // Chip fixo "Minha jornada" quando há uma em andamento.
  const chip = document.createElement("button");
  chip.type = "button"; chip.className = "jor-chip hidden"; chip.onclick = () => abrir();
  document.body.appendChild(chip);
  function atualizarChip() {
    if (atual && !atual.concluida) { chip.innerHTML = `🧭 ${escJ(atual.jornada.titulo)} · ${atual.progresso.atual}/${atual.progresso.total}`; chip.classList.remove("hidden"); }
    else chip.classList.add("hidden");
  }

  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta jor-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🧭</span><span><strong>Despachante Parente — resolva passo a passo</strong><small>Vendi meu veículo · Renovar a CNH · Contestar multa. Eu acompanho até o fim, com prazos e lembretes.</small></span><span class="docs-cta-arrow">→</span>';
    cta.onclick = () => abrir();
    els.emptyDocs.insertAdjacentElement("beforebegin", cta);
  }
  (async () => { const r = await api("/atual"); if (r.ok) { atual = r.data.cartao; atualizarChip(); } })().catch(() => {});

  // Botão na resposta do chat quando a pergunta é de uma jornada.
  window.__jornadaButton = function (bubble, id) {
    if (!bubble || (atual && !atual.concluida)) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "form-suggest jor-sug";
    btn.innerHTML = '<span class="fs-doc">🧭</span> Quero que você me acompanhe passo a passo';
    btn.onclick = () => comecar(id);
    bubble.appendChild(btn);
  };

  async function abrir() {
    els.overlay.classList.remove("hidden"); els.docsBack.classList.add("hidden");
    els.overlayTitle.textContent = "Despachante Parente";
    const r = await api("/atual"); atual = r.ok ? r.data.cartao : null; atualizarChip();
    if (atual) return render();
    if (!catalogo.length) { const c = await fetch(API("/jornadas")).then((x) => x.json()).catch(() => ({})); catalogo = c.jornadas || []; }
    els.overlayBody.innerHTML = '<p class="doc-intro">Escolha o que você precisa resolver. Eu te guio etapa por etapa, guardo onde você parou, conto os prazos e te lembro. Nada é pago nem assinado por mim: eu preparo e te levo ao canal oficial de cada passo.</p>'
      + `<div class="doc-grid">${catalogo.map((j) => `<button class="doc-card" data-j="${escJ(j.id)}"><h4 role="heading" aria-level="3">${j.icone} ${escJ(j.titulo)}</h4><p>${escJ(j.resumo)}</p><div class="doc-sub">${j.etapas} etapas</div></button>`).join("")}</div>`;
    els.overlayBody.querySelectorAll("[data-j]").forEach((b) => (b.onclick = () => comecar(b.dataset.j)));
  }
  async function comecar(id) {
    els.overlay.classList.remove("hidden"); els.docsBack.classList.add("hidden");
    els.overlayTitle.textContent = "Despachante Parente";
    const r = await api("/iniciar", { id });
    if (!r.ok) { els.overlayBody.innerHTML = `<div class="golpe-res atencao">${escJ(r.data.error || "Não foi possível começar.")}</div>`; return; }
    atual = r.data.cartao; atualizarChip(); render();
  }
  async function responder(acao, valor) {
    const r = await api("/responder", { acao, valor });
    if (r.data.cartao) atual = r.data.cartao;
    atualizarChip(); render(r.ok ? null : r.data.error);
    // Lembrete pelo WhatsApp com a data já preenchida (o cidadão confirma pelo próprio WhatsApp).
    for (const a of r.data.avisos || []) {
      const box = document.getElementById("jor-aviso");
      if (box && window.__abrirLembrete) {
        box.innerHTML = `<button class="btn btn-soft" id="jor-lemb">🔔 Receber lembrete no WhatsApp (${a.lembrete === "DEFESA" ? "prazo da defesa" : "vencimento da CNH"})</button>`;
        document.getElementById("jor-lemb").onclick = () => window.__abrirLembrete(a.lembrete === "DEFESA" ? { tipo: "DEFESA", recebimento: a.data } : { tipo: "CNH", data: a.data });
      }
    }
  }
  function render(erro) {
    const c = atual; if (!c) return abrir();
    const e = c.etapa;
    els.overlayTitle.textContent = `${c.jornada.icone} ${c.jornada.titulo}`;
    const passos = c.progresso.etapas.map((x) => `<li class="${x.feito ? "feito" : x.atual ? "atual" : ""}"><span>${x.feito ? "✓" : ""}</span>${escJ(x.titulo)}</li>`).join("");
    const prazos = c.prazos.length ? `<div class="jor-prazos">${c.prazos.map((p) => `<div class="${p.aviso ? "aviso" : p.faltam >= 0 && p.faltam <= 5 ? "perto" : ""}">📅 ${escJ(p.rotulo)}: <b>${escJ(p.dataBR)}</b>${p.faltam >= 0 ? ` <small>(faltam ${p.faltam} dias)</small>` : p.aviso ? "" : " <small>(já passou)</small>"}</div>`).join("")}</div>` : "";
    let acoes = "";
    if (e.tipo === "escolha") acoes = e.opcoes.map((o) => `<button class="btn btn-primary" data-op="${escJ(o.id)}">${escJ(o.rotulo)}</button>`).join("");
    else if (e.tipo === "data") acoes = `<input type="date" id="jor-data" class="golpe-in" style="max-width:220px;margin:0" value="${escJ(e.valor || "")}"><button class="btn btn-primary" data-a="data">Salvar data</button>${e.opcional ? '<button class="btn btn-soft" data-a="pular">Pular</button>' : ""}`;
    else if (e.tipo !== "fim") {
      if (e.link) acoes += `<a class="btn btn-soft" href="${escJ(e.link)}" target="_blank" rel="noopener">↗ Portal oficial</a>`;
      if (e.formId) acoes += `<button class="btn btn-soft" data-x="form">📝 Preencher o documento</button>`;
      if (e.servico) acoes += `<button class="btn btn-soft" data-x="conferir">✅ Conferir documentos</button>`;
      if (e.tipo === "defesa") acoes += `<button class="btn btn-soft" data-x="defesa">⚖️ Gerar o rascunho</button>`;
      if (e.id === "debitos" || e.id === "guia") acoes += `<button class="btn btn-soft" data-x="golpe">🛡️ É golpe? Conferir cobrança</button>`;
      acoes += `<button class="btn btn-primary" data-a="feito">Feito ✓ — próxima etapa</button>`;
    } else acoes = `<button class="btn btn-primary" data-x="nova">Resolver outra coisa</button>`;
    els.overlayBody.innerHTML = `
      <div class="jor-barra"><span style="width:${Math.round((c.progresso.atual / c.progresso.total) * 100)}%"></span></div>
      <div class="jor-grade"><ol class="jor-passos">${passos}</ol>
        <div class="jor-etapa ${c.concluida ? "fim" : ""}">
          <small>Etapa ${c.progresso.atual} de ${c.progresso.total}</small>
          <h4 role="heading" aria-level="3">${escJ(e.titulo)}</h4>
          <p>${escJ(e.texto)}</p>
          ${prazos}
          ${erro ? `<div class="golpe-res atencao">${escJ(erro)}</div>` : ""}
          <div class="jor-acoes">${acoes}</div>
          <div id="jor-aviso"></div>
          <div class="jor-rodape">${c.progresso.atual > 1 && !c.concluida ? '<button class="linklike" data-a="voltar">← Etapa anterior</button>' : ""}<button class="linklike" data-x="sair">${c.concluida ? "Fechar esta jornada" : "Parar o acompanhamento"}</button></div>
        </div></div>`;
    els.overlayBody.querySelectorAll("[data-op]").forEach((b) => (b.onclick = () => responder("opcao", b.dataset.op)));
    els.overlayBody.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
      if (b.dataset.a === "data") { const v = document.getElementById("jor-data").value; if (!v) return render("Escolha a data."); return responder("data", v); }
      responder(b.dataset.a);
    }));
    els.overlayBody.querySelectorAll("[data-x]").forEach((b) => (b.onclick = async () => {
      const x = b.dataset.x;
      if (x === "form") openForm(e.formId, false);
      else if (x === "conferir" && window.__abrirConferenciaServico) window.__abrirConferenciaServico(e.servico);
      else if (x === "defesa") escolherDefesa();
      else if (x === "golpe" && window.__abrirGolpe) window.__abrirGolpe();
      else if (x === "sair" || x === "nova") { await api("/sair", {}); atual = null; atualizarChip(); abrir(); }
    }));
  }
  window.__abrirJornada = abrir;
})();

/* ═══════════════════ ANTIGOLPE ═══════════════════ */
(function () {
  const escH = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta golpe-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🛡️</span><span><strong>É golpe? Confira antes de pagar</strong><small>Cole a mensagem, o link ou o código de barras que você recebeu.</small></span>';
    cta.onclick = abrirGolpe;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }
  function abrirGolpe() {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "É golpe? Confira antes de pagar";
    els.docsBack.classList.add("hidden");
    els.overlayBody.innerHTML = ''
      + '<p class="doc-intro">Recebeu SMS, WhatsApp ou e-mail cobrando multa, IPVA ou licenciamento? Cole aqui o texto, o link ou o número do código de barras. A conferência é na hora.</p>'
      + '<textarea id="g-texto" class="golpe-in" rows="6" placeholder="Ex.: DETRAN: sua CNH será bloqueada hoje. Regularize em https://... ou pague via PIX..."></textarea>'
      + '<button class="btn btn-primary" id="g-ok">Conferir</button>'
      + '<div id="g-out" aria-live="polite"></div>'
      + '<p class="calc-sub">Não peça nem informe senha, código ou dados de cartão a ninguém. Em caso de dúvida, consulte seus débitos digitando você mesmo o endereço do portal oficial.</p>';
    const ok = document.getElementById("g-ok");
    ok.onclick = async () => {
      const texto = document.getElementById("g-texto").value.trim();
      const out = document.getElementById("g-out");
      if (!texto) { out.innerHTML = '<div class="golpe-res sem_dados">Cole a mensagem, o link ou o código de barras.</div>'; return; }
      ok.disabled = true; ok.textContent = "Conferindo…";
      try {
        const r = await fetch(API("/antigolpe"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Não deu para conferir agora.");
        const icone = { golpe: "🚨", atencao: "⚠️", sem_sinais: "✅", sem_dados: "🔎" }[d.nivel];
        out.innerHTML = `<div class="golpe-res ${d.nivel}"><h4 role="heading" aria-level="3">${icone} ${escH(d.titulo)}</h4>`
          + (d.sinais.length ? `<p><b>O que encontrei:</b></p><ul>${d.sinais.map((s) => `<li>${escH(s)}</li>`).join("")}</ul>` : "")
          + (d.boletos.length ? `<ul>${d.boletos.map((b) => `<li>${escH(b.tipo)}${b.valor ? ` — valor ${escH(b.valor)}` : ""}${b.valido ? "" : " — código com erro"}</li>`).join("")}</ul>` : "")
          + `<p><b>O que fazer:</b></p><ul>${d.oQueFazer.map((s) => `<li>${escH(s)}</li>`).join("")}</ul>`
          + (d.aviso ? `<p class="calc-sub">${escH(d.aviso)}</p>` : "") + "</div>";
      } catch (e) {
        out.innerHTML = `<div class="golpe-res atencao">${escH(e.message)}</div>`;
      } finally { ok.disabled = false; ok.textContent = "Conferir"; }
    };
  }
  window.__abrirGolpe = abrirGolpe;
})();

/* ═══════════════════ CALCULADORAS ═══════════════════ */
(function () {
  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta calc-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🧮</span><span><strong>Calculadoras</strong><small>Pontos na CNH, prazo da defesa e custo de um serviço.</small></span>';
    cta.onclick = abrirCalc;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }
  const brl = (n) => "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, "0");

  function abrirCalc() {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Calculadoras";
    els.docsBack.classList.add("hidden");
    els.overlayBody.innerHTML = ''
      + '<p class="doc-intro">Ferramentas rápidas — nada é enviado pela internet, tudo é calculado aqui no navegador.</p>'
      + '<div class="calc-card"><h4 role="heading" aria-level="3">🚦 Pontos na CNH</h4><p class="calc-sub">Informe quantas infrações você tem em 12 meses, por gravidade.</p>'
      + '<div class="calc-grid">'
      + '<label>Leve (3 pts)<input type="number" min="0" value="0" id="c-leve"></label>'
      + '<label>Média (4 pts)<input type="number" min="0" value="0" id="c-media"></label>'
      + '<label>Grave (5 pts)<input type="number" min="0" value="0" id="c-grave"></label>'
      + '<label>Gravíssima (7 pts)<input type="number" min="0" value="0" id="c-gravi"></label>'
      + '</div><div id="c-pts-out" class="calc-out"></div></div>'
      + '<div class="calc-card"><h4 role="heading" aria-level="3">⏰ Prazo da defesa</h4><p class="calc-sub">Data em que você recebeu a notificação. O prazo é de 30 dias.</p>'
      + '<label class="calc-inline">Recebi em: <input type="date" id="c-data"></label><div id="c-prazo-out" class="calc-out"></div></div>'
      + '<div class="calc-card"><h4 role="heading" aria-level="3">💰 Custo de um serviço (referência)</h4><p class="calc-sub">Marque as taxas. Valores são referência — o final é o do boleto/DAE.</p>'
      + '<div id="c-taxas"></div><div id="c-custo-out" class="calc-out"></div></div>';

    const calcPts = () => {
      const l = +document.getElementById("c-leve").value || 0;
      const m = +document.getElementById("c-media").value || 0;
      const g = +document.getElementById("c-grave").value || 0;
      const gv = +document.getElementById("c-gravi").value || 0;
      const pts = 3 * l + 4 * m + 5 * g + 7 * gv;
      const limite = gv >= 2 ? 20 : gv === 1 ? 30 : 40;
      const pct = Math.min(100, Math.round((pts / limite) * 100));
      const suspenso = pts >= limite;
      const cor = suspenso ? "#c0392b" : pct >= 70 ? "#c77d0a" : "#167D70";
      const nota = suspenso
        ? `⚠️ Você atingiu o limite (${limite} pts) — sujeito à <strong>suspensão</strong> do direito de dirigir.`
        : `Limite no seu caso: <strong>${limite} pontos</strong> (${gv >= 2 ? "2+ gravíssimas" : gv === 1 ? "1 gravíssima" : "nenhuma gravíssima"}). Faltam ${limite - pts} pts.`;
      document.getElementById("c-pts-out").innerHTML = `<div class="calc-big" style="color:${cor}">${pts} pontos</div><div class="calc-track"><span class="calc-fill" style="width:${pct}%;background:${cor}"></span></div><div class="calc-note">${nota}</div>`;
    };
    ["c-leve", "c-media", "c-grave", "c-gravi"].forEach((id) => document.getElementById(id).addEventListener("input", calcPts));
    calcPts();

    const calcPrazo = () => {
      const v = document.getElementById("c-data").value;
      const out = document.getElementById("c-prazo-out");
      if (!v) { out.innerHTML = ""; return; }
      const d = new Date(v + "T00:00:00");
      const limite = new Date(d); limite.setDate(limite.getDate() + 30);
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const dias = Math.round((limite - hoje) / 86400000);
      const ld = `${pad(limite.getDate())}/${pad(limite.getMonth() + 1)}/${limite.getFullYear()}`;
      let cor, txt;
      if (dias < 0) { cor = "#c0392b"; txt = `Prazo <strong>vencido</strong> há ${-dias} dia(s). O limite era ${ld}.`; }
      else if (dias === 0) { cor = "#c0392b"; txt = `<strong>Último dia!</strong> O prazo termina hoje (${ld}).`; }
      else { cor = dias <= 7 ? "#c77d0a" : "#167D70"; txt = `Prazo final: <strong>${ld}</strong> — faltam <strong>${dias} dia(s)</strong>.`; }
      out.innerHTML = `<div class="calc-note" style="color:${cor}">${txt}</div>`;
    };
    document.getElementById("c-data").addEventListener("input", calcPrazo);

    const TAXAS = [
      { n: "Transferência de propriedade", v: 274.69 },
      { n: "Vistoria veicular", v: 68.67 },
      { n: "Emplacamento Mercosul (0km)", v: 45.78 },
      { n: "Licenciamento anual (TRLAV)", v: 214.51 },
      { n: "Transferência de jurisdição (CNH)", v: 149.72 },
    ];
    document.getElementById("c-taxas").innerHTML = TAXAS.map((t, i) => `<label class="calc-check"><input type="checkbox" data-v="${t.v}" id="tx${i}"> ${t.n} <span>${brl(t.v)}</span></label>`).join("");
    const calcCusto = () => {
      let tot = 0;
      document.querySelectorAll("#c-taxas input:checked").forEach((c) => { tot += +c.getAttribute("data-v"); });
      document.getElementById("c-custo-out").innerHTML = tot ? `<div class="calc-big">${brl(tot)}</div><div class="calc-note">Total de referência. Confirme no boleto/DAE do portal.</div>` : "";
    };
    document.querySelectorAll("#c-taxas input").forEach((c) => c.addEventListener("change", calcCusto));
  }
})();

/* ═══════════════════ MEU VEÍCULO ═══════════════════ */
(function () {
  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta mv-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🚗</span><span><strong>Meu veículo</strong><small>Guarde placa e RENAVAM e tenha os atalhos oficiais na mão.</small></span>';
    cta.onclick = abrirVeiculo;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }
  const load = () => { try { return JSON.parse(localStorage.getItem(LS("veiculo")) || "{}"); } catch (_) { return {}; } };
  const save = (v) => { try { localStorage.setItem(LS("veiculo"), JSON.stringify(v)); } catch (_) {} };

  const ATALHOS = CONTEUDO.atalhos || [];

  function copiar(txt, btn) {
    if (!txt) return;
    const done = () => { const o = btn.textContent; btn.textContent = "✓ copiado"; setTimeout(() => { btn.textContent = o; }, 1400); };
    (navigator.clipboard ? navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt)) : fallbackCopy(txt));
    if (!navigator.clipboard) done();
  }

  function abrirVeiculo() {
    const v = load();
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Meu veículo";
    els.docsBack.classList.add("hidden");
    els.overlayBody.innerHTML = ''
      + '<p class="doc-intro">Guarde seus dados (ficam só neste aparelho) e use os atalhos oficiais. Nos portais do DETRAN você cola a placa/RENAVAM no formulário — por isso os botões de copiar.</p>'
      + '<div class="mv-fields">'
      + '  <label>Placa<input id="mv-placa" maxlength="8" placeholder="ABC1D23" value="' + (v.placa || "") + '"></label>'
      + '  <label>RENAVAM<input id="mv-renavam" maxlength="12" placeholder="00000000000" value="' + (v.renavam || "") + '"></label>'
      + '  <label>CPF/CNPJ (opcional)<input id="mv-cpf" placeholder="para a consulta detalhada" value="' + (v.cpf || "") + '"></label>'
      + '</div>'
      + '<div class="mv-chips" id="mv-chips"></div>'
      + '<div class="mv-grid">' + ATALHOS.map((a) => '<a class="mv-card" href="' + a.u + '" target="_blank" rel="noopener"><span class="ic">' + a.ic + '</span><span><b>' + a.n + '</b><small>' + a.s + '</small></span></a>').join("") + '</div>';

    const elP = document.getElementById("mv-placa"), elR = document.getElementById("mv-renavam"), elC = document.getElementById("mv-cpf");
    const persist = () => save({ placa: elP.value.trim().toUpperCase(), renavam: elR.value.trim(), cpf: elC.value.trim() });
    [elP, elR, elC].forEach((e) => e.addEventListener("input", () => { persist(); renderChips(); }));

    function renderChips() {
      const cur = load();
      const chips = [];
      if (cur.placa) chips.push('<button class="mv-chip" data-c="' + cur.placa + '">📋 Copiar placa: ' + cur.placa + '</button>');
      if (cur.renavam) chips.push('<button class="mv-chip" data-c="' + cur.renavam + '">📋 Copiar RENAVAM</button>');
      const box = document.getElementById("mv-chips");
      box.innerHTML = chips.join("");
      box.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => copiar(b.getAttribute("data-c"), b));
    }
    renderChips();
  }
})();


/* Abre um documento direto pelo link (?doc=<id>), usado nas respostas do WhatsApp. */
(function () {
  try {
    const doc = new URLSearchParams(location.search).get("doc");
    if (doc && /^[a-z0-9-]{2,60}$/.test(doc)) openForm(doc, false);
  } catch (_) {}
})();

/* ═══════════════════ CONFERÊNCIA DE DOCUMENTOS ═══════════════════
   Checklist por serviço: o cidadão marca o que já tem ou manda a foto e o
   assistente confere (legível? é o documento certo? está no prazo?).
   A foto não fica guardada; o progresso fica só neste navegador. */
(function () {
  let SERVICOS = null, IA = false;
  const ST = { OK: ["✓", "ok", "Conferido"], VENCIDO: ["!", "venc", "Vencido"], ILEGIVEL: ["?", "aviso", "Foto ilegível"], OUTRO: ["✗", "venc", "Documento errado"], PENDENTE: ["!", "aviso", "Pendente"], CONFERIR: ["?", "aviso", "Confira"], TENHO: ["✓", "ok", "Marcado por você"] };
  const salvo = (id) => { try { return JSON.parse(localStorage.getItem(LS("conf_" + id)) || "{}"); } catch (_) { return {}; } };
  const guardar = (id, v) => { try { localStorage.setItem(LS("conf_" + id), JSON.stringify(v)); } catch (_) {} };

  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta conf-cta";
    cta.innerHTML = '<span class="docs-cta-icon">✅</span><span><strong>Conferir meus documentos</strong><small>Antes de ir ao DETRAN: veja o que falta e o que está vencido.</small></span>';
    cta.onclick = abrirServicos;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
    const cta2 = document.createElement("button");
    cta2.className = "docs-cta defesa-cta";
    cta2.innerHTML = `<span class="docs-cta-icon">⚖️</span><span><strong>Defesa de multa</strong><small>Defesa prévia, recurso à JARI ou ao ${CONSELHO}.</small></span>`;
    cta2.onclick = escolherDefesa;
    cta.insertAdjacentElement("afterend", cta2);
    // Demonstração: atalho para o "Meu DETRAN" simulado.
    if ((window.TENANT?.demonstracao || window.SIM_LIBERADO)) {
      const cta3 = document.createElement("a");
      cta3.className = "docs-cta sim-cta"; cta3.href = (window.TENANT_BASE || "") + "/servicos";
      const s = simAtual();
      cta3.innerHTML = `<span class="docs-cta-icon">🧪</span><span><strong>Meu DETRAN (simulação)</strong><small>${s.simCidadao ? "Cidadão fictício ativo — pergunte aqui sobre os débitos, a CNH e os agendamentos dele." : "Veja como ficam consultas, guias, agendamento e filas com dados fictícios."}</small></span><span class="docs-cta-arrow">→</span>`;
      cta2.insertAdjacentElement("afterend", cta3);
    }
  }

  async function carregar() {
    if (SERVICOS) return SERVICOS;
    const r = await fetch(API("/conferencia")); const d = await r.json().catch(() => ({}));
    SERVICOS = d.servicos || []; IA = Boolean(d.ia); return SERVICOS;
  }

  async function abrirServicos() {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Conferir meus documentos";
    els.docsBack.classList.add("hidden");
    els.overlayBody.innerHTML = '<p class="doc-intro">Carregando…</p>';
    const lista = await carregar();
    els.overlayBody.innerHTML = `<p class="doc-intro">Escolha o serviço. Eu mostro tudo o que você precisa levar${IA ? " e confiro as fotos dos seus documentos" : ""}, para você não perder a viagem.</p>`
      + `<div class="doc-grid">${lista.map((s) => { const v = salvo(s.id); const n = s.itens.filter((i) => v[i.id] && ["OK", "TENHO"].includes(v[i.id].status)).length; return `<button class="doc-card" data-s="${escapeHtml(s.id)}"><h4 role="heading" aria-level="3">${s.icone || "📄"} ${escapeHtml(s.titulo)}</h4><p>${escapeHtml(s.resumo || "")}</p>${n ? `<div class="doc-sub">${n}/${s.itens.length} documentos conferidos</div>` : ""}</button>`; }).join("")}</div>`;
    els.overlayBody.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => abrirServico(b.getAttribute("data-s"))));
  }

  function abrirServico(id) {
    const s = SERVICOS.find((x) => x.id === id); if (!s) return;
    els.overlayTitle.textContent = s.titulo;
    const estado = salvo(id);
    const render = () => {
      const obrig = s.itens.filter((i) => !i.condicional || estado[i.id]?.aplica !== false);
      const prontos = obrig.filter((i) => ["OK", "TENHO"].includes(estado[i.id]?.status) || (i.condicional && estado[i.id]?.aplica === false));
      const problemas = obrig.filter((i) => ["VENCIDO", "OUTRO", "ILEGIVEL", "PENDENTE", "CONFERIR"].includes(estado[i.id]?.status));
      const faltam = obrig.filter((i) => !estado[i.id]?.status && !(i.condicional && estado[i.id]?.aplica === false));
      const pct = Math.round((prontos.length / Math.max(1, obrig.length)) * 100);
      // Cruzamento: documentos conferidos por foto em nomes diferentes.
      const nomes = {};
      s.itens.forEach((i) => { const tt = estado[i.id]?.titular; if (tt) (nomes[tt] ||= []).push(i.nome); });
      const nomesDif = Object.keys(nomes);
      const temResid = s.itens.some((i) => /resid/i.test(i.nome + " " + (i.desc || "")));
      const alertaNomes = nomesDif.length > 1
        ? `<div class="conf-cruz"><b>⚠️ Os documentos estão em nomes diferentes:</b><ul>${nomesDif.map((n) => `<li>${escapeHtml(n)} — ${nomes[n].map(escapeHtml).join(", ")}</li>`).join("")}</ul>`
          + `${temResid ? `Se o comprovante de residência estiver no nome de outra pessoa (pai, mãe, cônjuge, locador), leve também uma <b>declaração de residência</b> assinada por ela${(formsCache || []).some((f) => f.id === "declaracao-residencia") ? ' — <button class="btn btn-soft" data-form="declaracao-residencia">📝 preencher aqui</button>' : ""}.` : "Confira se todos são mesmo da pessoa que vai fazer o serviço."}</div>`
        : "";
      const tudo = !problemas.length && !faltam.length && nomesDif.length <= 1;
      const itens = s.itens.map((i) => {
        const e = estado[i.id] || {}; const st = ST[e.status];
        const naoAplica = i.condicional && e.aplica === false;
        return `<div class="conf-item ${st ? "st-" + st[1] : ""} ${naoAplica ? "na" : ""}" data-i="${escapeHtml(i.id)}">
          <div class="conf-ic">${naoAplica ? "–" : st ? st[0] : ""}</div>
          <div class="conf-txt"><div class="gs-title">${escapeHtml(i.nome)}${i.condicional ? ' <span class="conf-tag">se for o caso</span>' : ""}</div>
            <div class="gs-desc">${escapeHtml(i.desc || "")}${i.condicional ? `<br><i>${escapeHtml(i.condicional)}</i>` : ""}</div>
            ${e.motivo ? `<div class="conf-motivo">${st ? `<b>${st[2]}:</b> ` : ""}${escapeHtml(e.motivo)}</div>` : ""}
            <div class="gs-actions">
              ${i.foto && IA && !naoAplica ? `<label class="btn btn-soft conf-foto">📷 ${e.status && e.status !== "TENHO" ? "Mandar outra foto" : "Conferir pela foto"}<input type="file" accept="image/*" capture="environment" hidden></label>` : ""}
              ${!naoAplica && e.status !== "TENHO" && e.status !== "OK" ? '<button class="btn btn-soft" data-a="tenho">Já tenho</button>' : ""}
              ${e.status ? '<button class="btn btn-soft" data-a="limpar">Desfazer</button>' : ""}
              ${i.condicional ? `<button class="btn btn-soft" data-a="aplica">${naoAplica ? "É o meu caso" : "Não é o meu caso"}</button>` : ""}
              ${i.form ? `<button class="btn btn-soft" data-a="form">📝 Preencher aqui</button>` : ""}
            </div></div></div>`;
      }).join("");
      els.overlayBody.innerHTML = `<button class="guia-back">← Outros serviços</button>
        <div class="conf-resumo ${tudo ? "pronto" : ""}"><div class="conf-pct"><span style="width:${pct}%"></span></div>
          <b>${tudo ? "✅ Tudo certo para dar entrada!" : `${prontos.length} de ${obrig.length} documentos prontos`}</b>
          <span>${tudo ? "Leve os originais. Confira o horário e o endereço no portal oficial." : [problemas.length ? `${problemas.length} com problema` : "", faltam.length ? `${faltam.length} ainda não conferido(s)` : ""].filter(Boolean).join(" · ")}</span></div>
        ${alertaNomes}
        <p class="doc-intro">${escapeHtml(s.resumo || "")} ${IA ? "As fotos servem só para a conferência e não ficam guardadas." : ""}</p>
        <div class="guia-steps">${itens}</div>
        <div class="preview-actions"><button class="btn btn-primary" id="conf-print">🖨️ Imprimir checklist</button>${TENANT.portalUrl ? `<a class="btn btn-soft" href="${escapeHtml(TENANT.portalUrl)}" target="_blank" rel="noopener">↗ Portal oficial</a>` : ""}</div>
        <p class="doc-intro" style="font-size:12px">A lista é uma orientação com base nas regras gerais. O ${escapeHtml(TENANT.sigla || "DETRAN")} pode pedir algo a mais no seu caso.</p>`;
      els.overlayBody.querySelector(".guia-back").onclick = abrirServicos;
      els.overlayBody.querySelectorAll("[data-form]").forEach((b) => (b.onclick = () => openForm(b.getAttribute("data-form"), false)));
      els.overlayBody.querySelectorAll(".conf-item").forEach((el) => {
        const item = s.itens.find((x) => x.id === el.getAttribute("data-i"));
        const set = (v) => { estado[item.id] = v; guardar(id, estado); render(); };
        el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
          const a = b.getAttribute("data-a");
          if (a === "tenho") set({ status: "TENHO", motivo: "" });
          else if (a === "limpar") set({});
          else if (a === "aplica") set(estado[item.id]?.aplica === false ? {} : { aplica: false });
          else if (a === "form") openForm(item.form, false);
        }));
        const inp = el.querySelector('input[type="file"]');
        if (inp) inp.onchange = async () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          el.querySelector(".conf-ic").innerHTML = '<span class="conf-spin"></span>';
          const lbl = el.querySelector(".conf-foto"); if (lbl) lbl.firstChild.textContent = "⏳ Conferindo… ";
          try {
            const imagem = await reduzir(f);
            const r = await fetch(API("/conferencia/analisar"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servico: s.id, item: item.id, imagem }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || "Não consegui conferir agora.");
            set({ status: d.status, motivo: d.motivo, titular: d.titular || null });
          } catch (e) { set({ ...(estado[item.id] || {}), motivo: e.message }); }
        };
      });
      document.getElementById("conf-print").onclick = () => imprimir(s, estado);
    };
    render();
  }

  function reduzir(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600; let w = img.width, h = img.height;
        if (w > MAX || h > MAX) { const k = Math.min(MAX / w, MAX / h); w = Math.round(w * k); h = Math.round(h * k); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Não consegui abrir essa imagem.")); img.src = url;
    });
  }

  function imprimir(s, estado) {
    let holder = document.getElementById("print-holder"); if (holder) holder.remove();
    holder = document.createElement("div"); holder.id = "print-holder";
    const linhas = s.itens.map((i) => { const e = estado[i.id] || {}; const na = i.condicional && e.aplica === false; const st = ST[e.status];
      return `<tr><td style="padding:6px;border:1px solid #999;width:28px;text-align:center">${na ? "–" : st ? st[0] : "☐"}</td><td style="padding:6px;border:1px solid #999"><b>${escapeHtml(i.nome)}</b>${na ? " (não se aplica)" : ""}<br><small>${escapeHtml(i.desc || "")}${e.motivo ? `<br><i>${escapeHtml(e.motivo)}</i>` : ""}</small></td></tr>`; }).join("");
    holder.innerHTML = `<div style="font-family:Arial,sans-serif;font-size:13px">${LOGO_SVG}<h2 style="margin:6px 0">${escapeHtml(TENANT.sigla || "DETRAN")} — Checklist de documentos</h2><h3 style="margin:0 0 10px;font-weight:normal">${escapeHtml(s.titulo)}</h3><table style="border-collapse:collapse;width:100%">${linhas}</table><p style="font-size:11px;margin-top:12px">Gerado em ${new Date().toLocaleDateString("pt-BR")} pelo ${escapeHtml(TENANT.assistente || "assistente virtual")}. Orientação geral: confirme no portal oficial ${escapeHtml(TENANT.portalUrl || "")}.</p></div>`;
    document.body.appendChild(holder); document.body.classList.add("is-printing");
    const cleanup = () => { holder.remove(); document.body.classList.remove("is-printing"); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    setTimeout(() => window.print(), 60); setTimeout(cleanup, 4000);
  }
  window.__abrirConferencia = abrirServicos;
  window.__abrirConferenciaServico = async (id) => {
    els.overlay.classList.remove("hidden"); els.docsBack.classList.add("hidden");
    await carregar();
    if (SERVICOS.some((s) => s.id === id)) abrirServico(id); else abrirServicos();
  };
})();

/* ═══════════════════ MEU DETRAN OFICIAL (login gov.br) ═══════════════════
   Só aparece quando o DETRAN ligou a integração oficial (API + gov.br). */
(function () {
  const params = new URLSearchParams(location.search);
  const retorno = params.get("govbr");
  fetch(API("/meu-detran/status")).then((r) => r.json()).then((st) => {
    if (!st || !st.ativo || !els.emptyDocs) return;
    const cta = document.createElement(st.logado ? "div" : "a");
    cta.className = "docs-cta govbr-cta";
    if (st.logado) {
      cta.innerHTML = `<span class="docs-cta-icon">🪪</span><span><strong>Conectado ao gov.br${st.logado.nome ? ` — ${escapeHtml(st.logado.nome)}` : ""}</strong><small>Pergunte sobre os seus débitos, a sua CNH e os seus veículos. <button type="button" class="govbr-sair">Sair</button></small></span>`;
      cta.querySelector(".govbr-sair").onclick = async (e) => { e.stopPropagation(); await fetch(API("/govbr/sair"), { method: "POST" }); location.href = location.pathname; };
    } else {
      cta.href = API("/govbr/entrar");
      cta.innerHTML = '<span class="docs-cta-icon">🪪</span><span><strong>Entrar com gov.br</strong><small>Para consultar a SUA situação: débitos, CNH, pontos e veículos — com os dados oficiais.</small></span><span class="docs-cta-arrow">→</span>';
    }
    els.emptyDocs.insertAdjacentElement("beforebegin", cta);
  }).catch(() => {});
  if (retorno) {
    const t = { ok: "Pronto! Você entrou com o gov.br. Agora pode perguntar sobre a sua situação.", erro: "Não foi possível entrar com o gov.br agora. Tente de novo.", cancelado: "Login gov.br cancelado.", expirado: "O login demorou demais. Tente de novo." }[retorno];
    if (t && els.emptyDocs) {
      const av = document.createElement("div");
      av.className = `govbr-aviso ${retorno === "ok" ? "ok" : "err"}`; av.setAttribute("role", "status"); av.textContent = t;
      els.emptyDocs.insertAdjacentElement("beforebegin", av);
      setTimeout(() => av.remove(), 9000);
    }
    history.replaceState(null, "", location.pathname);
  }
})();

/* Atalhos por link (?acao=...), usados nos lembretes e respostas do WhatsApp. */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    const acao = q.get("acao"), servico = String(q.get("servico") || "").replace(/[^a-z0-9-]/g, "");
    const mapa = { conferir: servico ? () => window.__abrirConferenciaServico(servico) : window.__abrirConferencia, defesa: escolherDefesa, golpe: window.__abrirGolpe, jornada: window.__abrirJornada };
    if (acao && typeof mapa[acao] === "function") setTimeout(() => mapa[acao](), 300);
  } catch (_) {}
})();

/* ═══════════════════ AVISO DE PRIVACIDADE (LGPD) ═══════════════════
   Na primeira visita, uma faixa curta explica que a conversa fica registrada
   e por quanto tempo, com link para o aviso completo. */
(function () {
  try { if (localStorage.getItem(LS("aviso_lgpd"))) return; } catch (_) { return; }
  const composer = document.querySelector("footer.composer");
  if (!composer) return;
  fetch(API("/privacidade")).then((r) => r.json()).then((d) => {
    const dias = d.retencaoConversasDias || 180;
    const box = document.createElement("div");
    box.className = "aviso-lgpd";
    box.setAttribute("role", "note");
    box.innerHTML = `<span>🔒 Para atender você, esta conversa fica registrada por até <b>${dias} dias</b> e depois é apagada. Não envie senhas nem dados bancários. <a href="${(window.TENANT_BASE || "")}/privacidade">Saiba mais</a></span><button type="button">Entendi</button>`;
    box.querySelector("button").onclick = () => { try { localStorage.setItem(LS("aviso_lgpd"), "1"); } catch (_) {} box.remove(); };
    composer.insertAdjacentElement("afterbegin", box);
  }).catch(() => {});
})();

/* ═══════════════════ LEMBRETES PELO WHATSAPP ═══════════════════
   O cidadão escolhe o lembrete, informa a data e o WhatsApp e aceita receber.
   O número recebe "responda SIM" — só depois disso os avisos são enviados. */
(function () {
  let INFO = null;
  async function info() { if (!INFO) { const r = await fetch(API("/lembretes")); INFO = await r.json().catch(() => ({})); } return INFO; }

  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta lemb-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🔔</span><span><strong>Lembretes no WhatsApp</strong><small>Vencimento da CNH, prazo da defesa e licenciamento.</small></span>';
    cta.onclick = () => window.__abrirLembrete();
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }

  const hoje = () => new Date().toLocaleDateString("en-CA");
  window.__abrirLembrete = async function (pre = {}) {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Lembretes no WhatsApp";
    els.docsBack.classList.add("hidden");
    els.overlayBody.innerHTML = '<p class="doc-intro">Carregando…</p>';
    const d = await info();
    if (!d.disponivel) {
      els.overlayBody.innerHTML = `<p class="doc-intro">Os lembretes pelo WhatsApp ainda não estão disponíveis no ${escapeHtml(TENANT.sigla || "DETRAN")}. Enquanto isso, use as <b>Calculadoras</b> para salvar o prazo na agenda do seu celular.</p>`;
      return;
    }
    const temCal = (d.finais || []).length > 0;
    els.overlayBody.innerHTML = `
      <p class="doc-intro">Eu aviso no seu WhatsApp antes do prazo. Você pode parar quando quiser, respondendo <b>PARAR LEMBRETES</b>.</p>
      <div class="calc-card lemb-form">
        <label class="lemb-lbl">Do que você quer ser lembrado?</label>
        <div class="lemb-tipos">
          <label><input type="radio" name="lt" value="CNH"> 🪪 Vencimento da CNH</label>
          <label><input type="radio" name="lt" value="DEFESA"> ⚖️ Prazo da defesa da multa</label>
          <label><input type="radio" name="lt" value="LICENCIAMENTO"> 🚗 Licenciamento do veículo</label>
        </div>
        <div id="lb-campos"></div>
        <label class="lemb-lbl" for="lb-fone">Seu WhatsApp (com DDD)</label>
        <input id="lb-fone" type="tel" inputmode="tel" placeholder="(91) 99999-9999" autocomplete="tel">
        <label class="lemb-aceite"><input type="checkbox" id="lb-aceite"> Aceito receber lembretes do ${escapeHtml(TENANT.sigla || "DETRAN")} pelo WhatsApp neste número. Vou confirmar respondendo SIM.</label>
        <button class="btn btn-primary" id="lb-ok">Criar lembrete</button>
        <div id="lb-msg" class="calc-out"></div>
        <p class="calc-sub">Ou mande direto no WhatsApp: <b>lembrete cnh 15/03/2027</b>. Seu número fica guardado só para os avisos e sai junto com eles (veja a <a href="${(window.TENANT_BASE || "")}/privacidade">privacidade</a>).</p>
      </div>`;
    const campos = (tipo) => {
      const c = document.getElementById("lb-campos");
      if (tipo === "CNH") c.innerHTML = `<label class="lemb-lbl" for="lb-data">Data de validade da sua CNH</label><input id="lb-data" type="date" min="${hoje()}" value="${pre.data && pre.data >= hoje() ? pre.data : ""}">`;
      else if (tipo === "DEFESA") c.innerHTML = `<label class="lemb-lbl" for="lb-data">Quando você recebeu a notificação?</label><input id="lb-data" type="date" max="${hoje()}" value="${pre.recebimento || ""}"><div class="calc-sub">O prazo é de 30 dias a partir do recebimento. Eu aviso 10, 3 e 1 dia antes.</div>`;
      else if (tipo === "LICENCIAMENTO") c.innerHTML = temCal
        ? `<label class="lemb-lbl" for="lb-final">Último número da placa</label><select id="lb-final"><option value="">Escolha</option>${d.finais.map((f) => `<option>${f}</option>`).join("")}</select>`
        : `<label class="lemb-lbl" for="lb-data">Data de vencimento do licenciamento</label><input id="lb-data" type="date" min="${hoje()}"><div class="calc-sub">Veja a data no calendário de licenciamento do portal.</div>`;
      else c.innerHTML = "";
    };
    els.overlayBody.querySelectorAll('input[name="lt"]').forEach((r) => (r.onchange = () => campos(r.value)));
    if (pre.tipo) { const r = els.overlayBody.querySelector(`input[name="lt"][value="${pre.tipo}"]`); if (r) { r.checked = true; campos(pre.tipo); } }
    document.getElementById("lb-ok").onclick = async () => {
      const tipo = (els.overlayBody.querySelector('input[name="lt"]:checked') || {}).value;
      const out = document.getElementById("lb-msg");
      const body = { tipo, telefone: document.getElementById("lb-fone").value, aceite: document.getElementById("lb-aceite").checked };
      const dt = document.getElementById("lb-data"), fin = document.getElementById("lb-final");
      if (dt) { if (tipo === "DEFESA") body.dataRecebimento = dt.value; else body.data = dt.value; }
      if (fin) body.final = fin.value;
      if (!tipo) return (out.innerHTML = '<div class="calc-note" style="color:#c0392b">Escolha o tipo de lembrete.</div>');
      if (!body.aceite) return (out.innerHTML = '<div class="calc-note" style="color:#c0392b">Marque que aceita receber os lembretes.</div>');
      const b = document.getElementById("lb-ok"); b.disabled = true;
      try {
        const r = await fetch(API("/lembretes"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Não deu certo agora.");
        out.innerHTML = `<div class="calc-note" style="color:var(--ayio-teal-deep)">✅ Quase lá! Mandei uma mensagem para o seu WhatsApp. <b>Responda SIM</b> lá para ativar o lembrete (data: ${new Date(j.dataAlvo).toLocaleDateString("pt-BR", { timeZone: "UTC" })}).</div>`;
      } catch (e) { out.innerHTML = `<div class="calc-note" style="color:#c0392b">⚠️ ${escapeHtml(e.message)}</div>`; b.disabled = false; }
    };
  };

  // Na calculadora "Prazo da defesa": atalho para o lembrete com a data já preenchida.
  const obs = new MutationObserver(() => {
    const out = document.getElementById("c-prazo-out"), dt = document.getElementById("c-data");
    if (!out || !dt || out.dataset.lemb) return;
    out.dataset.lemb = "1";
    const b = document.createElement("button");
    b.className = "btn btn-soft"; b.style.marginTop = "8px"; b.textContent = "🔔 Me lembrar pelo WhatsApp";
    b.onclick = () => window.__abrirLembrete({ tipo: "DEFESA", recebimento: dt.value });
    out.insertAdjacentElement("afterend", b);
  });
  if (els.overlayBody) obs.observe(els.overlayBody, { childList: true, subtree: true });
})();

// Simulação (só demonstração): cidadão fictício escolhido em /<uf>/servicos.
function simAtual() {
  if (!(window.TENANT?.demonstracao || window.SIM_LIBERADO)) return {};
  try {
    const s = JSON.parse(localStorage.getItem("detran_sim_" + window.TENANT.slug) || "{}");
    return s.cidadao ? { simCidadao: s.cidadao, simSessao: s.sessao } : {};
  } catch (_) { return {}; }
}
