// "Meu DETRAN" em modo simulação — dados fictícios, nada chega ao DETRAN.
(() => {
  const T = window.TENANT || {};
  const API = (p) => (window.API_BASE || "") + "/sim" + p;
  const LSK = "detran_sim_" + T.slug;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dBR = (s) => (s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—");
  const hBR = (s) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dhBR = (s) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const CORES = { ana: "#157A4C", carlos: "#A35A00", marina: "#7A2E8E", lucas: "#1E5AA8" };

  let estado = {};
  try { estado = JSON.parse(localStorage.getItem(LSK) || "{}"); } catch (_) {}
  if (!estado.sessao) estado.sessao = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/[^\w-]/g, "").slice(0, 36);
  const salvar = () => { try { localStorage.setItem(LSK, JSON.stringify(estado)); } catch (_) {} };
  salvar();

  let META = null, D = null, aba = "inicio", timerFila = null, CAT = null, preAgenda = null, filtroCat = "", buscaCat = "";
  const logChamadas = [];

  async function api(path, opt = {}) {
    const r = await fetch(API(path), { ...opt, headers: { "Content-Type": "application/json", "X-Sim-Sessao": estado.sessao, ...(opt.headers || {}) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Falha na simulação.");
    return d;
  }
  function toast(msg) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function registrar(sistema, acao, ok = true) {
    logChamadas.unshift({ em: new Date().toISOString(), sistema, acao, ok, ms: 90 + Math.floor(Math.random() * 380) });
    logChamadas.splice(40);
  }
  // Mostra "consultando ..." como se cada sistema respondesse em sequência.
  async function consultar(sistemas, fn) {
    const c = $("#conteudo");
    c.innerHTML = `<div class="consultando">${sistemas.map((s, i) => `<div id="cs${i}"><span class="spin"></span>Consultando ${esc(s)}…</div>`).join("")}</div>`;
    const prom = fn();
    for (let i = 0; i < sistemas.length; i++) {
      await espera(260 + Math.random() * 320);
      const el = $("#cs" + i); if (el) el.innerHTML = `<span class="ok">✓</span>${esc(sistemas[i])} respondeu`;
      registrar(sistemas[i], "consulta");
    }
    return prom;
  }
  const fonte = (txt) => `<p class="fonte"><span class="dot"></span>Fonte: ${esc(txt)} · consultado às ${hBR(Date.now())} <span class="tag al">simulado</span></p>`;

  // ── Escolha ────────────────────────────────────────────────────────────
  async function iniciar() {
    META = await api("");
    document.querySelectorAll("[data-o]").forEach((el) => (el.textContent = META.orgaos[el.dataset.o] || ""));
    if (estado.cidadao && META.cidadaos.some((c) => c.id === estado.cidadao)) return entrar(estado.cidadao);
    mostrarEscolha();
  }
  function mostrarEscolha() {
    clearInterval(timerFila);
    $("#app").classList.add("hidden"); $("#quem").classList.add("hidden"); $("#escolha").classList.remove("hidden");
    $("#personas").innerHTML = META.cidadaos.map((c) => `
      <button class="persona" data-p="${c.id}">
        <div class="topo-p"><div class="av" style="background:${CORES[c.id] || "#192662"}">${esc(c.nome[0])}</div>
          <div><b>${esc(c.nome)}</b><br><span class="placa">${esc(c.placa)}</span></div></div>
        <p>${esc(c.resumo)}</p><span class="entrar">Entrar como este cidadão →</span>
      </button>`).join("");
    $("#personas").querySelectorAll(".persona").forEach((b) => (b.onclick = () => entrar(b.dataset.p)));
  }
  async function entrar(pid) {
    estado.cidadao = pid; salvar(); CAT = null;
    $("#escolha").classList.add("hidden"); $("#app").classList.remove("hidden");
    const c = META.cidadaos.find((x) => x.id === pid);
    $("#quem").classList.remove("hidden");
    $("#quem").innerHTML = `<div class="av" style="color:${CORES[pid]}">${esc(c.nome[0])}</div><div class="nm">${esc(c.nome)}<br><button id="trocar">Trocar de cidadão</button> · <button id="zerar">Zerar simulação</button></div>`;
    $("#trocar").onclick = () => { estado.cidadao = null; salvar(); mostrarEscolha(); };
    $("#zerar").onclick = () => { estado = { sessao: Math.random().toString(36).slice(2) + Date.now().toString(36), cidadao: pid }; salvar(); toast("Simulação zerada para este navegador."); abrir("inicio"); };
    await abrir("inicio");
  }
  const recarregar = async () => { D = await api("/" + estado.cidadao); badge(); return D; };
  function badge() {
    const n = D.debitos.filter((d) => d.situacao !== "PAGO").length;
    $("#badge-deb").textContent = n; $("#badge-deb").classList.toggle("hidden", !n);
  }

  // ── Abas ───────────────────────────────────────────────────────────────
  document.querySelectorAll("#abas button").forEach((b) => (b.onclick = () => abrir(b.dataset.aba)));
  async function abrir(qual) {
    aba = qual; clearInterval(timerFila);
    document.querySelectorAll("#abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === qual));
    const O = META.orgaos;
    const fontes = {
      inicio: ["SENATRAN — RENAVAM", "SENATRAN — RENACH", `${O.fazendaSigla} — IPVA`],
      veiculo: ["SENATRAN — RENAVAM", "ECV credenciadas — vistoria"],
      cnh: ["SENATRAN — RENACH", "SENATRAN — RENAINF"],
      debitos: [`${O.fazendaSigla} — IPVA`, `${T.sigla} — taxas e multas`, `${O.rodovias}`, `${O.municipal}`],
      agenda: ["Agenda das unidades"], processos: [`Sistema de protocolo ${T.sigla}`],
      filas: ["Painel de senhas das unidades"], integracoes: ["Monitor de integrações"], catalogo: [`Carta de serviços ${T.sigla}`],
    }[qual];
    try {
      await consultar(fontes, async () => { await recarregar(); if (!CAT) CAT = await api(`/${estado.cidadao}/catalogo`); });
      window.scrollTo({ top: 0, behavior: "smooth" });
      ({ inicio, catalogo, veiculo, cnh, debitos, agenda, processos, filas, integracoes })[qual]();
    } catch (e) { $("#conteudo").innerHTML = `<div class="card er">${esc(e.message)}</div>`; }
  }

  // Início
  function inicio() {
    const abertos = D.debitos.filter((d) => d.situacao !== "PAGO");
    const vencidos = abertos.filter((d) => d.situacao === "VENCIDO");
    const ag = D.agendamentos.filter((a) => a.situacao === "CONFIRMADO");
    const al = [];
    const diasCnh = Math.round((new Date(D.cnh.validade) - Date.now()) / 864e5);
    if (D.cnh.situacao === "Permissão para Dirigir") al.push(["al", `Sua <b>Permissão para Dirigir</b> vence em ${diasCnh} dias. Peça a troca pela CNH definitiva (gratuita).`, "serv:cnh-troca", "Trocar agora"]);
    else if (D.cnh.situacao !== "Regular") al.push(["er", `CNH <b>${esc(D.cnh.situacao.toLowerCase())}</b>: ${esc(D.cnh.observacoes)}.`, "cnh", "Ver CNH"]);
    if (D.apreensao) al.push(["er", `Seu veículo está no <b>parque de retenção</b> há ${D.apreensao.dias} dia(s) — as diárias continuam correndo.`, "serv:vei-apreendido", "Liberar"]);
    if (D.infracoes.some((i) => i.indicavel)) al.push(["al", "Há infração em que você pode <b>indicar o real condutor</b> e não receber os pontos.", "serv:cnh-condutor", "Indicar condutor"]);
    if (D.debitos.some((d) => d.tipo === "DIVIDA_ATIVA" && d.situacao !== "PAGO")) al.push(["er", "Você tem débito inscrito em <b>dívida ativa</b>.", "serv:mul-divida", "Ver dívida"]);
    const taxaPend = D.protocolos.filter((p) => p.taxaId && !p.taxaPaga);
    if (taxaPend.length) al.push(["al", `${taxaPend.length} pedido(s) aguardando o pagamento da taxa para andar.`, "debitos", "Pagar"]);
    if (vencidos.length) al.push(["er", `${vencidos.length} débito(s) vencido(s) somando <b>${brl(vencidos.reduce((s, d) => s + d.total, 0))}</b>.`, "debitos", "Emitir guia"]);
    if (D.veiculo.restricoes.length) al.push(["al", `Veículo com restrição: ${esc(D.veiculo.restricoes.join("; "))}.`, "veiculo", "Ver veículo"]);
    if (D.veiculo.recall.length) al.push(["al", `Recall pendente: ${esc(D.veiculo.recall[0])}.`, "veiculo", "Detalhes"]);
    if (D.cnh.pontos >= 10 && D.cnh.situacao === "Regular") al.push(["al", `<b>${D.cnh.pontos} de ${limitePontos()} pontos</b> em 12 meses.${D.infracoes.some((i) => /defesa/i.test(i.fase)) ? " Há infração ainda no prazo de defesa prévia." : ""}`, "cnh", "Ver infrações"]);
    if (D.processosCnh.some((p) => p.prazoRecurso)) al.push(["al", `Prazo de recurso até <b>${dBR(D.processosCnh[0].prazoRecurso)}</b> no processo ${esc(D.processosCnh[0].numero)}.`, "processos", "Recorrer"]);
    if (!al.length) al.push(["ok", "Tudo em dia: nenhuma pendência no veículo, na CNH ou em débitos.", null, null]);
    $("#conteudo").innerHTML = `
      <h2 class="tit">Olá, ${esc(D.cidadao.nome.split(" ")[0])}</h2>${fonte("SENATRAN, " + META.orgaos.fazendaSigla + " e " + T.sigla)}
      <div class="grid">
        <div class="kpi"><small>CNH</small><b class="${D.cnh.situacao === "Regular" ? "ok" : "er"}">${esc(D.cnh.situacao)}</b><span>Cat. ${esc(D.cnh.categoria)} · validade ${dBR(D.cnh.validade)}</span></div>
        <div class="kpi"><small>Pontuação (12 meses)</small><b class="${D.cnh.pontos >= 20 ? "er" : D.cnh.pontos >= 10 ? "al" : "ok"}">${D.cnh.pontos} pts</b><span>${D.infracoes.length} infração(ões) no período</span></div>
        <div class="kpi"><small>Débitos em aberto</small><b class="${abertos.length ? "er" : "ok"}">${brl(D.totalEmAberto)}</b><span>${abertos.length} item(ns)${vencidos.length ? ` · ${vencidos.length} vencido(s)` : ""}</span></div>
        <div class="kpi"><small>Licenciamento</small><b class="${String(D.veiculo.licenciadoAte) === String(new Date().getFullYear()) ? "ok" : "er"}">${esc(D.veiculo.licenciadoAte)}</b><span>Placa ${esc(D.veiculo.placa)}</span></div>
      </div>
      <div class="card"><h3>Avisos</h3><div class="alertas">${al.map(([c, t, a, b]) => `<div class="alerta ${c}"><span>${c === "ok" ? "✅" : c === "er" ? "⛔" : "⚠️"}</span><span>${t}</span>${a ? `<button class="btn peq sec" data-ir="${a}">${b}</button>` : ""}</div>`).join("")}</div></div>
      <div class="card"><h3>Próximos agendamentos</h3>${ag.length ? ag.map((a) => `<div>📅 <b>${dBR(a.data)} às ${a.hora}</b> — ${esc(a.servico)} · ${esc(a.unidadeNome)} <span class="tag">${esc(a.codigo)}</span></div>`).join("") : `<div class="vazio">Nenhum agendamento. <button class="btn peq sec" data-ir="agenda">Agendar atendimento</button></div>`}</div>
      <div class="card"><h3>Pergunte ao assistente</h3><p style="margin:0 0 10px;color:var(--ink-2)">O assistente já conhece a situação deste cidadão fictício. Experimente: <i>"quanto eu devo?"</i>, <i>"minha CNH está suspensa, o que faço?"</i>, <i>"tenho agendamento?"</i></p><a class="btn" style="text-decoration:none;display:inline-block" href="/${esc(T.slug)}">💬 Abrir o assistente</a></div>`;
    ligarIr();
  }
  // CTB art. 261: 20 pts com 2+ gravíssimas, 30 com 1, 40 sem nenhuma; quem exerce atividade remunerada (EAR) tem 40.
  function limitePontos() {
    if (/EAR/.test(D.cnh.observacoes)) return 40;
    const g = D.infracoes.filter((i) => /Gravíssima/.test(i.natureza)).length;
    return g >= 2 ? 20 : g === 1 ? 30 : 40;
  }
  function ligarIr() {
    document.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => (b.dataset.ir.startsWith("serv:") ? abrirServico(b.dataset.ir.slice(5)) : abrir(b.dataset.ir))));
    document.querySelectorAll("[data-serv]").forEach((b) => (b.onclick = () => abrirServico(b.dataset.serv)));
  }

  // ── Todos os serviços (catálogo) ───────────────────────────────────────
  const ROTULO = { consulta: "Consulta", documento: "Certidão / documento", protocolo: "Requerimento", agenda: "Agendamento", aba: "Consulta", info: "Informação" };
  function catalogo() {
    const q = buscaCat.toLowerCase();
    const itens = CAT.servicos.filter((s) => (!filtroCat || s.cat === filtroCat) && (!q || (s.nome + " " + s.desc).toLowerCase().includes(q)));
    $("#conteudo").innerHTML = `
      <h2 class="tit">Todos os serviços</h2>${fonte(`carta de serviços do ${T.sigla} · ${CAT.total} serviços`)}
      <div class="cat-busca"><input id="cat-q" type="search" placeholder="Buscar serviço (ex.: transferência, segunda via, condutor)" value="${esc(buscaCat)}"></div>
      <div class="cat-chips"><button class="chip ${!filtroCat ? "on" : ""}" data-c="">Todos</button>${CAT.categorias.map((c) => `<button class="chip ${filtroCat === c ? "on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      ${CAT.categorias.filter((c) => itens.some((s) => s.cat === c)).map((c) => `<h3 class="cat-tit">${esc(c)}</h3><div class="cat-grid">${itens.filter((s) => s.cat === c).map((s) => `
        <button class="serv" data-serv="${s.id}"><b>${esc(s.nome)}</b><span>${esc(s.desc)}</span>
          <span class="serv-tags"><i class="tag">${ROTULO[s.tipo]}</i>${s.tipo === "protocolo" ? `<i class="tag ${s.taxa ? "al" : "ok"}">${s.taxa ? brl(s.taxa) : "Gratuito"}</i>` : ""}${s.app ? `<i class="tag">também no app</i>` : ""}</span></button>`).join("")}</div>`).join("") || `<div class="vazio">Nenhum serviço encontrado.</div>`}`;
    const inp = $("#cat-q");
    inp.oninput = () => { buscaCat = inp.value; const pos = inp.selectionStart; catalogo(); const n = $("#cat-q"); n.focus(); n.setSelectionRange(pos, pos); };
    document.querySelectorAll(".cat-chips .chip").forEach((b) => (b.onclick = () => { filtroCat = b.dataset.c; catalogo(); }));
    ligarIr();
  }

  async function abrirServico(id) {
    if (!CAT) CAT = await api(`/${estado.cidadao}/catalogo`);
    const s = CAT.servicos.find((x) => x.id === id); if (!s) return toast("Serviço indisponível.");
    if (s.tipo === "aba") return abrir(s.aba);
    if (s.tipo === "agenda") { preAgenda = s.agenda; return abrir("agenda"); }
    const semOpcao = (s.campos || []).find((c) => c.opcoes && !c.opcoes.length);
    abrirModal(`<h3 style="margin-top:0">${esc(s.nome)}</h3><p style="color:var(--ink-2);margin-top:0">${esc(s.desc)}</p>
      ${s.requisitos ? `<div class="card" style="padding:10px 14px"><b style="font-size:13px">O que é preciso</b><ul style="margin:6px 0 0;padding-left:18px;font-size:13.5px">${s.requisitos.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
      ${s.tipo === "protocolo" ? `<p style="font-size:13.5px">Taxa: <b>${s.taxaVariavel ? esc(s.taxaVariavel) : s.taxa ? `${brl(s.taxa)} (${esc(META.orgaos.guia)})` : "gratuito"}</b>${s.taxa ? ` <span style="color:var(--ink-3)">· valor de referência da simulação</span>` : ""}</p>` : ""}
      <div class="form-ag">${(s.campos || []).map((c) => `<label class="campo ${c.tipo === "textarea" ? "largo" : ""}">${esc(c.rotulo)}${
        c.tipo === "texto" ? `<input data-campo="${c.id}" maxlength="40">`
        : c.tipo === "textarea" ? `<textarea data-campo="${c.id}" maxlength="${c.max || 500}" rows="4" placeholder="Não escreva dados pessoais reais — é uma simulação."></textarea>`
        : `<select data-campo="${c.id}" ${c.dependeDe ? `data-depende="${c.dependeDe}"` : ""}>${c.opcoes.map((o) => `<option value="${esc(o.v)}" data-g="${esc(o.g || "")}">${esc(o.l)}</option>`).join("")}</select>`}</label>`).join("")}</div>
      ${s.anexos?.length ? `<div class="anexos"><b>Documentos (anexos)</b><small>Na simulação o arquivo <u>não sai do seu aparelho</u>: só o nome é registrado. Use “exemplo” para anexar um documento fictício.</small>
        ${s.anexos.map((doc, i) => `<div class="anexo" data-doc="${esc(doc)}"><span class="anexo-nome">📎 ${esc(doc)}</span><span class="anexo-arq" id="ax-n${i}">nenhum arquivo</span>
          <label class="btn peq sec">Escolher<input type="file" id="ax-f${i}" hidden accept=".pdf,.jpg,.jpeg,.png"></label><button class="btn peq sec" type="button" id="ax-e${i}">Exemplo</button></div>`).join("")}</div>` : ""}
      ${semOpcao ? `<div class="alerta al">Nada disponível para este cidadão em “${esc(semOpcao.rotulo)}”.</div>` : ""}
      <div class="acoes"><button class="btn" id="sv-ok" ${semOpcao ? "disabled" : ""}>${{ consulta: "Consultar", documento: "Emitir", protocolo: s.taxa ? "Protocolar e gerar taxa" : "Protocolar", info: "Ver" }[s.tipo]}</button><button class="btn sec" id="sv-nao">Voltar</button></div>
      <div id="sv-msg"></div>`);
    $("#sv-nao").onclick = fecharModal;
    // Selects dependentes (ex.: auto de infração do órgão escolhido)
    document.querySelectorAll("select[data-depende]").forEach((sel) => {
      const pai = document.querySelector(`[data-campo="${sel.dataset.depende}"]`);
      const filtrar = () => { let primeiro = null; [...sel.options].forEach((op) => { const ok = op.dataset.g === pai.value; op.hidden = !ok; op.disabled = !ok; if (ok && !primeiro) primeiro = op; }); if (sel.selectedOptions[0]?.disabled && primeiro) sel.value = primeiro.value; };
      pai.addEventListener("change", filtrar); filtrar();
    });
    // Anexos
    ANX = {};
    (s.anexos || []).forEach((doc, i) => {
      const mostra = () => ($(`#ax-n${i}`).textContent = ANX[doc] ? `${ANX[doc].nome}${ANX[doc].tamanho ? ` · ${Math.max(1, Math.round(ANX[doc].tamanho / 1024))} KB` : ""}` : "nenhum arquivo");
      $(`#ax-f${i}`).onchange = (ev) => { const f = ev.target.files[0]; if (f) ANX[doc] = { doc, nome: f.name, tamanho: f.size }; mostra(); };
      $(`#ax-e${i}`).onclick = () => { ANX[doc] = { doc, nome: `exemplo-${doc.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}.pdf`, tamanho: 184320, exemplo: true }; mostra(); };
    });
    if (s.tipo === "info") return executar(s);
    $("#sv-ok").onclick = () => executar(s);
  }
  let ANX = {};
  async function executar(s) {
    const faltando = (s.anexos || []).find((doc) => !ANX[doc]);
    if (faltando) { $("#sv-msg").innerHTML = `<div class="alerta al" style="margin-top:10px">📎 Anexe: <b>${esc(faltando)}</b> (ou use “Exemplo”).</div>`; return; }
    const campos = {}; document.querySelectorAll("[data-campo]").forEach((el) => (campos[el.dataset.campo] = el.value));
    const b = $("#sv-ok"); if (b) b.disabled = true;
    $("#sv-msg").innerHTML = `<div class="vazio" style="margin-top:10px"><span class="spin" style="display:inline-block;vertical-align:middle"></span> ${s.tipo === "protocolo" ? "Registrando no sistema de protocolo…" : "Consultando…"}</div>`;
    try {
      const [r] = await Promise.all([api(`/${estado.cidadao}/servicos/${s.id}`, { method: "POST", body: JSON.stringify({ campos, anexos: Object.values(ANX) }) }), espera(650)]);
      registrar(s.tipo === "protocolo" ? `Sistema de protocolo ${T.sigla}` : (r.resultado?.fonte || `${T.sigla}`), s.tipo === "protocolo" ? "abertura de processo" : "consulta");
      if (r.tipo === "protocolo") { CAT = null; await recarregar(); return mostrarProtocolo(r); }
      abrirModal(r.tipo === "documento" ? docResultado(r) : cardResultado(r));
    } catch (e) { $("#sv-msg").innerHTML = `<div class="alerta er" style="margin-top:10px">${esc(e.message)}</div>`; if (b) b.disabled = false; }
  }
  function blocos(x) {
    return `${x.linhas?.length ? `<table class="tab">${x.linhas.map(([k, v]) => `<tr><td style="color:var(--ink-3);width:38%">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>` : ""}
      ${x.tabela ? `<div class="rolagem"><table class="tab"><tr>${x.tabela.cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${x.tabela.linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table></div>` : ""}
      ${x.alertas?.length ? `<div class="alertas" style="margin-top:10px">${x.alertas.map(([c, t]) => `<div class="alerta ${c}">${c === "ok" ? "✅" : c === "er" ? "⛔" : "⚠️"} <span>${esc(t)}</span></div>`).join("")}</div>` : ""}
      ${x.texto ? `<p style="color:var(--ink-2);font-size:13.5px">${esc(x.texto)}</p>` : ""}`;
  }
  function cardResultado(r) {
    const x = r.resultado;
    return `<h3 style="margin-top:0">${esc(x.titulo || r.servico)}</h3>${x.fonte ? fonte(x.fonte) : ""}${blocos(x)}<div class="acoes" style="margin-top:12px"><button class="btn sec" onclick="this.closest('.modal').classList.add('hidden')">Fechar</button></div>`;
  }
  function docResultado(r) {
    const x = r.resultado;
    return `<div class="doc"><h4>${esc(T.sigla)} · ${esc(x.titulo)}</h4><div class="meta">Código ${esc(x.codigo)} · emitida ${dhBR(x.emitidoEm)} · válida por 30 dias (simulação)</div>${blocos(x)}</div>
      <div class="acoes" style="margin-top:14px"><button class="btn sec" onclick="window.print()">Imprimir / salvar PDF</button></div>`;
  }
  function mostrarProtocolo(r) {
    const p = r.protocolo;
    abrirModal(`<div class="doc"><h4>Comprovante de protocolo</h4><div class="meta">${dhBR(p.criadoEm)} · ${esc(D.cidadao.nome)}</div>
        <p style="font-size:20px;margin:6px 0"><code>${esc(p.numero)}</code></p><p style="margin:0"><b>${esc(p.tipo)}</b>${p.obs ? `<br><small style="color:var(--ink-3)">${esc(p.obs)}</small>` : ""}</p>
        ${r.taxa ? `<p style="margin:10px 0 0">Taxa: <b>${brl(r.taxa.valor)}</b> — o processo só anda depois do pagamento.</p>` : `<p style="margin:10px 0 0">${p.etapas[p.etapas.length - 1].feito ? "✅ Concluído." : "Sem taxa: o processo já está em andamento."}</p>`}</div>
      <div class="acoes" style="margin-top:14px">${r.taxa ? `<button class="btn verde" id="pr-taxa">Pagar taxa agora (${esc(META.orgaos.guia)})</button>` : ""}<button class="btn sec" id="pr-ver">Acompanhar processo</button><button class="btn sec" onclick="window.print()">Imprimir</button></div>`);
    $("#pr-ver").onclick = () => { fecharModal(); abrir("processos"); };
    if (r.taxa) $("#pr-taxa").onclick = () => pagarTaxa(r.taxa.id);
  }
  async function pagarTaxa(id) {
    try { const g = await api(`/${estado.cidadao}/guias`, { method: "POST", body: JSON.stringify({ debitos: [id] }) }); registrar("Arrecadação bancária / PIX", "registro de guia"); await recarregar(); mostrarGuia(g.guia); }
    catch (e) { toast(e.message); }
  }

  // Veículo
  function veiculo() {
    const v = D.veiculo;
    $("#conteudo").innerHTML = `
      <h2 class="tit">Veículo</h2>${fonte("SENATRAN — RENAVAM e laudos das ECV")}
      <div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div class="placa-br"><i>BRASIL</i><b>${esc(v.placa.slice(0, 3))}${esc(v.placa.slice(3))}</b></div>
        <div><b style="font-size:17px">${esc(v.modelo)}</b><br><span style="color:var(--ink-2)">${esc(v.ano)} · ${esc(v.cor)} · ${esc(v.combustivel)}</span></div>
        <span class="tag ${v.restricoes.length ? "al" : "ok"}" style="margin-left:auto">${v.restricoes.length ? "Com restrições" : "Sem restrições"}</span>
      </div>
      <div class="card"><h3>Dados do registro</h3><dl class="ficha">
        <div><dt>RENAVAM</dt><dd>${esc(v.renavam)}</dd></div><div><dt>Município</dt><dd>${esc(v.municipio)}</dd></div>
        <div><dt>Situação</dt><dd>${esc(v.situacao)}</dd></div><div><dt>Licenciado até</dt><dd>${esc(v.licenciadoAte)}</dd></div>
        <div><dt>Proprietário</dt><dd>${esc(D.cidadao.nome)}</dd></div><div><dt>CRLV-e</dt><dd>${String(v.licenciadoAte) === String(new Date().getFullYear()) ? "Disponível na CDT" : "Bloqueado até quitar o licenciamento"}</dd></div>
        ${v.endereco ? `<div><dt>Endereço</dt><dd>${esc(v.endereco)}</dd></div>` : ""}${v.categoria ? `<div><dt>Categoria</dt><dd>${esc(v.categoria)}</dd></div>` : ""}
      </dl></div>
      ${D.apreensao ? `<div class="card"><h3>Parque de retenção</h3><div class="alerta er">⛔ <span><b>${esc(D.apreensao.local)}</b> desde ${dBR(D.apreensao.desde)} (${D.apreensao.dias} dia(s))<br><small>${esc(D.apreensao.motivo)} · remoção ${brl(D.apreensao.remocao)} + diária ${brl(D.apreensao.diaria)}</small></span><button class="btn peq" data-serv="vei-apreendido">Liberar</button></div></div>` : ""}
      ${v.intencao ? `<div class="card"><h3>Intenção de venda</h3><div class="alerta al">📝 <span>Intenção de venda ativa para <b>${esc(v.intencao.comprador)}</b> desde ${dhBR(v.intencao.desde)} — ATPV-e aguardando assinatura no app CDT.</span><button class="btn peq sec" data-serv="vei-intencao-cancelar">Cancelar</button></div></div>` : ""}
      ${v.avisos?.length ? `<div class="card"><h3>Atualizações</h3><div class="alertas">${v.avisos.map((a) => `<div class="alerta ok">✅ <span>${esc(a)}</span></div>`).join("")}</div></div>` : ""}
      <div class="card"><h3>Restrições e avisos</h3>${v.restricoes.length || v.recall.length ? `<div class="alertas">${[...v.restricoes.map((r) => ["al", r]), ...v.recall.map((r) => ["er", r])].map(([c, r]) => `<div class="alerta ${c}">⚠️ <span>${esc(r)}</span>${/registrado em/i.test(r) ? `<button class="btn peq" data-serv="vei-transf-uf">Transferir</button>` : /Alienação/.test(r) ? `<button class="btn peq sec" data-serv="vei-gravame">Ver gravame</button>` : ""}</div>`).join("")}</div>` : `<div class="alerta ok">✅ Nenhuma restrição administrativa, judicial ou de recall.</div>`}</div>
      <div class="card"><h3>Serviços deste veículo</h3><div class="acoes">
        <button class="btn sec" data-serv="vei-crlv">CRLV-e</button>
        <button class="btn sec" data-serv="vei-certidao">Certidão de propriedade</button>
        <button class="btn sec" data-serv="vei-venda">Comunicado de venda</button>
        <button class="btn sec" data-serv="vei-transf-prop">Transferência de propriedade</button>
        <button class="btn sec" data-serv="vei-endereco">Alterar endereço</button>
        <button class="btn sec" data-serv="vei-vistoria">Agendar vistoria</button>
        <button class="btn sec" data-ir="catalogo">Todos os serviços →</button></div></div>`;
    ligarIr();
  }

  // CNH
  function cnh() {
    const c = D.cnh;
    const lim = limitePontos();
    $("#conteudo").innerHTML = `
      <h2 class="tit">Habilitação (CNH)</h2>${fonte("SENATRAN — RENACH e RENAINF")}
      <div class="grid">
        <div class="kpi"><small>Situação</small><b class="${c.situacao === "Regular" ? "ok" : "er"}">${esc(c.situacao)}</b><span>${esc(c.observacoes)}</span></div>
        <div class="kpi"><small>Pontos em 12 meses</small><b>${c.pontos} / ${lim}</b><div class="barra"><i style="width:${Math.min(100, (c.pontos / lim) * 100)}%;background:${c.pontos / lim > .6 ? "var(--erro)" : c.pontos / lim > .3 ? "var(--alerta)" : "var(--ok)"}"></i></div><span>Limite para suspensão: ${lim} pontos</span></div>
        <div class="kpi"><small>Validade</small><b>${dBR(c.validade)}</b><span>Categoria ${esc(c.categoria)} · 1ª hab. ${dBR(c.primeiraHab)}</span></div>
      </div>
      ${D.processosCnh.length ? `<div class="card"><h3>Processos de habilitação</h3>${D.processosCnh.map((p) => `<div class="alerta ${p.prazoRecurso ? "er" : "al"}">${p.prazoRecurso ? "⛔" : "📋"} <span><b>${esc(p.tipo)}</b> — ${esc(p.situacao)}<br><small>${esc(p.numero)} · desde ${dBR(p.desde)}${p.prazoRecurso ? ` · prazo para recurso até ${dBR(p.prazoRecurso)}` : ""}</small></span>${p.prazoRecurso ? `<button class="btn peq" data-serv="mul-cetran">Recorrer ao ${esc(META.orgaos.conselho)}</button>` : /reteste/i.test(p.situacao) ? `<button class="btn peq" data-serv="cnh-reteste">Pedir reteste</button>` : ""}</div>`).join("")}</div>` : ""}
      <div class="card"><h3>Infrações nos últimos 12 meses</h3>${D.infracoes.length ? `<div class="rolagem"><table class="tab"><tr><th>Data</th><th>Infração</th><th>Natureza</th><th class="num">Pontos</th><th>Fase</th><th></th></tr>
        ${D.infracoes.map((i) => `<tr${i.cancelada ? ' style="opacity:.6"' : ""}><td>${dBR(i.data)}</td><td>${i.cancelada ? `<span class="tag ok">CANCELADA</span> ` : ""}${esc(i.desc)}<small>AIT ${esc(i.ait)} · ${esc(i.orgao)}</small></td><td>${esc(i.natureza)}</td><td class="num">${i.pontos}${i.pontosOriginais ? `<small>era ${i.pontosOriginais}</small>` : ""}</td><td><small style="color:var(--ink-2)">${esc(i.fase)}</small></td><td><div class="acoes">${i.emAnalise || i.cancelada ? "" : `${i.indicavel ? `<button class="btn peq" data-serv="cnh-condutor">Indicar condutor</button>` : ""}${/Autuação/i.test(i.fase) ? `<button class="btn peq sec" data-serv="mul-defesa">Defesa prévia</button>` : /^Penalidade|cabe recurso à JARI/i.test(i.fase) ? `<button class="btn peq sec" data-serv="mul-jari">Recurso JARI</button>` : /indeferido/i.test(i.fase) && /cabe recurso ao/i.test(i.fase) ? `<button class="btn peq sec" data-serv="mul-cetran">Recurso ${esc(META.orgaos.conselho)}</button>` : ""}`}</div></td></tr>`).join("")}</table></div>` : `<div class="vazio">Nenhuma infração registrada.</div>`}</div>
      <div class="card"><h3>Serviços da CNH</h3><div class="acoes">
        <button class="btn sec" data-serv="cnh-renovacao">Renovar CNH</button><button class="btn sec" data-serv="cnh-2via">2ª via</button>
        ${c.situacao === "Permissão para Dirigir" ? `<button class="btn" data-serv="cnh-troca">Trocar PPD pela definitiva</button>` : `<button class="btn sec" data-serv="cnh-pid">Permissão Internacional (PID)</button>`}
        <button class="btn sec" data-serv="cer-prontuario">Certidão de prontuário</button><button class="btn sec" data-serv="cnh-prova-resultado">Resultado de exames</button>
        <button class="btn sec" data-ir="catalogo">Todos os serviços →</button></div></div>
      ${c.situacao === "Suspensa" ? `<div class="card"><h3>Para liberar a CNH</h3><ol style="margin:0 0 10px;padding-left:20px;font-size:14px"><li>Fazer o curso de reciclagem <button class="btn peq sec" data-serv="cnh-reciclagem">Inscrever</button></li><li>Cumprir os 12 meses da suspensão</li><li>Pedir a liberação <button class="btn peq sec" data-serv="cnh-apreendida">Pedir</button></li></ol>${barraTempo()}</div>` : ""}`;
    ligarIr(); ligarTempo();
  }

  // Débitos e guias
  function debitos() {
    const ab = D.debitos.filter((d) => d.situacao !== "PAGO");
    const sit = (d) => `<span class="tag ${d.situacao === "PAGO" ? "ok" : d.situacao === "VENCIDO" ? "er" : "al"}">${d.situacao}</span>`;
    $("#conteudo").innerHTML = `
      <h2 class="tit">Débitos e guias</h2>${fonte(`${META.orgaos.fazendaSigla}, ${T.sigla}, ${META.orgaos.rodovias} e ${META.orgaos.municipal}`)}
      <div class="card"><h3>Em aberto</h3>${ab.length ? `<div class="rolagem"><table class="tab">
        <tr><th></th><th>Débito</th><th>Órgão</th><th>Vencimento</th><th>Situação</th><th class="num">Valor</th></tr>
        ${ab.map((d) => `<tr><td><input type="checkbox" class="sel" value="${d.id}" checked aria-label="Incluir na guia"></td><td>${esc(d.desc)}${d.ait ? `<small>AIT ${esc(d.ait)} · ${esc(d.natureza)} · ${d.pontos} pts</small>` : ""}${d.desconto ? `<small class="ok">20% de desconto até o vencimento (−${brl(d.desconto)})</small>` : ""}${d.juros ? `<small class="er">multa e juros de mora: +${brl(d.juros)}</small>` : ""}</td><td>${esc(d.orgao)}</td><td>${dBR(d.vencimento)}</td><td>${sit(d)}</td><td class="num"><b>${brl(d.total)}</b>${d.total !== d.valor ? `<small>original ${brl(d.valor)}</small>` : ""}</td></tr>`).join("")}
      </table></div>
      <div class="rodape-deb"><span>Total selecionado: <span class="tot" id="tot-sel"></span></span><button class="btn sec" id="parcelar" style="margin-left:auto">💳 Parcelar no cartão</button><button class="btn" id="emitir">Emitir guia (${esc(META.orgaos.guia)})</button></div>` : `<div class="alerta ok">✅ Nenhum débito em aberto.</div>`}</div>
      ${D.debitosCancelados?.length ? `<div class="card"><h3>Cancelados</h3><table class="tab">${D.debitosCancelados.map((d) => `<tr><td>${esc(d.desc)}<small>AIT ${esc(d.ait)} · ${esc(d.motivoCancelamento)}</small></td><td class="num"><s>${brl(d.valor)}</s></td></tr>`).join("")}</table></div>` : ""}
      ${D.guias.length ? `<div class="card"><h3>Guias emitidas</h3><table class="tab"><tr><th>Guia</th><th>Emitida</th><th>Situação</th><th class="num">Valor</th><th></th></tr>
        ${D.guias.map((g) => `<tr><td><code>${esc(g.numero)}</code><small>${g.itens.length} item(ns)</small></td><td>${dhBR(g.criadaEm)}</td><td><span class="tag ${g.situacao === "PAGA" ? "ok" : "al"}">${g.situacao}</span></td><td class="num">${brl(g.total)}</td><td><button class="btn peq sec" data-guia="${esc(g.numero)}">${g.situacao === "PAGA" ? "Comprovante" : "Abrir / pagar"}</button></td></tr>`).join("")}</table></div>` : ""}
      <div class="card"><h3>Pagos</h3>${D.pagos.length ? `<table class="tab"><tr><th>Débito</th><th>Pago em</th><th class="num">Valor</th></tr>${D.pagos.map((p) => `<tr><td>${esc(p.desc)}${p.forma ? `<small>${esc(p.forma)}</small>` : ""}</td><td>${dBR(p.pagoEm)}</td><td class="num">${brl(p.valor)}</td></tr>`).join("")}</table>` : `<div class="vazio">Nada pago ainda.</div>`}</div>`;
    const atualizarTot = () => {
      const ids = [...document.querySelectorAll(".sel:checked")].map((x) => x.value);
      const tot = ab.filter((d) => ids.includes(d.id)).reduce((s, d) => s + d.total, 0);
      if ($("#tot-sel")) $("#tot-sel").textContent = brl(tot);
      if ($("#emitir")) $("#emitir").disabled = !ids.length;
      if ($("#parcelar")) $("#parcelar").disabled = !ids.length;
    };
    if ($("#parcelar")) $("#parcelar").onclick = () => {
      const ids = [...document.querySelectorAll(".sel:checked")].map((x) => x.value);
      const total = ab.filter((d) => ids.includes(d.id)).reduce((s, d) => s + d.total, 0);
      const i = META.jurosCartao;
      const parc = (n) => (n === 1 ? total : (total * i) / (1 - Math.pow(1 + i, -n)));
      abrirModal(`<h3 style="margin-top:0">Parcelar no cartão de crédito</h3>
        <p style="color:var(--ink-2);margin-top:0">A empresa credenciada paga o ${esc(T.sigla)} à vista e você paga a ela em parcelas. Total dos débitos: <b>${brl(total)}</b>.</p>
        <div class="form-ag"><label class="campo">Empresa credenciada<select id="pc-emp">${META.empresasParcelamento.map((e) => `<option>${esc(e)}</option>`).join("")}</select></label>
        <label class="campo">Parcelas<select id="pc-n">${Array.from({ length: 12 }, (_, k) => k + 1).map((n) => `<option value="${n}" ${n === 6 ? "selected" : ""}>${n}x de ${brl(parc(n))}${n > 1 ? ` (total ${brl(parc(n) * n)})` : " (sem juros)"}</option>`).join("")}</select></label></div>
        <p style="font-size:12.5px;color:var(--ink-3)">Juros de ${String((i * 100).toFixed(2)).replace(".", ",")}% ao mês (referência da simulação). Nenhum cartão é cobrado.</p>
        <div class="acoes"><button class="btn verde" id="pc-ok">Simular pagamento no cartão</button><button class="btn sec" id="pc-nao">Voltar</button></div><div id="pc-msg"></div>`);
      $("#pc-nao").onclick = fecharModal;
      $("#pc-ok").onclick = async () => {
        $("#pc-ok").disabled = true; $("#pc-msg").innerHTML = `<div class="vazio" style="margin-top:10px"><span class="spin" style="display:inline-block;vertical-align:middle"></span> Autorizando no cartão…</div>`;
        try {
          const [r] = await Promise.all([api(`/${estado.cidadao}/parcelar`, { method: "POST", body: JSON.stringify({ debitos: ids, empresa: $("#pc-emp").value, parcelas: Number($("#pc-n").value) }) }), espera(1200)]);
          registrar("Empresa credenciada de parcelamento", "autorização no cartão"); registrar("Arrecadação bancária / PIX", "baixa de pagamento");
          await recarregar(); CAT = null; debitos(); mostrarGuia(r.guia); toast("Débitos quitados via parcelamento no cartão.");
        } catch (e) { $("#pc-msg").innerHTML = `<div class="alerta er">${esc(e.message)}</div>`; $("#pc-ok").disabled = false; }
      };
    };
    document.querySelectorAll(".sel").forEach((x) => (x.onchange = atualizarTot)); atualizarTot();
    if ($("#emitir")) $("#emitir").onclick = async () => {
      const ids = [...document.querySelectorAll(".sel:checked")].map((x) => x.value);
      $("#emitir").disabled = true; $("#emitir").textContent = "Gerando guia…";
      try { const r = await api(`/${estado.cidadao}/guias`, { method: "POST", body: JSON.stringify({ debitos: ids }) }); registrar("Arrecadação bancária / PIX", "registro de guia"); await recarregar(); debitos(); mostrarGuia(r.guia); }
      catch (e) { toast(e.message); $("#emitir").disabled = false; $("#emitir").textContent = `Emitir guia (${META.orgaos.guia})`; }
    };
    document.querySelectorAll("[data-guia]").forEach((b) => (b.onclick = () => mostrarGuia(D.guias.find((g) => g.numero === b.dataset.guia))));
  }

  // Guia e comprovante
  function abrirModal(html) { $("#modal-corpo").innerHTML = html; $("#modal").classList.remove("hidden"); }
  function fecharModal() { $("#modal").classList.add("hidden"); }
  $(".modal-x").onclick = fecharModal;
  $("#modal").onclick = (e) => { if (e.target.id === "modal") fecharModal(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharModal(); });

  function docGuia(g) {
    return `<div class="doc">
      <h4>${esc(T.sigla)} · ${esc(META.orgaos.guiaNome)} — ${g.situacao === "PAGA" ? "COMPROVANTE" : "GUIA"}</h4>
      <div class="meta">Nº ${esc(g.numero)} · emitida ${dhBR(g.criadaEm)} · vencimento ${dBR(g.vencimento)} · contribuinte ${esc(D.cidadao.nome)} · CPF ${esc(D.cidadao.cpf)}</div>
      <table class="tab">${g.itens.map((i) => `<tr><td>${esc(i.desc)}<small>${esc(i.orgao)}</small></td><td class="num">${brl(i.valor)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num"><b>${brl(g.total)}</b></td></tr></table>
      ${g.situacao === "PAGA"
        ? `<p style="margin:14px 0 4px"><span class="carimbo">PAGO</span></p><div class="meta">Pago em ${dhBR(g.pagaEm)} · autenticação ${esc(g.autenticacao)}${g.forma ? ` · ${esc(g.forma)}: ${g.forma.match(/(\d+)x/)?.[1]}x de ${brl(g.parcela)} (total no cartão ${brl(g.totalCartao)})` : ""} · baixa enviada a ${esc(META.orgaos.fazendaSigla)} e ${esc(T.sigla)} (simulado)</div>`
        : `<div class="cod-barras" aria-hidden="true"></div><div class="linha-dig">${esc(g.linhaDigitavel)}</div>
           <div class="pix"><div class="qr" aria-hidden="true"></div><div style="flex:1;min-width:200px"><b>PIX copia e cola</b><code>${esc(g.pixCopiaECola)}</code><small style="color:var(--ink-3)">Código fictício — não funciona em nenhum banco.</small></div></div>`}
    </div>`;
  }
  function mostrarGuia(g) {
    abrirModal(`${docGuia(g)}<div class="acoes" style="margin-top:14px">${g.situacao === "PAGA" ? "" : `<button class="btn verde" id="pagar">Simular pagamento via PIX</button>`}<button class="btn sec" onclick="window.print()">Imprimir</button></div>`);
    if ($("#pagar")) $("#pagar").onclick = async () => {
      $("#modal-corpo").innerHTML = `<div class="processando"><div class="spin"></div><b id="pp">Aguardando confirmação do banco…</b><p style="color:var(--ink-3);font-size:13px">Simulação: nenhum valor é cobrado.</p></div>`;
      await espera(1200); $("#pp").textContent = `Pagamento confirmado. Enviando baixa para ${META.orgaos.fazendaSigla} e ${T.sigla}…`;
      try {
        const [r] = await Promise.all([api(`/${estado.cidadao}/guias/${encodeURIComponent(g.numero)}/pagar`, { method: "POST" }), espera(1100)]);
        registrar("Arrecadação bancária / PIX", "baixa de pagamento"); registrar(`${META.orgaos.fazendaSigla} — IPVA`, "atualização de débitos");
        await recarregar(); badge(); CAT = null; if (aba === "debitos") debitos(); else if (aba === "processos" || aba === "inicio") abrir(aba);
        mostrarGuia(r.guia); toast("Pagamento simulado com sucesso. Débitos baixados.");
      } catch (e) { $("#modal-corpo").innerHTML = `<div class="alerta er">${esc(e.message)}</div>`; }
    };
  }

  // Agendamentos
  const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const amanha = () => { const d = new Date(Date.now() + 86400000); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const maxData = () => new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 10);
  function formAgenda(alvo, ag, aoSalvar) {
    const U = META.orgaos.unidades;
    alvo.innerHTML = `<div class="form-ag">
        ${ag ? `<label class="campo">Serviço<input value="${esc(ag.servico)}" disabled></label>` : `<label class="campo">Serviço<select id="ag-serv">${META.servicosAgenda.map((s) => `<option ${s === preAgenda ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>`}
        <label class="campo">Unidade<select id="ag-un">${U.map((u) => `<option value="${u.id}" ${ag && ag.unidade === u.id ? "selected" : ""}>${esc(u.nome)} — ${esc(u.cidade)}</option>`).join("")}</select></label>
        <label class="campo">Data<input type="date" id="ag-data" min="${hojeISO()}" max="${maxData()}" value="${ag ? ag.data : amanha()}"></label>
      </div><div id="ag-slots" class="slots"></div>
      <div class="acoes" style="margin-top:12px"><button class="btn" id="ag-ok" disabled>${ag ? "Confirmar remarcação" : "Confirmar agendamento"}</button><span id="ag-esc" style="align-self:center;color:var(--ink-2);font-size:13.5px"></span></div>`;
    let hora = null;
    const carregarSlots = async () => {
      hora = null; $("#ag-ok", alvo).disabled = true; $("#ag-esc", alvo).textContent = "";
      const s = $("#ag-slots", alvo); s.innerHTML = `<div class="vazio"><span class="spin" style="display:inline-block;vertical-align:middle"></span> Buscando vagas…</div>`;
      try {
        const r = await api(`/unidades/${$("#ag-un", alvo).value}/horarios?data=${$("#ag-data", alvo).value}`);
        registrar("Agenda das unidades", "consulta de vagas");
        s.innerHTML = r.horarios.length ? r.horarios.map((h) => `<button class="slot" ${h.livre ? "" : "disabled"} data-h="${h.hora}">${h.hora}</button>`).join("") : `<div class="vazio">Unidade fechada neste dia. Escolha outra data.</div>`;
        s.querySelectorAll(".slot:not(:disabled)").forEach((b) => (b.onclick = () => {
          s.querySelectorAll(".slot").forEach((x) => x.classList.remove("on")); b.classList.add("on"); hora = b.dataset.h;
          $("#ag-ok", alvo).disabled = false; $("#ag-esc", alvo).textContent = `${dBR($("#ag-data", alvo).value)} às ${hora}`;
        }));
      } catch (e) { s.innerHTML = `<div class="vazio er">${esc(e.message)}</div>`; }
    };
    $("#ag-un", alvo).onchange = carregarSlots; $("#ag-data", alvo).onchange = carregarSlots; carregarSlots();
    $("#ag-ok", alvo).onclick = async () => {
      const corpo = { unidade: $("#ag-un", alvo).value, data: $("#ag-data", alvo).value, hora, servico: ag ? ag.servico : $("#ag-serv", alvo).value };
      $("#ag-ok", alvo).disabled = true;
      try {
        await api(`/${estado.cidadao}/agendamentos${ag ? "/" + ag.codigo : ""}`, { method: ag ? "PUT" : "POST", body: JSON.stringify(corpo) });
        registrar("Agenda das unidades", ag ? "remarcação" : "reserva de vaga");
        toast(ag ? "Agendamento remarcado." : "Agendamento confirmado. Leve documento com foto."); aoSalvar();
      } catch (e) { toast(e.message); carregarSlots(); }
    };
  }
  function agenda() {
    const lista = D.agendamentos;
    $("#conteudo").innerHTML = `
      <h2 class="tit">Agendamentos</h2>${fonte(`agenda das unidades (${[...new Set(META.orgaos.unidades.map((u) => u.tipo))].join(", ")})`)}
      <div class="card"><h3>Novo agendamento</h3><div id="ag-novo"></div></div>
      <div class="card"><h3>Meus agendamentos</h3>${lista.length ? `<div class="rolagem"><table class="tab"><tr><th>Código</th><th>Serviço</th><th>Unidade</th><th>Data</th><th>Situação</th><th></th></tr>
        ${lista.map((a) => `<tr><td><code>${esc(a.codigo)}</code></td><td>${esc(a.servico)}</td><td>${esc(a.unidadeNome)}<small>${esc(a.cidade || "")}</small></td><td>${dBR(a.data)} ${a.hora}${a.remarcadoEm ? "<small>remarcado</small>" : ""}</td><td><span class="tag ${a.situacao === "CONFIRMADO" ? "ok" : "er"}">${a.situacao}</span></td>
        <td>${a.situacao === "CONFIRMADO" ? `<div class="acoes"><button class="btn peq sec" data-rem="${a.codigo}">Remarcar</button><button class="btn peq perigo" data-can="${a.codigo}">Cancelar</button></div>` : ""}</td></tr>`).join("")}</table></div>` : `<div class="vazio">Você ainda não tem agendamentos.</div>`}</div>`;
    formAgenda($("#ag-novo"), null, () => abrir("agenda")); preAgenda = null;
    document.querySelectorAll("[data-rem]").forEach((b) => (b.onclick = () => {
      const a = lista.find((x) => x.codigo === b.dataset.rem);
      abrirModal(`<h3 style="margin-top:0">Remarcar ${esc(a.servico)}</h3><p style="color:var(--ink-2);margin-top:0">Atual: ${dBR(a.data)} às ${a.hora} — ${esc(a.unidadeNome)}</p><div id="ag-rem"></div>`);
      formAgenda($("#ag-rem"), a, () => { fecharModal(); abrir("agenda"); });
    }));
    document.querySelectorAll("[data-can]").forEach((b) => (b.onclick = () => {
      const a = lista.find((x) => x.codigo === b.dataset.can);
      abrirModal(`<h3 style="margin-top:0">Cancelar agendamento?</h3><p>${esc(a.servico)} em ${dBR(a.data)} às ${a.hora} — ${esc(a.unidadeNome)}.</p><p style="color:var(--ink-2);font-size:13.5px">A vaga volta para a agenda da unidade.</p><div class="acoes"><button class="btn perigo" id="can-ok">Cancelar agendamento</button><button class="btn sec" id="can-nao">Manter</button></div>`);
      $("#can-nao").onclick = fecharModal;
      $("#can-ok").onclick = async () => { await api(`/${estado.cidadao}/agendamentos/${a.codigo}`, { method: "DELETE" }); registrar("Agenda das unidades", "cancelamento"); fecharModal(); toast("Agendamento cancelado."); abrir("agenda"); };
    }));
  }

  // Processos e protocolos
  function processos() {
    const temProcCnh = D.infracoes.some((i) => /indeferido/i.test(i.fase));
    $("#conteudo").innerHTML = `
      <h2 class="tit">Processos e recursos</h2>${fonte(`sistema de protocolo do ${T.sigla}, JARI e ${META.orgaos.conselho}`)}
      ${temProcCnh ? `<div class="alerta al" style="margin-bottom:14px">⚖️ <span>O recurso à JARI foi indeferido. Ainda cabe recurso ao <b>${esc(META.orgaos.conselho)}</b>${D.processosCnh[0]?.prazoRecurso ? ` até <b>${dBR(D.processosCnh[0].prazoRecurso)}</b>` : ""}.</span><button class="btn peq" data-serv="mul-cetran">Recorrer agora</button></div>` : ""}
      <div class="card"><h3>Meus processos</h3>${D.protocolos.length ? D.protocolos.map((p) => `
        <div class="proc"><div class="proc-topo"><code>${esc(p.numero)}</code><b>${esc(p.tipo)}</b><span style="color:var(--ink-3);font-size:12.5px;margin-left:auto">aberto ${dhBR(p.criadoEm)}</span></div>
          <div class="etapas">${p.etapas.map((e) => `<div class="etapa ${e.feito ? "feito" : ""} ${e.atual ? "atual" : ""}"><i></i>${esc(e.nome)}${e.em ? `<small>${dhBR(e.em)}</small>` : ""}</div>`).join("")}</div>
          ${p.taxaId && !p.taxaPaga ? `<div class="alerta al" style="margin-top:8px">💳 <span>Aguardando o pagamento da taxa.</span><button class="btn peq verde" data-taxa="${esc(p.taxaId)}">Pagar taxa (${esc(META.orgaos.guia)})</button></div>` : ""}
          ${p.anexos?.length ? `<div class="obs">📎 ${p.anexos.map((a) => `${esc(a.doc)}: <i>${esc(a.nome)}</i>${a.exemplo ? " (exemplo)" : ""}`).join(" · ")}</div>` : ""}
          ${p.obs ? `<div class="obs">${esc(p.obs)}</div>` : ""}</div>`).join("") : `<div class="vazio">Nenhum processo aberto.</div>`}</div>
      ${barraTempo()}
      <div class="card"><h3>Abrir novo pedido</h3><p style="margin:0 0 10px;color:var(--ink-2)">São ${CAT.total} serviços: habilitação, veículos, multas, certidões e atendimento.</p><button class="btn" data-ir="catalogo">Ver todos os serviços</button></div>`;
    document.querySelectorAll("[data-taxa]").forEach((b) => (b.onclick = () => pagarTaxa(b.dataset.taxa)));
    ligarTempo(); ligarIr();
  }
  // "Avançar o tempo": só da demonstração, para ver julgamentos e prazos sem esperar.
  function barraTempo() {
    return `<div class="tempo"><span>⏩ <b>Avançar o tempo</b> <small>(recurso da demonstração — os processos andam como se o tempo tivesse passado${D.avancoDias ? `; já avançado ${D.avancoDias} dia(s)` : ""})</small></span>
      <span class="acoes"><button class="btn peq sec" data-dias="1">+1 dia</button><button class="btn peq sec" data-dias="30">+30 dias</button><button class="btn peq sec" data-dias="365">+12 meses</button></span></div>`;
  }
  function ligarTempo() {
    document.querySelectorAll("[data-dias]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api(`/${estado.cidadao}/avancar`, { method: "POST", body: JSON.stringify({ dias: Number(b.dataset.dias) }) }); CAT = null; toast(`Tempo avançado: +${b.dataset.dias === "365" ? "12 meses" : b.dataset.dias + " dia(s)"}.`); abrir(aba); }
      catch (e) { toast(e.message); b.disabled = false; }
    }));
  }

  // Unidades e filas (atualiza sozinho)
  async function filas() {
    const pintar = async () => {
      const r = await api("/filas");
      if (aba !== "filas") return;
      registrar("Painel de senhas das unidades", "leitura");
      const cor = { Tranquila: "var(--ok)", Movimentada: "var(--alerta)", Lotada: "var(--erro)", Fechada: "#A9B1C2" };
      $("#conteudo").innerHTML = `
        <h2 class="tit">Unidades e filas agora</h2>${fonte("painel de senhas das unidades · atualiza a cada 15 s")}
        <div class="filas">${r.unidades.map((u) => `<div class="fila">
          <div class="cab"><div><b>${esc(u.nome)}</b><div class="cid">${esc(u.tipo)} · ${esc(u.cidade)}</div></div><span class="tag" style="background:${cor[u.status]}22;color:${cor[u.status]}">${u.status}</span></div>
          <div class="espera">${u.aberta ? `${u.esperaMin}<small> min de espera</small>` : `<small>Fechada agora</small>`}</div>
          <div class="barra"><i style="width:${Math.min(100, (u.esperaMin / 60) * 100)}%;background:${cor[u.status]}"></i></div>
          <div class="det"><span>👥 ${u.aguardando} aguardando</span><span>🪟 ${u.guichesAbertos}/${u.guiches} guichês</span><span>✔ ${u.atendidosHoje} hoje</span></div>
        </div>`).join("")}</div>
        <p class="nota">Na versão integrada estes números vêm do sistema de senhas de cada unidade. O assistente pode sugerir a unidade com menor espera e já oferecer o agendamento. <button class="btn peq sec" data-ir="agenda">Agendar</button></p>`;
      ligarIr();
    };
    await pintar(); timerFila = setInterval(() => pintar().catch(() => {}), 15000);
  }

  // Integrações
  async function integracoes() {
    const r = await api("/integracoes");
    const st = (s) => (s === "Operacional" ? "var(--ok)" : "var(--alerta)");
    $("#conteudo").innerHTML = `
      <h2 class="tit">Integrações</h2>${fonte("monitor de integrações")}
      <div class="card"><h3>Sistemas conectados</h3>${r.itens.map((i) => `<div class="integ"><span class="st" style="background:${st(i.status)}"></span>
        <div class="nm"><b>${esc(i.nome)}</b><small>${esc(i.desc)}</small></div>
        <div class="mt"><span class="tag ${i.status === "Operacional" ? "ok" : "al"}">${i.status}</span><br>${i.latenciaMs} ms · ${i.chamadasHoje.toLocaleString("pt-BR")} chamadas hoje<br><small style="color:var(--ink-3)">sync ${hBR(i.ultimaSync)}</small></div></div>`).join("")}</div>
      <div class="card"><h3>Chamadas desta sessão</h3><div class="log">${logChamadas.length ? logChamadas.map((l) => `<div>${hBR(l.em)} <span class="${l.ok ? "ok" : "al"}">${l.ok ? "200" : "503"}</span> ${esc(l.sistema)} · ${esc(l.acao)} · ${l.ms} ms</div>`).join("") : "Nenhuma chamada ainda."}</div></div>
      <p class="nota">Simulação: nenhum desses sistemas é chamado de verdade. Na implantação, cada linha corresponde a um convênio/API oficial (SENATRAN, ${esc(META.orgaos.fazendaSigla)}, ECV, prefeituras, bancos).</p>`;
  }

  iniciar().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<div class="escolha-in"><div class="card er">${esc(e.message)}</div></div>`); });
})();
