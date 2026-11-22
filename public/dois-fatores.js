// Verificação em duas etapas (código de 6 dígitos do aplicativo autenticador).
// Usado pelo login das áreas internas (sessao.js) e do /admin (admin.js).
(function () {
  if (window.DoisFatores) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const post = async (url, body, token) => {
    const h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token;
    const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body || {}) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  };
  const get = async (url, token) => {
    const r = await fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  };

  // Janela simples, acessível (foco no campo, Esc fecha, leitor de tela anuncia).
  function janela(titulo, corpoHtml) {
    const fundo = document.createElement("div");
    fundo.style.cssText = "position:fixed;inset:0;background:rgba(10,21,73,.55);z-index:9999;display:grid;place-items:center;padding:16px";
    fundo.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="df-tit" style="background:#fff;color:#1B2236;max-width:420px;width:100%;border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.3);font:15px/1.5 system-ui,sans-serif">
      <h2 id="df-tit" style="margin:0 0 8px;font-size:18px;color:#192662">${esc(titulo)}</h2>${corpoHtml}
      <p id="df-msg" role="alert" style="min-height:20px;margin:8px 0 0;color:#B3261E;font-size:13.5px"></p></div>`;
    document.body.appendChild(fundo);
    const caixa = fundo.firstElementChild;
    const fechar = () => fundo.remove();
    fundo.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
    return { caixa, fechar, msg: (t) => { caixa.querySelector("#df-msg").textContent = t || ""; } };
  }
  const campoCodigo = `<label for="df-cod" style="display:block;font-weight:600;margin:12px 0 4px">Código de 6 dígitos</label>
    <input id="df-cod" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" style="width:100%;font-size:24px;letter-spacing:6px;text-align:center;padding:10px;border:1px solid #C9D2E0;border-radius:10px" />
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" id="df-canc" style="padding:9px 14px;border-radius:10px;border:1px solid #C9D2E0;background:#fff;cursor:pointer">Cancelar</button>
    <button type="button" id="df-ok" style="padding:9px 16px;border-radius:10px;border:0;background:#192662;color:#fff;font-weight:600;cursor:pointer">Confirmar</button></div>`;

  // Pede o código e chama `enviar(codigo)` até dar certo ou a pessoa cancelar.
  function pedirCodigo(titulo, introHtml, enviar) {
    return new Promise((resolve) => {
      const j = janela(titulo, introHtml + campoCodigo);
      const inp = j.caixa.querySelector("#df-cod"), ok = j.caixa.querySelector("#df-ok");
      setTimeout(() => inp.focus(), 30);
      const ir = async () => {
        const c = inp.value.replace(/\D/g, "");
        if (c.length !== 6) return j.msg("Digite os 6 números do aplicativo.");
        ok.disabled = true; const r = await enviar(c); ok.disabled = false;
        if (r.ok) { j.fechar(); resolve(r); } else { j.msg(r.data.error || "Código incorreto."); inp.select(); }
      };
      ok.onclick = ir; inp.onkeydown = (e) => { if (e.key === "Enter") ir(); };
      j.caixa.querySelector("#df-canc").onclick = () => { j.fechar(); resolve({ ok: false, status: 0, data: { error: "Login cancelado." } }); };
    });
  }
  const instrucoesCadastro = (segredo, uri) => `<ol style="padding-left:18px;margin:6px 0">
      <li>Instale no celular um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar).</li>
      <li>No celular, <a href="${esc(uri)}">toque aqui para adicionar</a>, ou no aplicativo escolha <b>“Inserir chave de configuração”</b> e digite:</li></ol>
    <div style="font:600 17px/1.4 ui-monospace,monospace;background:#F1F5F9;border-radius:10px;padding:10px;text-align:center;word-break:break-all;user-select:all">${esc(segredo.replace(/(.{4})/g, "$1 ").trim())}</div>
    <p style="margin:8px 0 0;font-size:13.5px">3. Digite o código que o aplicativo mostrar.</p>`;

  // Depois de usuário+senha: conclui a 2ª etapa (ou o cadastro obrigatório).
  async function concluirLogin(resp, baseAuth) {
    const d = resp.data || {};
    if (d.precisa2fa) {
      return pedirCodigo("Verificação em duas etapas", `<p style="margin:0">Abra o aplicativo autenticador e digite o código do <b>Assistente DETRAN</b>.</p>`,
        (codigo) => post(baseAuth + "/2fa", { desafio: d.desafio, codigo }));
    }
    if (d.precisaCadastrar2fa) {
      const ini = await post(baseAuth + "/2fa/iniciar", { desafio: d.desafio });
      if (!ini.ok) return ini;
      const fim = await pedirCodigo("Ative a verificação em duas etapas", `<p style="margin:0 0 6px">Para o seu perfil, ela é obrigatória. Leva 1 minuto:</p>` + instrucoesCadastro(ini.data.segredo, ini.data.uri),
        (codigo) => post(baseAuth + "/2fa/ativar", { desafio: d.desafio, codigo }));
      return fim.ok ? { ok: true, status: 200, data: { token: fim.data.token, usuario: d.usuario } } : fim;
    }
    return resp;
  }

  // Botão "Verificação em duas etapas" dentro das áreas (ativar/desativar).
  async function configurar(baseAuth, token) {
    const st = await get(baseAuth + "/2fa/estado", token);
    if (!st.ok) return alertar(st.data.error || "Não foi possível consultar agora.");
    if (!st.data.ativo) {
      const ini = await post(baseAuth + "/2fa/iniciar", {}, token);
      if (!ini.ok) return alertar(ini.data.error);
      const r = await pedirCodigo("Ativar verificação em duas etapas", `<p style="margin:0 0 6px">Depois de ativar, o login vai pedir também um código do celular.</p>` + instrucoesCadastro(ini.data.segredo, ini.data.uri),
        (codigo) => post(baseAuth + "/2fa/ativar", { codigo }, token));
      if (r.ok) alertar("Pronto! A verificação em duas etapas está ativa.", true);
      return;
    }
    if (st.data.obrigatorio) return alertar("A verificação em duas etapas está ativa e é obrigatória para o seu perfil.", true);
    const r = await pedirCodigo("Desativar verificação em duas etapas", `<p style="margin:0">Ativa desde ${esc(new Date(st.data.desde).toLocaleDateString("pt-BR"))}. Para desativar, confirme com um código.</p>`,
      (codigo) => post(baseAuth + "/2fa/desativar", { codigo }, token));
    if (r.ok) alertar("Verificação em duas etapas desativada.", true);
  }
  function alertar(texto, ok) {
    const j = janela(ok ? "Tudo certo" : "Atenção", `<p style="margin:0">${esc(texto)}</p><div style="text-align:right;margin-top:14px"><button type="button" id="df-fim" style="padding:9px 16px;border-radius:10px;border:0;background:#192662;color:#fff;font-weight:600;cursor:pointer">OK</button></div>`);
    const b = j.caixa.querySelector("#df-fim"); b.onclick = j.fechar; setTimeout(() => b.focus(), 30);
  }

  window.DoisFatores = { concluirLogin, configurar };
})();
