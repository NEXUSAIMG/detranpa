// "Meus pedidos": conta rápida do cidadão (código no WhatsApp, sem senha).
(function () {
  const API = (p) => `${window.API_BASE}/conta${p || ""}`;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const data = (d) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
  const dataHora = (d) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const mostrar = (id, sim) => $(id).classList.toggle("hidden", !sim);
  const aviso = (id, txt, tipo = "err") => { const e = $(id); e.textContent = txt || ""; e.className = `msg ${tipo}${txt ? "" : " hidden"}`; };

  async function chamar(caminho, corpo) {
    try {
      const r = await fetch(API(caminho), corpo === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      let d = {}; try { d = await r.json(); } catch { d = {}; }
      return { ok: r.ok, status: r.status, data: d };
    } catch { return { ok: false, status: 0, data: { error: "Sem conexão. Confira a internet e tente de novo." } }; }
  }

  // ── Entrar ──
  let telefone = "";
  $("f-tel").onsubmit = async (ev) => {
    ev.preventDefault(); aviso("m-entrar", "");
    telefone = $("tel").value;
    if (telefone.replace(/\D/g, "").length < 10) { aviso("m-entrar", "Informe o WhatsApp com DDD."); return $("tel").focus(); }
    const b = $("b-cod"); b.disabled = true; b.textContent = "Enviando…";
    const r = await chamar("/codigo", { telefone });
    b.disabled = false; b.textContent = "Receber código";
    if (!r.ok) {
      aviso("m-entrar", r.data.error || "Não consegui mandar o código agora.");
      if (r.data.semWhatsApp) { mostrar("entrar", false); mostrar("consulta", true); }
      return;
    }
    $("enviado").textContent = `Mandamos o código para o WhatsApp ${r.data.enviadoPara}. Ele vale por ${r.data.validadeMin} minutos.`;
    mostrar("f-tel", false); mostrar("f-cod", true); $("cod").value = ""; $("cod").focus();
  };
  $("b-outro").onclick = () => { mostrar("f-cod", false); mostrar("f-tel", true); aviso("m-entrar", ""); $("tel").focus(); };
  $("f-cod").onsubmit = async (ev) => {
    ev.preventDefault(); aviso("m-entrar", "");
    const codigo = $("cod").value.replace(/\D/g, "");
    if (codigo.length !== 6) { aviso("m-entrar", "O código tem 6 números."); return $("cod").focus(); }
    const b = $("b-entrar"); b.disabled = true;
    const r = await chamar("/entrar", { telefone, codigo });
    b.disabled = false;
    if (!r.ok) { aviso("m-entrar", r.data.error || "Não foi possível entrar."); if (r.status === 429) $("b-outro").click(); return; }
    carregar();
  };
  $("cod").oninput = () => { if ($("cod").value.replace(/\D/g, "").length === 6) $("f-cod").requestSubmit(); };

  // ── Consulta simples (sem conta) ──
  $("f-cons").onsubmit = async (ev) => {
    ev.preventDefault();
    const out = $("r-cons");
    const r = await chamar("/consultar", { protocolo: $("c-prot").value.trim().toUpperCase(), telefone: $("c-tel").value });
    if (!r.ok) { out.innerHTML = `<div class="msg err">${esc(r.data.error || "Não foi possível consultar.")}</div>`; return; }
    const p = r.data;
    out.innerHTML = `<div class="msg ok"><div class="num">${esc(p.protocolo)}</div><div>${esc(p.assunto)}</div>
      <div>Situação: <b>${esc(p.statusTexto)}</b>${p.prazoEm ? ` · Previsão: ${data(p.prazoEm)}` : ""}</div>
      <small>Última atualização em ${dataHora(p.atualizadoEm)}.</small>
      ${p.aguardandoVoce ? `<p>O ${esc(window.TENANT?.sigla || "DETRAN")} está aguardando uma resposta sua. Entre com o seu WhatsApp acima para ver o pedido e responder.</p>` : ""}</div>`;
  };

  // ── Logado ──
  function selo(p) {
    const cls = p.aguardandoVoce ? "voce" : p.status === "RESOLVIDO" ? "fim" : p.status === "CANCELADO" ? "cancel" : "";
    return `<span class="selo ${cls}">${p.aguardandoVoce ? "⚠️ " : ""}${esc(p.statusTexto)}</span>`;
  }
  function cartaoPedido(p, i) {
    const linha = p.eventos.length
      ? `<ol class="linha">${p.eventos.map((e) => `<li class="${e.deVoce ? "voce" : ""}"><small>${dataHora(e.em)}${e.deVoce ? " · você" : ""}</small><div class="txt">${esc(e.texto)}</div></li>`).join("")}</ol>`
      : `<p class="suave">Ainda sem atualizações.</p>`;
    const resp = p.aberto ? `
      <form class="f-msg" data-p="${esc(p.protocolo)}" novalidate>
        <label for="m-${i}">${p.aguardandoVoce ? "Responder ao pedido do " + esc(window.TENANT?.sigla || "DETRAN") : "Mandar mensagem ou documento"}</label>
        <textarea id="m-${i}" rows="3" maxlength="1500"></textarea>
        <label for="a-${i}">Documentos (fotos ou PDF, até 4)</label>
        <input id="a-${i}" type="file" accept="image/*,application/pdf" multiple />
        <ul class="arqs"></ul>
        <div class="acoes"><button class="btn" type="submit">Enviar</button></div>
        <div class="msg hidden" role="alert"></div>
      </form>` : "";
    return `<details class="cartao pedido" ${p.aguardandoVoce || i === 0 ? "open" : ""}>
      <summary><div style="flex:1"><div class="num">${esc(p.protocolo)}</div><h3>${esc(p.assunto)}</h3>
        <small class="suave">Aberto em ${data(p.criadoEm)}${p.aberto && p.prazoEm ? ` · previsão ${data(p.prazoEm)}` : ""}${p.resolvidoEm ? ` · encerrado em ${data(p.resolvidoEm)}` : ""}</small></div>${selo(p)}</summary>
      <div class="corpo">${linha}${resp}</div></details>`;
  }
  function cartaoJornadas(js) {
    if (!js.length) return "";
    return `<section class="cartao" aria-labelledby="t-jor"><h2 id="t-jor">Acompanhamentos no WhatsApp</h2>
      ${js.map((j) => `<div class="jor"><span aria-hidden="true" style="font-size:22px">${esc(j.icone || "📋")}</span><div style="flex:1"><b>${esc(j.titulo)}</b>
        <div class="suave">${j.concluida ? (j.protocolo ? `Concluído e protocolado: ${esc(j.protocolo)}` : "Concluído. Para protocolar, escreva PROTOCOLAR no WhatsApp.") : `Etapa ${j.atual} de ${j.total}: ${esc(j.etapa)}`}</div>
        ${(j.prazos || []).map((p) => `<div class="suave">📅 ${esc(p.rotulo)}: <b>${esc(p.dataBR)}</b></div>`).join("")}
        <div class="barra" aria-hidden="true"><span style="width:${Math.round((j.atual / Math.max(1, j.total)) * 100)}%"></span></div></div></div>`).join("")}</section>`;
  }

  // Foto grande vira JPEG de até 1600 px (cabe no limite de envio).
  function reduzirFoto(f) {
    return new Promise((ok, falha) => {
      const img = new Image(); const url = URL.createObjectURL(f);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        const b64 = c.toDataURL("image/jpeg", 0.82);
        ok({ nome: f.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: b64, bytes: Math.round((b64.length - 23) * 0.75) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); falha(new Error(`"${f.name}": não consegui abrir a foto.`)); };
      img.src = url;
    });
  }
  function lerPdf(f) {
    return new Promise((ok, falha) => {
      if (f.size > 2_500_000) return falha(new Error(`"${f.name}" passa de 2,5 MB.`));
      const r = new FileReader(); r.onload = () => ok({ nome: f.name, mime: f.type, base64: r.result, bytes: f.size }); r.onerror = () => falha(new Error("Não consegui ler o arquivo.")); r.readAsDataURL(f);
    });
  }
  function ligarFormularios() {
    document.querySelectorAll(".f-msg").forEach((form) => {
      let arquivos = [];
      const out = form.querySelector(".msg"), lista = form.querySelector(".arqs"), entrada = form.querySelector("input[type=file]");
      const erro = (t) => { out.textContent = t || ""; out.className = `msg err${t ? "" : " hidden"}`; };
      const listar = () => {
        lista.innerHTML = arquivos.map((a, i) => `<li>${a.mime === "application/pdf" ? "📄" : "🖼️"} ${esc(a.nome)} <button type="button" class="linklike" data-i="${i}">remover</button></li>`).join("");
        lista.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { arquivos.splice(Number(b.dataset.i), 1); listar(); }));
      };
      entrada.onchange = async () => {
        erro("");
        for (const f of [...entrada.files]) {
          if (arquivos.length >= 4) { erro("No máximo 4 arquivos por vez."); break; }
          try {
            if (!/^image\//.test(f.type) && f.type !== "application/pdf") throw new Error(`"${f.name}": envie foto ou PDF.`);
            arquivos.push(/^image\//.test(f.type) ? await reduzirFoto(f) : await lerPdf(f));
          }
          catch (e) { erro(e.message); }
        }
        entrada.value = ""; listar();
      };
      form.onsubmit = async (ev) => {
        ev.preventDefault(); erro("");
        const texto = form.querySelector("textarea").value.trim();
        if (!texto && !arquivos.length) return erro("Escreva a mensagem ou junte um documento.");
        if (arquivos.reduce((s, a) => s + a.bytes, 0) > 4_000_000) return erro("Os arquivos juntos passam de 4 MB. Remova algum.");
        const b = form.querySelector("button[type=submit]"); b.disabled = true; b.textContent = "Enviando…";
        const r = await chamar(`/pedidos/${encodeURIComponent(form.dataset.p)}/mensagem`, { texto, anexos: arquivos.map(({ nome, mime, base64 }) => ({ nome, mime, base64 })) });
        b.disabled = false; b.textContent = "Enviar";
        if (r.status === 401) return carregar();
        if (!r.ok) return erro(r.data.error || "Não foi possível enviar.");
        carregar(`Enviado. O pedido ${form.dataset.p} está: ${r.data.statusTexto}.`);
      };
    });
  }

  async function carregar(okMsg) {
    mostrar("carregando", true);
    const r = await chamar("");
    mostrar("carregando", false);
    if (!r.ok) { $("carregando").textContent = r.data.error || "Não foi possível carregar."; return mostrar("carregando", true); }
    const d = r.data;
    if (!d.logado) {
      mostrar("conta", false); mostrar("consulta", true);
      mostrar("entrar", d.entrarPorWhatsApp);
      if (d.entrarPorWhatsApp) { mostrar("f-tel", true); mostrar("f-cod", false); }
      return;
    }
    mostrar("entrar", false); mostrar("consulta", false); mostrar("conta", true);
    $("fone").textContent = d.telefone;
    $("lista").innerHTML = (okMsg ? `<div class="msg ok" role="status">${esc(okMsg)}</div>` : "")
      + (d.pedidos.length ? d.pedidos.map(cartaoPedido).join("") : `<div class="cartao"><p>Ainda não há pedidos com este número.</p><p class="suave">Para começar, volte ao assistente e escolha o serviço: no fim do passo a passo dá para protocolar o pedido.</p></div>`);
    $("jornadas").innerHTML = cartaoJornadas(d.jornadas || []);
    ligarFormularios();
  }
  $("b-atualizar").onclick = () => carregar();
  $("b-sair").onclick = async () => { await chamar("/sair", {}); carregar(); };
  $("b-sair-todos").onclick = async () => { await chamar("/sair", { todos: true }); carregar(); };
  carregar();
})();
