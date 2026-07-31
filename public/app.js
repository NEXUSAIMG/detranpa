// Frontend do Assistente DETRAN-PA.
// Conversa com o backend local (/api/chat) e usa o catálogo de documentos
// (/api/forms) para o preenchedor guiado. A chave da Anthropic nunca passa
// pelo navegador.

const SUGESTOES = [
  { area: "Habilitação", q: "Quais documentos preciso para renovar a CNH?" },
  { area: "Veículos", q: "Como faço a transferência de um veículo que comprei?" },
  { area: "Multas", q: "Recebi uma notificação de autuação. O que faço?" },
  { area: "IPVA", q: "Onde consulto e pago o IPVA no Pará?" },
  { area: "Veículos", q: "Quero vender meu carro. Como faço a intenção de venda?" },
  { area: "Habilitação", q: "Quem precisa fazer exame toxicológico?" },
];

// Emblema do DETRAN-PA recriado em vetor (três anéis: vermelho, verde e amarelo).
const LOGO_SVG = `<svg class="detran-mark" viewBox="0 0 100 96" xmlns="http://www.w3.org/2000/svg" aria-label="DETRAN-PA"><g fill="none" stroke-width="7"><circle cx="50" cy="28" r="18" stroke="#E11B22"/><circle cx="33" cy="60" r="18" stroke="#3AAA35"/><circle cx="67" cy="60" r="18" stroke="#F6C400"/></g><g><circle cx="50" cy="28" r="3.6" fill="#E11B22"/><circle cx="33" cy="60" r="3.6" fill="#3AAA35"/><circle cx="67" cy="60" r="3.6" fill="#F6C400"/></g></svg>`;

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

function delayFor(part) { return Math.min(1500, 400 + part.length * 12); }

