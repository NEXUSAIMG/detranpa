// Tutoria do bot dentro da Central de Gestão (/<uf>/gestao#tutoria).
// Ensinar, corrigir respostas reais, avisos com prazo e normas. Tudo entra no
// ar na hora; o servidor fala com o BotAyio (o token nunca chega aqui).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const api = (p, o) => Sessao.api("/gestao/tutoria" + p, o);
  const post = (b) => ({ method: "POST", body: JSON.stringify(b || {}) });
  const put = (b) => ({ method: "PUT", body: JSON.stringify(b || {}) });
  const fmtD = (d) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("pt-BR") : "—");
  const fmtDH = (d) => (d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const txt = (s) => window.textoRico ? window.textoRico(s) : esc(s).replace(/\[\[BREAK\]\]/g, "<br>").replace(/\[\[[A-Z:-]+[\w-]*\]\]/g, "").replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
  const conf = (c) => (c == null ? "" : `<span class="tu-conf ${c >= 0.25 ? "ok" : "baixa"}" title="O quanto a base de conhecimento combinou com a pergunta">${Math.round(c * 100)}% de confiança</span>`);
  const msg = (t, tipo = "err") => { $("tu-msg").innerHTML = t ? `<div class="msg ${tipo}">${esc(t)}</div>` : ""; if (t && tipo === "ok") setTimeout(() => { if ($("tu-msg").textContent === t) $("tu-msg").innerHTML = ""; }, 5000); };
  let aba = "ensinar";
  let ligada = null;

  document.querySelectorAll("#tu-abas [data-tu]").forEach((b) => (b.onclick = () => abrir(b.dataset.tu)));

  async function carregar() {
    if (ligada === null) {
      const r = await api("/status");
      ligada = Boolean(r.ok && r.data.ligada);
    }
    if (!ligada) {
      $("tu-abas").classList.add("hidden");
      $("tu-corpo").innerHTML = `<div class="cartao"><h4 role="heading" aria-level="2">A tutoria deste DETRAN ainda não foi ligada</h4><p class="vazio-p">Falta cadastrar o link de tutoria do bot (BotAyio) em <b>/admin → Integrações</b>. Peça ao administrador.</p></div>`;
      return;
    }
    $("tu-abas").classList.remove("hidden");
    contarRevisar();
    abrir(aba);
  }
  async function contarRevisar() {
    const r = await api("/respostas?revisao=1&limite=200");
    const n = r.ok ? r.data.itens.length : 0;
    $("tu-n-revisar").textContent = n ? String(n) : "";
  }
  function abrir(qual) {
    aba = qual; msg("");
    document.querySelectorAll("#tu-abas [data-tu]").forEach((b) => b.classList.toggle("on", b.dataset.tu === qual));
    ({ ensinar: telaEnsinar, revisar: () => telaRespostas(true), recentes: () => telaRespostas(false), ensinado: () => telaEnsinado("resposta"), avisos: telaAvisos, documentos: telaDocumentos })[qual]();
  }
  const falhou = (r) => { msg(r.data?.error || "Não foi possível concluir agora."); if (r.data?.semTutoria) { ligada = false; carregar(); } };

  // ── Testar uma pergunta (usado em várias telas) ──
  async function testar(pergunta, alvo) {
    $(alvo).innerHTML = `<div class="tu-teste"><small>Perguntando ao bot…</small></div>`;
    const r = await api("/testar", post({ pergunta }));
    if (!r.ok) { $(alvo).innerHTML = `<div class="msg err">${esc(r.data.error || "Falha no teste.")}</div>`; return; }
    const usados = (r.data.base || []).filter((b) => b.usado);
    $(alvo).innerHTML = `<div class="tu-teste"><small>Resposta do bot agora:</small><div class="tu-resp">${txt(r.data.resposta)}</div>
      ${usados.length ? `<small>Usou: ${usados.map((b) => `${b.ensinado ? "🎓 " : ""}${esc(b.topico)}`).join(" · ")}</small>` : `<small>Não achou nada na base para essa pergunta.</small>`}</div>`;
  }

  // ── Ensinar algo novo ──
  function telaEnsinar() {
    $("tu-corpo").innerHTML = `<div class="tu-grade">
      <div class="cartao">
        <h4 role="heading" aria-level="2">Ensinar algo novo ao bot</h4>
        <label class="f" for="tu-perg">Como o cidadão pergunta</label>
        <textarea id="tu-perg" class="in" rows="3" placeholder="Ex.: Posso transferir o carro com IPVA atrasado?&#10;(uma forma por linha — quanto mais jeitos de perguntar, melhor o bot encontra)"></textarea>
        <label class="f" for="tu-resp">Resposta certa</label>
        <textarea id="tu-resp" class="in" rows="7" placeholder="Escreva como o bot deve responder. Pode citar documentos, prazos, valores e links oficiais."></textarea>
        <div class="tu-linha">
          <div><label class="f" for="tu-fonte">Base legal ou fonte (opcional)</label><input id="tu-fonte" class="in" placeholder="Ex.: Resolução CONTRAN nº 1.027/2026, art. 12" /></div>
          <div><label class="f" for="tu-rev">Lembrar de revisar em (opcional)</label><input id="tu-rev" class="in" type="date" /></div>
        </div>
        <div class="tu-acoes"><button class="btn pri" id="tu-salvar">Ensinar ao bot</button><button class="btn soft" id="tu-testar1">Testar antes</button></div>
        <div id="tu-res1"></div>
      </div>
      <div class="cartao">
        <h4 role="heading" aria-level="2">Perguntar ao bot</h4>
        <p class="vazio-p">Veja como o bot responde hoje, sem virar conversa real.</p>
        <textarea id="tu-tp" class="in" rows="3" placeholder="Digite uma pergunta como o cidadão faria"></textarea>
        <div class="tu-acoes"><button class="btn soft" id="tu-tpb">Perguntar</button></div>
        <div id="tu-tpr"></div>
      </div></div>`;
    $("tu-testar1").onclick = () => { const p = primeira($("tu-perg").value); if (!p) return msg("Escreva como o cidadão pergunta."); testar(p, "tu-res1"); };
    $("tu-tpb").onclick = () => { const p = $("tu-tp").value.trim(); if (p) testar(p, "tu-tpr"); };
    $("tu-salvar").onclick = async () => {
      const pergunta = juntarPerguntas($("tu-perg").value), resposta = comFonte($("tu-resp").value, $("tu-fonte").value);
      if (!pergunta || !$("tu-resp").value.trim()) return msg("Escreva a pergunta e a resposta certa.");
      $("tu-salvar").disabled = true;
      const r = await api("/ensinar", post({ pergunta, resposta, dataRevisao: $("tu-rev").value || null }));
      $("tu-salvar").disabled = false;
      if (!r.ok) return falhou(r);
      msg("Pronto! O bot já está usando isso.", "ok");
      const p = primeira($("tu-perg").value);
      ["tu-perg", "tu-resp", "tu-fonte", "tu-rev"].forEach((id) => ($(id).value = ""));
      testar(p, "tu-res1");
    };
  }
  const primeira = (v) => String(v || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  const juntarPerguntas = (v) => String(v || "").split("\n").map((s) => s.trim()).filter(Boolean).join(" / ");
  const comFonte = (resp, fonte) => { const r = String(resp || "").trim(), f = String(fonte || "").trim(); return f ? `${r}\n\nBase legal/fonte: ${f}` : r; };

  // ── Respostas reais (para revisar = só as "no escuro") ──
  async function telaRespostas(soRevisar) {
    $("tu-corpo").innerHTML = `<div class="vazio-p">Carregando…</div>`;
    const r = await api(`/respostas?limite=${soRevisar ? 200 : 60}${soRevisar ? "&revisao=1" : ""}`);
    if (!r.ok) { $("tu-corpo").innerHTML = ""; return falhou(r); }
    const itens = r.data.itens;
    if (!itens.length) {
      $("tu-corpo").innerHTML = `<div class="cartao"><p class="vazio-p">${soRevisar ? "Nada para revisar agora: o bot achou resposta na base para tudo que perguntaram. 🎉" : "Ainda não há respostas registradas."}</p></div>`;
      return;
    }
    $("tu-corpo").innerHTML = (soRevisar ? `<p class="vazio-p">Perguntas em que o bot <b>não achou nada parecido na base</b> ou respondeu com <b>confiança baixa</b> (abaixo de 25%) — as mais incertas primeiro. Corrija para ele aprender.</p>` : "")
      + itens.map((i, k) => `<div class="cartao tu-item">
        <div class="tu-topo"><small>${fmtDH(i.quando)}</small>${conf(i.confianca)}${i.jaCorrigida ? `<span class="tu-tag ok">já corrigida</span>` : ""}</div>
        <div class="tu-q"><b>Cidadão:</b> ${esc(i.pergunta || "(sem texto)")}</div>
        <details><summary>O que o bot respondeu</summary><div class="tu-resp">${txt(i.resposta)}</div>
          ${i.base.length ? `<small>Na base achou: ${i.base.map((b) => `${esc(b.topico)} (${Math.round((b.score || 0) * 100)}%)`).join(" · ")}</small>` : ""}</details>
        <div class="tu-acoes"><button class="btn soft mini" data-corrigir="${k}">${i.jaCorrigida ? "Corrigir de novo" : "Corrigir"}</button></div>
        <div id="tu-fc-${k}"></div></div>`).join("");
    $("tu-corpo").querySelectorAll("[data-corrigir]").forEach((b) => (b.onclick = () => formCorrigir(itens[Number(b.dataset.corrigir)], "tu-fc-" + b.dataset.corrigir)));
  }
  function formCorrigir(i, alvo) {
    const limpo = String(i.resposta || "").replace(/\[\[BREAK\]\]/g, "\n").replace(/\[\[[A-Z:-]+[\w-]*\]\]/g, "").trim();
    $(alvo).innerHTML = `<div class="tu-form">
      <label class="f">Como o cidadão pergunta (pode acrescentar outros jeitos, um por linha)</label>
      <textarea class="in" rows="2" data-c="perg">${esc(i.pergunta && !/\[(CPF|telefone|placa|e-mail|número|CNPJ)\]/.test(i.pergunta) ? i.pergunta : "")}</textarea>
      <label class="f">Resposta certa</label>
      <textarea class="in" rows="6" data-c="resp">${esc(limpo)}</textarea>
      <div class="tu-acoes"><button class="btn pri mini" data-c="ok">Salvar correção</button><button class="btn ghost mini" data-c="x">Cancelar</button></div>
      <div data-c="res"></div></div>`;
    const box = $(alvo), q = (c) => box.querySelector(`[data-c="${c}"]`);
    q("x").onclick = () => (box.innerHTML = "");
    q("ok").onclick = async () => {
      const pergunta = juntarPerguntas(q("perg").value), resposta = q("resp").value.trim();
      if (!pergunta || !resposta) return msg("Escreva a pergunta e a resposta certa.");
      q("ok").disabled = true;
      const r = await api("/ensinar", post({ pergunta, resposta, mensagemId: i.mensagemId, respostaOriginal: i.resposta }));
      q("ok").disabled = false;
      if (!r.ok) return falhou(r);
      msg("Correção salva — o bot já responde assim.", "ok");
      q("res").id = alvo + "-t"; testar(primeira(q("perg").value), alvo + "-t");
      contarRevisar();
    };
  }

  // ── O que já foi ensinado / avisos ──
  async function listaEnsinado() {
    const r = await api("/ensinado");
    if (!r.ok) { falhou(r); return null; }
    return r.data.itens;
  }
  const situacao = (c) => !c.ativo ? `<span class="tu-tag off">desligado</span>`
    : c.noAr ? `<span class="tu-tag ok">no ar</span>`
    : c.vigenteDe && c.vigenteDe > hoje() ? `<span class="tu-tag warn">agendado</span>` : `<span class="tu-tag off">encerrado</span>`;
  async function telaEnsinado() {
    $("tu-corpo").innerHTML = `<div class="vazio-p">Carregando…</div>`;
    const todos = await listaEnsinado(); if (!todos) return;
    const itens = todos.filter((c) => c.tipo !== "aviso");
    if (!itens.length) { $("tu-corpo").innerHTML = `<div class="cartao"><p class="vazio-p">Nada ensinado ainda. Use a aba <b>Ensinar</b> ou corrija uma resposta.</p></div>`; return; }
    $("tu-corpo").innerHTML = `<input class="in tu-busca" id="tu-busca" placeholder="Buscar no que já foi ensinado…" />` + `<div id="tu-lista"></div>`;
    const desenhar = () => {
      const f = $("tu-busca").value.trim().toLowerCase();
      const vis = itens.filter((c) => !f || (c.pergunta + " " + c.resposta).toLowerCase().includes(f));
      $("tu-lista").innerHTML = vis.map((c) => cartaoEnsinado(c)).join("") || `<p class="vazio-p">Nada encontrado.</p>`;
      ligarAcoes(vis, telaEnsinado);
    };
    $("tu-busca").oninput = desenhar; desenhar();
  }
  const cartaoEnsinado = (c) => `<div class="cartao tu-item" data-id="${esc(c.id)}">
    <div class="tu-topo">${situacao(c)}${c.revisar ? `<span class="tu-tag warn">revisar</span>` : ""}<small>${c.origem === "correcao" ? "Correção" : "Ensinado"} por ${esc(c.autor || "—")} em ${fmtD(c.criadoEm)}</small>
      ${c.tipo === "aviso" ? `<small>Vale de ${fmtD(c.vigenteDe) === "—" ? "agora" : fmtD(c.vigenteDe)} até ${fmtD(c.vigenteAte)}</small>` : c.dataRevisao ? `<small>Revisar em ${fmtD(c.dataRevisao)}</small>` : ""}</div>
    <div class="tu-q"><b>${c.tipo === "aviso" ? "Assunto" : "Pergunta"}:</b> ${esc(c.pergunta)}</div>
    <div class="tu-resp">${txt(c.resposta)}</div>
    <div class="tu-acoes"><button class="btn soft mini" data-a="editar">Editar</button><button class="btn ghost mini" data-a="alternar">${c.ativo ? "Desligar" : "Ligar"}</button><button class="btn ghost mini" data-a="hist">Histórico</button><button class="btn ghost mini" data-a="testar">Testar</button></div>
    <div data-a="area"></div></div>`;
  function ligarAcoes(lista, recarregar) {
    $("tu-corpo").querySelectorAll(".tu-item[data-id]").forEach((card) => {
      const c = lista.find((x) => x.id === card.dataset.id); if (!c) return;
      const area = card.querySelector('[data-a="area"]');
      card.querySelector('[data-a="alternar"]').onclick = async () => {
        const r = await api(`/ensinado/${encodeURIComponent(c.id)}/alternar`, post({}));
        if (!r.ok) return falhou(r);
        msg(r.data.ativo ? "Ligado de novo — o bot volta a usar." : "Desligado — o bot deixa de usar (nada foi apagado).", "ok"); recarregar();
      };
      card.querySelector('[data-a="testar"]').onclick = () => { area.id = "tu-a-" + c.id; testar(primeira(c.pergunta.split(" / ").join("\n")), area.id); };
      card.querySelector('[data-a="hist"]').onclick = async () => {
        const r = await api(`/ensinado/${encodeURIComponent(c.id)}/historico`);
        if (!r.ok) return falhou(r);
        area.innerHTML = r.data.itens.length ? `<div class="tu-form"><small>Versões anteriores da resposta:</small>${r.data.itens.map((h) => `<div class="tu-hist"><small>${fmtDH(h.quando)} — ${esc(h.autor_anterior || "—")}</small><div>${txt(h.resposta_anterior)}</div></div>`).join("")}</div>` : `<p class="vazio-p">Sem versões anteriores — nunca foi editado.</p>`;
      };
      card.querySelector('[data-a="editar"]').onclick = () => {
        area.innerHTML = `<div class="tu-form"><label class="f">Resposta</label><textarea class="in" rows="6" data-e="resp">${esc(c.resposta)}</textarea>
          ${c.tipo === "aviso" ? `<div class="tu-linha"><div><label class="f">Vale a partir de</label><input class="in" type="date" data-e="de" value="${esc(c.vigenteDe || "")}"></div><div><label class="f">Sai do ar depois de</label><input class="in" type="date" data-e="ate" value="${esc(c.vigenteAte || "")}"></div></div>`
            : `<div class="tu-linha"><div><label class="f">Lembrar de revisar em</label><input class="in" type="date" data-e="rev" value="${esc(c.dataRevisao || "")}"></div><div></div></div>`}
          <div class="tu-acoes"><button class="btn pri mini" data-e="ok">Salvar</button><button class="btn ghost mini" data-e="x">Cancelar</button></div></div>`;
        const q = (k) => area.querySelector(`[data-e="${k}"]`);
        q("x").onclick = () => (area.innerHTML = "");
        q("ok").onclick = async () => {
          const body = { resposta: q("resp").value };
          if (c.tipo === "aviso") { body.vigenteDe = q("de").value || ""; body.vigenteAte = q("ate").value || ""; if (!body.vigenteAte) return msg("Aviso precisa de data final."); }
          else body.dataRevisao = q("rev").value || "";
          const r = await api(`/ensinado/${encodeURIComponent(c.id)}`, put(body));
          if (!r.ok) return falhou(r);
          msg("Atualizado — a versão anterior ficou no histórico.", "ok"); recarregar();
        };
      };
    });
  }

  async function telaAvisos() {
    $("tu-corpo").innerHTML = `<div class="cartao">
      <h4 role="heading" aria-level="2">Novo aviso com prazo</h4>
      <p class="vazio-p">Para situações passageiras: unidade fechada, sistema fora do ar, prazo prorrogado, mutirão. O aviso <b>sai do ar sozinho</b> depois da data final.</p>
      <label class="f" for="av-assunto">Sobre o que o cidadão vai perguntar</label>
      <input id="av-assunto" class="in" placeholder="Ex.: atendimento na Ciretran de Marabá / vistoria em Marabá" />
      <label class="f" for="av-texto">O aviso</label>
      <textarea id="av-texto" class="in" rows="4" placeholder="Ex.: A Ciretran de Marabá está fechada para reforma. Os serviços estão sendo feitos na unidade do shopping…"></textarea>
      <div class="tu-linha"><div><label class="f" for="av-de">Vale a partir de</label><input id="av-de" class="in" type="date" value="${hoje()}" /></div>
        <div><label class="f" for="av-ate">Sai do ar depois de</label><input id="av-ate" class="in" type="date" /></div></div>
      <div class="tu-acoes"><button class="btn pri" id="av-ok">Publicar aviso</button></div>
    </div><div id="tu-lista"><div class="vazio-p">Carregando…</div></div>`;
    $("av-ok").onclick = async () => {
      const pergunta = $("av-assunto").value.trim(), resposta = $("av-texto").value.trim();
      if (!pergunta || !resposta) return msg("Escreva o assunto e o aviso.");
      if (!$("av-ate").value) return msg("Escolha até quando o aviso vale.");
      $("av-ok").disabled = true;
      const r = await api("/ensinar", post({ tipo: "aviso", pergunta, resposta, vigenteDe: $("av-de").value || null, vigenteAte: $("av-ate").value }));
      $("av-ok").disabled = false;
      if (!r.ok) return falhou(r);
      msg("Aviso publicado.", "ok"); telaAvisos();
    };
    const todos = await listaEnsinado(); if (!todos) return;
    const avisos = todos.filter((c) => c.tipo === "aviso");
    $("tu-lista").innerHTML = avisos.length ? `<div class="linha-tit"><h3>Avisos</h3></div>` + avisos.map(cartaoEnsinado).join("") : `<p class="vazio-p">Nenhum aviso publicado.</p>`;
    ligarAcoes(avisos, telaAvisos);
  }

  // ── Normas e documentos ──
  // ── Normas novas do CONTRAN (detectadas pela rotina diária) ──
  const ROT_DEC = { incluida: "✅ Incluída na base", ja_tem: "✔ Já estava na base", ignorada: "Ignorada" };
  async function cartaoNormas(acao) {
    const alvo = $("tu-normas"); if (!alvo) return;
    alvo.innerHTML = `<div class="cartao"><h4 role="heading" aria-level="2">Normas novas do CONTRAN</h4><p class="vazio-p">${acao ? "Verificando no gov.br…" : "Carregando…"}</p></div>`;
    const r = acao ? await api("/normas/verificar", post({})) : await api("/normas");
    if (!r.ok) { alvo.innerHTML = `<div class="cartao"><h4 role="heading" aria-level="2">Normas novas do CONTRAN</h4><div class="msg err">${esc(r.data?.error || "Não foi possível verificar.")}</div></div>`; return; }
    const itens = r.data.itens || [];
    const pend = itens.filter((x) => !x.decisao);
    alvo.innerHTML = `<div class="cartao tu-normas">
      <h4 role="heading" aria-level="2">Normas novas do CONTRAN ${pend.length ? `<b class="tu-badge">${pend.length} para revisar</b>` : ""}</h4>
      <p class="vazio-p">Todo dia o sistema confere se o CONTRAN publicou resolução nova no gov.br. Abra, leia e decida: incluir na base do bot (entra na hora), marcar que já está na base ou ignorar.</p>
      ${itens.length ? `<ul class="tu-normas-lista">${itens.map((x) => `<li class="${x.decisao ? "feita" : ""}">
        <div><b>${esc(x.titulo)}</b><small>Detectada em ${new Date(x.detectadaEm).toLocaleDateString("pt-BR")}${x.decisao ? ` · ${ROT_DEC[x.decisao.decisao] || x.decisao.decisao}${x.decisao.autor ? ` por ${esc(x.decisao.autor)}` : ""}` : ""}</small></div>
        <div class="tu-acoes">
          <a class="btn soft" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir no gov.br ↗</a>
          ${x.decisao ? `<button class="btn soft" data-n="${x.numero}" data-acao="desfazer">Desfazer</button>` : `<button class="btn pri" data-n="${x.numero}" data-acao="incluir">Incluir na base</button><button class="btn soft" data-n="${x.numero}" data-acao="ja_tem">Já está na base</button><button class="btn soft" data-n="${x.numero}" data-acao="ignorar">Ignorar</button>`}
        </div></li>`).join("")}</ul>` : `<p class="vazio-p">Nenhuma norma nova detectada até agora.</p>`}
      <div class="tu-acoes"><button class="btn soft" id="tu-normas-verif">Verificar agora</button></div></div>`;
    $("tu-normas-verif").onclick = () => cartaoNormas(true);
    alvo.querySelectorAll("[data-acao]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; const t0 = b.textContent; if (b.dataset.acao === "incluir") b.textContent = "Baixando e incluindo…";
      const rr = await api(`/normas/${b.dataset.n}`, post({ acao: b.dataset.acao }));
      if (!rr.ok) { b.disabled = false; b.textContent = t0; return falhou(rr); }
      if (b.dataset.acao === "incluir") msg(rr.data.jaExistia ? "Essa norma já estava na base do bot." : `Incluída na base do bot (${rr.data.trechos} trechos). Já vale para as próximas perguntas.`, "ok");
      if (b.dataset.acao === "incluir") telaDocumentos(); else cartaoNormas(false);
    }));
  }

  // ── Site oficial do DETRAN: páginas acompanhadas e o que mudou (rotina diária) ──
  const ROT_SITE = { revisado: "✅ Base revisada", sem_impacto: "Sem impacto na base" };
  async function cartaoSite(acao) {
    const alvo = $("tu-site"); if (!alvo) return;
    const tit = `<h4 role="heading" aria-level="2">Mudanças no site oficial</h4>`;
    alvo.innerHTML = `<div class="cartao">${tit}<p class="vazio-p">${acao === "verificar" ? "Conferindo as páginas no site do DETRAN…" : "Carregando…"}</p></div>`;
    const r = acao === "verificar" ? await api("/site/verificar", post({})) : await api("/site");
    if (!r.ok) { alvo.innerHTML = `<div class="cartao">${tit}<div class="msg err">${esc(r.data?.error || "Não foi possível carregar.")}</div></div>`; return; }
    const d = r.data, itens = d.itens || [];
    const pend = itens.filter((x) => x.pendente);
    const linhaMud = (x) => {
      if (!x.mudanca) return "";
      if (x.mudanca.pdf) return `<p class="vazio-p">O arquivo PDF foi trocado. Abra e confira.</p>`;
      const lista = (arr, cls, rot) => (arr.length ? `<div class="tu-dif ${cls}"><b>${rot}</b><ul>${arr.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` : "");
      return lista(x.mudanca.entrou, "entrou", "Entrou no site:") + lista(x.mudanca.saiu, "saiu", "Saiu do site:");
    };
    alvo.innerHTML = `<div class="cartao tu-site">
      <h4 role="heading" aria-level="2">Mudanças no site oficial ${pend.length ? `<b class="tu-badge">${pend.length} para revisar</b>` : ""}</h4>
      <p class="vazio-p">Todo dia o sistema confere as páginas abaixo no portal do DETRAN (${esc(d.dominio || "portal não cadastrado")}). Quando o texto muda (taxa, documento, prazo), aparece aqui o que entrou e o que saiu. Confira, ensine ou corrija o bot se precisar, e marque como revisado.</p>
      ${itens.length ? `<ul class="tu-normas-lista">${itens.map((x) => `<li class="${x.pendente ? "" : "feita"}">
        <div style="flex:1;min-width:0"><b>${esc(x.titulo || x.url)}</b>
          <small>${esc(x.url)}</small>
          <small>${x.erro ? `⚠️ ${esc(x.erro)}` : x.verificadoEm ? `Conferida em ${fmtDH(x.verificadoEm)}` : "Ainda não conferida"}${x.mudouEm ? ` · mudou em ${fmtDH(x.mudouEm)}` : ""}${x.decisao ? ` · ${ROT_SITE[x.decisao.decisao] || x.decisao.decisao}${x.decisao.autor ? ` por ${esc(x.decisao.autor)}` : ""}` : ""}</small>
          ${x.semTexto ? `<div class="tu-dif saiu">Esta página é montada por JavaScript: o texto não vem no endereço, e o monitor não consegue comparar. Acompanhe o PDF ou uma página com o texto escrito, ou tire esta.</div>` : ""}
          ${x.pendente ? linhaMud(x) : ""}</div>
        <div class="tu-acoes">
          <a class="btn soft" href="${esc(x.url)}" target="_blank" rel="noopener">Abrir ↗</a>
          ${x.pendente ? `<button class="btn pri" data-url="${esc(x.url)}" data-sa="revisado">Base revisada</button><button class="btn soft" data-url="${esc(x.url)}" data-sa="sem_impacto">Sem impacto</button>` : x.decisao ? `<button class="btn soft" data-url="${esc(x.url)}" data-sa="desfazer">Desfazer</button>` : ""}
          <button class="btn ghost" data-url="${esc(x.url)}" data-sa="tirar" aria-label="Parar de acompanhar ${esc(x.titulo || x.url)}">Tirar</button>
        </div></li>`).join("")}</ul>` : `<p class="vazio-p">Nenhuma página acompanhada.</p>`}
      ${itens.length < (d.max || 20) ? `<div class="tu-linha"><div><label class="f" for="tu-site-url">Acompanhar outra página do portal</label><input id="tu-site-url" class="in" type="url" placeholder="https://www.${esc(d.dominio || "detran.xx.gov.br")}/servicos/..." /></div></div>` : ""}
      <div class="tu-acoes">${itens.length < (d.max || 20) ? `<button class="btn pri" id="tu-site-add">Adicionar página</button>` : ""}<button class="btn soft" id="tu-site-verif">Verificar agora</button></div></div>`;
    $("tu-site-verif").onclick = () => cartaoSite("verificar");
    if ($("tu-site-add")) $("tu-site-add").onclick = async () => {
      const url = $("tu-site-url").value.trim(); if (!url) return $("tu-site-url").focus();
      $("tu-site-add").disabled = true;
      const rr = await api("/site/paginas", post({ url }));
      if (!rr.ok) { $("tu-site-add").disabled = false; return falhou(rr); }
      msg("Página adicionada. A versão de hoje virou a referência.", "ok"); cartaoSite();
    };
    alvo.querySelectorAll("[data-sa]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      const rr = b.dataset.sa === "tirar"
        ? await api("/site/paginas?url=" + encodeURIComponent(b.dataset.url), { method: "DELETE" })
        : await api("/site/decidir", post({ url: b.dataset.url, acao: b.dataset.sa }));
      if (!rr.ok) { b.disabled = false; return falhou(rr); }
      cartaoSite();
    }));
  }

  async function telaDocumentos() {
    $("tu-corpo").innerHTML = `<div id="tu-normas"></div><div id="tu-site"></div><div class="cartao">
      <h4 role="heading" aria-level="2">Enviar norma ou documento</h4>
      <p class="vazio-p">Portaria, instrução normativa, resolução, manual. O texto inteiro entra na base do bot. PDF, DOCX ou TXT de até 4 MB.</p>
      <div class="tu-linha"><div><label class="f" for="doc-arq">Arquivo</label><input id="doc-arq" class="in" type="file" accept=".pdf,.docx,.txt,.md" /></div>
        <div><label class="f" for="doc-base">Base legal (opcional — vai junto de cada trecho)</label><input id="doc-base" class="in" placeholder="Ex.: Portaria DETRAN-PA nº 1.234/2026" /></div></div>
      <div class="tu-acoes"><button class="btn pri" id="doc-ok">Enviar</button></div>
    </div><div id="tu-lista"><div class="vazio-p">Carregando…</div></div>`;
    $("doc-ok").onclick = enviarDoc;
    cartaoNormas(false);
    cartaoSite();
    const r = await api("/documentos");
    if (!r.ok) { $("tu-lista").innerHTML = ""; return falhou(r); }
    const docs = r.data.itens;
    $("tu-lista").innerHTML = docs.length ? `<div class="cartao"><h4 role="heading" aria-level="2">Documentos na base do bot</h4><div style="overflow-x:auto"><table class="tabela"><thead><tr><th>Documento</th><th>Trechos</th><th>Enviado em</th><th></th></tr></thead><tbody>
      ${docs.map((d, k) => `<tr><td>${esc(d.nome)}</td><td>${d.trechos}${d.trechos < d.total ? ` de ${d.total}` : ""}</td><td>${fmtD(d.criado_em)}</td><td><button class="btn perigo mini" data-rm="${k}">Remover</button></td></tr>`).join("")}</tbody></table></div></div>`
      : `<p class="vazio-p">Nenhum documento na base.</p>`;
    $("tu-lista").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.conf !== "1") { b.dataset.conf = "1"; b.textContent = "Confirmar remoção"; setTimeout(() => { if (b.isConnected) { b.dataset.conf = ""; b.textContent = "Remover"; } }, 5000); return; }
      const d = docs[Number(b.dataset.rm)];
      b.disabled = true;
      const r = await api("/documentos?nome=" + encodeURIComponent(d.nome), { method: "DELETE" });
      if (!r.ok) { b.disabled = false; return falhou(r); }
      msg(`Removido: ${d.nome} — o bot deixou de usar.`, "ok"); telaDocumentos();
    }));
  }
  async function enviarDoc() {
    const f = $("doc-arq").files[0];
    if (!f) return msg("Escolha o arquivo.");
    if (f.size > 4 * 1024 * 1024) return msg("Arquivo maior que 4 MB. Divida o PDF ou envie em TXT.");
    $("doc-ok").disabled = true; $("doc-ok").textContent = "Enviando…";
    try {
      const res = await fetch((window.API_BASE || "/api/t/" + (window.TENANT || {}).slug) + "/gestao/tutoria/documentos", {
        method: "POST", body: f,
        headers: { Authorization: "Bearer " + Sessao.token(), "Content-Type": "application/octet-stream", "X-Nome-Arquivo": encodeURIComponent(f.name), "X-Base-Legal": encodeURIComponent($("doc-base").value.trim()) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return falhou({ data });
      msg(`Enviado: ${data.nome} (${data.trechos} trechos)${data.truncado ? " — documento muito longo, parte final não entrou; divida em partes." : ""}.`, "ok");
      telaDocumentos();
    } finally { if ($("doc-ok")) { $("doc-ok").disabled = false; $("doc-ok").textContent = "Enviar"; } }
  }

  // Vindo do Observatório: abre "Ensinar" já com a pergunta que ficou sem resposta.
  let pendente = null;
  async function ensinarCom(pergunta) {
    pendente = String(pergunta || "");
    aba = "ensinar";
    await carregar();
    if (pendente && $("tu-perg")) { $("tu-perg").value = pendente; $("tu-resp")?.focus(); }
    pendente = null;
  }
  window.TutoriaGestao = { carregar, ensinarCom };
})();
