// Copiloto do Balcão — apoio ao atendente (modo operador).
const $ = (id) => document.getElementById(id);
let tKey = sessionStorage.getItem("tutorKey") || "";
const conversa = []; let carregando = false; let foto = null; let fotoChip = null;

const CHIPS = [
  "Transferência de propriedade — o que exigir do cidadão?",
  "1ª habilitação — passo a passo e documentos",
  "Renovação de CNH — requisitos e exames",
  "Comunicação de venda — documentos",
  "Veículo de outro estado (transferência de jurisdição)",
  "Vou fotografar os documentos para você fazer a triagem",
];

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function rich(t) { return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  if (tKey) headers["x-tutor-key"] = tKey;
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

$("enter").onclick = login;
$("pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login() {
  const k = $("pwd").value.trim(); if (!k) return;
  const { ok, data } = await api("/api/tutor/auth", { method: "POST", body: JSON.stringify({ key: k }) });
  if (!ok) { $("login-msg").textContent = data.error || "Senha incorreta."; return; }
  tKey = k; sessionStorage.setItem("tutorKey", k); abrirConsole();
}
$("logout").onclick = () => { tKey = ""; sessionStorage.removeItem("tutorKey"); location.reload(); };

function abrirConsole() {
  $("login").classList.add("hidden"); $("console").classList.remove("hidden"); $("logout").classList.remove("hidden"); var _pn=document.getElementById("painel"); if(_pn) _pn.classList.remove("hidden");
  const c = $("chips"); c.innerHTML = "";
  CHIPS.forEach((q) => { const b = document.createElement("button"); b.className = "bx-chip"; b.textContent = q.split(" — ")[0]; b.title = q; b.onclick = () => { $("inp").value = q; $("inp").focus(); }; c.appendChild(b); });
  if (!chat.children.length) addBot("Pronto pra ajudar no atendimento. Descreva o caso ou **fotografe os documentos** do cidadão que eu faço a triagem — sempre com checklist e base legal.");
}

const chat = $("chat");
const scrollDown = () => { chat.scrollTop = chat.scrollHeight; };
function addOp(content) {
  const r = document.createElement("div"); r.className = "bx-row op"; const b = document.createElement("div"); b.className = "bx-b";
  if (content && typeof content === "object") { let h = ""; if (content.img) h += `<img src="${content.img}">`; if (content.text) h += esc(content.text); b.innerHTML = h || "📷 documento"; }
  else b.textContent = content;
  r.appendChild(b); chat.appendChild(r); scrollDown();
}
function addBot(t) {
  const r = document.createElement("div"); r.className = "bx-row bot";
  r.innerHTML = '<div class="bx-av">⚖️</div>'; const b = document.createElement("div"); b.className = "bx-b"; b.innerHTML = rich(t);
  r.appendChild(b); chat.appendChild(r); scrollDown(); return r;
}
let typingRow = null;
function typing(on) { if (on) { typingRow = addBot("…"); } else if (typingRow) { typingRow.remove(); typingRow = null; } }

async function enviar() {
  if (carregando) return;
  const txt = $("inp").value.trim();
  if (!txt && !foto) return;
  let content;
  if (foto) { const t = txt || "Faça a triagem destes documentos."; content = [{ type: "text", text: t }, { type: "image", source: { type: "base64", media_type: foto.mediaType, data: foto.data } }]; addOp({ text: txt, img: foto.dataUrl }); }
  else { content = txt; addOp(txt); }
  conversa.push({ role: "user", content });
  $("inp").value = ""; limparFoto();
  carregando = true; typing(true);
  const { ok, data } = await api("/api/atendente", { method: "POST", body: JSON.stringify({ messages: conversa }) });
  typing(false); carregando = false;
  if (!ok) { addBot("⚠️ " + (data.error || "Falha ao responder.")); conversa.pop(); return; }
  const u = conversa[conversa.length - 1]; if (u && Array.isArray(u.content)) u.content = (typeof txt === "string" && txt) ? txt : "(documentos enviados)";
  conversa.push({ role: "assistant", content: data.reply || "" });
  addBot(data.reply || "Sem resposta.");
}
$("send").onclick = enviar;
$("inp").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } });

