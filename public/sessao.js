// Sessão das áreas internas (Tutor, Balcão, Painel) por DETRAN.
// Login por usuário e senha; o token fica só nesta aba (sessionStorage).
(function () {
  const T = window.TENANT || {};
  const BASE = window.API_BASE || "/api/t/" + (T.slug || "pa");
  const CHAVE = "detran_" + (T.slug || "pa") + "_token";
  const get = () => { try { return sessionStorage.getItem(CHAVE) || ""; } catch (_) { return ""; } };
  const set = (v) => { try { v ? sessionStorage.setItem(CHAVE, v) : sessionStorage.removeItem(CHAVE); } catch (_) {} };

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    const tok = get();
    if (tok) headers.Authorization = "Bearer " + tok;
    const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }
  // Carrega a verificação em duas etapas só quando for preciso.
  const carregar2fa = () => window.DoisFatores ? Promise.resolve() : new Promise((ok, erro) => {
    const s = document.createElement("script"); s.src = "/dois-fatores.js"; s.onload = ok; s.onerror = erro; document.head.appendChild(s);
  });
  async function entrar(login, senha, area) {
    let r = await api("/auth/login", { method: "POST", body: JSON.stringify({ login, senha, area }) });
    if (r.ok && (r.data.precisa2fa || r.data.precisaCadastrar2fa)) {
      try { await carregar2fa(); r = await window.DoisFatores.concluirLogin(r, BASE + "/auth"); }
      catch (_) { r = { ok: false, status: 0, data: { error: "Não foi possível abrir a verificação em duas etapas." } }; }
    }
    if (r.ok && r.data.token) set(r.data.token);
    return r;
  }
  async function duasEtapas() { await carregar2fa(); return window.DoisFatores.configurar(BASE + "/auth", get()); }
  async function valida(area) {
    if (!get()) return false;
    const r = await api("/auth/eu?area=" + encodeURIComponent(area));
    if (!r.ok) set("");
    return r.ok;
  }
  window.Sessao = { api, entrar, valida, duasEtapas, sair: () => set(""), token: get, base: window.TENANT_BASE || "/" + (T.slug || "pa") };
})();
