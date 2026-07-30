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
  bubble.innerHTML = role === "user" ? escapeHtml(content) : renderRich(content);

  if (formId) {
    const info = (formsCache || []).find((f) => f.id === formId);
    const btn = document.createElement("button");
    btn.className = "form-suggest";
    btn.innerHTML = `<span class="fs-doc">📄</span> Abrir e preencher: ${escapeHtml(info ? info.title : "documento")}`;
    btn.onclick = () => openForm(formId);
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

async function revealParts(parts, formId) {
  for (let i = 0; i < parts.length; i++) {
    showTyping();
    await sleep(i === 0 ? 300 : delayFor(parts[i]));
    hideTyping();
    addBubble("assistant", parts[i], i === parts.length - 1 ? formId : null);
  }
}

async function enviar(texto) {
  const pergunta = (texto ?? els.input.value).trim();
  if (!pergunta || carregando) return;
  clearError();
  addBubble("user", pergunta);
  conversa.push({ role: "user", content: pergunta });
  els.input.value = ""; els.input.style.height = "auto";
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
      let reply = data.reply || "";
      let formId = null;
      const m = reply.match(/\[\[FORM:([a-z-]+)\]\]/i);
      if (m) { formId = m[1].toLowerCase(); reply = reply.replace(m[0], "").trim(); }
      const limpo = reply.replace(/\[\[BREAK\]\]/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
      conversa.push({ role: "assistant", content: limpo });
      const parts = splitReply(reply);
      await revealParts(parts, formId);
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

async function openForm(id) {
  els.overlay.classList.remove("hidden");
  els.docsBack.classList.remove("hidden");
  els.overlayBody.innerHTML = `<p class="doc-intro">Carregando documento…</p>`;
  try {
    const resp = await fetch(`/api/forms/${id}`);
    if (!resp.ok) throw new Error();
    const { form } = await resp.json();
    renderForm(form);
  } catch (e) {
    els.overlayBody.innerHTML = `<p class="doc-intro">Não foi possível abrir este documento.</p>`;
  }
}

function renderForm(form) {
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
