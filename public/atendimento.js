// Atendimento humano do DETRAN: fila de conversas do WhatsApp que pediram atendente.
// Atualiza sozinho a cada poucos segundos (funciona na Vercel, sem conexão aberta).
const $ = (id) => document.getElementById(id);
let filtro = "HUMANO", abertaId = null, meuId = null, timerLista = null, timerConv = null, ultimaQtd = -1;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const hora = (v) => { const d = new Date(v); const hoje = new Date().toDateString() === d.toDateString(); return hoje ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const fone = (c) => { const d = String(c || ""); return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : d; };
const api = (p, o) => Sessao.api("/atendimento" + p, o);
const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body || {}) });

// ── Login ──
$("l-ok").onclick = entrar;
$("l-pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
async function entrar() {
  const u = $("l-user").value.trim(), s = $("l-pwd").value;
  if (!u || !s) { $("l-msg").textContent = "Informe usuário e senha."; return; }
  const r = await Sessao.entrar(u, s, "atendimento");
  if (!r.ok) { $("l-msg").textContent = r.data.error || "Não foi possível entrar."; return; }
  iniciar();
}
$("sair").onclick = () => { Sessao.sair(); location.reload(); };

function iniciar() {
  try { meuId = JSON.parse(atob(Sessao.token().split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).uid; } catch (_) {}
  $("login").classList.add("hidden"); $("painel").classList.remove("hidden"); $("sair").classList.remove("hidden");
  carregarLista(); timerLista = setInterval(carregarLista, 5000);
}

// ── Fila ──
document.querySelectorAll(".fl").forEach((b) => (b.onclick = () => {
  filtro = b.dataset.st; document.querySelectorAll(".fl").forEach((x) => x.classList.toggle("on", x === b)); carregarLista();
}));
let tBusca; $("busca").addEventListener("input", () => { clearTimeout(tBusca); tBusca = setTimeout(carregarLista, 350); });

async function carregarLista() {
  const r = await api(`/conversas?status=${filtro}&busca=${encodeURIComponent($("busca").value.trim())}`);
  if (r.status === 401 || r.status === 403) { Sessao.sair(); location.reload(); return; }
  if (!r.ok) return;
  const cs = r.data.conversas || [];
  const res = await api("/resumo");
  if (res.ok) {
    const c = $("contador"); c.classList.remove("hidden");
    c.textContent = `🙋 ${res.data.semAtendente} sem atendente · ${res.data.emAtendimento} em atendimento`;
    document.title = (res.data.semAtendente ? `(${res.data.semAtendente}) ` : "") + "Atendimento — " + ((window.TENANT || {}).sigla || "");
    if (ultimaQtd >= 0 && res.data.semAtendente > ultimaQtd) avisar();
    ultimaQtd = res.data.semAtendente;
  }
  $("lista").innerHTML = cs.map((c) => {
    const tags = c.status === "HUMANO"
      ? (!c.atendenteId ? '<span class="tag esp">sem atendente</span>' : c.atendenteId === meuId ? '<span class="tag meu">comigo</span>' : `<span class="tag out">${esc(c.atendenteNome || "")}</span>`)
      : "";
    const quem = c.nome || fone(c.contato);
    const ult = c.ultima ? `${c.ultima.autor === "CIDADAO" ? "" : c.ultima.autor === "BOT" ? "🤖 " : c.ultima.autor === "ATENDENTE" ? "Você/equipe: " : ""}${c.ultima.texto}` : "";
    return `<div class="item ${c.id === abertaId ? "sel" : ""}" data-id="${esc(c.id)}">
      <div class="l1"><span>${c.aguardando ? "🔴 " : ""}${esc(quem)}</span><span class="hr">${hora(c.ultimaEm)}</span></div>
      <div class="l2">${tags}${c.canal === "WEB" ? '<span class="tag out">site</span>' : ""}${esc(ult)}</div></div>`;
  }).join("") || `<div class="vazio">${filtro === "HUMANO" ? "Nenhuma conversa aguardando atendente. 🎉" : "Nada por aqui."}</div>`;
  document.querySelectorAll(".item").forEach((el) => (el.onclick = () => abrir(el.dataset.id)));
}

function avisar() {
  try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(); o.frequency.value = 880; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 180); } catch (_) {}
}

