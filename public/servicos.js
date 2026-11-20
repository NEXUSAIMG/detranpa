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
  const CORES = { ana: "#157A4C", carlos: "#A35A00", marina: "#7A2E8E" };

  let estado = {};
  try { estado = JSON.parse(localStorage.getItem(LSK) || "{}"); } catch (_) {}
  if (!estado.sessao) estado.sessao = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/[^\w-]/g, "").slice(0, 36);
  const salvar = () => { try { localStorage.setItem(LSK, JSON.stringify(estado)); } catch (_) {} };
  salvar();

  let META = null, D = null, aba = "inicio", timerFila = null;
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
    estado.cidadao = pid; salvar();
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
      filas: ["Painel de senhas das unidades"], integracoes: ["Monitor de integrações"],
    }[qual];
    try {
      await consultar(fontes, recarregar);
      window.scrollTo({ top: 0, behavior: "smooth" });
      ({ inicio, veiculo, cnh, debitos, agenda, processos, filas, integracoes })[qual]();
    } catch (e) { $("#conteudo").innerHTML = `<div class="card er">${esc(e.message)}</div>`; }
  }

  // Início
  function inicio() {
    const abertos = D.debitos.filter((d) => d.situacao !== "PAGO");
    const vencidos = abertos.filter((d) => d.situacao === "VENCIDO");
    const ag = D.agendamentos.filter((a) => a.situacao === "CONFIRMADO");
    const al = [];
    if (D.cnh.situacao !== "Regular") al.push(["er", `CNH <b>${esc(D.cnh.situacao.toLowerCase())}</b>: ${esc(D.cnh.observacoes)}.`, "cnh", "Ver CNH"]);
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
  function ligarIr() { document.querySelectorAll("[data-ir]").forEach((b) => (b.onclick = () => abrir(b.dataset.ir))); }

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
      </dl></div>
      <div class="card"><h3>Restrições e avisos</h3>${v.restricoes.length || v.recall.length ? `<div class="alertas">${[...v.restricoes.map((r) => ["al", r]), ...v.recall.map((r) => ["er", r])].map(([c, r]) => `<div class="alerta ${c}">⚠️ <span>${esc(r)}</span></div>`).join("")}</div>` : `<div class="alerta ok">✅ Nenhuma restrição administrativa, judicial ou de recall.</div>`}</div>
      <div class="card"><h3>Serviços deste veículo</h3><div class="acoes">
        <button class="btn sec" data-proto="2ª via do CRLV-e">2ª via do CRLV-e</button>
        <button class="btn sec" data-proto="Transferência de propriedade">Iniciar transferência</button>
        <button class="btn sec" data-ir="agenda">Agendar vistoria</button>
        <button class="btn sec" data-ir="debitos">Ver débitos</button></div></div>`;
    ligarIr(); ligarProto();
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
      ${D.processosCnh.length ? `<div class="card"><h3>Processos administrativos</h3>${D.processosCnh.map((p) => `<div class="alerta er">⛔ <span><b>${esc(p.tipo)}</b> — ${esc(p.situacao)}<br><small>${esc(p.numero)} · desde ${dBR(p.desde)} · prazo para recurso até ${dBR(p.prazoRecurso)}</small></span><button class="btn peq" data-proto="Recurso ao CETRAN">Recorrer ao ${esc(META.orgaos.conselho)}</button></div>`).join("")}</div>` : ""}
      <div class="card"><h3>Infrações nos últimos 12 meses</h3>${D.infracoes.length ? `<div class="rolagem"><table class="tab"><tr><th>Data</th><th>Infração</th><th>Natureza</th><th class="num">Pontos</th><th>Fase</th><th></th></tr>
        ${D.infracoes.map((i) => `<tr><td>${dBR(i.data)}</td><td>${esc(i.desc)}<small>AIT ${esc(i.ait)} · ${esc(i.orgao)}</small></td><td>${esc(i.natureza)}</td><td class="num">${i.pontos}</td><td><small style="color:var(--ink-2)">${esc(i.fase)}</small></td><td>${/defesa/i.test(i.fase) ? `<button class="btn peq sec" data-proto="Defesa prévia">Defesa prévia</button>` : /JARI/.test(i.fase) && !/indeferido/i.test(i.fase) ? `<button class="btn peq sec" data-proto="Recurso à JARI">Recurso JARI</button>` : ""}</td></tr>`).join("")}</table></div>` : `<div class="vazio">Nenhuma infração registrada.</div>`}</div>
      <div class="card"><h3>Serviços da CNH</h3><div class="acoes"><button class="btn sec" data-proto="Renovação de CNH">Renovar CNH</button><button class="btn sec" data-ir="agenda">Agendar exame / biometria</button></div></div>`;
    ligarIr(); ligarProto();
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
      <div class="rodape-deb"><span>Total selecionado: <span class="tot" id="tot-sel"></span></span><button class="btn" id="emitir" style="margin-left:auto">Emitir guia (DAE)</button></div>` : `<div class="alerta ok">✅ Nenhum débito em aberto.</div>`}</div>
      ${D.guias.length ? `<div class="card"><h3>Guias emitidas</h3><table class="tab"><tr><th>Guia</th><th>Emitida</th><th>Situação</th><th class="num">Valor</th><th></th></tr>
        ${D.guias.map((g) => `<tr><td><code>${esc(g.numero)}</code><small>${g.itens.length} item(ns)</small></td><td>${dhBR(g.criadaEm)}</td><td><span class="tag ${g.situacao === "PAGA" ? "ok" : "al"}">${g.situacao}</span></td><td class="num">${brl(g.total)}</td><td><button class="btn peq sec" data-guia="${esc(g.numero)}">${g.situacao === "PAGA" ? "Comprovante" : "Abrir / pagar"}</button></td></tr>`).join("")}</table></div>` : ""}
      <div class="card"><h3>Pagos</h3>${D.pagos.length ? `<table class="tab"><tr><th>Débito</th><th>Pago em</th><th class="num">Valor</th></tr>${D.pagos.map((p) => `<tr><td>${esc(p.desc)}</td><td>${dBR(p.pagoEm)}</td><td class="num">${brl(p.valor)}</td></tr>`).join("")}</table>` : `<div class="vazio">Nada pago ainda.</div>`}</div>`;
    const atualizarTot = () => {
      const ids = [...document.querySelectorAll(".sel:checked")].map((x) => x.value);
      const tot = ab.filter((d) => ids.includes(d.id)).reduce((s, d) => s + d.total, 0);
      if ($("#tot-sel")) $("#tot-sel").textContent = brl(tot);
      if ($("#emitir")) $("#emitir").disabled = !ids.length;
    };
    document.querySelectorAll(".sel").forEach((x) => (x.onchange = atualizarTot)); atualizarTot();
    if ($("#emitir")) $("#emitir").onclick = async () => {
      const ids = [...document.querySelectorAll(".sel:checked")].map((x) => x.value);
      $("#emitir").disabled = true; $("#emitir").textContent = "Gerando guia…";
      try { const r = await api(`/${estado.cidadao}/guias`, { method: "POST", body: JSON.stringify({ debitos: ids }) }); registrar("Arrecadação bancária / PIX", "registro de guia"); await recarregar(); debitos(); mostrarGuia(r.guia); }
      catch (e) { toast(e.message); $("#emitir").disabled = false; $("#emitir").textContent = "Emitir guia (DAE)"; }
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
      <h4>${esc(T.sigla)} · Documento de Arrecadação — ${g.situacao === "PAGA" ? "COMPROVANTE" : "GUIA"}</h4>
      <div class="meta">Nº ${esc(g.numero)} · emitida ${dhBR(g.criadaEm)} · vencimento ${dBR(g.vencimento)} · contribuinte ${esc(D.cidadao.nome)} · CPF ${esc(D.cidadao.cpf)}</div>
      <table class="tab">${g.itens.map((i) => `<tr><td>${esc(i.desc)}<small>${esc(i.orgao)}</small></td><td class="num">${brl(i.valor)}</td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num"><b>${brl(g.total)}</b></td></tr></table>
      ${g.situacao === "PAGA"
        ? `<p style="margin:14px 0 4px"><span class="carimbo">PAGO</span></p><div class="meta">Pago em ${dhBR(g.pagaEm)} · autenticação ${esc(g.autenticacao)} · baixa enviada a ${esc(META.orgaos.fazendaSigla)} e ${esc(T.sigla)} (simulado)</div>`
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
        await recarregar(); badge(); if (aba === "debitos") debitos();
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
        ${ag ? `<label class="campo">Serviço<input value="${esc(ag.servico)}" disabled></label>` : `<label class="campo">Serviço<select id="ag-serv">${META.servicosAgenda.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>`}
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
    formAgenda($("#ag-novo"), null, () => abrir("agenda"));
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
  function ligarProto() {
    document.querySelectorAll("[data-proto]").forEach((b) => (b.onclick = () => novoProtocolo(b.dataset.proto)));
  }
  function novoProtocolo(tipo) {
    const nome = tipo === "Recurso ao CETRAN" ? `Recurso ao ${META.orgaos.conselho}` : tipo;
    abrirModal(`<h3 style="margin-top:0">Protocolar: ${esc(nome)}</h3>
      <p style="color:var(--ink-2)">No sistema real, este passo envia o requerimento e os anexos ao ${esc(T.sigla)}. Aqui é simulado: o protocolo começa com <b>SIM-</b> e o andamento avança sozinho a cada 2 minutos.</p>
      ${/Recurso|Defesa/.test(tipo) ? `<p style="font-size:13.5px">Dica: o assistente monta o texto da ${/Defesa/.test(tipo) ? "defesa" : "peça de recurso"} — use o botão “Defesa de multa” na tela do chat.</p>` : ""}
      <div class="acoes"><button class="btn" id="pr-ok">Protocolar (simulação)</button><button class="btn sec" id="pr-nao">Voltar</button></div>`);
    $("#pr-nao").onclick = fecharModal;
    $("#pr-ok").onclick = async () => {
      $("#pr-ok").disabled = true;
      try {
        const r = await api(`/${estado.cidadao}/protocolos`, { method: "POST", body: JSON.stringify({ tipo: nome }) });
        registrar(`Sistema de protocolo ${T.sigla}`, "abertura de processo");
        abrirModal(`<div class="doc"><h4>Comprovante de protocolo</h4><div class="meta">${dhBR(r.protocolo.criadoEm)} · ${esc(D.cidadao.nome)}</div><p style="font-size:20px;margin:6px 0"><code>${esc(r.protocolo.numero)}</code></p><p style="margin:0">${esc(r.protocolo.tipo)}</p></div>
          <div class="acoes" style="margin-top:14px"><button class="btn" id="pr-ver">Acompanhar processo</button><button class="btn sec" onclick="window.print()">Imprimir</button></div>`);
        $("#pr-ver").onclick = () => { fecharModal(); abrir("processos"); };
      } catch (e) { toast(e.message); $("#pr-ok").disabled = false; }
    };
  }
  function processos() {
    const temProcCnh = D.processosCnh.length || D.infracoes.some((i) => /indeferido/i.test(i.fase));
    $("#conteudo").innerHTML = `
      <h2 class="tit">Processos e recursos</h2>${fonte(`sistema de protocolo do ${T.sigla}, JARI e ${META.orgaos.conselho}`)}
      ${temProcCnh ? `<div class="alerta al" style="margin-bottom:14px">⚖️ <span>O recurso à JARI foi indeferido. Ainda cabe recurso ao <b>${esc(META.orgaos.conselho)}</b>${D.processosCnh[0]?.prazoRecurso ? ` até <b>${dBR(D.processosCnh[0].prazoRecurso)}</b>` : ""}.</span><button class="btn peq" data-proto="Recurso ao CETRAN">Recorrer agora</button></div>` : ""}
      <div class="card"><h3>Meus processos</h3>${D.protocolos.length ? D.protocolos.map((p) => `
        <div class="proc"><div class="proc-topo"><code>${esc(p.numero)}</code><b>${esc(p.tipo)}</b><span style="color:var(--ink-3);font-size:12.5px;margin-left:auto">aberto ${dhBR(p.criadoEm)}</span></div>
          <div class="etapas">${p.etapas.map((e) => `<div class="etapa ${e.feito ? "feito" : ""} ${e.atual ? "atual" : ""}"><i></i>${esc(e.nome)}${e.em ? `<small>${dhBR(e.em)}</small>` : ""}</div>`).join("")}</div>
          ${p.obs ? `<div class="obs">${esc(p.obs)}</div>` : ""}</div>`).join("") : `<div class="vazio">Nenhum processo aberto.</div>`}</div>
      <div class="card"><h3>Abrir novo processo</h3><div class="acoes">${META.tiposProtocolo.map((t) => `<button class="btn sec" data-proto="${esc(/^Recurso ao (?!JARI)/.test(t) ? "Recurso ao CETRAN" : t)}">${esc(t)}</button>`).join("")}</div></div>`;
    ligarProto();
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