$("foto").onclick = () => $("file").click();
$("file").onchange = async () => { const f = $("file").files && $("file").files[0]; if (!f) return; try { foto = await comprimir(f); mostrarFoto(foto.dataUrl); } catch (_) { addBot("Não consegui ler a imagem."); } $("file").value = ""; };
function comprimir(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); const MAX = 1500; let w = img.width, h = img.height; if (w > MAX || h > MAX) { const k = Math.min(MAX / w, MAX / h); w = Math.round(w * k); h = Math.round(h * k); } const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); const dataUrl = c.toDataURL("image/jpeg", 0.85); resolve({ dataUrl, mediaType: "image/jpeg", data: dataUrl.split(",")[1] }); };
    img.onerror = reject; img.src = url;
  });
}
function mostrarFoto(dataUrl) {
  if (fotoChip) fotoChip.remove();
  fotoChip = document.createElement("div"); fotoChip.className = "bx-chipfoto";
  fotoChip.innerHTML = '<img><span>Documento pronto — descreva o serviço (ou toque em enviar)</span><button type="button">✕</button>';
  fotoChip.querySelector("img").src = dataUrl; fotoChip.querySelector("button").onclick = limparFoto;
  chat.insertAdjacentElement("afterend", fotoChip);
}
function limparFoto() { foto = null; if (fotoChip) { fotoChip.remove(); fotoChip = null; } }

(async function () {
  const status = await api("/api/tutor/status");
  if (status.ok && !status.data.enabled) { $("login").innerHTML = '<div class="lb-card"><h3>Copiloto do Balcão desativado</h3><p class="sub">Defina TUTOR_PASSWORD no ambiente para ativar.</p><a href="/" class="ghost-btn">← Voltar</a></div>'; return; }
  if (tKey) { const probe = await api("/api/tutor/entries"); if (probe.ok) { abrirConsole(); return; } tKey = ""; sessionStorage.removeItem("tutorKey"); }
})();

/* ── Termo de exigência ── */
$("termo").onclick = gerarTermo;
$("termo-x").onclick = () => $("termo-ov").classList.add("hidden");
$("termo-ov").addEventListener("click", (e) => { if (e.target === $("termo-ov")) $("termo-ov").classList.add("hidden"); });
async function gerarTermo() {
  if (!conversa.length) { addBot("Descreva o caso (ou faça a triagem por foto) antes de gerar o termo."); return; }
  const b = $("termo"); const o = b.textContent; b.disabled = true; b.textContent = "…";
  const { ok, data } = await api("/api/termo", { method: "POST", body: JSON.stringify({ messages: conversa }) });
  b.disabled = false; b.textContent = o;
  if (!ok || !data.termo) { addBot("⚠️ " + ((data && data.error) || "Não foi possível gerar o termo.")); return; }
  abrirTermo(data.termo);
}
function abrirTermo(texto) {
  $("termo-paper").textContent = texto;
  $("termo-ov").classList.remove("hidden");
  $("termo-copy").onclick = async () => { try { await navigator.clipboard.writeText(texto); const c = $("termo-copy"); const t = c.textContent; c.textContent = "✓ Copiado"; setTimeout(() => { c.textContent = t; }, 1500); } catch (_) {} };
  $("termo-print").onclick = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write('<meta charset="utf-8"><title>Termo de exigência</title><pre style="font-family:Georgia,serif;font-size:13px;line-height:1.6;white-space:pre-wrap;padding:26px;">' + esc(texto) + '</pre>');
    w.document.close(); w.focus(); setTimeout(() => w.print(), 250);
  };
}

/* ── Registro de atendimento + painel do balcão ── */
function lg(k){ try { return localStorage.getItem("balcao_" + k) || ""; } catch (_) { return ""; } }
function sg(k, v){ try { localStorage.setItem("balcao_" + k, v); } catch (_) {} }
function ultimoBot(){ for (let i = conversa.length - 1; i >= 0; i--) if (conversa[i].role === "assistant") return conversa[i].content; return ""; }
function ultimoUser(){ for (let i = conversa.length - 1; i >= 0; i--){ const c = conversa[i]; if (c.role === "user") return typeof c.content === "string" ? c.content : "(documentos)"; } return ""; }

