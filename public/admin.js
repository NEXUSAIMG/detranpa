// Administração: /admin (equipe Ayio, todos os DETRANs) ou /<uf>/admin (admin do DETRAN).
const $ = (id) => document.getElementById(id);
const GERAL = Boolean(window.ADMIN_GERAL);
const TOKEN_KEY = "detran_admin_geral_token";
let slugAtual = GERAL ? null : (window.TENANT || {}).slug;
let souSuper = false;
let tenantsCache = [];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const msg = (el, text, tipo = "err") => { $(el).innerHTML = text ? `<div class="msg ${tipo}">${esc(text)}</div>` : ""; };
const dt = (v) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

// Token: na área geral fica numa chave própria; no DETRAN usa a sessão do DETRAN.
const tokGet = () => { try { return GERAL ? sessionStorage.getItem(TOKEN_KEY) || "" : Sessao.token(); } catch (_) { return ""; } };
const tokSet = (v) => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch (_) {} };
async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  const t = tokGet();
  if (t) headers.Authorization = "Bearer " + t;
  const r = await fetch(path, Object.assign({}, opts, { headers }));
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
const tApi = (p, opts) => api(`/api/t/${slugAtual}/admin${p}`, opts);
const corpo = (o) => ({ method: "POST", body: JSON.stringify(o) });
const put = (o) => ({ method: "PUT", body: JSON.stringify(o) });

// ── Login ──
if (GERAL) { $("login-titulo").textContent = "Administração geral (equipe Ayio)"; $("login-sub").textContent = "Cadastro e gestão de todos os DETRANs."; }
else { $("login-sub").textContent = `${(window.TENANT || {}).sigla || ""} — apenas administradores.`; }

$("l-ok").onclick = entrar;
$("l-pwd").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
async function entrar() {
  const login = $("l-user").value.trim(), senha = $("l-pwd").value;
  if (!login || !senha) return msg("l-msg", "Informe usuário e senha.");
  $("l-ok").disabled = true;
  let r;
  if (GERAL) { r = await api("/api/admin/login", corpo({ login, senha })); if (r.ok) tokSet(r.data.token); }
  else r = await Sessao.entrar(login, senha, "admin");
  $("l-ok").disabled = false;
  if (!r.ok) return msg("l-msg", r.data.error || "Não foi possível entrar.");
  iniciar();
}
$("sair").onclick = () => { if (GERAL) tokSet(""); else Sessao.sair(); location.reload(); };

async function iniciar() {
  $("login").classList.add("hidden"); $("sair").classList.remove("hidden");
  if (GERAL) { souSuper = true; await mostrarLista(); }
  else await abrirTenant(slugAtual);
}

// ── Lista de DETRANs ──
async function mostrarLista() {
  $("detalhe").classList.add("hidden"); $("voltar").classList.add("hidden"); $("lista").classList.remove("hidden");
  const r = await api("/api/admin/tenants");
  if (!r.ok) { if (r.status === 401) { tokSet(""); location.reload(); } return; }
  tenantsCache = r.data.tenants || [];
  const pill = (ok, txt) => `<span class="pill ${ok ? "ok" : "no"}">${txt}</span>`;
  $("lista-corpo").innerHTML = tenantsCache.map((t) => `<tr class="click" data-slug="${esc(t.slug)}">
    <td><span class="lst-marca"><img src="${esc(t.marca || "")}" alt="" loading="lazy" /></span><b>/${esc(t.slug)}</b>${t.ativo ? "" : ' <span class="pill no">inativo</span>'}${t.demonstracao ? ' <span class="pill">demonstração</span>' : ""}</td><td>${esc(t.sigla)}<div class="hint">${esc(t.nome)}</div></td>
    <td>${pill(t.integracoes.botayio, "Bot")}${pill(t.integracoes.tutoria, "Tutoria")}${pill(t.integracoes.zapayio, "WhatsApp")}</td>
    <td>${t.usuarios}</td><td>${t.formularios}</td><td>${t.conversas}</td></tr>`).join("") || '<tr><td colspan="6">Nenhum DETRAN cadastrado.</td></tr>';
  document.querySelectorAll("#lista-corpo tr.click").forEach((tr) => (tr.onclick = () => abrirTenant(tr.dataset.slug)));
  $("n-copiar-forms").innerHTML = '<option value="">— nenhum —</option>' + tenantsCache.map((t) => `<option value="${esc(t.slug)}">${esc(t.sigla)}</option>`).join("");
  carregarRede();
}

