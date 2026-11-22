// Observatório → Impacto do assistente, Antes e depois (linha de base) e Divulgação (QR + cartaz).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const T = window.TENANT || {};
  const API = () => window.API_BASE || "/api/t/" + (T.slug || "pa");
  const SLUG = () => T.slug || "pa";
  const n = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));
  const kpi = (rot, val, sub, cls = "") => `<div class="kpi ${cls}"><small>${esc(rot)}</small><b>${val}</b><span>${sub}</span></div>`;
  const NOMES_CTX = { "conferencia:transferencia": "Conferência · transferência", "conferencia:comunicacao-venda": "Conferência · comunicação de venda", "conferencia:renovacao-cnh": "Conferência · renovação de CNH", "jornada:venda": "Jornada · venda de veículo", "jornada:renovacao": "Jornada · renovação de CNH", "jornada:defesa": "Jornada · defesa de multa" };
  const nomeCtx = (c) => NOMES_CTX[c] || c.replace(":", " · ").replace(/-/g, " ");
  let ultimo = null, diasAtual = 30;

  // ── Impacto ──
  function render(d, dias) {
    ultimo = d; diasAtual = dias;
    const I = d.impacto; if (!I || !$("ob-impacto")) return;
    const comp = I.anterior ? (I.viagensEvitadas - I.anterior) : null;
    $("ob-impacto").innerHTML = `<div class="kpis">${[
      kpi("Viagens ao DETRAN evitadas", n(I.viagensEvitadas), `${I.taxaEvitou == null ? "sem respostas ainda" : `${I.taxaEvitou}% de ${n(I.respostas)} resposta(s)`}${comp ? ` · ${comp > 0 ? "▲" : "▼"} ${Math.abs(comp)} vs. período anterior` : ""}`, "ok"),
      kpi("Documentos certos antes de vir", n(I.conferenciasOk), "conferências com tudo pronto"),
      kpi("Jornadas concluídas", n(I.jornadasConcluidas), "venda, CNH e multa até o fim"),
      kpi("Golpes barrados", n(I.golpesBarrados), "mensagens com cara de golpe"),
      kpi("Lacunas corrigidas", n(I.lacunasCorrigidas), "ensinamentos na Tutoria"),
      kpi("Horas economizadas", `${n(I.horasCidadao)} h`, `cidadão · ${n(I.horasServidor)} h de servidor (estimativa)`, "neutro"),
    ].join("")}</div>
    ${I.porContexto.length ? `<table class="ob-tab"><thead><tr><th>Onde o cidadão respondeu</th><th>Evitou</th><th>Não evitou</th><th>Ainda não sabe</th></tr></thead><tbody>${I.porContexto.map((x) => `<tr><td>${esc(nomeCtx(x.contexto))}</td><td>${n(x.sim)}</td><td>${n(x.nao)}</td><td>${n(x.talvez)}</td></tr>`).join("")}</tbody></table>` : '<div class="vazio-p">Ainda não há respostas à pergunta “isso evitou uma ida ao DETRAN?”. Ela aparece ao fim de cada conferência de documentos e de cada jornada.</div>'}
    <p class="ob-dica">Estimativa: ${I.estimativa.minutosViagem} min do cidadão (deslocamento e espera) e ${I.estimativa.minutosServidor} min de servidor por viagem evitada.</p>
    ${blocoCusto(d.custoIA)}`;
    renderOrigens(I.origens || []);
    renderMedicoes(I.medicoes);
  }

  // ── Custo REAL da IA no mês (tokens devolvidos pelo BotAyio × preço do modelo) ──
  const reais = (v, casas = 2) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  function blocoCusto(c) {
    if (!c || !c.respostas) return '<p class="ob-dica">Custo da IA: ainda sem respostas medidas neste mês.</p>';
    const mil = (n) => (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
    return `<div class="ob-custo"><b>Custo da IA neste mês (medido):</b> ${reais(c.custoReais)} em ${n(c.respostas)} respostas${c.custoPorResposta != null ? ` · <b>${reais(c.custoPorResposta, 4)}</b> por resposta` : ""}
      <br><small>Tokens: ${mil(c.tokens.entrada)} de entrada, ${mil(c.tokens.cacheLido)} reaproveitados do cache e ${mil(c.tokens.saida)} de saída · cotação US$ 1 = R$ ${String(c.cotacao).replace(".", ",")}${c.semPreco.length ? ` · sem preço configurado para ${esc(c.semPreco.join(", "))}` : ""}</small></div>`;
  }

  // ── Antes e depois (linha de base e medições do DETRAN) ──
  let campos = null;
  async function carregarMedicoes() {
    const r = await Sessao.api("/gestao/impacto/medicoes"); if (!r.ok) return;
    campos = r.data.campos; desenharForm(); renderMedicoes(r.data.comparacao, r.data.medicoes);
  }
  function desenharForm() {
    if (!campos || !$("ob-med-form") || $("ob-med-form").dataset.ok) return;
    $("ob-med-form").dataset.ok = "1";
    $("ob-med-form").innerHTML = `<div class="ob-med-grade">
      <div><label class="f" for="med-data">Data da medição</label><input id="med-data" class="in" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      ${Object.entries(campos).map(([k, rot]) => `<div><label class="f" for="med-${k}">${esc(rot)}</label><input id="med-${k}" class="in" type="number" min="0" step="0.1" inputmode="decimal"></div>`).join("")}
      <div class="largo"><label class="f" for="med-fonte">Fonte dos números</label><input id="med-fonte" class="in" placeholder="Ex.: sistema de senhas da sede, relatório do call center de outubro"></div>
    </div><button class="btn soft mini" id="med-salvar" type="button">Salvar medição</button> <span id="med-msg" class="sub" role="status"></span>`;
    $("med-salvar").onclick = async () => {
      const b = { data: $("med-data").value, fonte: $("med-fonte").value };
      for (const k of Object.keys(campos)) { const v = $(`med-${k}`).value; if (v !== "") b[k] = Number(v); }
      const r = await Sessao.api("/gestao/impacto/medicoes", { method: "POST", body: JSON.stringify(b) });
      $("med-msg").textContent = r.ok ? "Medição salva." : (r.data.error || "Não foi possível salvar.");
      if (r.ok) renderMedicoes(r.data.comparacao, r.data.medicoes);
    };
  }
  function renderMedicoes(comp, lista) {
    const el = $("ob-med"); if (!el) return;
    if (!comp) { el.innerHTML = '<div class="vazio-p">Ainda sem linha de base. Registre abaixo os números de hoje (o primeiro registro vira a linha de base). Repita a cada mês para ver o antes e depois.</div>'; return; }
    const fmtVar = (c) => c.variacao == null ? "—" : `<span class="ob-var ${c.bom === true ? "desce" : c.bom === false ? "sobe" : ""}">${c.variacao > 0 ? "▲" : "▼"} ${Math.abs(c.variacao)}%</span>`;
    el.innerHTML = `<table class="ob-tab"><thead><tr><th>Indicador</th><th>Linha de base (${esc(br(comp.base))})</th><th>Última (${esc(br(comp.ultima))})</th><th>Variação</th></tr></thead><tbody>
      ${comp.campos.map((c) => `<tr><td>${esc(c.rotulo)}</td><td>${n(c.base)}</td><td>${comp.mesma ? "—" : n(c.atual)}</td><td>${comp.mesma ? "—" : fmtVar(c)}</td></tr>`).join("")}</tbody></table>
      ${lista ? `<details class="ob-med-lista"><summary>${lista.length} medição(ões) registradas</summary><ul>${lista.slice().reverse().map((m) => `<li>${esc(br(m.data))}${m.fonte ? ` · ${esc(m.fonte)}` : ""} <button class="btn ghost mini" type="button" data-med-del="${esc(m.data)}" aria-label="Remover a medição de ${esc(br(m.data))}">Remover</button></li>`).join("")}</ul></details>` : ""}`;
  }
  const br = (iso) => String(iso || "").split("-").reverse().join("/");

  // ── Divulgação: QR Code e cartaz por ponto ──
  const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  function montarDivulgacao() {
    const el = $("ob-divulgar"); if (!el || el.dataset.ok) return; el.dataset.ok = "1";
    el.innerHTML = `<p class="sub" style="margin:0 0 8px">Crie um QR para cada ponto (balcão, CIRETRAN, site oficial, redes). Cada acesso fica contado por origem, para saber o que funciona.</p>
      <div class="ob-qr-linha"><div style="flex:1;min-width:200px"><label class="f" for="qr-local">Ponto de divulgação</label><input id="qr-local" class="in" placeholder="Ex.: Balcão da sede, CIRETRAN Santarém, Instagram"></div>
      <button class="btn soft mini" id="qr-gerar" type="button">Gerar QR e cartaz</button></div>
      <div id="qr-saida"></div>`;
    $("qr-gerar").onclick = () => {
      const local = $("qr-local").value.trim(); const origem = slugify(local);
      if (!origem) { $("qr-saida").innerHTML = '<p class="sub" role="alert">Escreva o nome do ponto.</p>'; return; }
      const base = `${location.origin}/${SLUG()}`;
      const link = `${base}?origem=${origem}`;
      const cartaz = `${base}/cartaz?origem=${encodeURIComponent(origem)}&local=${encodeURIComponent(local)}`;
      $("qr-saida").innerHTML = `<div class="ob-qr"><img src="${esc(API())}/qr.svg?origem=${encodeURIComponent(origem)}" alt="QR Code para ${esc(local)}" width="150" height="150">
        <div><b>${esc(local)}</b><br><code>${esc(link)}</code><br>
        <a class="btn soft mini" href="${esc(cartaz)}" target="_blank" rel="noopener">🖨️ Abrir cartaz A4</a>
        <a class="btn ghost mini" href="${esc(API())}/qr.svg?origem=${encodeURIComponent(origem)}" download="qr-${esc(origem)}.svg">Baixar QR (SVG)</a></div></div>`;
    };
  }
  function renderOrigens(origens) {
    montarDivulgacao();
    const el = $("ob-origens"); if (!el) return;
    el.innerHTML = origens.length ? `<table class="ob-tab"><thead><tr><th>Origem do acesso</th><th>Acessos no período</th></tr></thead><tbody>${origens.map((o) => `<tr><td>${esc(o.origem.replace(/-/g, " "))}</td><td>${n(o.n)}</td></tr>`).join("")}</tbody></table>` : '<div class="vazio-p">Nenhum acesso por QR ou link de divulgação no período.</div>';
  }

  // ── Relatório do mês (abre pronto para imprimir/salvar em PDF) ──
  function relatorio() {
    const d = ultimo; if (!d) return;
    const I = d.impacto, R = d.resumo, comp = I.medicoes;
    const w = window.open("", "_blank"); if (!w) return;
    const linha = (a, b) => `<tr><td>${esc(a)}</td><td><b>${b}</b></td></tr>`;
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório de impacto — ${esc(T.sigla)}</title>
      <style>body{font:14px/1.5 system-ui,sans-serif;color:#1B2236;max-width:780px;margin:24px auto;padding:0 16px}h1{font-size:22px;color:#192662;margin:0}h2{font-size:16px;color:#192662;margin:22px 0 6px;border-bottom:2px solid #E3E8F0;padding-bottom:4px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #E3E8F0}small{color:#4E5870}@media print{button{display:none}}</style></head><body>
      <button onclick="print()" style="float:right;padding:8px 14px">Imprimir / salvar PDF</button>
      <h1>Relatório de impacto do assistente virtual</h1><small>${esc(T.nome || T.sigla)} · últimos ${diasAtual} dias · gerado em ${new Date().toLocaleString("pt-BR")}</small>
      <h2>Resultados para o cidadão</h2><table>
        ${linha("Viagens ao DETRAN evitadas (resposta do próprio cidadão)", n(I.viagensEvitadas))}
        ${linha("Taxa de “evitou uma ida” entre quem respondeu", I.taxaEvitou == null ? "—" : I.taxaEvitou + "%")}
        ${linha("Conferências de documentos com tudo pronto", n(I.conferenciasOk))}
        ${linha("Jornadas concluídas (venda, CNH, multa)", n(I.jornadasConcluidas))}
        ${linha("Golpes barrados", n(I.golpesBarrados))}
        ${linha("Horas economizadas pelo cidadão (estimativa)", n(I.horasCidadao) + " h")}
        ${linha("Horas de servidor economizadas (estimativa)", n(I.horasServidor) + " h")}</table>
      <h2>Atendimento</h2><table>
        ${linha("Perguntas ao assistente", n(R.perguntas))}
        ${linha("Sem resposta na base", R.taxaSemBase + "%")}
        ${linha("Encaminhadas a atendente", R.taxaTransbordo + "%")}
        ${linha("Satisfação", R.satisfacao == null ? "—" : R.satisfacao + "%")}
        ${linha("Lacunas corrigidas pela Tutoria", n(I.lacunasCorrigidas))}
        ${d.custoIA?.respostas ? linha("Custo da IA no mês (medido)", reais(d.custoIA.custoReais) + (d.custoIA.custoPorResposta != null ? " · " + reais(d.custoIA.custoPorResposta, 4) + " por resposta" : "")) : ""}</table>
      ${comp ? `<h2>Antes e depois (dados do ${esc(T.sigla)})</h2><table><tr><th>Indicador</th><th>Linha de base (${esc(br(comp.base))})</th><th>Última (${esc(br(comp.ultima))})</th><th>Variação</th></tr>${comp.campos.map((c) => `<tr><td>${esc(c.rotulo)}</td><td>${n(c.base)}</td><td>${comp.mesma ? "—" : n(c.atual)}</td><td>${comp.mesma || c.variacao == null ? "—" : (c.variacao > 0 ? "+" : "") + c.variacao + "%"}</td></tr>`).join("")}</table>` : ""}
      ${(I.origens || []).length ? `<h2>De onde vieram os acessos</h2><table>${I.origens.map((o) => linha(o.origem.replace(/-/g, " "), n(o.n))).join("")}</table>` : ""}
      <p><small>Metodologia: “viagens evitadas” vêm da pergunta feita ao cidadão ao fim da conferência de documentos e de cada jornada. Horas são estimativas (${I.estimativa.minutosViagem} min do cidadão e ${I.estimativa.minutosServidor} min de servidor por viagem evitada). Nenhum dado pessoal é usado nestes números.</small></p>
      </body></html>`);
    w.document.close();
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("#ob-relatorio")) return relatorio();
    const del = e.target.closest("[data-med-del]"); if (!del) return;
    const r = await Sessao.api("/gestao/impacto/medicoes/" + encodeURIComponent(del.dataset.medDel), { method: "DELETE" });
    if (r.ok) renderMedicoes(r.data.comparacao, r.data.medicoes);
  });
  window.Impacto = { render, carregarMedicoes };
})();
