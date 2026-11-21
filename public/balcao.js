// Copiloto do Balcão — apoio ao atendente (modo operador).
const $ = (id) => document.getElementById(id);
// Login por usuário e perfil do DETRAN: ver /sessao.js
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

// Chamadas à API do DETRAN da URL (com o token da sessão).
const api = (path, opts = {}) => Sessao.api(path.replace(/^\/api/, ""), opts);

$("enter").onclick = login;
$("pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
async function login() {
  const u = $("user").value.trim(), k = $("pwd").value;
  if (!u || !k) { $("login-msg").textContent = "Informe usuário e senha."; return; }
  const { ok, data } = await Sessao.entrar(u, k, "balcao");
  if (!ok) { $("login-msg").textContent = data.error || "Usuário ou senha incorretos."; return; }
  abrirConsole();
}
$("logout").onclick = () => { Sessao.sair(); location.reload(); };

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
  const row = addBot(data.reply || "Sem resposta.");
  // Fontes: trechos da mesma base do bot (site/WhatsApp) que embasaram a resposta.
  if (Array.isArray(data.fontes) && data.fontes.length) {
    const f = document.createElement("div"); f.className = "bx-fontes";
    f.innerHTML = "<b>Base usada:</b> " + data.fontes.map((x) => `<span title="${esc(x.baseLegal || "")}">[${x.n}] ${x.tutoria ? "🎓 " : ""}${esc(x.topico || "")}${x.baseLegal ? ` · ${esc(x.baseLegal)}` : ""}</span>`).join("");
    row.querySelector(".bx-b").appendChild(f);
  }
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
  if (await Sessao.valida("balcao")) abrirConsole();
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

/* ── Conferência de documentos (mesmo checklist do site, para o guichê) ── */
(function () {
  let SERV = [], IA = false, estado = {}, atual = null;
  const STX = { OK: ["✓", "Conferido"], TENHO: ["✓", "Apresentado"], VENCIDO: ["!", "Vencido"], OUTRO: ["✗", "Documento errado"], ILEGIVEL: ["?", "Ilegível"], PENDENTE: ["!", "Pendente"], CONFERIR: ["?", "Conferir"] };
  const ok = (s) => ["OK", "TENHO"].includes(s);
  $("conf").onclick = abrir;
  $("conf-x").onclick = () => $("conf-ov").classList.add("hidden");
  $("conf-ov").addEventListener("click", (e) => { if (e.target === $("conf-ov")) $("conf-ov").classList.add("hidden"); });
  $("conf-novo").onclick = () => { estado = {}; $("cl-fone").value = ""; $("cl-aceite").checked = false; $("cl-msg").textContent = ""; render(); };
  $("conf-serv").onchange = () => { atual = SERV.find((s) => s.id === $("conf-serv").value); estado = {}; render(); };

  async function abrir() {
    $("conf-ov").classList.remove("hidden");
    if (!SERV.length) {
      const r = await api("/api/conferencia");
      SERV = (r.ok && r.data.servicos) || []; IA = Boolean(r.ok && r.data.ia);
      $("conf-serv").innerHTML = SERV.map((s) => `<option value="${esc(s.id)}">${s.icone || ""} ${esc(s.titulo)}</option>`).join("");
      atual = SERV[0];
    }
    render();
  }

  function obrigatorios() { return atual ? atual.itens.filter((i) => !(i.condicional && estado[i.id]?.aplica === false)) : []; }
  function render() {
    if (!atual) return;
    const obr = obrigatorios();
    const pend = obr.filter((i) => !ok(estado[i.id]?.status));
    $("conf-resumo").className = "bc-resumo" + (pend.length ? "" : " ok");
    $("conf-resumo").innerHTML = pend.length ? `<b>${obr.length - pend.length} de ${obr.length}</b> conferidos · pendentes: ${pend.map((i) => esc(i.nome)).join(", ")}` : "<b>✅ Documentação completa: pode dar entrada.</b>";
    $("conf-itens").innerHTML = atual.itens.map((i) => {
      const e = estado[i.id] || {}; const na = i.condicional && e.aplica === false; const st = STX[e.status];
      return `<div class="bc-item ${na ? "na" : ""}" data-i="${esc(i.id)}"><div class="bc-st ${esc(e.status || "")}">${na ? "–" : st ? st[0] : ""}</div>
        <div class="bc-txt"><b>${esc(i.nome)}</b>${i.condicional ? " <small style='display:inline'>(se for o caso)</small>" : ""}<small>${esc(i.desc || "")}</small>
        ${e.motivo ? `<div class="bc-mot">${st ? `<b>${st[1]}:</b> ` : ""}${esc(e.motivo)}</div>` : ""}
        <div class="bc-acoes">
          ${!na ? `<button data-a="tenho">✓ Apresentado</button><button data-a="falta">✗ Não trouxe</button>` : ""}
          ${!na && i.foto && IA ? `<label>📷 Conferir foto<input type="file" accept="image/*" capture="environment" hidden></label>` : ""}
          ${i.condicional ? `<button data-a="aplica">${na ? "Aplica-se" : "Não se aplica"}</button>` : ""}
        </div></div></div>`;
    }).join("");
    $("conf-itens").querySelectorAll(".bc-item").forEach((el) => {
      const item = atual.itens.find((x) => x.id === el.dataset.i);
      const set = (v) => { estado[item.id] = v; render(); };
      el.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => {
        const a = b.dataset.a;
        if (a === "tenho") set({ status: "TENHO" });
        else if (a === "falta") set({ status: "PENDENTE", motivo: "Não apresentado." });
        else if (a === "aplica") set(estado[item.id]?.aplica === false ? {} : { aplica: false });
      }));
      const inp = el.querySelector('input[type="file"]');
      if (inp) inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        el.querySelector(".bc-st").textContent = "…";
        try {
          const img = await comprimir(f);
          const r = await api("/api/conferencia/analisar", { method: "POST", body: JSON.stringify({ servico: atual.id, item: item.id, imagem: img.dataUrl }) });
          if (!r.ok) throw new Error(r.data.error || "Não consegui conferir.");
          set({ status: r.data.status, motivo: r.data.motivo });
        } catch (e) { set({ ...(estado[item.id] || {}), motivo: e.message }); }
      };
    });
  }

  function pendenciasTexto() {
    return obrigatorios().filter((i) => !ok(estado[i.id]?.status)).map((i, n) => `${n + 1}. ${i.nome}${estado[i.id]?.motivo ? ` — ${estado[i.id].motivo}` : ` — ${i.desc || "apresentar"}`}`);
  }
  $("conf-termo").onclick = () => {
    const T = window.TENANT || {};
    const p = pendenciasTexto();
    const hoje = new Date().toLocaleDateString("pt-BR");
    const texto = [
      `${String(T.governo || "").toUpperCase()} / ${String(T.nome || "").toUpperCase()} - ${T.sigla || ""}`, "", "TERMO DE EXIGÊNCIA", "",
      `Serviço pretendido: ${atual.titulo}`, "Cidadão: ______________________________   CPF: ____________________", "Protocolo: ____________________", "",
      p.length ? "Para prosseguir com o serviço, é necessário apresentar/corrigir:" : "A documentação apresentada está completa para dar entrada no serviço.",
      ...p, "", "Prazo para cumprimento: ____________________", "",
      `${T.cidadeSede || ""}, ${hoje}.`, "", "Atendente: ______________________________   Matrícula: __________",
    ].join("\n");
    $("conf-ov").classList.add("hidden"); // o termo abre por cima; a conferência continua guardada
    abrirTermo(texto);
  };
  $("conf-reg").onclick = () => {
    abrirReg();
    $("reg-servico").value = atual.titulo;
    const p = pendenciasTexto();
    $("reg-resumo").value = p.length ? "Pendências:\n" + p.join("\n") : "Documentação completa conferida no balcão.";
    $("conf-ov").classList.add("hidden");
  };
  $("cl-ok").onclick = async () => {
    const tipo = $("cl-tipo").value, dt = $("cl-data").value;
    const body = { tipo, telefone: $("cl-fone").value, aceite: $("cl-aceite").checked, ...(tipo === "DEFESA" ? { dataRecebimento: dt } : { data: dt }) };
    if (!body.aceite) { $("cl-msg").textContent = "Confirme que o cidadão aceitou receber."; return; }
    const r = await api("/api/lembretes", { method: "POST", body: JSON.stringify(body) });
    $("cl-msg").textContent = r.ok ? "✓ Convite enviado. Peça para o cidadão responder SIM no WhatsApp." : "⚠️ " + (r.data.error || "Não foi possível.");
  };
})();