// ── Rede de DETRANs (equipe Ayio) ──
async function carregarRede() {
  if (!$("rede-tab")) return;
  const r = await api(`/api/admin/rede?dias=${$("rede-dias").value}`);
  if (!r.ok) { $("rede-resumo").innerHTML = `<div class="msg err">${esc(r.data.error || "Não foi possível carregar a rede.")}</div>`; return; }
  const R = r.data.resumo, f = (v, s = "") => (v == null ? "—" : `${v}${s}`);
  const caixa = (rot, v) => `<div><small>${rot}</small><b>${v}</b></div>`;
  $("rede-resumo").innerHTML = caixa("Estados com movimento", `${R.comMovimento}/${R.estados}`) + caixa("Perguntas", R.perguntas)
    + caixa("Sem resposta (média)", f(R.taxaSemBase, "%")) + caixa("Para atendente (média)", f(R.taxaTransbordo, "%"))
    + caixa("Satisfação (média)", f(R.satisfacao, "%")) + caixa("Golpes conferidos", R.golpes);
  const linhas = r.data.detrans.slice().sort((a, b) => b.perguntas - a.perguntas);
  const ruim = (v, lim) => (v != null && v >= lim ? ' class="rede-alerta"' : "");
  $("rede-tab").innerHTML = `<thead><tr><th>DETRAN</th><th>Perguntas</th><th>Conversas</th><th>Sem resposta</th><th>Para atendente</th><th>Satisfação</th><th>Nota do atendimento</th><th>Espera (mediana)</th><th>WhatsApp</th><th>Golpes</th></tr></thead><tbody>`
    + linhas.map((d) => `<tr><td><b>${esc(d.sigla)}</b>${d.demonstracao ? ' <span class="pill">demo</span>' : ""}</td><td>${d.perguntas}</td><td>${d.conversas}</td>
      <td${ruim(d.taxaSemBase, 15)}>${f(d.taxaSemBase, "%")}</td><td>${f(d.taxaTransbordo, "%")}</td><td>${f(d.satisfacao, "%")}</td>
      <td>${f(d.notaAtendimento)}</td><td${ruim(d.esperaMediana, 30)}>${f(d.esperaMediana, " min")}</td><td>${f(d.whatsapp, "%")}</td><td>${d.golpes}${d.golpesProvaveis ? ` <small>(${d.golpesProvaveis} golpe)</small>` : ""}</td></tr>`).join("") + "</tbody>";
}
if ($("rede-dias")) $("rede-dias").onchange = carregarRede;
$("voltar").onclick = mostrarLista;

$("n-ok").onclick = async () => {
  const b = { slug: $("n-slug").value.trim().toLowerCase(), uf: $("n-uf").value.trim(), sigla: $("n-sigla").value.trim(), assistente: $("n-assistente").value.trim(),
    nome: $("n-nome").value.trim(), governo: $("n-governo").value.trim(), cidadeSede: $("n-cidade").value.trim(), telefone: $("n-telefone").value.trim(),
    portalUrl: $("n-portal").value.trim(), copiarFormulariosDe: $("n-copiar-forms").value || undefined };
  $("n-ok").disabled = true;
  const r = await api("/api/admin/tenants", corpo(b));
  $("n-ok").disabled = false;
  if (!r.ok) return msg("n-msg", r.data.error || "Erro ao criar.");
  msg("n-msg", `DETRAN criado${r.data.formulariosCopiados ? ` com ${r.data.formulariosCopiados} formulários` : ""}.`, "ok");
  ["n-slug", "n-uf", "n-sigla", "n-assistente", "n-nome", "n-governo", "n-cidade", "n-telefone", "n-portal"].forEach((id) => ($(id).value = ""));
  await mostrarLista();
};

