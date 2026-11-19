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
  async function entrar(login, senha, area) {
    const r = await api("/auth/login", { method: "POST", body: JSON.stringify({ login, senha, area }) });
    if (r.ok && r.data.token) set(r.data.token);
    return r;
  }
  async function valida(area) {
    if (!get()) return false;
    const r = await api("/auth/eu?area=" + encodeURIComponent(area));
    if (!r.ok) set("");
    return r.ok;
  }
  window.Sessao = { api, entrar, valida, sair: () => set(""), token: get, base: window.TENANT_BASE || "/" + (T.slug || "pa") };
})();