// ── Conversa ──
async function abrir(id) {
  abertaId = id;
  $("painel").classList.add("aberta");
  $("sem-conv").classList.add("hidden"); $("com-conv").classList.remove("hidden");
  document.querySelectorAll(".item").forEach((el) => el.classList.toggle("sel", el.dataset.id === id));
  await carregarConversa(true);
  clearInterval(timerConv); timerConv = setInterval(() => carregarConversa(false), 4000);
}
$("voltar").onclick = () => { abertaId = null; clearInterval(timerConv); $("painel").classList.remove("aberta"); $("com-conv").classList.add("hidden"); $("sem-conv").classList.remove("hidden"); };

let ultimaMsgId = null;
async function carregarConversa(rolar) {
  if (!abertaId) return;
  const r = await api(`/conversas/${abertaId}`);
  if (!r.ok) { mostrarErro(r.data.error || "Não foi possível abrir."); return; }
  const c = r.data.conversa, ms = r.data.mensagens || [];
  $("c-nome").textContent = c.nome || fone(c.contato);
  $("c-info").textContent = `${c.canal === "WHATSAPP" ? "WhatsApp " + fone(c.contato) : "Site"} · ${({ HUMANO: "com atendente", BOT: "com o bot", ENCERRADA: "encerrada" })[c.status]}${c.atendenteNome ? " · " + c.atendenteNome : ""}${c.categoria ? " · " + c.categoria : ""}`;
  const zap = c.canal === "WHATSAPP";
  $("b-assumir").classList.toggle("hidden", !(c.status === "HUMANO" && c.atendenteId !== meuId));
  $("b-assumir").textContent = c.atendenteId ? `Assumir (está com ${c.atendenteNome})` : "Assumir";
  $("b-transferir").classList.toggle("hidden", !(zap && c.status !== "HUMANO"));
  $("b-devolver").classList.toggle("hidden", c.status !== "HUMANO");
  $("b-encerrar").classList.toggle("hidden", c.status !== "HUMANO");
  $("resp").classList.toggle("hidden", !(zap && c.status === "HUMANO"));
  const novoUltimo = ms.length ? ms[ms.length - 1].id : null;
  if (novoUltimo === ultimaMsgId && !rolar) return;
  ultimaMsgId = novoUltimo;
  const box = $("msgs");
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = ms.map((m) => `<div class="m ${m.autor}">${link(m.texto)}${m.autor === "SISTEMA" ? "" : `<small>${m.autor === "CIDADAO" ? "Cidadão" : m.autor === "BOT" ? "Assistente (bot)" : esc(m.autorNome || "Atendente")} · ${hora(m.criadoEm)}</small>`}</div>`).join("");
  if (rolar || perto) box.scrollTop = box.scrollHeight;
}
function mostrarErro(t) { const e = $("c-erro"); e.textContent = t; e.classList.remove("hidden"); setTimeout(() => e.classList.add("hidden"), 6000); }

async function acao(rota, body, okFn) {
  const r = await post(`/conversas/${abertaId}/${rota}`, body);
  if (!r.ok) { mostrarErro(r.data.error || "Não foi possível concluir."); return false; }
  if (okFn) okFn();
  await carregarConversa(true); carregarLista();
  return true;
}
$("b-assumir").onclick = () => acao("assumir");
$("b-transferir").onclick = () => acao("transferir");
$("b-devolver").onclick = () => acao("devolver");
$("b-encerrar").onclick = () => acao("encerrar");

$("r-ok").onclick = responder;
$("r-texto").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); responder(); } });
async function responder() {
  const t = $("r-texto").value.trim(); if (!t) return;
  $("r-ok").disabled = true;
  const ok = await acao("responder", { texto: t }, () => { $("r-texto").value = ""; });
  $("r-ok").disabled = false;
  if (ok) $("r-texto").focus();
}

(async () => { if (await Sessao.valida("atendimento")) iniciar(); })();