// ── Um DETRAN ──
const CAMPOS = ["sigla", "uf", "assistente", "telefone", "nome", "governo", "cidadeSede", "portalUrl", "logoUrl", "marcaUrl", "personaTom", "orientacoes"];
async function abrirTenant(slug) {
  slugAtual = slug;
  const r = await tApi("");
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) { if (GERAL) tokSet(""); else Sessao.sair(); location.reload(); }
    return;
  }
  souSuper = r.data.super;
  const t = r.data.tenant;
  $("lista").classList.add("hidden"); $("detalhe").classList.remove("hidden");
  if (GERAL) $("voltar").classList.remove("hidden");
  $("eyebrow").textContent = t.sigla;
  $("d-titulo").textContent = `${t.sigla} — /${t.slug}`;
  $("d-sub").textContent = t.nome;
  $("ver-site").href = r.data.linkDemo || `/${t.slug}`;
  $("demo-link").classList.toggle("hidden", !r.data.linkDemo);
  $("demo-url").value = r.data.linkDemo ? location.origin + r.data.linkDemo : "";
  $("demo-copiar").onclick = () => { $("demo-url").select(); navigator.clipboard?.writeText($("demo-url").value); $("demo-copiar").textContent = "Copiado ✓"; setTimeout(() => ($("demo-copiar").textContent = "Copiar"), 1500); };
  $("sim-link").classList.toggle("hidden", !r.data.linkSim);
  $("sim-url").value = r.data.linkSim ? location.origin + r.data.linkSim : "";
  $("sim-copiar").onclick = () => { $("sim-url").select(); navigator.clipboard?.writeText($("sim-url").value); $("sim-copiar").textContent = "Copiado ✓"; setTimeout(() => ($("sim-copiar").textContent = "Copiar"), 1500); };
  CAMPOS.forEach((c) => ($(`t-${c}`).value = t[c] || ""));
  $("t-conteudo").value = JSON.stringify(t.conteudo || {}, null, 2);
  $("t-ativo-wrap").classList.toggle("hidden", !souSuper); $("t-ativo").checked = t.ativo;
  $("t-demo-wrap").classList.toggle("hidden", !souSuper); $("t-demonstracao").checked = Boolean(t.demonstracao);
  CORES.forEach((c) => { $(`t-${c}`).value = t[c] || ""; sincronizarCor(c); });
  mostrarImagens(t.imagens);
  msg("img-msg", "");
  mostrarIntegracao(r.data.integracao);
  trocarAba("dados");
}

document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => trocarAba(b.dataset.aba)));
function trocarAba(aba) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.aba === aba));
  ["dados", "integ", "usuarios", "forms"].forEach((a) => $(`aba-${a}`).classList.toggle("hidden", a !== aba));
  if (aba === "usuarios") carregarUsuarios();
  if (aba === "forms") carregarForms();
  if (aba === "integ") carregarMeuDetran();
}

// ── Meu DETRAN com dados oficiais (API do DETRAN + gov.br) ──
async function carregarMeuDetran() {
  const r = await tApi("/meu-detran");
  if (!r.ok) return msg("md-msg", r.data.error || "Não foi possível carregar.");
  const s = r.data;
  $("md-modo").value = s.modo; $("md-api").value = s.apiUrl || ""; $("md-amb").value = s.govbrAmbiente; $("md-cid").value = s.govbrClientId || "";
  $("md-token").placeholder = s.api ? "cadastrado — deixe em branco para manter" : "não cadastrado";
  $("md-csec").placeholder = s.govbr ? "cadastrado — deixe em branco para manter" : "não cadastrado";
  $("md-pill").innerHTML = `<span class="pill ${s.pronto ? "ok" : "no"}">${s.pronto ? "ligado" : s.modo === "api" ? "incompleto" : "desligado"}</span>`;
  $("md-retorno").textContent = `URL de retorno para cadastrar no gov.br: ${location.origin}/api/t/${slugAtual}/govbr/retorno`;
}
$("md-ok").onclick = async () => {
  const b = { modo: $("md-modo").value, apiUrl: $("md-api").value.trim(), govbrAmbiente: $("md-amb").value, govbrClientId: $("md-cid").value.trim() };
  if ($("md-token").value) b.apiToken = $("md-token").value;
  if ($("md-csec").value) b.govbrClientSecret = $("md-csec").value;
  const r = await tApi("/meu-detran", put(b));
  $("md-token").value = ""; $("md-csec").value = "";
  if (!r.ok) return msg("md-msg", r.data.error || "Erro ao salvar.");
  msg("md-msg", r.data.pronto ? "Salvo e ligado: o botão “Entrar com gov.br” aparece no site." : r.data.modo === "api" ? "Salvo, mas ainda falta URL/token da API ou as credenciais do gov.br." : "Salvo (desligado).", "ok");
  carregarMeuDetran();
};

