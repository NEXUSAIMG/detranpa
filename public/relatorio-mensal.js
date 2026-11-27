// Relatório mensal para o DETRAN (Central de Gestão): abre pronto para imprimir/salvar em PDF.
(function () {
  const T = window.TENANT || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const n = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR"));
  const p = (v) => (v == null ? "—" : `${v}%`);
  const h = (v) => (v == null ? "—" : v < 48 ? `${n(v)} h` : `${n(Math.round((v / 24) * 10) / 10)} dias`);
  const reais = (v, c = 2) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
  const varTxt = (v) => (v == null ? "novo" : `${v > 0 ? "+" : ""}${v}%`);
  const ROT = { WEB: "Site", WHATSAPP: "WhatsApp" };

  async function iniciar() {
    const campo = $("rel-mes"); if (!campo) return;
    const agora = new Date(), ant = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
    campo.max = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    campo.value = `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, "0")}`; // padrão: mês passado (fechado)
  }

  function pagina(d) {
    const linha = (a, b, nota) => `<tr><td>${esc(a)}${nota ? `<br><small>${esc(nota)}</small>` : ""}</td><td class="v">${b}</td></tr>`;
    const A = d.atendimento, P = d.protocolos, H = d.humano, I = d.impacto;
    const canais = Object.entries(A.porCanal || {}).map(([k, v]) => `${ROT[k] || k}: ${n(v)}`).join(" · ");
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório mensal — ${esc(d.sigla)} — ${esc(d.nome)}</title>
<style>
  body{font:13.5px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1B2236;max-width:820px;margin:24px auto;padding:0 18px}
  h1{font-size:22px;color:#192662;margin:0}h2{font-size:15.5px;color:#192662;margin:22px 0 6px;border-bottom:2px solid #E3E8F0;padding-bottom:4px;break-after:avoid}
  table{width:100%;border-collapse:collapse;break-inside:avoid}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #E3E8F0;vertical-align:top}th{font-size:12.5px;color:#4E5870}
  td.v{text-align:right;font-weight:700;white-space:nowrap}small{color:#4E5870}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.kpi{border:1px solid #E3E8F0;border-radius:10px;padding:10px}.kpi b{display:block;font-size:22px;color:#192662}.kpi span{font-size:12px;color:#4E5870}
  .demo{background:#FFF4CC;border:1px solid #EBD58A;padding:8px 10px;border-radius:8px;font-weight:600}
  @media print{button{display:none}body{margin:0}}
</style></head><body>
<button onclick="print()" style="float:right;padding:8px 14px">Imprimir / salvar PDF</button>
<h1>Relatório mensal do assistente virtual</h1>
<small>${esc(d.orgao || d.sigla)} · ${esc(d.nome)} · gerado em ${new Date(d.geradoEm).toLocaleString("pt-BR")}${d.guardado ? " (versão guardada no fechamento do mês)" : ""}</small>
${d.demonstracao ? `<p class="demo">Ambiente de demonstração: números de teste, não oficiais.</p>` : ""}
${d.parcial ? `<p class="demo">Mês ainda em andamento: números até hoje. O relatório fechado fica pronto no dia 1º.</p>` : ""}
<div class="kpis">
  <div class="kpi"><b>${n(A.perguntas)}</b><span>perguntas respondidas (${varTxt(A.variacao)} sobre o mês anterior)</span></div>
  <div class="kpi"><b>${n(P.abertos)}</b><span>protocolos abertos</span></div>
  <div class="kpi"><b>${p(P.taxaNoPrazo)}</b><span>resolvidos dentro do prazo</span></div>
  <div class="kpi"><b>${p(A.satisfacao)}</b><span>de respostas avaliadas como úteis</span></div>
</div>
<h2>Atendimento pelo assistente</h2><table>
  ${linha("Conversas novas", n(A.conversasNovas), canais)}
  ${linha("Perguntas respondidas", n(A.perguntas), `Mês anterior: ${n(A.perguntasMesAnterior)}`)}
  ${linha("Sem resposta na base", p(A.taxaSemBase), "Perguntas que o assistente não soube responder (ver lista abaixo)")}
  ${linha("Encaminhadas a um atendente", p(A.taxaTransbordo))}
  ${linha("Satisfação (👍 entre as respostas avaliadas)", p(A.satisfacao), `${n(A.avaliacoes)} avaliações`)}
</table>
${d.assuntos.length ? `<h2>Assuntos mais procurados</h2><table><tr><th>Assunto</th><th style="text-align:right">No mês</th><th style="text-align:right">Mês anterior</th><th style="text-align:right">Variação</th></tr>
  ${d.assuntos.map((a) => `<tr><td>${esc(a.tema)}</td><td class="v">${n(a.n)}</td><td class="v">${n(a.anterior)}</td><td class="v">${varTxt(a.variacao)}</td></tr>`).join("")}</table>` : ""}
<h2>Protocolos (pedidos do cidadão e chamados da Central)</h2><table>
  ${linha("Abertos no mês", n(P.abertos), `${n(P.peloCidadao)} pelo próprio cidadão (site/WhatsApp), ${n(P.abertos - P.peloCidadao)} pela equipe`)}
  ${linha("Resolvidos no mês", n(P.resolvidos), P.cancelados ? `${n(P.cancelados)} cancelados` : "")}
  ${linha("Tempo de resposta (da abertura à solução)", h(P.tempoMedianoHoras), `Mediana. Média: ${h(P.tempoMedioHoras)}`)}
  ${linha("Resolvidos dentro do prazo", p(P.taxaNoPrazo), `${n(P.noPrazo)} de ${n(P.comPrazo)} com prazo`)}
  ${linha(d.parcial ? "Pendentes hoje" : "Pendentes no fim do mês", n(P.pendentesNoFim), P.vencidosNoFim ? `${n(P.vencidosNoFim)} já com o prazo vencido` : "Nenhum com prazo vencido")}
</table>
${P.porCategoria.length ? `<table style="margin-top:8px"><tr><th>Protocolos abertos por categoria</th><th style="text-align:right">Qtde.</th></tr>${P.porCategoria.map((c) => `<tr><td>${esc(c.nome)}</td><td class="v">${n(c.n)}</td></tr>`).join("")}</table>` : ""}
<h2>Atendimento humano</h2><table>
  ${linha("Conversas encaminhadas a atendente", n(H.encaminhadas))}
  ${linha("Tempo até a 1ª resposta do atendente", H.primeiraRespostaMin == null ? "—" : `${n(H.primeiraRespostaMin)} min`, "Mediana")}
  ${linha("Nota média do atendimento (1 a 5)", H.notaMedia == null ? "—" : n(H.notaMedia), `${n(H.avaliacoes)} avaliações`)}
</table>
<h2>Resultado para o cidadão</h2><table>
  ${linha("Viagens ao DETRAN evitadas (resposta do próprio cidadão)", n(I.viagensEvitadas), I.taxaEvitou == null ? "" : `${I.taxaEvitou}% de quem respondeu (${n(I.respostas)})`)}
  ${linha("Passo a passo concluídos (Despachante Parente)", n(I.jornadasConcluidas))}
  ${linha("Conferências de documentos com tudo pronto", n(I.conferenciasOk))}
  ${linha("Golpes barrados", n(I.golpesBarrados))}
  ${linha("Horas economizadas pelo cidadão (estimativa)", `${n(I.horasCidadao)} h`)}
  ${linha("Horas de servidor economizadas (estimativa)", `${n(I.horasServidor)} h`)}
  ${linha("Perguntas sem resposta corrigidas pela Tutoria", n(I.lacunasCorrigidas))}
</table>
${d.jornadas.length ? `<h2>Passo a passo (Despachante Parente)</h2><table><tr><th>Serviço</th><th style="text-align:right">Começaram</th><th style="text-align:right">Concluíram</th></tr>${d.jornadas.map((j) => `<tr><td>${esc(j.titulo)}</td><td class="v">${n(j.inicio)}</td><td class="v">${n(j.fim)}</td></tr>`).join("")}</table>` : ""}
${d.lacunas.length ? `<h2>O que o assistente não soube responder (para ensinar)</h2><table><tr><th>Pergunta (sem dados pessoais)</th><th style="text-align:right">Vezes</th></tr>${d.lacunas.map((l) => `<tr><td>${esc(l.pergunta)}</td><td class="v">${n(l.vezes)}</td></tr>`).join("")}</table>` : ""}
${d.custoIA ? `<h2>Custo da IA</h2><table>${linha("Custo medido no mês", reais(d.custoIA.custoReais), `${n(d.custoIA.respostas)} respostas${d.custoIA.custoPorResposta != null ? ` · ${reais(d.custoIA.custoPorResposta, 4)} por resposta` : ""}`)}</table>` : ""}
<p><small>Mês de calendário no horário de Brasília (UTC-3). "Viagens evitadas" vêm da pergunta feita ao cidadão ao fim da conferência de documentos e de cada passo a passo; horas são estimativas. Nenhum dado pessoal é usado nestes números.</small></p>
</body></html>`;
  }

  async function abrir() {
    const mes = $("rel-mes")?.value;
    if (!/^\d{4}-\d{2}$/.test(mes || "")) { $("rel-mes")?.focus(); return; }
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Montando o relatório…</title></head><body style="font:15px system-ui;padding:30px">Montando o relatório de ${esc(mes)}…</body></html>`);
    const r = await Sessao.api("/gestao/relatorio-mensal?mes=" + encodeURIComponent(mes));
    w.document.open();
    w.document.write(r.ok ? pagina(r.data) : `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório</title></head><body style="font:15px system-ui;padding:30px">${esc(r.data?.error || "Não foi possível montar o relatório.")}</body></html>`);
    w.document.close();
  }

  document.addEventListener("click", (e) => { if (e.target.closest("#rel-mensal")) abrir(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
  window.RelatorioMensal = { pagina, abrir };
})();