$("reg").onclick = abrirReg;
$("reg-x").onclick = () => $("reg-ov").classList.add("hidden");
$("reg-ov").addEventListener("click", (e) => { if (e.target === $("reg-ov")) $("reg-ov").classList.add("hidden"); });
function abrirReg(){
  $("reg-guiche").value = lg("guiche"); $("reg-atendente").value = lg("atendente");
  $("reg-servico").value = ""; $("reg-protocolo").value = ""; $("reg-cpf").value = "";
  const bot = ultimoBot();
  $("reg-resumo").value = bot ? (ultimoUser() + "\n→ " + bot).slice(0, 900) : "";
  $("reg-msg").textContent = "";
  $("reg-ov").classList.remove("hidden");
}
$("reg-save").onclick = async () => {
  const g = $("reg-guiche").value.trim(), a = $("reg-atendente").value.trim();
  sg("guiche", g); sg("atendente", a);
  const body = { guiche: g, atendente: a, servico: $("reg-servico").value.trim(), protocolo: $("reg-protocolo").value.trim(), cpf: $("reg-cpf").value.trim(), resumo: $("reg-resumo").value.trim() };
  if (!body.servico && !body.resumo) { $("reg-msg").textContent = "Informe ao menos o serviço."; return; }
  const { ok, data } = await api("/api/atendimento", { method: "POST", body: JSON.stringify(body) });
  if (!ok) { $("reg-msg").textContent = (data && data.error) || "Falha ao salvar."; return; }
  $("reg-ov").classList.add("hidden"); addBot("Atendimento registrado.");
};

let recCache = [];
$("painel").onclick = abrirPainel;
$("pan-x").onclick = () => $("pan-ov").classList.add("hidden");
$("pan-ov").addEventListener("click", (e) => { if (e.target === $("pan-ov")) $("pan-ov").classList.add("hidden"); });
$("pan-search").addEventListener("input", renderRecs);
async function abrirPainel(){
  $("pan-ov").classList.remove("hidden");
  $("pan-list").innerHTML = '<p style="color:#5B6C64;font-size:13px">Carregando…</p>';
  const { ok, data } = await api("/api/balcao");
  if (!ok) { $("pan-list").innerHTML = '<p style="font-size:13px">Não foi possível carregar.</p>'; return; }
  recCache = data.atendimentos || [];
  renderStats(); renderRecs();
}
function renderStats(){
  const total = recCache.length;
  const porServ = {}, porGui = {};
  recCache.forEach((r) => { const sv = (r.servico || "—").trim() || "—"; porServ[sv] = (porServ[sv] || 0) + 1; const g = (r.guiche || "").trim(); if (g) porGui[g] = (porGui[g] || 0) + 1; });
  $("pan-tiles").innerHTML = `<div class="dash-tile"><div class="num">${total}</div><div class="lbl">atendimentos</div></div><div class="dash-tile"><div class="num">${Object.keys(porServ).length}</div><div class="lbl">tipos de serviço</div></div><div class="dash-tile"><div class="num">${Object.keys(porGui).length}</div><div class="lbl">guichês ativos</div></div>`;
  const bars = (obj, titulo) => { const ents = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6); if (!ents.length) return ""; const max = Math.max(1, ...ents.map((e) => e[1])); return `<div class="t-label" style="font-size:12px;color:#5B6C64;font-weight:600;margin:12px 0 5px">${titulo}</div>` + ents.map(([k, v]) => `<div class="dash-bar"><span class="cap">${esc(k)}</span><span class="track"><span class="fill" style="width:${Math.round(v / max * 100)}%"></span></span><span class="val">${v}</span></div>`).join(""); };
  $("pan-themes").innerHTML = bars(porServ, "Por serviço") + bars(porGui, "Por guichê");
}
function renderRecs(){
  const q = ($("pan-search").value || "").toLowerCase().trim();
  const list = recCache.filter((r) => { if (!q) return true; return [r.protocolo, r.cpf, r.cidadao, r.servico].some((x) => String(x || "").toLowerCase().includes(q)); }).slice(0, 50);
  $("pan-list").innerHTML = list.length ? list.map((r) => {
    const d = new Date(r.at); const dt = d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const meta = [r.guiche && ("Guichê " + r.guiche), r.atendente, r.protocolo && ("Prot. " + r.protocolo), r.cpf].filter(Boolean).join(" · ");
    return `<div class="bx-rec"><h5>${esc(r.servico || "Atendimento")}</h5><div class="m">${esc(meta)} — ${dt}</div>${r.resumo ? `<div class="r">${esc(r.resumo)}</div>` : ""}</div>`;
  }).join("") : '<p style="color:#5B6C64;font-size:13px">Nenhum atendimento encontrado.</p>';
}