$("dados-ok").onclick = async () => {
  const b = {};
  CAMPOS.forEach((c) => (b[c] = $(`t-${c}`).value));
  try { b.conteudo = JSON.parse($("t-conteudo").value || "{}"); } catch (_) { return msg("dados-msg", "O conteúdo da tela não é um JSON válido."); }
  CORES.forEach((c) => (b[c] = $(`t-${c}`).value.trim()));
  if (souSuper) { b.ativo = $("t-ativo").checked; b.demonstracao = $("t-demonstracao").checked; }
  const r = await tApi("/dados", put(b));
  if (!r.ok) return msg("dados-msg", r.data.error || "Erro ao salvar.");
  msg("dados-msg", "Dados salvos. O site atualiza em até 1 minuto.", "ok");
};

// ── Identidade visual: cores e imagens ──
const CORES = ["corPrimaria", "corDestaque"];
const HEX = /^#[0-9a-fA-F]{6}$/;
function sincronizarCor(c) {
  const v = $(`t-${c}`).value.trim();
  $(`t-${c}-pick`).value = HEX.test(v) ? v : (c === "corPrimaria" ? "#192662" : "#14AD92");
}
CORES.forEach((c) => {
  $(`t-${c}-pick`).addEventListener("input", (e) => ($(`t-${c}`).value = e.target.value.toUpperCase()));
  $(`t-${c}`).addEventListener("input", () => sincronizarCor(c));
});
function mostrarImagens(im = {}) {
  ["logo", "marca"].forEach((tipo) => { $(`img-${tipo}`).src = im[tipo] || ""; });
}
document.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => $(`up-${b.dataset.up}`).click()));
["logo", "marca"].forEach((tipo) => {
  $(`up-${tipo}`).addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return msg("img-msg", "Use uma imagem PNG, JPG ou WEBP.");
    if (f.size > 600 * 1024) return msg("img-msg", "A imagem deve ter até 600 KB.");
    const leitor = new FileReader();
    leitor.onload = async () => {
      msg("img-msg", "Enviando…", "ok");
      const r = await tApi(`/arquivo/${tipo}`, put({ dataUrl: leitor.result }));
      if (!r.ok) return msg("img-msg", r.data.error || "Não foi possível enviar.");
      mostrarImagens(r.data.imagens);
      $(`t-${tipo}Url`).value = "";
      msg("img-msg", "Imagem salva. O site atualiza em até 1 minuto.", "ok");
    };
    leitor.readAsDataURL(f);
  });
});
document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
  const r = await tApi(`/arquivo/${b.dataset.del}`, { method: "DELETE" });
  if (!r.ok) return msg("img-msg", r.data.error || "Não foi possível remover.");
  mostrarImagens(r.data.imagens);
  msg("img-msg", "Imagem removida. Fica a marca provisória com a sigla.", "ok");
}));

