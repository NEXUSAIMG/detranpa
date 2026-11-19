// Sala do Tutor (por DETRAN). O conhecimento e as correções ficam no bot do
// DETRAN no BotAyio (Modo Tutoria); aqui o tutor entra com usuário e senha,
// abre a tutoria do bot e acompanha os indicadores do atendimento.
const $ = (id) => document.getElementById(id);
const el = {
  login: $("login"), panel: $("panel"), user: $("user"), pwd: $("pwd"), enter: $("enter"),
  loginMsg: $("login-msg"), logout: $("logout"), goBalcao: $("go-balcao"),
  tutoria: $("tutoria"), dashTiles: $("dash-tiles"), dashThemes: $("dash-themes"),
  dashHours: $("dash-hours"), dashCanais: $("dash-canais"), dashReload: $("dash-reload"), periodo: $("periodo"),
};
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const msg = (t, text, type) => { t.innerHTML = text ? `<div class="t-msg ${type}">${escapeHtml(text)}</div>` : ""; };

el.enter.onclick = entrar;
el.pwd.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
async function entrar() {
  const login = el.user.value.trim(), senha = el.pwd.value;
  if (!login || !senha) return msg(el.loginMsg, "Informe usuário e senha.", "err");
  el.enter.disabled = true;
  const r = await Sessao.entrar(login, senha, "tutor");
  el.enter.disabled = false;
  if (!r.ok) return msg(el.loginMsg, r.data.error || "Não foi possível entrar.", "err");
  abrirPainel(r.data.usuario);
}
el.logout.onclick = () => { Sessao.sair(); location.reload(); };

async function abrirPainel(usuario) {
  el.login.classList.add("hidden"); el.panel.classList.remove("hidden"); el.logout.classList.remove("hidden");
  const perfil = usuario?.perfil || "";
  if (["BALCAO", "GESTOR", "ADMIN", "SUPERADMIN"].includes(perfil) || !perfil) el.goBalcao.classList.remove("hidden");
  carregarTutoria();
  carregarIndicadores();
}

async function carregarTutoria() {
  const { ok, data } = await Sessao.api("/tutoria");
  if (!ok) { el.tutoria.innerHTML = `<div class="t-msg err">${escapeHtml(data.error || "Não foi possível carregar.")}</div>`; return; }
  const st = data.integracoes || {};
  if (!data.tutorUrl) {
    el.tutoria.innerHTML = `<div class="t-msg err">A tutoria do bot deste DETRAN ainda não foi cadastrada. ${st.botayio ? "O bot já está ligado; falta o link de tutoria." : "O bot deste DETRAN no BotAyio ainda não foi ligado."} Fale com o administrador.</div>`;
    return;
  }
  el.tutoria.innerHTML = `
    <div class="t-row" style="margin-bottom:10px">
      <a class="t-btn primary" href="${escapeHtml(data.tutorUrl)}" target="_blank" rel="noopener" style="text-decoration:none">Abrir a tutoria em nova aba ↗</a>
      <button class="t-btn soft" id="embed">Abrir aqui</button>
    </div>
    <div id="frame-box"></div>`;
  $("embed").onclick = () => {
    $("frame-box").innerHTML = `<iframe src="${escapeHtml(data.tutorUrl)}" title="Tutoria do bot" style="width:100%;height:75vh;border:1px solid var(--paper-edge);border-radius:12px;background:#fff"></iframe>`;
  };
}

async function carregarIndicadores() {
  const dias = Number(el.periodo.value) || 30;
  const { ok, data } = await Sessao.api("/stats?dias=" + dias);
  if (!ok) { el.dashTiles.innerHTML = `<div class="t-msg err">${escapeHtml(data.error || "Sem acesso aos indicadores.")}</div>`; return; }
  const s = data.stats || {};
  const total = s.total || 0;
  const taxa = total ? Math.round(((s.resolved || 0) / total) * 100) : 0;
  const fb = (s.up || 0) + (s.down || 0);
  const sat = fb ? Math.round(((s.up || 0) / fb) * 100) : null;
  el.dashTiles.innerHTML = `
    <div class="dash-tile"><div class="num">${s.conversas || 0}</div><div class="lbl">conversas no período</div></div>
    <div class="dash-tile"><div class="num">${total}</div><div class="lbl">perguntas feitas</div></div>
    <div class="dash-tile"><div class="num">${taxa}%</div><div class="lbl">respondidas sem erro</div></div>
    <div class="dash-tile"><div class="num">${s.transbordos || 0}</div><div class="lbl">pedidos de atendente</div></div>
    <div class="dash-tile"><div class="num">${sat == null ? "—" : sat + "%"}</div><div class="lbl">satisfação · 👍 ${s.up || 0} / 👎 ${s.down || 0}</div></div>`;
  const barra = (cap, v, max) => `<div class="dash-bar"><span class="cap">${escapeHtml(cap)}</span><span class="track"><span class="fill" style="width:${Math.round((v / Math.max(1, max)) * 100)}%"></span></span><span class="val">${v}</span></div>`;
  const bc = s.byCanal || {};
  const maxC = Math.max(bc.WEB || 0, bc.WHATSAPP || 0);
  el.dashCanais.innerHTML = '<div class="t-label">Por canal</div>' + barra("Site", bc.WEB || 0, maxC) + barra("WhatsApp", bc.WHATSAPP || 0, maxC);
  const nomes = { cnh: "Habilitação", veiculos: "Veículos", multas: "Multas", ipva: "IPVA", outros: "Outros", erro: "Falhas de atendimento" };
  const bt = s.byTheme || {};
  const temas = Object.keys(bt).sort((a, b) => bt[b] - bt[a]);
  const maxT = Math.max(1, ...temas.map((k) => bt[k]));
  el.dashThemes.innerHTML = '<div class="t-label">Demanda por tema</div>' + (temas.length ? temas.map((k) => barra(nomes[k] || k, bt[k], maxT)).join("") : '<p class="sub">Sem perguntas no período.</p>');
  const bh = s.byHour || {};
  const periodos = [["Madrugada (0–5h)", 0, 5], ["Manhã (6–11h)", 6, 11], ["Tarde (12–17h)", 12, 17], ["Noite (18–23h)", 18, 23]];
  const somas = periodos.map(([lbl, a, b]) => { let n = 0; for (let h = a; h <= b; h++) n += bh[h] || 0; return { lbl, n }; });
  const maxH = Math.max(1, ...somas.map((x) => x.n));
  el.dashHours.innerHTML = '<div class="t-label">Movimento por horário</div>' + somas.map((x) => barra(x.lbl, x.n, maxH)).join("");
}
el.dashReload.onclick = carregarIndicadores;
el.periodo.onchange = carregarIndicadores;

(async () => { if (await Sessao.valida("tutor")) abrirPainel(); })();
