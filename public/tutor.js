// Sala do Tutor — ensina o assistente em tempo real (texto digitado ou documento).
// A extração do texto dos arquivos acontece no próprio navegador.

const $ = (id) => document.getElementById(id);
let tutorKey = sessionStorage.getItem("tutorKey") || "";
let pendingSource = "texto"; // "texto" ou "documento"

const el = {
  login: $("login"), panel: $("panel"), pwd: $("pwd"), enter: $("enter"),
  loginMsg: $("login-msg"), logout: $("logout"),
  title: $("t-title"), content: $("t-content"), charCount: $("char-count"),
  save: $("save"), clear: $("clear"), addMsg: $("add-msg"),
  list: $("list"), listCount: $("list-count"), banner: $("storage-banner"),
  testInput: $("test-input"), testSend: $("test-send"), testAnswer: $("test-answer"),
  file: $("file"), pickFile: $("pick-file"), upStatus: $("up-status"),
};

const MAX_CHARS = 120000;      // documentos bem maiores são aceitos
const MAX_PDF_PAGES = 200;     // teto de páginas lidas de um PDF

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function msg(target, text, type) {
  target.innerHTML = text ? `<div class="t-msg ${type}">${escapeHtml(text)}</div>` : "";
}
function setUp(text, type) {
  el.upStatus.className = "up-status" + (type ? " " + type : "");
  el.upStatus.textContent = text || "";
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtNum(n) { return Number(n || 0).toLocaleString("pt-BR"); }

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (tutorKey) headers["x-tutor-key"] = tutorKey;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/* ── Login ── */
el.enter.onclick = login;
el.pwd.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

async function login() {
  const key = el.pwd.value.trim();
  if (!key) return;
  el.enter.disabled = true;
  const { ok, data } = await api("/api/tutor/auth", { method: "POST", body: JSON.stringify({ key }) });
  el.enter.disabled = false;
  if (!ok) { msg(el.loginMsg, data.error || "Não foi possível entrar.", "err"); return; }
  tutorKey = key; sessionStorage.setItem("tutorKey", key);
  showPanel(data.storage);
}

el.logout.onclick = () => {
  tutorKey = ""; sessionStorage.removeItem("tutorKey");
  el.panel.classList.add("hidden"); el.login.classList.remove("hidden");
  el.logout.classList.add("hidden"); el.pwd.value = ""; msg(el.loginMsg, "", "");
};

function showPanel(storage) {
  el.login.classList.add("hidden");
  el.panel.classList.remove("hidden");
  el.logout.classList.remove("hidden");
  renderBanner(storage);
  loadEntries();
}

function renderBanner(storage) {
  if (storage === "none") {
    el.banner.innerHTML = `<div class="t-msg err">⚠️ O armazenamento permanente ainda não está configurado neste ambiente. Você consegue testar, mas para <strong>salvar de verdade</strong> é preciso configurar o Vercel KV / Upstash (veja o DEPLOY.md).</div>`;
  } else {
    const nome = storage === "kv" ? "permanente (KV)" : "local (arquivo)";
    el.banner.innerHTML = `<div style="margin-bottom:14px"><span class="badge ok">● Memória ${nome} ativada</span></div>`;
  }
}

/* ── Envio de documento (extração no navegador) ── */
el.pickFile.onclick = () => el.file.click();
el.file.onchange = async () => {
  const file = el.file.files && el.file.files[0];
  if (!file) return;
  const nome = file.name;
  setUp(`Extraindo o texto de "${nome}"… (documentos grandes podem levar alguns segundos)`, "busy");
  el.pickFile.disabled = true;
  try {
    let texto = await extractText(file);
    texto = limparTexto(texto);
    if (!texto) throw new Error("Não encontrei texto neste arquivo. Se for um PDF digitalizado (imagem), o texto precisa ser digitado.");
    let aviso = "";
    if (texto.length > MAX_CHARS) {
      texto = texto.slice(0, MAX_CHARS);
      aviso = ` (o documento é enorme; mantive os primeiros ${fmtNum(MAX_CHARS)} caracteres)`;
    }
    el.title.value = tituloDoArquivo(nome);
    el.content.value = texto;
    el.charCount.textContent = fmtNum(texto.length);
    pendingSource = "documento";
    setUp(`Pronto! Texto de "${nome}" carregado (${fmtNum(texto.length)} caracteres)${aviso}. Revise e clique em Salvar.`, "");
    el.content.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    setUp(e.message || "Não consegui ler este arquivo. Tente PDF, Word (.docx), TXT ou cole o texto manualmente.", "err");
  } finally {
    el.pickFile.disabled = false;
    el.file.value = "";
  }
};

function tituloDoArquivo(nome) {
  return nome.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120);
}
function limparTexto(t) {
  return String(t || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

let mammothPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Falha ao carregar componente de leitura."));
    document.head.appendChild(s);
  });
}

async function extractText(file) {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".txt") || nome.endsWith(".md")) {
    return await file.text();
  }
  if (nome.endsWith(".pdf")) {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4/build/pdf.worker.min.mjs";
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    const limite = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= limite; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += tc.items.map((it) => it.str).join(" ") + "\n\n";
      if (out.length > MAX_CHARS + 4000) break;
      if (i % 10 === 0) setUp(`Extraindo… página ${i} de ${limite}`, "busy");
    }
    return out;
  }
  if (nome.endsWith(".docx")) {
    if (!mammothPromise) mammothPromise = loadScript("https://cdn.jsdelivr.net/npm/mammoth@1/mammoth.browser.min.js");
    await mammothPromise;
    const buf = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return (result && result.value) || "";
  }
  throw new Error("Formato não suportado. Envie PDF, Word (.docx), TXT ou Markdown.");
}