// ── Integrações ──
const SEGREDOS = ["botayioSecret", "botayioTutorUrl", "zapayioToken", "zapayioClientToken", "zapayioWebhookSecret"];
function mostrarIntegracao(i) {
  const pill = (ok, txt) => `<span class="pill ${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${txt}</span>`;
  $("integ-status").innerHTML = pill(i.botayio, "Bot ligado") + pill(i.tutoria, "Link de tutoria") + pill(i.zapayio, "WhatsApp") + pill(i.webhookProtegido, "Webhook protegido")
    + (i.webhook ? `<div class="hint">Webhook do WhatsApp: ${esc(location.origin + i.webhook)}</div>` : "");
  $("i-botayioUrl").value = i.botayioUrl || "";
  $("i-zapayioBaseUrl").value = i.zapayioBaseUrl || "";
  $("i-zapayioInstanceId").value = i.zapayioInstanceId || "";
  const cad = { botayioSecret: i.botayio, botayioTutorUrl: i.tutoria, zapayioToken: i.zapayio, zapayioClientToken: i.zapayioClientToken, zapayioWebhookSecret: i.webhookProtegido };
  SEGREDOS.forEach((s) => { $(`i-${s}`).value = ""; $(`i-${s}`).placeholder = cad[s] ? "cadastrado — deixe em branco para manter" : "não cadastrado"; });
}
$("gerar-segredo").onclick = () => {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  const s = Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
  const el = $("i-zapayioWebhookSecret"); el.value = s; el.type = "text";
};
$("integ-ok").onclick = async () => {
  const b = {};
  ["botayioUrl", "zapayioBaseUrl", "zapayioInstanceId", ...SEGREDOS].forEach((k) => { const v = $(`i-${k}`).value.trim(); if (v) b[k] = v; });
  const r = await tApi("/integracao", put(b));
  if (!r.ok) return msg("integ-msg", r.data.error || "Erro ao salvar.");
  mostrarIntegracao(r.data.integracao); $("i-zapayioWebhookSecret").type = "password";
  msg("integ-msg", "Integrações salvas.", "ok");
};
$("webhook-ok").onclick = async () => {
  const r = await api(`/api/t/${slugAtual}/zapayio/configurar-webhook`, { method: "POST" });
  msg("integ-msg", r.ok ? `Webhook apontado: ${r.data.webhook}` : (r.data.error || "Erro."), r.ok ? "ok" : "err");
};
$("zap-status").onclick = async () => {
  const r = await api(`/api/t/${slugAtual}/zapayio/status`);
  msg("integ-msg", r.ok ? `WhatsApp: ${JSON.stringify(r.data.instancia)}` : (r.data.error || "Erro ao consultar."), r.ok ? "ok" : "err");
};
$("bot-ok").onclick = async () => {
  $("bot-out").innerHTML = '<div class="hint">Perguntando ao bot…</div>';
  const r = await tApi("/botayio/teste", corpo({ texto: $("bot-q").value || "oi" }));
  if (!r.ok) { $("bot-out").innerHTML = `<div class="msg err">${esc(r.data.error || "Erro.")}</div>`; return; }
  const t = (r.data.contents || []).map((c) => c.text || "").join("\n\n———\n\n");
  $("bot-out").innerHTML = `<div class="bot-out">${esc(t || "(sem texto)")}${r.data.categoria ? `\n\n[categoria: ${esc(r.data.categoria)}]` : ""}${r.data.transbordo ? "\n[pediu atendente]" : ""}</div>`;
};

