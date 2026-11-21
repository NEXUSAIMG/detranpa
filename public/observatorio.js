// Observatório de demandas (Central de Gestão) — só leitura.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const NOMES = { cnh: "CNH", veiculos: "Veículos", multas: "Multas", ipva: "IPVA", outros: "Outros", protocolo: "Protocolo", erro: "Erros", golpe: "Golpes", lembrete: "Lembretes", conferencia: "Conferência de documentos" };
  let dias = 30;
  let carregando = false;

  document.querySelectorAll("#ob-periodo [data-d]").forEach((b) => (b.onclick = () => {
    dias = Number(b.dataset.d);
    document.querySelectorAll("#ob-periodo [data-d]").forEach((x) => x.classList.toggle("on", x === b));
    carregar();
  }));

  const seta = (v) => (v == null ? '<span class="ob-var novo">novo</span>' : v > 0 ? `<span class="ob-var sobe">▲ ${v}%</span>` : v < 0 ? `<span class="ob-var desce">▼ ${Math.abs(v)}%</span>` : '<span class="ob-var">=</span>');
  const vazio = (t) => `<div class="vazio-p">${t}</div>`;
  const kpi = (rot, val, sub, cls = "") => `<div class="kpi ${cls}"><small>${rot}</small><b>${val}</b><span>${sub}</span></div>`;

  async function carregar() {
    if (carregando) return;
    carregando = true;
    $("ob-msg").innerHTML = "";
    try {
      const r = await Sessao.api(`/gestao/observatorio?dias=${dias}`);
      if (!r.ok) { $("ob-msg").innerHTML = `<div class="msg err">${esc(r.data?.error || "Não foi possível carregar.")}</div>`; return; }
      render(r.data);
    } finally { carregando = false; }
  }

  function render(d) {
    const R = d.resumo;
    $("ob-kpis").innerHTML = [
      kpi("Perguntas", R.perguntas, `${seta(R.variacao)} vs. ${dias} dias antes`),
      kpi("Sem resposta na base", `${R.taxaSemBase}%`, `${R.semBase} pergunta(s)`, R.taxaSemBase >= 15 ? "critico" : R.taxaSemBase >= 5 ? "alerta" : ""),
      kpi("Foram para atendente", `${R.taxaTransbordo}%`, `${R.transbordos} conversa(s)`, "neutro"),
      kpi("Golpes conferidos", R.golpesConferidos, `${R.golpesProvaveis} com cara de golpe ${R.golpesProvaveis ? seta(R.golpesVariacao) : ""}`, R.golpesProvaveis ? "alerta" : ""),
      kpi("Satisfação", R.satisfacao == null ? "—" : `${R.satisfacao}%`, `${R.avaliacoes} avaliação(ões) 👍/👎`),
    ].join("");

    const max = Math.max(1, ...d.temas.map((t) => Math.max(t.atual, t.anterior)));
    $("ob-temas").innerHTML = d.temas.length ? `<table class="ob-tab"><thead><tr><th>Assunto</th><th></th><th>Agora</th><th>Antes</th><th>Variação</th><th>Sem base</th><th>Atendente</th></tr></thead><tbody>${d.temas.map((t) => `
      <tr><td><b>${esc(NOMES[t.tema] || t.tema)}</b></td>
      <td class="ob-barra"><div class="trilho"><div class="enche" style="width:${(t.atual / max) * 100}%"></div></div><div class="trilho antes"><div class="enche" style="width:${(t.anterior / max) * 100}%"></div></div></td>
      <td>${t.atual}</td><td class="mudo">${t.anterior}</td><td>${seta(t.variacao)}</td>
      <td>${t.semBase ? `<span class="ob-pill alerta">${t.semBase}</span>` : "—"}</td><td>${t.transbordo || "—"}</td></tr>`).join("")}</tbody></table>` : vazio("Sem perguntas no período.");

    $("ob-lacunas").innerHTML = d.lacunas.length ? `<ul class="ob-lista">${d.lacunas.map((l, i) => `
      <li><span class="ob-q">“${esc(l.pergunta)}”</span><span class="ob-n">${l.vezes}×</span><button class="btn soft ob-ensinar" data-i="${i}">Ensinar</button></li>`).join("")}</ul>`
      : vazio("Nenhuma pergunta ficou sem resposta no período. 👏");
    document.querySelectorAll(".ob-ensinar").forEach((b) => (b.onclick = () => ensinar(d.lacunas[Number(b.dataset.i)].pergunta)));

    $("ob-alta").innerHTML = d.emAlta.length ? `<ul class="ob-lista">${d.emAlta.map((x) => `<li><span class="ob-q">${esc(x.termo)}</span><span class="ob-n">${x.atual}</span>${seta(x.variacao)}</li>`).join("")}</ul>`
      : d.maisFalados.length ? `<p class="vazio-p">Nada cresceu de forma clara. Mais falados:</p><div class="ob-nuvem">${d.maisFalados.map((x) => `<span>${esc(x.termo)} <b>${x.n}</b></span>`).join("")}</div>` : vazio("Ainda sem mensagens suficientes.");

    const G = d.golpes, totG = G.golpe + G.atencao + G.sem_sinais;
    $("ob-golpes").innerHTML = totG ? `<div class="barras-h">${[["golpe", "Com cara de golpe", "var(--verm)"], ["atencao", "Sinais suspeitos", "#F59E0B"], ["sem_sinais", "Sem sinais", "var(--ok)"]].map(([k, rot, cor]) => `
      <div class="b"><span>${rot}</span><div class="trilho"><div class="enche" style="width:${(G[k] / totG) * 100}%;background:${cor}"></div></div><span class="n">${G[k]}</span></div>`).join("")}</div>
      <p class="ob-dica">Cada conferência é um pagamento que o cidadão pensou duas vezes antes de fazer. Um pico de "cara de golpe" vale um alerta nas redes do órgão.</p>`
      : vazio("Ninguém conferiu cobrança no período. O cidadão pode colar no chat a mensagem, o link ou o código de barras.");

    $("ob-freq").innerHTML = d.perguntasFrequentes.length ? `<ul class="ob-lista">${d.perguntasFrequentes.map((f) => `<li><span class="ob-q">“${esc(f.pergunta)}”</span><span class="ob-n">${f.vezes}×</span></li>`).join("")}</ul>` : vazio("Nenhuma pergunta repetida igualzinha no período.");

    const mc = Math.max(1, ...d.calor.flat()); const D = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    let h = "<span></span>" + Array.from({ length: 24 }, (_, i) => `<span style="text-align:center">${i % 3 === 0 ? i : ""}</span>`).join("");
    for (let i = 0; i < 7; i++) h += `<span class="r">${D[i]}</span>` + d.calor[i].map((v, hr) => `<span class="c" style="opacity:${v ? 0.15 + (v / mc) * 0.85 : 0.06}" title="${D[i]} ${hr}h: ${v}"></span>`).join("");
    $("ob-calor").innerHTML = h;

    const mb = Math.max(1, ...d.balcao.map((b) => b.n));
    $("ob-balcao").innerHTML = d.balcao.length ? `<div class="barras-h">${d.balcao.map((b) => `<div class="b"><span title="${esc(b.servico)}">${esc(b.servico)}</span><div class="trilho"><div class="enche" style="width:${(b.n / mb) * 100}%"></div></div><span class="n">${b.n}</span></div>`).join("")}</div>` : vazio("Nenhum atendimento de balcão registrado no período.");
  }

  function ensinar(pergunta) {
    const nav = document.querySelector('.nav[data-sec="tutoria"]');
    if (!nav || nav.classList.contains("hidden") || !window.TutoriaGestao?.ensinarCom) return;
    nav.click();
    window.TutoriaGestao.ensinarCom(pergunta);
  }

  window.Observatorio = { carregar };
})();
