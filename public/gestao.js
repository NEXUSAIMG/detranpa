// Central de Gestão do DETRAN — /<uf>/gestao
(function () {
  const $ = (id) => document.getElementById(id);
  const T = window.TENANT || {};
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const api = (p, o) => Sessao.api("/gestao" + p, o);
  const apiAt = (p, o) => Sessao.api("/atendimento" + p, o);
  const post = (b) => ({ method: "POST", body: JSON.stringify(b || {}) });
  const put = (b) => ({ method: "PUT", body: JSON.stringify(b || {}) });
  const patch = (b) => ({ method: "PATCH", body: JSON.stringify(b || {}) });
  const fmtHora = (d) => (d ? new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
  const fmtData = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
  const fmtDH = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const quando = (d) => { if (!d) return ""; const x = new Date(d); return x.toDateString() === new Date().toDateString() ? fmtHora(x) : x.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };
  const minDesde = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d)) / 60000)) : 0);
  const durTxt = (m) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
  const msgBox = (el, t, tipo = "err") => { $(el).innerHTML = t ? `<div class="msg ${tipo}">${esc(t)}</div>` : ""; };
  const linkify = (s) => window.textoRico ? window.textoRico(s) : esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
  let toastT;
  const toast = (t) => { $("toast").textContent = t; $("toast").classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.add("hidden"), 2600); };

  const S = {
    eu: null, podeGerir: false, config: {}, equipe: [], respostas: [], etiquetas: [], ia: false,
    prioridades: [], statusChamado: [], statusTexto: {},
    sec: "visao", dias: 7, aba: "fila", convId: null, conv: null, modo: "resp",
    chamados: [], modoCh: "kanban", pulso: null, ultimaFila: null,
  };
  const etq = (id) => S.etiquetas.find((e) => e.id === id);
  const nomeCat = { cnh: "CNH", veiculos: "Veículos", multas: "Multas", ipva: "IPVA", outros: "Outros", protocolo: "Protocolo", erro: "Erros" };

  // ── Login ──
  $("ver-site").href = Sessao.base;
  $("l-ok").onclick = entrar;
  $("l-pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  async function entrar() {
    const login = $("l-user").value.trim(), senha = $("l-pwd").value;
    if (!login || !senha) return msgBox("l-msg", "Informe usuário e senha.");
    $("l-ok").disabled = true;
    const r = await Sessao.entrar(login, senha, "central");
    $("l-ok").disabled = false;
    if (!r.ok) return msgBox("l-msg", r.data.error || "Não foi possível entrar.");
    iniciar();
  }
  if ($("duas-etapas")) $("duas-etapas").onclick = () => Sessao.duasEtapas();
  $("sair").onclick = async () => { await api("/eu/status", put({ status: "OFFLINE" })).catch(() => {}); Sessao.sair(); location.reload(); };

  async function iniciar() {
    const r = await api("/inicio");
    if (!r.ok) { Sessao.sair(); $("tela-login").classList.remove("hidden"); $("app").classList.add("hidden"); return msgBox("l-msg", r.data.error || "Faça login."); }
    Object.assign(S, r.data);
    // Para a equipe, "Aguardando você" (texto do cidadão) vira "Aguardando cidadão".
    S.statusTexto = { ...S.statusTexto, AGUARDANDO_CIDADAO: "Aguardando cidadão" };
    $("tela-login").classList.add("hidden"); $("app").classList.remove("hidden");
    $("eu-nome").textContent = S.eu.nome;
    document.querySelectorAll(".so-gestor").forEach((el) => el.classList.toggle("hidden", !S.podeGerir));
    document.querySelectorAll(".so-tutoria").forEach((el) => el.classList.toggle("hidden", !S.podeTutoria));
    document.querySelectorAll(".ia-only").forEach((el) => el.classList.toggle("hidden", !S.ia));
    // TUTOR: entra só na Tutoria (sem fila, status, chamados nem modo TV).
    if (S.soTutoria) {
      document.querySelectorAll(".lado .nav").forEach((el) => { if (el.dataset.sec !== "tutoria" && el.id !== "ver-site") el.classList.add("hidden"); });
      ["meu-status", "pulso"].forEach((id) => $(id).classList.add("hidden"));
      return irPara("tutoria");
    }
    // Entrou na central: fica online (se estava offline)
    if (S.eu.status === "OFFLINE" && S.eu.id) { await api("/eu/status", put({ status: "ONLINE" })); S.eu.status = "ONLINE"; }
    mostrarStatus();
    montarFiltros();
    const h = (location.hash || "").slice(1);
    document.querySelectorAll(".so-demo").forEach((el) => el.classList.toggle("hidden", !(T.demonstracao || window.SIM_LIBERADO)));
    irPara(["visao", "atendimento", "chamados", "cidadaos", "equipe", "config"].concat((T.demonstracao || window.SIM_LIBERADO) ? ["unidades"] : [], S.podeTutoria ? ["tutoria"] : [], S.podeGerir ? ["observatorio"] : []).includes(h) ? h : "visao");
    pulsar(); setInterval(pulsar, 5000);
    setInterval(() => { if (document.hidden) return; if (S.sec === "atendimento") { carregarLista(); if (S.convId) abrirConversa(S.convId, true); } else if (S.sec === "visao") carregarVisao(); else if (S.sec === "unidades") carregarUnidades(); }, 8000);
    if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 3000);
  }

  // ── Status do atendente ──
  function mostrarStatus() { const s = $("meu-status"); s.value = S.eu.status; s.className = "status-sel " + S.eu.status; }
  $("meu-status").onchange = async (e) => {
    const r = await api("/eu/status", put({ status: e.target.value }));
    if (r.ok) { S.eu.status = r.data.status; mostrarStatus(); toast(`Status: ${e.target.selectedOptions[0].textContent.replace("● ", "")}`); }
  };

  // ── Navegação ──
  const TITULOS = { visao: "Visão geral", atendimento: "Atendimento", chamados: "Chamados", cidadaos: "Cidadãos", equipe: "Equipe", config: "Configurações", unidades: "Unidades e integrações (simulação)", tutoria: "Tutoria do bot", observatorio: "Observatório de demandas" };
  document.querySelectorAll(".nav[data-sec]").forEach((b) => (b.onclick = () => irPara(b.dataset.sec)));
  $("menu-mob").onclick = () => document.querySelector(".lado").classList.toggle("aberto");
  function irPara(sec) {
    S.sec = sec; history.replaceState(null, "", "#" + sec);
    document.querySelectorAll(".nav[data-sec]").forEach((b) => b.classList.toggle("on", b.dataset.sec === sec));
    document.querySelectorAll(".sec").forEach((s) => s.classList.toggle("hidden", s.id !== "sec-" + sec));
    $("titulo-sec").textContent = TITULOS[sec];
    document.querySelector(".lado").classList.remove("aberto");
    ({ visao: carregarVisao, atendimento: carregarLista, chamados: carregarChamados, cidadaos: carregarCidadaos, equipe: carregarEquipe, config: carregarConfig, unidades: carregarUnidades, tutoria: () => window.TutoriaGestao.carregar(), observatorio: () => window.Observatorio.carregar() })[sec]();
  }

  // ── Unidades e integrações (simulação; só DETRAN em demonstração) ──
  async function carregarUnidades() {
    const [f, i] = await Promise.all([Sessao.api("/sim/filas"), Sessao.api("/sim/integracoes")]);
    if (!f.ok || !i.ok) { $("uni-tab").innerHTML = `<div class="msg err">${esc((f.data || i.data).error || "Simulação indisponível.")}</div>`; return; }
    const U = f.data.unidades, abertas = U.filter((u) => u.aberta);
    const tot = (k) => U.reduce((s, u) => s + u[k], 0);
    const pior = abertas.slice().sort((a, b) => b.esperaMin - a.esperaMin)[0];
    const melhor = abertas.slice().sort((a, b) => a.esperaMin - b.esperaMin)[0];
    $("uni-kpis").innerHTML = [
      ["Aguardando agora", tot("aguardando"), `${abertas.length}/${U.length} unidades abertas`],
      ["Guichês abertos", tot("guichesAbertos"), `de ${tot("guiches")} no total`],
      ["Atendidos hoje", tot("atendidosHoje"), "todas as unidades"],
      ["Maior espera", pior ? `${pior.esperaMin} min` : "—", pior ? pior.nome : "unidades fechadas"],
      ["Menor espera", melhor ? `${melhor.esperaMin} min` : "—", melhor ? `${melhor.nome} — o bot sugere esta` : ""],
    ].map(([t, v, s]) => `<div class="kpi"><small>${esc(t)}</small><b>${esc(v)}</b><span>${esc(s)}</span></div>`).join("");
    const cor = { Tranquila: "#157A4C", Movimentada: "#A35A00", Lotada: "#B3261E", Fechada: "#8A93A6" };
    $("uni-tab").innerHTML = `<div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Unidade</th><th>Tipo</th><th>Status</th><th>Aguardando</th><th>Espera</th><th>Guichês</th><th>Atendidos hoje</th></tr></thead><tbody>${U.map((u) => `<tr>
      <td><b>${esc(u.nome)}</b><br><small>${esc(u.cidade)}</small></td><td>${esc(u.tipo)}</td>
      <td><span style="color:${cor[u.status]};font-weight:700">● ${u.status}</span></td><td>${u.aguardando}</td>
      <td>${u.aberta ? u.esperaMin + " min" : "—"}</td><td>${u.guichesAbertos}/${u.guiches}</td><td>${u.atendidosHoje}</td></tr>`).join("")}</tbody></table></div>`;
    $("uni-integ").innerHTML = `<div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Sistema</th><th>Status</th><th>Latência</th><th>Chamadas hoje</th><th>Última sincronização</th></tr></thead><tbody>${i.data.itens.map((x) => `<tr>
      <td><b>${esc(x.nome)}</b><br><small>${esc(x.desc)}</small></td><td><span style="color:${x.status === "Operacional" ? "#157A4C" : "#A35A00"};font-weight:700">● ${x.status}</span></td>
      <td>${x.latenciaMs} ms</td><td>${x.chamadasHoje.toLocaleString("pt-BR")}</td><td>${fmtHora(x.ultimaSync)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  // ── Pulso: contadores, alerta de fila, notificação ──
  let audio;
  function bip() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18].forEach((t) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.16); o.connect(g).connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.17); });
    } catch (_) {}
  }
  async function pulsar() {
    const r = await api("/pulso"); if (!r.ok) { if (r.status === 401) location.reload(); return; }
    const p = r.data; S.pulso = p;
    const espMin = minDesde(p.filaMaisAntiga);
    const cls = !p.fila ? "" : espMin >= S.config.esperaCriticaMin ? "critico" : espMin >= S.config.esperaAlertaMin ? "alerta" : "";
    $("pulso").innerHTML = `<span class="p ${cls}">Fila: ${p.fila}${p.fila ? ` · ${durTxt(espMin)}` : ""}</span><span class="p">Em atendimento: ${p.emAtendimento}</span>`
      + (p.meusAguardando ? `<span class="p alerta">${p.meusAguardando} esperando sua resposta</span>` : "")
      + (p.chamadosVencidos ? `<span class="p critico">${p.chamadosVencidos} chamado(s) vencido(s)</span>` : "");
    $("bdg-fila").textContent = p.fila; $("bdg-fila").classList.toggle("hidden", !p.fila);
    $("bdg-vencidos").textContent = p.chamadosVencidos; $("bdg-vencidos").classList.toggle("hidden", !p.chamadosVencidos);
    $("n-fila").textContent = p.fila || ""; $("n-meus").textContent = p.meus || "";
    document.title = (p.fila ? `(${p.fila}) ` : "") + `Central de Gestão — ${T.sigla}`;
    if (S.ultimaFila != null && p.fila > S.ultimaFila && S.eu.status === "ONLINE") {
      bip();
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) new Notification(`${T.sigla}: cidadão na fila`, { body: `${p.fila} aguardando atendente.`, icon: T.marcaUrl });
    }
    S.ultimaFila = p.fila;
    if (!$("tv").classList.contains("hidden")) desenharTV();
  }

  // ═════════ VISÃO GERAL ═════════
  document.querySelectorAll("#periodo button").forEach((b) => (b.onclick = () => { S.dias = Number(b.dataset.d); document.querySelectorAll("#periodo button").forEach((x) => x.classList.toggle("on", x === b)); carregarVisao(); }));
  // Texto legível sobre a cor da etiqueta (contraste WCAG AA): branco ou escuro.
  function corTexto(hex) {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if (!m) return '#1B2236';
    const [r, g, b] = m.slice(1).map((x) => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return (1.05) / (L + 0.05) >= 4.5 ? '#fff' : '#1B2236';
  }
  const kpi = (rot, val, sub = "", cls = "") => `<div class="kpi ${cls}"><small>${esc(rot)}</small><b>${esc(val)}</b><span>${esc(sub)}</span></div>`;
  // Faixa de saúde: só aparece se alguma integração deste DETRAN estiver fora
  // (o Balcão não tem acesso a esta checagem; a faixa simplesmente não aparece).
  async function faixaSaude() {
    const el = $("saude-faixa"); if (!el) return;
    const r = await api("/saude").catch(() => null);
    const fora = r && r.ok ? r.data.itens.filter((i) => i.ok === false && i.configurado !== false) : [];
    el.classList.toggle("hidden", !fora.length);
    el.innerHTML = fora.map((i) => `⚠️ <b>${esc(i.nome)}</b> fora do ar${i.detalhe ? `: ${esc(i.detalhe)}` : ""}. Avise a equipe técnica.`).join("<br>");
  }
  async function carregarVisao() {
    faixaSaude();
    const r = await api(`/visao?dias=${S.dias}`); if (!r.ok) return;
    const v = r.data; S.visao = v; const a = v.agora, p = v.periodo;
    $("kpi-agora").innerHTML =
      kpi("Na fila", a.fila, a.fila ? `espera máx. ${durTxt(a.esperaMaxMin)}` : "ninguém esperando", a.esperaMaxMin >= S.config.esperaCriticaMin ? "critico" : a.esperaMaxMin >= S.config.esperaAlertaMin ? "alerta" : "")
      + kpi("Em atendimento", a.emAtendimento, "com atendente")
      + kpi("Com o assistente virtual", a.noBot, "últimos 30 min", "neutro")
      + kpi("Equipe online", a.online, `de ${S.equipe.length}`, "neutro")
      + kpi("Chamados em aberto", a.chamadosAbertos, a.chamadosVencidos ? `${a.chamadosVencidos} vencido(s)` : "nenhum vencido", a.chamadosVencidos ? "critico" : "");
    $("kpi-periodo").innerHTML =
      kpi("Perguntas ao assistente", p.perguntas.toLocaleString("pt-BR"), `${p.conversas} conversas`, "neutro")
      + kpi("Pediram atendente", p.transbordos, `${p.taxaTransbordo}% das conversas`)
      + kpi("1ª resposta humana", durTxt(p.tprMedioMin), "tempo médio")
      + kpi("Duração do atendimento", durTxt(p.tmaMedioMin), `${p.encerradas} encerrados`)
      + kpi("Satisfação", p.nota != null ? `${String(p.nota).replace(".", ",")} ★` : "—", p.avaliacoes ? `${p.csat}% satisfeitos · ${p.avaliacoes} notas` : "sem notas ainda", p.nota != null && p.nota < 3.5 ? "alerta" : "")
      + kpi("Chamados", `${p.chamadosResolvidos}/${p.chamadosAbertos}`, p.resolucaoMediaH != null ? `resolvidos · ${durTxt(p.resolucaoMediaH * 60)} em média` : "resolvidos / abertos")
      + kpi("Lembretes no WhatsApp", p.lembretesAtivos, `${p.lembretesEnviados} enviado(s) no período`, "neutro");
    grafDias(v.porDia); grafTemas(v.temas); grafCalor(v.calor); grafNotas(p.distNotas, p.nota); tabRanking(v.ranking);
  }
  function grafDias(porDia) {
    const dias = []; for (let i = S.dias === 1 ? 0 : S.dias - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); dias.push(d.toLocaleDateString("en-CA")); }
    const vals = dias.map((d) => porDia[d] || 0); const max = Math.max(1, ...vals); const W = 600, H = 150, n = vals.length, bw = W / n;
    const barras = vals.map((v, i) => `<rect x="${i * bw + bw * 0.15}" y="${H - (v / max) * (H - 18)}" width="${bw * 0.7}" height="${(v / max) * (H - 18)}" rx="3" fill="var(--ayio-teal)"><title>${dias[i].split("-").reverse().join("/")}: ${v}</title></rect>`).join("");
    const rot = n <= 14 ? vals.map((v, i) => `<text x="${i * bw + bw / 2}" y="${H + 14}" font-size="12" text-anchor="middle" fill="#667085">${dias[i].slice(8)}/${dias[i].slice(5, 7)}</text>`).join("") : "";
    $("graf-dias").innerHTML = vals.some(Boolean) ? `<svg viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="none">${barras}${rot}</svg>` : '<div class="vazio-p">Sem movimento no período.</div>';
  }
  function grafTemas(temas) {
    const max = Math.max(1, ...temas.map((t) => t.n));
    $("graf-temas").innerHTML = temas.length ? `<div class="barras-h">${temas.slice(0, 8).map((t) => `<div class="b"><span>${esc(nomeCat[t.tema] || t.tema)}</span><div class="trilho"><div class="enche" style="width:${(t.n / max) * 100}%"></div></div><span class="n">${t.n}</span></div>`).join("")}</div>` : '<div class="vazio-p">Sem perguntas no período.</div>';
  }
  function grafCalor(calor) {
    const max = Math.max(1, ...calor.flat()); const D = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    let h = '<span></span>' + Array.from({ length: 24 }, (_, i) => `<span style="text-align:center">${i % 3 === 0 ? i : ""}</span>`).join("");
    for (let d = 0; d < 7; d++) h += `<span class="r">${D[d]}</span>` + calor[d].map((v, hr) => `<span class="c" style="opacity:${v ? 0.15 + (v / max) * 0.85 : 0.06}" title="${D[d]} ${hr}h: ${v}"></span>`).join("");
    $("graf-calor").innerHTML = h;
  }
  function grafNotas(dist, media) {
    const tot = dist.reduce((s, x) => s + x, 0); const max = Math.max(1, ...dist);
    $("graf-notas").innerHTML = tot ? `<div style="display:flex;align-items:center;gap:16px;margin-bottom:8px"><b style="font-size:34px;color:var(--ayio-navy)">${String(media).replace(".", ",")}</b><span class="estrelas">${"★".repeat(Math.round(media))}${"☆".repeat(5 - Math.round(media))}</span><span class="vazio-p">${tot} avaliação(ões)</span></div>`
      + `<div class="barras-h">${[5, 4, 3, 2, 1].map((n) => `<div class="b"><span>${n} ★</span><div class="trilho"><div class="enche" style="width:${(dist[n - 1] / max) * 100}%;background:${n >= 4 ? "var(--ok)" : n === 3 ? "#F59E0B" : "var(--verm)"}"></div></div><span class="n">${dist[n - 1]}</span></div>`).join("")}</div>`
      : `<div class="vazio-p">Ainda sem notas. ${S.config.pesquisaSatisfacao ? "Ao encerrar um atendimento no WhatsApp, o cidadão recebe a pergunta de 1 a 5." : "A pesquisa está desligada em Configurações."}</div>`;
  }
  function tabRanking(rk) {
    $("tab-ranking").innerHTML = rk.length ? `<table class="tabela"><thead><tr><th>Atendente</th><th>Agora</th><th>Atendimentos</th><th>1ª resposta</th><th>Nota</th></tr></thead><tbody>${rk.map((u, i) => `<tr><td>${i < 3 && u.atendimentos ? ["🥇", "🥈", "🥉"][i] + " " : ""}<span class="bolinha ${u.status}"></span>${esc(u.nome)}</td><td>${u.emAtendimento || "—"}</td><td><b>${u.atendimentos}</b></td><td>${durTxt(u.tprMin)}</td><td>${u.nota != null ? `${String(u.nota).replace(".", ",")} ★ <span class="vazio-p">(${u.avaliacoes})</span>` : "—"}</td></tr>`).join("")}</tbody></table>` : '<div class="vazio-p">Cadastre a equipe em Administração → Usuários.</div>';
  }

  // ═════════ ATENDIMENTO ═════════
  function montarFiltros() {
    $("filtro-etq").innerHTML = '<option value="">Etiquetas</option>' + S.etiquetas.map((e) => `<option value="${esc(e.id)}">${esc(e.nome)}</option>`).join("");
    $("fch-prio").innerHTML = '<option value="">Prioridade</option>' + S.prioridades.map((p) => `<option>${p}</option>`).join("");
    $("fch-status").innerHTML = '<option value="abertos">Em aberto</option><option value="">Todos</option>' + S.statusChamado.map((s) => `<option value="${s}">${esc(S.statusTexto[s])}</option>`).join("");
    $("fch-resp").innerHTML = '<option value="">Responsável</option><option value="eu">Comigo</option><option value="ninguem">Sem responsável</option>' + S.equipe.map((u) => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join("");
  }
  document.querySelectorAll("#abas-conv button").forEach((b) => (b.onclick = () => { S.aba = b.dataset.aba; document.querySelectorAll("#abas-conv button").forEach((x) => x.classList.toggle("on", x === b)); carregarLista(); }));
  let tBusca; $("busca-conv").oninput = () => { clearTimeout(tBusca); tBusca = setTimeout(carregarLista, 300); };
  $("filtro-etq").onchange = carregarLista;
  $("puxar-proximo").onclick = async () => {
    const r = await api("/fila/proximo", post());
    if (!r.ok) return toast(r.data.error || "Não foi possível.");
    if (!r.data.conversaId) return toast("A fila está vazia. 🎉");
    S.aba = "meus"; document.querySelectorAll("#abas-conv button").forEach((x) => x.classList.toggle("on", x.dataset.aba === "meus"));
    await carregarLista(); abrirConversa(r.data.conversaId); pulsar();
  };
  function classeEspera(min) { return min >= S.config.esperaCriticaMin ? "critico" : min >= S.config.esperaAlertaMin ? "alerta" : ""; }
  async function carregarLista() {
    const q = new URLSearchParams({ aba: S.aba, busca: $("busca-conv").value.trim(), etiqueta: $("filtro-etq").value });
    const r = await api("/conversas?" + q); if (!r.ok) return;
    const cs = r.data.conversas;
    $("lista-conv").innerHTML = cs.map((c) => {
      const esp = c.esperaDesde ? minDesde(c.esperaDesde) : null;
      const etqs = (c.etiquetas || []).map(etq).filter(Boolean).map((e) => `<span class="chip tinto" style="background:${esc(e.cor)};color:${corTexto(e.cor)}">${esc(e.nome)}</span>`).join("");
      const ultima = c.ultima ? `${c.ultima.autor === "CIDADAO" ? "" : c.ultima.autor === "BOT" ? "🤖 " : "Você/equipe: "}${window.textoLimpo ? window.textoLimpo(c.ultima.texto) : c.ultima.texto}` : "";
      return `<div class="it ${c.id === S.convId ? "sel" : ""}" data-id="${esc(c.id)}">
        <div class="l1"><span>${c.canal === "WHATSAPP" ? "🟢" : "🌐"} ${esc(c.nome || (c.canal === "WEB" ? "Visitante do site" : formatarFone(c.contato)))}</span>${esp != null ? `<span class="espera ${classeEspera(esp)}">⏱ ${durTxt(esp)}</span>` : `<span class="hora">${quando(c.ultimaEm)}</span>`}</div>
        <div class="l2">${esc(ultima)}</div>
        <div class="l3">${c.atendenteNome && S.aba !== "meus" ? `<span class="chip">👤 ${esc(c.atendenteNome)}</span>` : ""}${c.categoria ? `<span class="chip">${esc(nomeCat[c.categoria] || c.categoria)}</span>` : ""}${c.avaliacao ? `<span class="chip">${c.avaliacao} ★</span>` : ""}${etqs}</div>
      </div>`;
    }).join("") || `<div class="vazio"><div class="vazio-ic">${S.aba === "fila" ? "🎉" : "📭"}</div><b>${S.aba === "fila" ? "Ninguém na fila" : "Nada por aqui"}</b></div>`;
    document.querySelectorAll("#lista-conv .it").forEach((el) => (el.onclick = () => abrirConversa(el.dataset.id)));
  }
  $("voltar-lista").onclick = () => $("caixa").classList.remove("aberta");

  async function abrirConversa(id, silencioso) {
    const r = await api("/conversas/" + encodeURIComponent(id)); if (!r.ok) return silencioso || toast(r.data.error || "Erro ao abrir.");
    const mudou = S.convId !== id;
    S.convId = id; S.conv = r.data;
    $("caixa").classList.add("aberta");
    $("conv-vazia").classList.add("hidden"); $("conv").classList.remove("hidden"); $("ficha").classList.remove("hidden");
    document.querySelectorAll("#lista-conv .it").forEach((el) => el.classList.toggle("sel", el.dataset.id === id));
    const c = r.data.conversa;
    $("c-nome").textContent = r.data.ficha.nome || c.nome || c.contato;
    const stTxt = { HUMANO: c.atendenteNome ? `com ${c.atendenteNome}` : "aguardando atendente", BOT: "com o assistente virtual", ENCERRADA: `encerrado${c.avaliacao ? ` · nota ${c.avaliacao}/5` : ""}` }[c.status];
    $("c-sub").textContent = `${c.canal === "WHATSAPP" ? "WhatsApp " + formatarFone(c.contato) : "Site"} · ${stTxt}`;
    acoesConversa(c);
    const box = $("c-msgs"); const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const html = r.data.mensagens.map((m) => `<div class="m ${esc(m.autor)}">${linkify(m.texto)}<small>${m.autorNome ? esc(m.autorNome) + " · " : ""}${fmtDH(m.criadoEm)}</small></div>`).join("");
    if (box.dataset.h !== String(html.length) || mudou) { box.innerHTML = html; box.dataset.h = html.length; if (mudou || noFim) box.scrollTop = box.scrollHeight; }
    // Site também (27/11/2026): a resposta aparece na tela do cidadão enquanto ele estiver nela.
    const podeResponder = c.status === "HUMANO";
    $("compor").classList.toggle("hidden", !(podeResponder || S.modo === "nota" || c.status !== "HUMANO"));
    if (mudou) { trocarModo(podeResponder ? "resp" : "nota"); $("ia-resumo-out").classList.add("hidden"); fichaPreencher(r.data); }
    else fichaChamados(r.data.chamados);
  }
  // Só formata o que é telefone; o "contato" do site é o código da sessão (teste I13).
  const formatarFone = (f) => { if (!/^\+?[\d\s().-]{10,20}$/.test(String(f || ""))) return "sessão do site"; const d = String(f).replace(/\D/g, "").replace(/^55/, ""); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : f; };
  function acoesConversa(c) {
    const meu = c.atendenteId === S.eu.id; const b = [];
    if (c.status === "HUMANO" && !c.atendenteId) b.push(`<button class="btn pri mini" data-a="assumir">Assumir</button>`);
    if (c.status !== "HUMANO") b.push(`<button class="btn soft mini" data-a="transferir">Puxar para mim</button>`);
    if (c.status === "HUMANO") b.push(`<button class="btn ghost mini" data-a="repassar">Repassar</button>`);
    b.push(`<button class="btn soft mini" data-a="chamado">📋 Abrir chamado</button>`);
    if (c.status === "HUMANO" && (meu || S.podeGerir || !c.atendenteId)) b.push(`<button class="btn ghost mini" data-a="devolver">Devolver ao bot</button><button class="btn acento mini" data-a="encerrar">Encerrar</button>`);
    $("c-acoes").innerHTML = b.join("");
    $("c-acoes").querySelectorAll("button").forEach((x) => (x.onclick = () => acao(x.dataset.a)));
  }
  async function acao(a) {
    const id = S.convId; let r;
    if (a === "assumir" || a === "transferir") r = await apiAt(`/conversas/${id}/${a}`, post());
    else if (a === "repassar") return modalRepassar();
    else if (a === "chamado") return modalChamado({ conversaId: id });
    else if (a === "devolver") { if (!(await confirmar("Devolver a conversa para o assistente virtual?"))) return; r = await apiAt(`/conversas/${id}/devolver`, post()); }
    else if (a === "encerrar") return modalEncerrar();
    if (r && !r.ok) return toast(r.data.error || "Não foi possível.");
    toast("Feito."); await abrirConversa(id, true); carregarLista(); pulsar();
  }
  // Confirmação dentro da página (teste I13): a caixa do navegador trava a tela e some
  // em alguns navegadores. Devolve uma Promise; quem chama usa "await confirmar(...)".
  const confirmar = (t) => new Promise((ok) => {
    const volta = document.activeElement;
    const ov = document.createElement("div"); ov.className = "conf-ov";
    ov.innerHTML = `<div class="conf-box" role="alertdialog" aria-modal="true" aria-labelledby="conf-t"><p id="conf-t">${esc(t)}</p><div class="conf-bts"><button type="button" class="btn ghost" data-r="0">Cancelar</button><button type="button" class="btn" data-r="1">Confirmar</button></div></div>`;
    const fim = (r) => { ov.remove(); document.removeEventListener("keydown", tecla, true); volta?.focus?.(); ok(r); };
    const tecla = (e) => { if (e.key === "Escape") { e.preventDefault(); fim(false); } else if (e.key === "Tab") { const bs = [...ov.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement); e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus(); } };
    ov.querySelectorAll("button").forEach((b) => (b.onclick = () => fim(b.dataset.r === "1")));
    ov.addEventListener("click", (e) => { if (e.target === ov) fim(false); });
    document.addEventListener("keydown", tecla, true);
    document.body.appendChild(ov); ov.querySelector('[data-r="0"]').focus();
  });

  // Caixa de resposta: resposta ao cidadão ou nota interna; "/" abre respostas rápidas
  document.querySelectorAll(".compor-abas button[data-modo]").forEach((b) => (b.onclick = () => trocarModo(b.dataset.modo)));
  function trocarModo(m) {
    S.modo = m; $("compor").classList.toggle("nota", m === "nota");
    document.querySelectorAll(".compor-abas button[data-modo]").forEach((b) => b.classList.toggle("on", b.dataset.modo === m));
    const c = S.conv?.conversa;
    const pode = c && c.status === "HUMANO";
    document.querySelector('.compor-abas button[data-modo="resp"]').disabled = !pode;
    $("c-texto").placeholder = m === "nota" ? "Nota interna — só a equipe vê."
      : c?.canal === "WEB" ? "Mensagem para o cidadão no site (ele vê enquanto estiver com a página aberta)… Enter envia"
      : "Escreva a mensagem para o cidadão… (Enter envia, Shift+Enter quebra linha)";
    $("compor").classList.remove("hidden");
  }
  $("c-enviar").onclick = enviar;
  const ta = $("c-texto");
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; rapidasFiltrar(); });
  ta.addEventListener("keydown", (e) => {
    const aberto = !$("rapidas").classList.contains("hidden");
    if (aberto && ["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); moverRapida(e.key === "ArrowDown" ? 1 : -1); return; }
    if (aberto && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); usarRapida(); return; }
    if (aberto && e.key === "Escape") { $("rapidas").classList.add("hidden"); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  });
  let rapSel = 0, rapLista = [];
  function rapidasFiltrar() {
    const m = ta.value.match(/(?:^|\s)\/([\w-]*)$/);
    if (!m) return $("rapidas").classList.add("hidden");
    const q = m[1].toLowerCase();
    rapLista = S.respostas.filter((r) => r.atalho.includes(q) || r.titulo.toLowerCase().includes(q)).slice(0, 8);
    if (!rapLista.length) return $("rapidas").classList.add("hidden");
    rapSel = 0; desenharRapidas();
  }
  function desenharRapidas() {
    $("rapidas").innerHTML = rapLista.map((r, i) => `<div class="r ${i === rapSel ? "sel" : ""}" data-i="${i}"><b>/${esc(r.atalho)}</b> — ${esc(r.titulo)}<span>${esc(r.texto)}</span></div>`).join("");
    $("rapidas").classList.remove("hidden");
    $("rapidas").querySelectorAll(".r").forEach((el) => (el.onmousedown = (e) => { e.preventDefault(); rapSel = Number(el.dataset.i); usarRapida(); }));
  }
  function moverRapida(d) { rapSel = (rapSel + d + rapLista.length) % rapLista.length; desenharRapidas(); }
  function usarRapida() {
    const r = rapLista[rapSel]; if (!r) return;
    const nome = (S.conv?.ficha?.nome || S.conv?.conversa?.nome || "").split(" ")[0];
    ta.value = ta.value.replace(/(?:^|\s)\/[\w-]*$/, (m) => (m.startsWith(" ") ? " " : "") + r.texto.replace(/\{nome\}/g, nome));
    $("rapidas").classList.add("hidden"); ta.focus(); ta.dispatchEvent(new Event("input"));
  }
  async function enviar() {
    const texto = ta.value.trim(); if (!texto || !S.convId) return;
    $("c-enviar").disabled = true;
    const r = S.modo === "nota" ? await api(`/conversas/${S.convId}/nota`, post({ texto })) : await apiAt(`/conversas/${S.convId}/responder`, post({ texto }));
    $("c-enviar").disabled = false;
    if (!r.ok) return toast(r.data.error || "Não foi possível enviar.");
    ta.value = ""; ta.style.height = "auto";
    await abrirConversa(S.convId, true); $("c-msgs").scrollTop = $("c-msgs").scrollHeight; carregarLista();
  }
  $("ia-sugerir").onclick = async () => {
    $("ia-sugerir").disabled = true; $("ia-sugerir").textContent = "✨ Pensando…";
    const r = await api("/ia/sugestao", post({ conversaId: S.convId }));
    $("ia-sugerir").disabled = false; $("ia-sugerir").textContent = "✨ Sugerir resposta";
    if (!r.ok) return toast(r.data.error || "A IA não respondeu.");
    trocarModo("resp"); ta.value = r.data.sugestao; ta.focus(); ta.dispatchEvent(new Event("input"));
  };

  // Ficha do cidadão (painel da direita)
  function fichaPreencher(d) {
    $("f-nome").value = d.ficha.nome || ""; $("f-notas").value = d.ficha.notas || "";
    const marcadas = new Set(d.ficha.etiquetas);
    $("f-etqs").innerHTML = S.etiquetas.map((e) => `<button class="etq ${marcadas.has(e.id) ? "on" : ""}" data-id="${esc(e.id)}" style="--c:${esc(e.cor)}">${esc(e.nome)}</button>`).join("") || '<span class="vazio-p">Sem etiquetas cadastradas.</span>';
    $("f-etqs").querySelectorAll(".etq").forEach((b) => (b.onclick = () => { b.classList.toggle("on"); salvarFicha(true); }));
    fichaChamados(d.chamados);
    if (d.conversa.canal === "WHATSAPP") fichaLembretes(d.conversa.contato); else $("f-lembretes").innerHTML = '<span class="vazio-p">Só para conversas do WhatsApp.</span>';
  }
  async function fichaLembretes(contato) {
    const r = await api("/lembretes?contato=" + encodeURIComponent(contato));
    const ls = (r.ok && r.data.lembretes) || [];
    const ST = { ATIVO: "ativo", PENDENTE: "aguardando SIM", CONCLUIDO: "concluído", CANCELADO: "cancelado" };
    $("f-lembretes").innerHTML = ls.length ? ls.map((l) => `<div class="mini-ch">🔔 <b>${esc(l.nome || l.tipo)}</b>${l.descricao ? ` <small>(${esc(l.descricao)})</small>` : ""}<div>${new Date(l.dataAlvo).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · ${ST[l.status] || l.status}${["ATIVO", "PENDENTE"].includes(l.status) ? ` <button class="btn ghost mini" data-cl="${esc(l.id)}">cancelar</button>` : ""}</div></div>`).join("") : '<span class="vazio-p">Nenhum. O cidadão pode pedir pelo site ou mandando "lembrete" no WhatsApp.</span>';
    $("f-lembretes").querySelectorAll("[data-cl]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); if (!(await confirmar("Cancelar este lembrete?"))) return; await api("/lembretes/" + b.dataset.cl, { method: "DELETE" }); fichaLembretes(contato); }));
  }
  function fichaChamados(chs) {
    $("f-chamados").innerHTML = chs.length ? chs.map((c) => `<div class="mini-ch" data-id="${esc(c.id)}"><b>${esc(c.protocolo)}</b> <span class="pill st-${esc(c.status)}">${esc(S.statusTexto[c.status])}</span><div>${esc(c.assunto)}</div></div>`).join("") : '<span class="vazio-p">Nenhum chamado.</span>';
    $("f-chamados").querySelectorAll(".mini-ch").forEach((el) => (el.onclick = () => abrirChamado(el.dataset.id)));
  }
  $("f-salvar").onclick = () => salvarFicha(false);
  async function salvarFicha(silencioso) {
    const c = S.conv?.conversa; if (!c) return;
    const etqs = [...$("f-etqs").querySelectorAll(".etq.on")].map((b) => b.dataset.id);
    const r = await api(`/contatos/${encodeURIComponent(c.contato)}`, put({ nome: $("f-nome").value, notas: $("f-notas").value, etiquetas: etqs }));
    if (!r.ok) return toast(r.data.error || "Erro ao salvar.");
    if (!silencioso) toast("Ficha salva.");
    $("c-nome").textContent = $("f-nome").value || c.contato; carregarLista();
  }
  $("ia-resumo").onclick = async () => {
    const out = $("ia-resumo-out"); out.classList.remove("hidden"); out.textContent = "✨ Lendo a conversa…";
    const r = await api("/ia/resumo", post({ conversaId: S.convId }));
    out.textContent = r.ok ? r.data.resumo : r.data.error || "A IA não respondeu.";
  };

  // ═════════ MODAIS ═════════
  function modal(html, aoMontar) {
    $("modal-card").innerHTML = html; $("modal").classList.remove("hidden");
    $("modal").onclick = (e) => { if (e.target.id === "modal") fecharModal(); };
    $("modal-card").querySelectorAll("[data-fechar]").forEach((b) => (b.onclick = fecharModal));
    aoMontar && aoMontar();
  }
  const fecharModal = () => $("modal").classList.add("hidden");
  function modalRepassar() {
    const outros = S.equipe.filter((u) => u.id !== S.eu.id);
    modal(`<h3>Repassar atendimento</h3><p class="sub">Escolha quem vai continuar a conversa.</p>
      <select id="rp-quem" class="sel">${outros.map((u) => `<option value="${esc(u.id)}">${u.status === "ONLINE" ? "🟢" : u.status === "PAUSA" ? "🟡" : "⚪"} ${esc(u.nome)}</option>`).join("")}</select>
      <label class="f">Nota para o colega (opcional)</label><textarea id="rp-nota" class="in" rows="2"></textarea>
      <div id="rp-msg"></div><div class="modal-rodape"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn pri" id="rp-ok">Repassar</button></div>`, () => {
      $("rp-ok").onclick = async () => {
        const nota = $("rp-nota").value.trim();
        if (nota) await api(`/conversas/${S.convId}/nota`, post({ texto: nota }));
        const r = await api(`/conversas/${S.convId}/repassar`, post({ usuarioId: $("rp-quem").value }));
        if (!r.ok) return msgBox("rp-msg", r.data.error);
        fecharModal(); toast("Atendimento repassado."); abrirConversa(S.convId, true); carregarLista();
      };
    });
    if (!outros.length) msgBox("rp-msg", "Não há outro usuário neste DETRAN.");
  }
  function modalEncerrar() {
    const pesquisa = S.config.pesquisaSatisfacao;
    modal(`<h3>Encerrar atendimento</h3>
      <label class="f">Mensagem de despedida</label><textarea id="en-aviso" class="in" rows="3">Atendimento encerrado. Obrigado pelo contato! Se precisar, é só mandar uma nova mensagem.</textarea>
      ${pesquisa ? `<label class="chk"><input type="checkbox" id="en-pesq" checked /> Enviar a pesquisa de satisfação (nota de 1 a 5)</label>` : ""}
      <div id="en-msg"></div><div class="modal-rodape"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn acento" id="en-ok">Encerrar</button></div>`, () => {
      $("en-ok").onclick = async () => {
        const r = await apiAt(`/conversas/${S.convId}/encerrar`, post({ aviso: $("en-aviso").value.trim() || false, pesquisa: pesquisa ? $("en-pesq").checked : false }));
        if (!r.ok) return msgBox("en-msg", r.data.error);
        fecharModal(); toast("Atendimento encerrado."); abrirConversa(S.convId, true); carregarLista(); pulsar();
      };
    });
  }
  function modalChamado(pre = {}) {
    const cats = S.config.categorias || [];
    modal(`<h3>Novo chamado</h3><p class="sub">${pre.conversaId ? "Ligado a esta conversa. O cidadão recebe o número do protocolo no WhatsApp." : "Chamado avulso."}</p>
      ${pre.conversaId && S.ia ? `<button class="btn soft mini" id="nc-ia">✨ Preencher com IA a partir da conversa</button>` : ""}
      <label class="f">Assunto</label><input id="nc-assunto" class="in" maxlength="160" />
      <div class="campos">
        <div><label class="f">Categoria</label><select id="nc-cat" class="sel"><option value="">—</option>${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
        <div><label class="f">Prioridade</label><select id="nc-prio" class="sel">${S.prioridades.map((p) => `<option ${p === "NORMAL" ? "selected" : ""}>${p}</option>`).join("")}</select></div>
        <div><label class="f">Responsável</label><select id="nc-resp" class="sel"><option value="">— ninguém ainda —</option>${S.equipe.map((u) => `<option value="${esc(u.id)}" ${u.id === S.eu.id ? "selected" : ""}>${esc(u.nome)}</option>`).join("")}</select></div>
        <div><label class="f">Prazo</label><input id="nc-prazo" class="in" type="date" /><small class="vazio-p" id="nc-prazo-dica"></small></div>
      </div>
      ${pre.conversaId ? "" : `<div class="campos"><div><label class="f">Nome do cidadão</label><input id="nc-nome" class="in" /></div><div><label class="f">WhatsApp (opcional)</label><input id="nc-fone" class="in" placeholder="91 99999-9999" /></div></div>`}
      <label class="f">Descrição</label><textarea id="nc-desc" class="in" rows="4"></textarea>
      <label class="chk"><input type="checkbox" id="nc-avisar" ${S.config.avisarChamado ? "checked" : ""} /> Avisar o cidadão no WhatsApp</label>
      <div id="nc-msg"></div><div class="modal-rodape"><button class="btn ghost" data-fechar>Cancelar</button><button class="btn pri" id="nc-ok">Abrir chamado</button></div>`, () => {
      const dica = () => { const h = S.config.slaHoras[$("nc-prio").value]; $("nc-prazo-dica").textContent = $("nc-prazo").value ? "" : `Padrão: ${h}h (${fmtData(Date.now() + h * 3600000)})`; };
      $("nc-prio").onchange = dica; $("nc-prazo").oninput = dica; dica();
      if ($("nc-ia")) $("nc-ia").onclick = async () => {
        $("nc-ia").disabled = true; $("nc-ia").textContent = "✨ Lendo a conversa…";
        const r = await api("/ia/chamado", post({ conversaId: pre.conversaId }));
        $("nc-ia").disabled = false; $("nc-ia").textContent = "✨ Preencher com IA a partir da conversa";
        if (!r.ok) return msgBox("nc-msg", r.data.error);
        $("nc-assunto").value = r.data.assunto; $("nc-desc").value = r.data.descricao; $("nc-prio").value = r.data.prioridade;
        if (r.data.categoria) $("nc-cat").value = r.data.categoria; dica();
      };
      $("nc-ok").onclick = async () => {
        const b = { conversaId: pre.conversaId, assunto: $("nc-assunto").value, categoria: $("nc-cat").value, prioridade: $("nc-prio").value, responsavelId: $("nc-resp").value || undefined,
          descricao: $("nc-desc").value, avisarCidadao: $("nc-avisar").checked, prazoEm: $("nc-prazo").value ? $("nc-prazo").value + "T18:00:00" : undefined,
          nome: $("nc-nome")?.value, contato: $("nc-fone")?.value };
        $("nc-ok").disabled = true;
        const r = await api("/chamados", post(b));
        $("nc-ok").disabled = false;
        if (!r.ok) return msgBox("nc-msg", r.data.error);
        fecharModal(); toast(`Chamado ${r.data.chamado.protocolo} aberto${r.data.avisou ? " e cidadão avisado" : ""}.`);
        if (S.sec === "atendimento") abrirConversa(S.convId, true); else carregarChamados();
      };
    });
  }

  // ═════════ CHAMADOS ═════════
  $("novo-ch").onclick = () => modalChamado();
  document.querySelectorAll("#modo-ch button").forEach((b) => (b.onclick = () => { S.modoCh = b.dataset.m; document.querySelectorAll("#modo-ch button").forEach((x) => x.classList.toggle("on", x === b)); desenharChamados(); }));
  let tBch; $("busca-ch").oninput = () => { clearTimeout(tBch); tBch = setTimeout(carregarChamados, 300); };
  ["fch-status", "fch-prio", "fch-resp", "fch-venc"].forEach((id) => ($(id).onchange = carregarChamados));
  async function carregarChamados() {
    // "Em aberto" vale também no quadro (teste I6): antes o quadro buscava todos e mostrava resolvidos.
    const status = $("fch-status").value;
    const q = new URLSearchParams({ busca: $("busca-ch").value.trim(), status, prioridade: $("fch-prio").value, responsavel: $("fch-resp").value, vencidos: $("fch-venc").checked ? "1" : "" });
    const r = await api("/chamados?" + q); if (!r.ok) return;
    S.chamados = r.data.chamados; desenharChamados();
  }
  const cartao = (c) => `<div class="card prio-${esc(c.prioridade)} ${c.vencido ? "vencido" : ""}" draggable="true" data-id="${esc(c.id)}">
      <div class="proto">${esc(c.protocolo)}</div><div class="ass">${esc(c.assunto)}</div>
      <div class="rod"><span>${c.responsavelNome ? "👤 " + esc(c.responsavelNome.split(" ")[0]) : "<i>sem responsável</i>"}</span><span class="${c.vencido ? "pill venc" : ""}">${c.prazoEm ? "⏰ " + fmtData(c.prazoEm) : ""}</span></div></div>`;
  function desenharChamados() {
    const kan = S.modoCh === "kanban";
    $("kanban").classList.toggle("hidden", !kan); $("lista-ch").classList.toggle("hidden", kan);
    if (kan) {
      const cols = ["ABERTO", "EM_ANDAMENTO", "AGUARDANDO_CIDADAO", "RESOLVIDO", "CANCELADO"];
      const recentes = (c) => !["RESOLVIDO", "CANCELADO"].includes(c.status) || Date.now() - new Date(c.resolvidoEm || c.atualizadoEm) < 7 * 86400000;
      $("kanban").innerHTML = cols.map((s) => { const cs = S.chamados.filter((c) => c.status === s && recentes(c)); const fechada = $("fch-status").value === "abertos" && ["RESOLVIDO", "CANCELADO"].includes(s); return `<div class="col" data-st="${s}"><h5 role="heading" aria-level="3"><span>${esc(S.statusTexto[s])}</span><span>${fechada ? "" : cs.length}</span></h5>${fechada ? '<p class="vazio-p" style="padding:8px">Arraste um chamado para cá. Para ver os já encerrados, mude o filtro para “Todos”.</p>' : cs.map(cartao).join("")}</div>`; }).join("");
      arrastar();
    } else {
      $("lista-ch").innerHTML = S.chamados.length ? `<div class="cartao"><table class="tabela"><thead><tr><th>Protocolo</th><th>Assunto</th><th>Cidadão</th><th>Situação</th><th>Prioridade</th><th>Responsável</th><th>Prazo</th></tr></thead><tbody>${S.chamados.map((c) => `<tr class="click" data-id="${esc(c.id)}"><td><b>${esc(c.protocolo)}</b></td><td>${esc(c.assunto)}</td><td>${esc(c.nome || (c.contato ? formatarFone(c.contato) : "—"))}</td><td><span class="pill st-${esc(c.status)}">${esc(S.statusTexto[c.status])}</span></td><td>${esc(c.prioridade)}</td><td>${esc(c.responsavelNome || "—")}</td><td class="${c.vencido ? "pill venc" : ""}">${fmtData(c.prazoEm)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="vazio"><div class="vazio-ic">📋</div><b>Nenhum chamado</b><span>Abra a partir de uma conversa ou pelo botão “Novo chamado”.</span></div>';
    }
    document.querySelectorAll("#kanban .card, #lista-ch tr.click").forEach((el) => el.addEventListener("click", () => abrirChamado(el.dataset.id)));
  }
  function arrastar() {
    let arrastando = null;
    document.querySelectorAll("#kanban .card").forEach((c) => {
      c.addEventListener("dragstart", (e) => { arrastando = c.dataset.id; c.classList.add("arrastando"); e.dataTransfer.effectAllowed = "move"; });
      c.addEventListener("dragend", () => c.classList.remove("arrastando"));
    });
    document.querySelectorAll("#kanban .col").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("alvo"); });
      col.addEventListener("dragleave", () => col.classList.remove("alvo"));
      col.addEventListener("drop", async (e) => {
        e.preventDefault(); col.classList.remove("alvo");
        const ch = S.chamados.find((x) => x.id === arrastando); if (!ch || ch.status === col.dataset.st) return;
        ch.status = col.dataset.st; desenharChamados();
        const r = await api(`/chamados/${ch.id}`, patch({ status: col.dataset.st }));
        if (!r.ok) { toast(r.data.error || "Não foi possível mover."); return carregarChamados(); }
        toast(`${ch.protocolo}: ${S.statusTexto[col.dataset.st]}${r.data.avisou ? " · cidadão avisado" : ""}`); carregarChamados(); pulsar();
      });
    });
  }

  // Gaveta do chamado
  $("g-fechar").onclick = fecharGaveta; $("veu").onclick = fecharGaveta;
  function fecharGaveta() { $("gaveta").classList.add("hidden"); $("veu").classList.add("hidden"); }
  async function abrirChamado(id) {
    const r = await api("/chamados/" + encodeURIComponent(id)); if (!r.ok) return toast(r.data.error || "Erro.");
    const c = r.data.chamado, ev = r.data.eventos;
    $("g-proto").textContent = c.protocolo; $("g-assunto").textContent = c.assunto;
    const opt = (lista, atual, rot = (x) => x) => lista.map((x) => `<option value="${esc(x)}" ${x === atual ? "selected" : ""}>${esc(rot(x))}</option>`).join("");
    $("g-corpo").innerHTML = `
      <div class="campos">
        <div><label class="f">Situação</label><select id="g-status" class="sel">${opt(S.statusChamado, c.status, (s) => S.statusTexto[s])}</select></div>
        <div><label class="f">Prioridade</label><select id="g-prio" class="sel">${opt(S.prioridades, c.prioridade)}</select></div>
        <div><label class="f">Responsável</label><select id="g-resp" class="sel"><option value="">— ninguém —</option>${S.equipe.map((u) => `<option value="${esc(u.id)}" ${u.id === c.responsavelId ? "selected" : ""}>${esc(u.nome)}</option>`).join("")}</select></div>
        <div><label class="f">Prazo ${c.vencido ? '<span class="pill venc">vencido</span>' : ""}</label><input id="g-prazo" class="in" type="date" value="${c.prazoEm ? new Date(c.prazoEm).toLocaleDateString("en-CA") : ""}" /></div>
        <div><label class="f">Categoria</label><select id="g-cat" class="sel"><option value="">—</option>${opt(S.config.categorias, c.categoria)}</select></div>
        <div><label class="f">Cidadão</label><div style="padding:9px 0">${esc(c.nome || "—")}${c.contato ? `<br><small class="vazio-p">${esc(formatarFone(c.contato))}</small>` : ""}</div></div>
      </div>
      <label class="chk"><input type="checkbox" id="g-avisar" ${c.avisarCidadao ? "checked" : ""} ${c.canal === "WHATSAPP" ? "" : "disabled"} /> Avisar o cidadão no WhatsApp a cada mudança de situação</label>
      ${c.conversaId ? `<button class="btn soft mini" id="g-conv">💬 Abrir a conversa</button>` : ""}
      ${c.descricao ? `<label class="f">Descrição</label><div class="cartao" style="box-shadow:none;white-space:pre-wrap">${linkify(c.descricao)}</div>` : ""}
      <div id="g-anexos"></div>
      <label class="f">Comentar</label><textarea id="g-com" class="in" rows="2" placeholder="Atualização do chamado…"></textarea>
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn soft mini" id="g-nota">🔒 Nota interna</button>${c.canal === "WHATSAPP" && c.contato ? `<button class="btn pri mini" id="g-pub">📣 Enviar ao cidadão</button>` : ""}</div>
      <label class="f">Linha do tempo</label>
      <div class="linha-tempo">${ev.map((e) => `<div class="ev ${esc(e.tipo)}">${linkify(e.texto)}<small>${esc(e.autorNome || "")} · ${fmtDH(e.criadoEm)} ${e.publico ? '<span class="pub">· visível ao cidadão</span>' : ""}</small></div>`).join("")}</div>`;
    $("gaveta").classList.remove("hidden"); $("veu").classList.remove("hidden");
    const salvar = async (campo, valor) => {
      const r2 = await api(`/chamados/${c.id}`, patch({ [campo]: valor }));
      if (!r2.ok) return toast(r2.data.error || "Não foi possível salvar.");
      toast("Atualizado" + (r2.data.avisou ? " · cidadão avisado" : "") + "."); abrirChamado(c.id); if (S.sec === "chamados") carregarChamados(); pulsar();
    };
    $("g-status").onchange = (e) => salvar("status", e.target.value);
    $("g-prio").onchange = (e) => salvar("prioridade", e.target.value);
    $("g-resp").onchange = (e) => salvar("responsavelId", e.target.value || null);
    $("g-prazo").onchange = (e) => salvar("prazoEm", e.target.value ? e.target.value + "T18:00:00" : null);
    $("g-cat").onchange = (e) => salvar("categoria", e.target.value);
    $("g-avisar").onchange = (e) => salvar("avisarCidadao", e.target.checked);
    if ($("g-conv")) $("g-conv").onclick = () => { fecharGaveta(); irPara("atendimento"); S.aba = "todas"; abrirConversa(c.conversaId); };
    const comentar = async (publico) => {
      const texto = $("g-com").value.trim(); if (!texto) return;
      const r2 = await api(`/chamados/${c.id}/comentarios`, post({ texto, publico }));
      if (!r2.ok) return toast(r2.data.error || "Erro.");
      toast(publico ? (r2.data.avisou ? "Enviado ao cidadão." : "Registrado (WhatsApp não enviou).") : "Nota registrada."); abrirChamado(c.id);
    };
    $("g-nota").onclick = () => comentar(false);
    if ($("g-pub")) $("g-pub").onclick = () => comentar(true);
    // Anexos enviados pelo cidadão com o protocolo (fotos e PDFs dos documentos).
    api(`/chamados/${c.id}/anexos`).then((ra) => {
      const box = $("g-anexos"); if (!box || !ra.ok || !(ra.data.anexos || []).length) return;
      box.innerHTML = `<label class="f">Documentos enviados pelo cidadão</label><div class="anexos">${ra.data.anexos.map((a) =>
        `<button class="btn soft mini" data-anexo="${esc(a.id)}" data-nome="${esc(a.nome)}">${a.mime === "application/pdf" ? "📄" : "🖼️"} ${esc(a.nome)} <small>(${Math.max(1, Math.round(a.tamanho / 1024))} KB)</small></button>`).join(" ")}</div>`;
      box.querySelectorAll("[data-anexo]").forEach((b) => (b.onclick = async () => {
        const w = window.open("", "_blank");
        const r = await fetch((window.API_BASE || "") + `/gestao/chamados/${encodeURIComponent(c.id)}/anexos/${encodeURIComponent(b.dataset.anexo)}`, { headers: { Authorization: "Bearer " + Sessao.token() } });
        if (!r.ok) { if (w) w.close(); return toast("Não foi possível abrir o anexo."); }
        const url = URL.createObjectURL(await r.blob());
        if (w) w.location.href = url; else location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }));
    });
  }

  // ═════════ CIDADÃOS ═════════
  let tCid; $("busca-cid").oninput = () => { clearTimeout(tCid); tCid = setTimeout(carregarCidadaos, 300); };
  async function carregarCidadaos() {
    const r = await api("/contatos?busca=" + encodeURIComponent($("busca-cid").value.trim())); if (!r.ok) return;
    const cs = r.data.contatos;
    $("lista-cid").innerHTML = cs.length ? `<div class="cartao"><table class="tabela"><thead><tr><th>Cidadão</th><th>WhatsApp</th><th>Etiquetas</th><th>Última conversa</th><th>Chamados</th><th>Nota</th></tr></thead><tbody>${cs.map((c) => `<tr class="click" data-id="${esc(c.conversaId)}"><td><b>${esc(c.nome || "—")}</b>${c.notas ? `<br><small class="vazio-p">${esc(c.notas.slice(0, 60))}</small>` : ""}</td><td>${esc(formatarFone(c.contato))}</td><td>${c.etiquetas.map(etq).filter(Boolean).map((e) => `<span class="chip tinto" style="background:${esc(e.cor)};color:${corTexto(e.cor)}">${esc(e.nome)}</span>`).join(" ")}</td><td>${fmtDH(c.ultimaEm)}</td><td>${c.chamados || "—"}</td><td>${c.avaliacao ? c.avaliacao + " ★" : "—"}</td></tr>`).join("")}</tbody></table></div>` : '<div class="vazio"><div class="vazio-ic">👤</div><b>Nenhum cidadão encontrado</b><span>Aparecem aqui as pessoas que falaram com o DETRAN pelo WhatsApp.</span></div>';
    document.querySelectorAll("#lista-cid tr.click").forEach((tr) => (tr.onclick = () => { irPara("atendimento"); abrirConversa(tr.dataset.id); }));
  }

  // ═════════ EQUIPE ═════════
  async function carregarEquipe() {
    const r = await api("/visao?dias=7"); if (!r.ok) return;
    const ini = (n) => n.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
    const st = { ONLINE: "Online", PAUSA: "Em pausa", OFFLINE: "Offline" };
    $("lista-equipe").innerHTML = r.data.ranking.map((u) => `<div class="pessoa"><div class="topo-p"><div class="avatar">${esc(ini(u.nome))}<i class="${u.status}"></i></div><div><b>${esc(u.nome)}</b><br><small class="vazio-p">${st[u.status]}${u.emAtendimento ? ` · ${u.emAtendimento} em atendimento` : ""}</small></div></div>
      <div class="nums"><div><b>${u.atendimentos}</b><small>atendimentos</small></div><div><b>${durTxt(u.tprMin)}</b><small>1ª resposta</small></div><div><b>${u.nota != null ? String(u.nota).replace(".", ",") : "—"}</b><small>nota</small></div></div></div>`).join("") || '<div class="vazio-p">Nenhum usuário cadastrado neste DETRAN.</div>';
  }

  // ═════════ CONFIGURAÇÕES ═════════
  const FUSOS = ["America/Belem", "America/Manaus", "America/Sao_Paulo", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Maceio", "America/Araguaina", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Noronha"];
  const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  function carregarConfig() {
    if (!S.podeGerir) return irPara("visao");
    const c = S.config;
    $("cf-pesquisa").checked = c.pesquisaSatisfacao; $("cf-msgPesquisa").value = c.mensagemPesquisa; $("cf-agradece").value = c.agradecimentoPesquisa;
    $("cf-avisar").checked = c.avisarChamado; $("cf-cats").value = c.categorias.join("\n");
    $("cf-sla").innerHTML = S.prioridades.map((p) => `<div><label for="sla-${p}">${p}</label><input id="sla-${p}" class="in" type="number" min="1" data-p="${p}" value="${c.slaHoras[p]}" /></div>`).join("");
    $("cf-hativo").checked = c.horario.ativo;
    $("cf-dias").innerHTML = DIAS.map((d, i) => `<label><input type="checkbox" value="${i}" ${c.horario.dias.includes(i) ? "checked" : ""} />${d}</label>`).join("");
    $("cf-ini").value = c.horario.inicio; $("cf-fim").value = c.horario.fim; $("cf-fora").value = c.horario.mensagemFora;
    $("cf-fuso").innerHTML = FUSOS.map((f) => `<option ${f === c.fuso ? "selected" : ""}>${f}</option>`).join("");
    $("cf-alerta").value = c.esperaAlertaMin; $("cf-critica").value = c.esperaCriticaMin;
    $("cf-cal").innerHTML = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((f) => `<div><label>Final ${f}</label><input class="in" data-final="${f}" placeholder="dd/mm" maxlength="5" value="${esc((c.calendarioLicenciamento || {})[f] || "")}" /></div>`).join("");
    $("cf-retConv").value = c.retencaoConversasDias; $("cf-retCh").value = c.retencaoChamadosDias;
    $("cf-encarregado").value = c.encarregado || ""; $("cf-politica").value = c.politicaUrl || ""; $("cf-avisoWa").checked = c.avisoWhatsApp !== false;
    $("lgpd-ver").href = Sessao.base + "/privacidade";
    previaLgpd();
    listaRespostas(); listaEtiquetas();
  }
  async function historicoLgpd() {
    const el = $("lgpd-hist-corpo"); if (!el) return;
    const r = await api("/lgpd/historico?limite=60"); if (!r.ok) return (el.textContent = r.data.error || "Sem acesso ao histórico.");
    const d = r.data, n = (v) => Number(v || 0).toLocaleString("pt-BR");
    const nome = { retencao: "Retenção automática", "pedido-do-cidadao": "Pedido do cidadão", "pedido-do-cidadao-site": "Cidadão apagou no site" };
    el.innerHTML = `<p style="margin:0 0 6px">No total registrado: <b>${n(d.totais.conversas)}</b> conversa(s), <b>${n(d.totais.contatos)}</b> ficha(s), <b>${n(d.totais.balcao)}</b> registro(s) do balcão e <b>${n(d.totais.lembretes)}</b> lembrete(s) apagados; <b>${n(d.totais.chamados)}</b> chamado(s) anonimizados.</p>`
      + (d.itens.length ? `<table class="tab"><thead><tr><th>Quando</th><th>Motivo</th><th>Conversas</th><th>Fichas</th><th>Chamados anonimizados</th></tr></thead><tbody>${d.itens.map((i) => `<tr><td>${esc(new Date(i.em).toLocaleString("pt-BR"))}</td><td>${esc(nome[i.tipo] || i.tipo)}</td><td>${n(i.conversas)}</td><td>${n(i.contatos)}</td><td>${n(i.chamados)}</td></tr>`).join("")}</tbody></table>` : "<p>Nenhuma eliminação registrada ainda.</p>");
  }
  async function previaLgpd() {
    historicoLgpd();
    $("lgpd-previa").textContent = "Calculando…";
    const r = await api("/lgpd/previa"); if (!r.ok) return ($("lgpd-previa").textContent = "");
    const d = r.data;
    $("lgpd-previa").innerHTML = `Pela regra atual, a próxima limpeza remove <b>${d.conversas}</b> conversa(s) e <b>${d.balcao}</b> registro(s) do balcão, e tira os dados pessoais de <b>${d.chamados}</b> chamado(s) encerrado(s). Última limpeza: <b>${d.ultimaLimpeza ? fmtDH(d.ultimaLimpeza) : "ainda não rodou"}</b>.`;
  }
  $("lgpd-limpar").onclick = async () => {
    if (!(await confirmar("Aplicar agora a limpeza pela regra configurada? O que for apagado não volta."))) return;
    const r = await api("/lgpd/limpar", post());
    if (!r.ok) return toast(r.data.error || "Erro na limpeza.");
    toast(`Limpeza feita: ${r.data.conversas} conversa(s), ${r.data.chamados} chamado(s) anonimizado(s).`); previaLgpd();
  };
  $("f-apagar").onclick = async () => {
    const c = S.conv?.conversa; if (!c) return;
    if (!(await confirmar(`Apagar TODAS as conversas e a ficha de ${S.conv.ficha.nome || formatarFone(c.contato)}? Os chamados ficam, mas sem nome e telefone. Use só a pedido do cidadão. Não dá para desfazer.`))) return;
    const r = await api("/lgpd/apagar-cidadao", post({ contato: c.contato }));
    if (!r.ok) return toast(r.data.error || "Não foi possível apagar.");
    toast(`Dados apagados: ${r.data.conversas} conversa(s), ${r.data.chamados} chamado(s) anonimizado(s).`);
    S.convId = null; S.conv = null; $("conv").classList.add("hidden"); $("ficha").classList.add("hidden"); $("conv-vazia").classList.remove("hidden"); $("caixa").classList.remove("aberta"); carregarLista();
  };
  $("cf-salvar").onclick = async () => {
    const sla = {}; $("cf-sla").querySelectorAll("input").forEach((i) => (sla[i.dataset.p] = Number(i.value)));
    const b = {
      pesquisaSatisfacao: $("cf-pesquisa").checked, mensagemPesquisa: $("cf-msgPesquisa").value, agradecimentoPesquisa: $("cf-agradece").value,
      avisarChamado: $("cf-avisar").checked, categorias: $("cf-cats").value.split("\n"), slaHoras: sla, fuso: $("cf-fuso").value,
      esperaAlertaMin: Number($("cf-alerta").value), esperaCriticaMin: Number($("cf-critica").value),
      retencaoConversasDias: Number($("cf-retConv").value), retencaoChamadosDias: Number($("cf-retCh").value),
      encarregado: $("cf-encarregado").value, politicaUrl: $("cf-politica").value, avisoWhatsApp: $("cf-avisoWa").checked,
      calendarioLicenciamento: Object.fromEntries([...$("cf-cal").querySelectorAll("input")].map((i) => [i.dataset.final, i.value.trim()]).filter(([, v]) => v)),
      horario: { ativo: $("cf-hativo").checked, dias: [...$("cf-dias").querySelectorAll("input:checked")].map((i) => Number(i.value)), inicio: $("cf-ini").value, fim: $("cf-fim").value, mensagemFora: $("cf-fora").value },
    };
    const r = await api("/config", put(b));
    if (!r.ok) return msgBox("cf-msg", r.data.error || "Erro ao salvar.");
    S.config = r.data.config; msgBox("cf-msg", "Configurações salvas.", "ok"); carregarConfig();
  };
  function listaRespostas() {
    $("lista-rr").innerHTML = S.respostas.map((r) => `<div class="rr-item"><div><b>/${esc(r.atalho)}</b> — ${esc(r.titulo)}<span>${esc(r.texto)}</span></div><button class="btn ghost mini" data-ed="${esc(r.id)}">Editar</button><button class="btn perigo mini" data-rm="${esc(r.id)}">✕</button></div>`).join("") || '<div class="vazio-p">Nenhuma resposta rápida.</div>';
    $("lista-rr").querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => { const r = S.respostas.find((x) => x.id === b.dataset.ed); $("rr-id").value = r.id; $("rr-atalho").value = r.atalho; $("rr-titulo").value = r.titulo; $("rr-texto").value = r.texto; }));
    $("lista-rr").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!(await confirmar("Apagar esta resposta rápida?"))) return; await api("/respostas/" + b.dataset.rm, { method: "DELETE" }); S.respostas = S.respostas.filter((x) => x.id !== b.dataset.rm); listaRespostas(); }));
  }
  $("rr-limpar").onclick = () => ["rr-id", "rr-atalho", "rr-titulo", "rr-texto"].forEach((i) => ($(i).value = ""));
  $("rr-salvar").onclick = async () => {
    const r = await api("/respostas", post({ id: $("rr-id").value || undefined, atalho: $("rr-atalho").value, titulo: $("rr-titulo").value, texto: $("rr-texto").value }));
    if (!r.ok) return msgBox("rr-msg", r.data.error);
    const i = S.respostas.findIndex((x) => x.id === r.data.resposta.id); if (i >= 0) S.respostas[i] = r.data.resposta; else S.respostas.push(r.data.resposta);
    msgBox("rr-msg", ""); $("rr-limpar").onclick(); listaRespostas(); toast("Resposta rápida salva.");
  };
  function listaEtiquetas() {
    $("lista-etq").innerHTML = S.etiquetas.map((e) => `<div class="rr-item"><div><span class="chip tinto" style="background:${esc(e.cor)};color:${corTexto(e.cor)}">${esc(e.nome)}</span></div><button class="btn ghost mini" data-ed="${esc(e.id)}">Editar</button><button class="btn perigo mini" data-rm="${esc(e.id)}">✕</button></div>`).join("") || '<div class="vazio-p">Nenhuma etiqueta.</div>';
    $("lista-etq").querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => { const e = S.etiquetas.find((x) => x.id === b.dataset.ed); $("et-id").value = e.id; $("et-nome").value = e.nome; $("et-cor").value = e.cor; }));
    $("lista-etq").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!(await confirmar("Apagar esta etiqueta?"))) return; await api("/etiquetas/" + b.dataset.rm, { method: "DELETE" }); S.etiquetas = S.etiquetas.filter((x) => x.id !== b.dataset.rm); listaEtiquetas(); montarFiltros(); }));
  }
  $("et-limpar").onclick = () => { $("et-id").value = ""; $("et-nome").value = ""; };
  $("et-salvar").onclick = async () => {
    const r = await api("/etiquetas", post({ id: $("et-id").value || undefined, nome: $("et-nome").value, cor: $("et-cor").value }));
    if (!r.ok) return msgBox("et-msg", r.data.error);
    const i = S.etiquetas.findIndex((x) => x.id === r.data.etiqueta.id); if (i >= 0) S.etiquetas[i] = r.data.etiqueta; else S.etiquetas.push(r.data.etiqueta);
    msgBox("et-msg", ""); $("et-limpar").onclick(); listaEtiquetas(); montarFiltros(); toast("Etiqueta salva.");
  };

  // ═════════ MODO TV ═════════
  let relogio;
  $("abrir-tv").onclick = async () => {
    $("tv").classList.remove("hidden");
    try { await document.documentElement.requestFullscreen(); } catch (_) {}
    desenharTV(); relogio = setInterval(() => ($("tv-hora").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })), 1000);
  };
  $("tv-sair").onclick = () => { $("tv").classList.add("hidden"); clearInterval(relogio); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  async function desenharTV() {
    const [v, f] = await Promise.all([api("/visao?dias=1"), api("/conversas?aba=fila")]);
    if (!v.ok) return;
    const a = v.data.agora, p = v.data.periodo;
    $("tv-hora").textContent = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    $("tv-kpis").innerHTML = `<div class="${a.esperaMaxMin >= S.config.esperaCriticaMin ? "critico" : ""}"><small>Na fila</small><b>${a.fila}</b></div><div><small>Em atendimento</small><b>${a.emAtendimento}</b></div><div><small>Atendidos hoje</small><b>${p.encerradas}</b></div><div><small>Nota de hoje</small><b>${p.nota != null ? String(p.nota).replace(".", ",") : "—"}</b></div>`;
    const fila = f.ok ? f.data.conversas : [];
    $("tv-fila").innerHTML = fila.slice(0, 8).map((c) => { const m = minDesde(c.esperaDesde || c.transbordoEm); return `<div class="tv-linha ${classeEspera(m)}"><span>${esc((c.nome || "Cidadão").split(" ")[0])} · ${esc(nomeCat[c.categoria] || c.categoria || "")}</span><b>${durTxt(m)}</b></div>`; }).join("") || '<div class="tv-linha"><span>Ninguém esperando 🎉</span></div>';
    $("tv-equipe").innerHTML = v.data.ranking.filter((u) => u.status !== "OFFLINE").map((u) => `<div class="tv-linha"><span>${u.status === "ONLINE" ? "🟢" : "🟡"} ${esc(u.nome.split(" ")[0])}</span><b>${u.emAtendimento}</b></div>`).join("") || '<div class="tv-linha"><span>Ninguém online</span></div>';
  }

  // Ao sair da aba/fechar, fica offline (melhor esforço)
  window.addEventListener("pagehide", () => {
    if (!S.eu?.id || S.eu.status !== "ONLINE") return;
    try { fetch((window.API_BASE || "") + "/gestao/eu/status", { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json", Authorization: "Bearer " + Sessao.token() }, body: JSON.stringify({ status: "OFFLINE" }) }); } catch (_) {}
  });

  // Já logado nesta aba?
  if (Sessao.token()) iniciar();
})();