// ── Usuários ──
const NOMES_PERFIL = { BALCAO: "Balcão", TUTOR: "Tutor", GESTOR: "Gestor", ADMIN: "Administrador" };
async function carregarUsuarios() {
  const r = await tApi("/usuarios");
  if (!r.ok) return msg("u-msg", r.data.error || "Erro ao listar.");
  $("u-corpo").innerHTML = (r.data.usuarios || []).map((u) => `<tr data-id="${esc(u.id)}">
    <td>${esc(u.nome)}</td><td>${esc(u.login)}</td>
    <td><select class="sel u-perfil" style="width:auto">${Object.entries(NOMES_PERFIL).map(([k, v]) => `<option value="${k}" ${k === u.perfil ? "selected" : ""}>${v}</option>`).join("")}</select></td>
    <td>${u.ativo ? '<span class="pill ok">ativo</span>' : '<span class="pill no">inativo</span>'}</td><td>${dt(u.ultimoAcesso)}</td>
    <td><button class="btn soft u-ativo">${u.ativo ? "Desativar" : "Reativar"}</button>
        <input class="in u-novasenha" type="password" placeholder="nova senha" style="width:130px;display:inline-block" autocomplete="new-password" />
        <button class="btn soft u-senha">Trocar senha</button></td></tr>`).join("") || '<tr><td colspan="6">Nenhum usuário.</td></tr>';
  document.querySelectorAll("#u-corpo tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    const salvar = async (b, ok) => { const r2 = await tApi(`/usuarios/${id}`, put(b)); msg("u-msg", r2.ok ? ok : (r2.data.error || "Erro."), r2.ok ? "ok" : "err"); if (r2.ok) carregarUsuarios(); };
    tr.querySelector(".u-perfil").onchange = (e) => salvar({ perfil: e.target.value }, "Perfil alterado.");
    tr.querySelector(".u-ativo").onclick = () => salvar({ ativo: tr.querySelector(".u-ativo").textContent === "Reativar" }, "Situação alterada.");
    tr.querySelector(".u-senha").onclick = () => { const s = tr.querySelector(".u-novasenha").value; if (!s) return msg("u-msg", "Digite a nova senha ao lado do botão."); salvar({ senha: s }, "Senha trocada."); };
  });
}
$("u-ok").onclick = async () => {
  const b = { nome: $("u-nome").value.trim(), login: $("u-login").value.trim(), perfil: $("u-perfil").value, senha: $("u-senha").value };
  const r = await tApi("/usuarios", corpo(b));
  if (!r.ok) return msg("u-msg", r.data.error || "Erro ao criar.");
  ["u-nome", "u-login", "u-senha"].forEach((id) => ($(id).value = ""));
  msg("u-msg", "Usuário criado.", "ok"); carregarUsuarios();
};

// ── Formulários ──
async function carregarForms() {
  const r = await tApi("/formularios");
  if (!r.ok) return msg("f-msg", r.data.error || "Erro ao listar.");
  $("f-corpo").innerHTML = (r.data.formularios || []).map((f) => `<tr data-chave="${esc(f.chave)}">
    <td><input class="in f-ordem" type="number" min="0" value="${f.ordem}" style="width:70px" /></td><td>${esc(f.titulo)}<div class="hint">${esc(f.chave)}</div></td>
    <td>${f.ativo ? '<span class="pill ok">no site</span>' : '<span class="pill no">oculto</span>'}</td>
    <td><button class="btn soft f-ativo">${f.ativo ? "Ocultar" : "Mostrar"}</button></td></tr>`).join("") || '<tr><td colspan="4">Nenhum formulário.</td></tr>';
  document.querySelectorAll("#f-corpo tr[data-chave]").forEach((tr) => {
    const ch = encodeURIComponent(tr.dataset.chave);
    const salvar = async (b) => { const r2 = await tApi(`/formularios/${ch}`, put(b)); msg("f-msg", r2.ok ? "Salvo. O site atualiza em até 1 minuto." : (r2.data.error || "Erro."), r2.ok ? "ok" : "err"); if (r2.ok) carregarForms(); };
    tr.querySelector(".f-ativo").onclick = () => salvar({ ativo: tr.querySelector(".f-ativo").textContent === "Mostrar" });
    tr.querySelector(".f-ordem").onchange = (e) => salvar({ ordem: Number(e.target.value) });
  });
  $("f-copiar").classList.toggle("hidden", !souSuper || !GERAL);
  if (souSuper && GERAL) $("f-de").innerHTML = tenantsCache.filter((t) => t.slug !== slugAtual).map((t) => `<option value="${esc(t.slug)}">Copiar de ${esc(t.sigla)}</option>`).join("");
}
$("f-copiar-ok").onclick = async () => {
  const r = await tApi("/formularios/copiar", corpo({ de: $("f-de").value }));
  msg("f-msg", r.ok ? `${r.data.copiados} formulário(s) copiado(s).` : (r.data.error || "Erro."), r.ok ? "ok" : "err");
  if (r.ok) carregarForms();
};

// ── Início: reaproveita a sessão se ainda valer ──
(async () => {
  if (GERAL) { if (tokGet()) { const r = await api("/api/admin/tenants"); if (r.ok) return iniciar(); tokSet(""); } }
  else if (await Sessao.valida("admin")) iniciar();
})();