async function revealParts(parts, formId, wantsDefesa) {
  for (let i = 0; i < parts.length; i++) {
    showTyping();
    await sleep(i === 0 ? 300 : delayFor(parts[i]));
    hideTyping();
    const _bb = addBubble("assistant", parts[i], i === parts.length - 1 ? formId : null);
    if (i === parts.length - 1) {
      if (wantsDefesa && window.__defesaButton) window.__defesaButton(_bb);
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
    const resp = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversa }),
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
      const resp = await fetch("/api/forms");
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
      <h4>${escapeHtml(f.title)}</h4>
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
    const resp = await fetch(`/api/forms/${id}`);
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
      const r = await fetch("/api/extract", {
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

// Monta o documento no layout oficial do DETRAN-PA (logo no topo + marca d'água).
function buildDoc(form, values) {
  const blankH = '<span class="dp-blank">__________________</span>';
  const blankT = "__________________";
  const H = []; const T = [];

  // Marca d'água (ao fundo)
  H.push(`<div class="dp-wm" aria-hidden="true">${LOGO_SVG}<span>DETRAN-PA</span></div>`);
  H.push(`<div class="dp-content">`);

  // Cabeçalho oficial: logo + órgão
  H.push(`<div class="dp-head"><div class="dp-logo"><img class="detran-mark" src="/img/detran-pa-mark.png" alt="DETRAN-PA"></div><div class="dp-gov">Governo do Estado do Pará<br>Departamento de Trânsito do Estado do Pará<br>DETRAN-PA</div></div>`);
  T.push("GOVERNO DO ESTADO DO PARÁ");
  T.push("DEPARTAMENTO DE TRÂNSITO DO ESTADO DO PARÁ");
  T.push("DETRAN-PA\n");

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

fetch("/api/forms").then((r) => r.json()).then((d) => { formsCache = d.forms || []; }).catch(() => {});

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
  try { pref = JSON.parse(localStorage.getItem("detranpa_a11y") || "{}"); } catch (_) {}
  const ZOOMS = [1, 1.15, 1.3];
  let zi = ZOOMS.indexOf(pref.zoom); if (zi < 0) zi = 0;
  let hc = !!pref.hc;

  function salvar() { try { localStorage.setItem("detranpa_a11y", JSON.stringify({ zoom: ZOOMS[zi], hc })); } catch (_) {} }
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
      fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ up }) }).catch(() => {});
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
  btn.onclick = () => gerarDefesa(btn);
  bubble.appendChild(btn);
};
async function gerarDefesa(btn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = "📝 Gerando o rascunho…";
  try {
    const r = await fetch("/api/defesa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversa }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.defesa) { btn.innerHTML = "Não deu pra gerar agora"; setTimeout(() => { btn.disabled = false; btn.innerHTML = old; }, 2400); return; }
    abrirDefesa(d.defesa);
    btn.innerHTML = "📝 Rascunho gerado ✓"; setTimeout(() => { btn.disabled = false; btn.innerHTML = old; }, 2600);
  } catch (_) { btn.innerHTML = "Erro ao gerar"; setTimeout(() => { btn.disabled = false; btn.innerHTML = old; }, 2400); }
}
function abrirDefesa(texto) {
  els.overlay.classList.remove("hidden");
  els.overlayTitle.textContent = "Rascunho de defesa de multa";
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
  const GUIAS = [
    {
      id: "comprar", icon: "🚗", title: "Comprei um veículo usado",
      desc: "Passar o carro/moto para o meu nome.",
      intro: "Transferência de propriedade — quem faz é o comprador.",
      prazoDias: 30, prazoLabel: "Transferência em até 30 dias da assinatura da ATPV",
      steps: [
        { t: "Conferir débitos e impedimentos", d: "IPVA, multas e licenciamento têm que estar quitados e sem bloqueios.", link: "https://www.detran.pa.gov.br/servicosWeb/consultaVeiculoInfracao_detalhada_V.php", linkLabel: "Consultar o veículo" },
        { t: "Checar o gravame", d: "Se o carro era financiado, o gravame precisa estar baixado (a financeira informa)." },
        { t: "Gerar e assinar a ATPV-e", d: "O vendedor gera a ATPV-e; comprador e vendedor assinam no app Carteira Digital de Trânsito (login gov.br). Dispensa cartório para registros a partir de 04/01/2021." },
        { t: "Fazer a vistoria", d: "Em ECV credenciada ou no DETRAN — confere chassi e motor (decalque)." },
        { t: "Pagar o DAE", d: "Pague a taxa de transferência (boleto DAE) gerada no portal." },
        { t: "Emitir o CRLV-e", d: "Em ~2 dias úteis após o pagamento, o novo documento fica no app CDT.", link: "https://www.detran.pa.gov.br/sistransito/detran-web/servicos/crlv/indexCRLVe.jsf", linkLabel: "CRLV-e" }
      ]
    },
    {
      id: "vender", icon: "🤝", title: "Vou vender meu veículo",
      desc: "Comunicar a venda e me proteger de multas futuras.",
      intro: "Comunicação de venda — quem faz é o vendedor.",
      prazoDias: 30, prazoLabel: "Comunicação de venda em até 30 dias da venda",
      steps: [
        { t: "Preencher a intenção/ATPV com o comprador", d: "Reúna os dados completos do comprador (nome, CPF, endereço, contato).", docs: true },
        { t: "Fazer a Comunicação de Venda", d: "No portal, aba Veículos → Formulário de Comunicação de Venda → preencher, anexar e protocolar.", link: "https://www.detran.pa.gov.br/servicos", linkLabel: "Portal de serviços" },
        { t: "Guardar o protocolo e acompanhar", d: "A partir do registro, multas e débitos do novo dono deixam de vir no seu nome." }
      ]
    },
    {
      id: "renovar", icon: "🪪", title: "Renovar a CNH",
      desc: "Renovar a carteira quando vence.",
      intro: "Renovação de CNH (cadastro no PA).",
      steps: [
        { t: "Emitir o boleto de renovação", d: "Abra o serviço no portal e emita o boleto.", link: "https://www.detran.pa.gov.br/servicos", linkLabel: "Portal de serviços" },
        { t: "Pagar e aguardar a compensação", d: "Leva cerca de 72h úteis." },
        { t: "Validação documental + foto", d: "Presencial, com identidade e comprovante de residência." },
        { t: "Exame médico", d: "Obrigatório para todas as categorias. Agende pelo Call Center 154." },
        { t: "Psicotécnico (se EAR)", d: "Só para quem exerce atividade remunerada." },
        { t: "Toxicológico (se C, D ou E)", d: "Obrigatório nessas categorias; validade de 90 dias." },
        { t: "Receber a CNH em casa", d: "A carteira é enviada pelos Correios; a CNH-e fica no app CDT." }
      ]
    },
    {
      id: "multa", icon: "⚖️", title: "Recorrer de uma multa",
      desc: "Contestar uma autuação ou multa.",
      intro: "Defesa/Recurso pelo Portal Venus.",
      prazoDias: 30, prazoLabel: "Protocole dentro do prazo da notificação (mínimo 30 dias)",
      steps: [
        { t: "Identificar a fase", d: "Notificação de Autuação = cabe Defesa Prévia. Notificação de Penalidade = cabe Recurso à JARI." },
        { t: "Conferir o órgão autuador", d: "O Portal Venus só trata multas do próprio DETRAN-PA. Rodovia estadual → DER-PA; federal → PRF; via municipal → Prefeitura/SEMOB." },
        { t: "Reunir as provas", d: "Notificação, RG/CNH, CRLV-e, fotos, vídeos, recibos — o que ajudar a fundamentar." },
        { t: "Protocolar no Portal Venus", d: "Login gov.br (prata/ouro). Redija com fundamentação e anexe as provas. (Dica: peça ao assistente um rascunho de defesa!)", link: "https://cidadao.detran.pa.gov.br", linkLabel: "Portal Venus" },
        { t: "Guardar o protocolo e acompanhar", d: "Anote o número e acompanhe o resultado." }
      ]
    }
  ];

  if (els.emptyDocs) {
    const cta = document.createElement("button");
    cta.className = "docs-cta guia-cta";
    cta.innerHTML = '<span class="docs-cta-icon">🧭</span><span><strong>Te levo pela mão</strong><small>O passo a passo de um serviço inteiro, com prazos e documentos.</small></span>';
    cta.onclick = abrirGuias;
    els.emptyDocs.insertAdjacentElement("afterend", cta);
  }

  function done(id) { try { return JSON.parse(localStorage.getItem("detranpa_guia_" + id) || "[]"); } catch (_) { return []; } }
  function setDone(id, arr) { try { localStorage.setItem("detranpa_guia_" + id, JSON.stringify(arr)); } catch (_) {} }

  function abrirGuias() {
    els.overlay.classList.remove("hidden");
    els.overlayTitle.textContent = "Te levo pela mão";
    els.docsBack.classList.add("hidden");
    const cards = GUIAS.map((g) => {
      const d = done(g.id).length, tot = g.steps.length;
      const prog = d ? `<div class="doc-sub">${d}/${tot} etapas concluídas</div>` : "";
      return `<button class="doc-card" data-g="${g.id}"><h4>${g.icon} ${g.title}</h4><p>${g.desc}</p>${prog}</button>`;
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
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DETRAN-PA//Assistente//PT-BR", "BEGIN:VEVENT",
      `UID:${g.id}-${ymd}@detranpa`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${ymd2}`,
      `SUMMARY:Prazo DETRAN — ${g.title}`, `DESCRIPTION:${g.prazoLabel}. Confirme sempre no portal detran.pa.gov.br`,
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Lembrete de prazo DETRAN", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `prazo-detran-${g.id}.ics`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
})();