/* ── Salvar / limpar ── */
el.content.addEventListener("input", () => { el.charCount.textContent = fmtNum(el.content.value.length); });
el.save.onclick = salvar;
el.clear.onclick = () => {
  el.title.value = ""; el.content.value = ""; el.charCount.textContent = "0";
  pendingSource = "texto"; setUp("", ""); msg(el.addMsg, "", "");
};

async function salvar() {
  const title = el.title.value.trim();
  const content = el.content.value.trim();
  if (!title || !content) { msg(el.addMsg, "Preencha o título e o conteúdo (ou envie um documento).", "err"); return; }
  if (content.length > MAX_CHARS) { msg(el.addMsg, `O conteúdo passou de ${fmtNum(MAX_CHARS)} caracteres. Corte um pouco antes de salvar.`, "err"); return; }
  el.save.disabled = true;
  const { ok, data } = await api("/api/tutor/entries", { method: "POST", body: JSON.stringify({ title, content, source: pendingSource }) });
  el.save.disabled = false;
  if (!ok) { msg(el.addMsg, data.error || "Não foi possível salvar.", "err"); return; }
  msg(el.addMsg, "Conhecimento salvo! O assistente já está usando.", "ok");
  el.title.value = ""; el.content.value = ""; el.charCount.textContent = "0";
  pendingSource = "texto"; setUp("", "");
  setTimeout(() => msg(el.addMsg, "", ""), 3000);
  loadEntries();
}

/* ── Lista ── */
async function loadEntries() {
  const { ok, data } = await api("/api/tutor/entries");
  if (!ok) { if (data.error) el.listCount.textContent = data.error; return; }
  const entries = data.entries || [];
  el.listCount.textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? "item ensinado" : "itens ensinados"}.`
    : "Você ainda não ensinou nada. Comece pelo campo acima.";
  el.list.innerHTML = entries.map((e) => {
    const truncado = (e.chars || 0) > (e.preview || "").length;
    const corpo = escapeHtml(e.preview || "") + (truncado ? "…" : "");
    const tag = e.source === "documento" ? '<span class="tag-doc">📄 documento</span>' : "";
    const grande = (e.chars || 0) > 2000 ? `<span class="tag-doc" style="background:#EEE6D8;color:#7A5A20">${fmtNum(e.chars)} caracteres</span>` : "";
    return `
      <div class="entry" data-id="${e.id}">
        <h4>${escapeHtml(e.title)} ${tag} ${grande}</h4>
        <div class="body">${corpo}</div>
        <div class="meta">
          <span>Atualizado em ${fmtDate(e.updatedAt)}</span>
          <span class="spacer"></span>
          <button class="t-btn danger" data-del="${e.id}">Remover</button>
        </div>
      </div>`;
  }).join("");
  el.list.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => remover(b.getAttribute("data-del")); });
}

async function remover(id) {
  if (!confirm("Remover este conhecimento? O assistente deixará de usá-lo.")) return;
  const { ok, data } = await api(`/api/tutor/entries/${id}`, { method: "DELETE" });
  if (!ok) { alert(data.error || "Não foi possível remover."); return; }
  loadEntries();
}

/* ── Testar o assistente ── */
el.testSend.onclick = testar;
el.testInput.addEventListener("keydown", (e) => { if (e.key === "Enter") testar(); });

async function testar() {
  const q = el.testInput.value.trim();
  if (!q) return;
  el.testSend.disabled = true;
  el.testAnswer.innerHTML = `<div class="test-answer">Consultando o assistente…</div>`;
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { el.testAnswer.innerHTML = `<div class="t-msg err">${escapeHtml(data.error || "Erro ao consultar.")}</div>`; }
    else {
      const limpo = String(data.reply || "").replace(/\[\[BREAK\]\]/g, "\n\n").replace(/\[\[FORM:[a-z-]+\]\]/gi, "").replace(/\n{3,}/g, "\n\n").trim();
      el.testAnswer.innerHTML = `<div class="test-answer">${escapeHtml(limpo)}</div>`;
    }
  } catch (e) {
    el.testAnswer.innerHTML = `<div class="t-msg err">Não foi possível conectar ao servidor.</div>`;
  } finally { el.testSend.disabled = false; }
}

/* ── Início ── */
(async function init() {
  const status = await api("/api/tutor/status");
  if (status.ok && !status.data.enabled) {
    el.login.innerHTML = `<div class="t-card"><h3>Sala do Tutor desativada</h3><p class="sub">Para ativar, defina a variável <strong>TUTOR_PASSWORD</strong> nas variáveis de ambiente (no Vercel ou no arquivo .env) e reinicie. Veja o DEPLOY.md.</p><a href="/" class="t-btn soft">← Voltar ao chat</a></div>`;
    return;
  }
  if (tutorKey) {
    const probe = await api("/api/tutor/entries");
    if (probe.ok) { showPanel((probe.data && probe.data.storage) || "file"); return; }
    tutorKey = ""; sessionStorage.removeItem("tutorKey");
  }
})();
