// Despachante Parente (22/11/2026): 5 jornadas novas, "o que levar", palavras do WhatsApp e cutucada com ajuda.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as J from "../../lib/jornadas.js";

const t = { id: "t-unit2", slug: "unit2", sigla: "DETRAN-TT", portalUrl: "https://detran.tt.gov.br", telefone: "154" };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const br = (s) => s.split("-").reverse().join("/");
const percorrer = async (dono, id, passos) => {
  let est = await J.iniciar(t, dono, id);
  const avisos = [];
  for (const p of passos) {
    const r = await J.responder(t, est, p);
    assert.ok(!r.erro, `${id}: ${JSON.stringify(p)} -> ${r.erro}`);
    avisos.push(...(r.avisos || []));
    est = r.est;
  }
  return { est, c: J.cartao(t, est), avisos };
};

test("gatilhos das jornadas novas (e as antigas continuam iguais)", () => {
  const casos = {
    "Como faço a transferência de um veículo que comprei?": "compra",
    "comprei uma moto usada, e agora?": "compra",
    "quero passar o carro para o meu nome": "compra",
    "como pago o licenciamento 2027?": "licenciamento",
    "onde baixo o CRLV-e?": "licenciamento",
    "quero tirar a minha primeira habilitação": "primeira",
    "como faço para tirar a CNH?": "primeira",
    "perdi minha CNH, como tiro a segunda via?": "segundavia",
    "roubaram minha carteira de motorista": "segundavia",
    "mudei de endereço, preciso avisar o DETRAN?": "endereco",
    "como faço a transferência de jurisdição do meu carro?": "endereco",
    "vendi meu carro semana passada": "venda",
    "minha CNH venceu, como renovar?": "renovacao",
    "quero recorrer da multa": "defesa",
    "qual o horário de atendimento?": null,
  };
  for (const [p, id] of Object.entries(casos)) assert.equal(J.detectarJornada(p), id, p);
});

test("palavras do WhatsApp (ACOMPANHAR <palavra>)", () => {
  assert.equal(J.jornadaPorPalavra("compra"), "compra");
  assert.equal(J.jornadaPorPalavra("transferência"), "compra");
  assert.equal(J.jornadaPorPalavra("LICENCIAMENTO"), "licenciamento");
  assert.equal(J.jornadaPorPalavra("2 via"), "segundavia");
  assert.equal(J.jornadaPorPalavra("segunda via"), "segundavia");
  assert.equal(J.jornadaPorPalavra("habilitação"), "primeira");
  assert.equal(J.jornadaPorPalavra("endereço"), "endereco");
  assert.equal(J.jornadaPorPalavra("cnh"), "renovacao");
  assert.equal(J.jornadaPorPalavra("multa"), "defesa");
  assert.equal(J.jornadaPorPalavra("meu processo"), null);
  const palavras = Object.values(J.JORNADAS).map((j) => J.palavraDe(j));
  assert.equal(new Set(palavras).size, palavras.length, "cada jornada tem uma palavra própria no menu");
  for (const j of Object.values(J.JORNADAS)) assert.equal(J.jornadaPorPalavra(J.palavraDe(j)), j.id);
});

test("compra: CRV de papel, prazo de 30 dias, validade da vistoria e lembrete da transferência", async () => {
  const compra = iso(-5), vist = iso(-1);
  const { c, avisos } = await percorrer("web:unit-compra-0001", "compra", [
    { acao: "feito" }, { acao: "opcao", valor: "papel" }, { acao: "feito" },
    { acao: "data", valor: br(compra) }, { acao: "data", valor: vist },
  ]);
  assert.equal(c.etapa.id, "documentos");
  assert.equal(c.etapa.servico, "transferencia");
  assert.ok(!c.progresso.etapas.some((e) => e.id === "assinatura"), "papel não mostra a ATPV-e");
  assert.deepEqual(c.prazos.map((p) => p.faltam), [25, 29]);
  assert.deepEqual(avisos, [{ lembrete: "TRANSFERENCIA", data: compra }]);
});

test("licenciamento: com calendário conta pelo final; sem calendário pede a data", async () => {
  const hoje = new Date(); const alvo = new Date(hoje.getTime() + 40 * 86400000);
  const tc = { ...t, slug: "unit2c", configGestao: { calendarioLicenciamento: { 7: `${alvo.getUTCDate()}/${alvo.getUTCMonth() + 1}` } } };
  let est = await J.iniciar(tc, "web:unit-lic-0001", "licenciamento");
  let r = await J.responder(tc, est, { acao: "opcao", valor: "7" });
  let c = J.cartao(tc, r.est);
  assert.equal(c.etapa.id, "debitos", "com calendário pula a data");
  assert.equal(c.prazos[0].data, alvo.toISOString().slice(0, 10));
  assert.deepEqual(r.avisos[0], { lembrete: "LICENCIAMENTO", final: "7", data: c.prazos[0].data });

  est = await J.iniciar(t, "web:unit-lic-0002", "licenciamento");
  r = await J.responder(t, est, { acao: "opcao", valor: "3" });
  c = J.cartao(t, r.est);
  assert.equal(c.etapa.id, "vencimento", "sem calendário pede a data");
  assert.equal(r.avisos.length, 0);
  r = await J.responder(t, r.est, { acao: "data", valor: iso(60) });
  assert.deepEqual(r.avisos, [{ lembrete: "LICENCIAMENTO", data: iso(60) }]);
  assert.equal(J.cartao(t, r.est).prazos[0].rotulo, "Vencimento do licenciamento (final 3)");
});

test("primeira CNH: datas de exames e provas viram prazos; não aceita data passada", async () => {
  let est = await J.iniciar(t, "web:unit-prim-0001", "primeira");
  let r = await J.responder(t, est, { acao: "feito" }); r = await J.responder(t, r.est, { acao: "feito" }); r = await J.responder(t, r.est, { acao: "feito" });
  assert.equal(J.cartao(t, r.est).etapa.id, "exames");
  assert.ok((await J.responder(t, r.est, { acao: "data", valor: iso(-2) })).erro);
  r = await J.responder(t, r.est, { acao: "data", valor: iso(10) });
  assert.equal(J.cartao(t, r.est).prazos[0].rotulo, "Exames médico e psicológico");
});

test("2ª via: roubo pede B.O.; CNH vencida manda para a renovação; dano não pede B.O.", async () => {
  let { c } = await percorrer("web:unit-2via-0001", "segundavia", [{ acao: "opcao", valor: "roubo" }]);
  assert.equal(c.etapa.id, "bo");
  ({ c } = await percorrer("web:unit-2via-0002", "segundavia", [{ acao: "opcao", valor: "dano" }, { acao: "opcao", valor: "vencida" }]));
  assert.equal(c.etapa.id, "renovar");
  ({ c } = await percorrer("web:unit-2via-0003", "segundavia", [{ acao: "opcao", valor: "dano" }, { acao: "opcao", valor: "valida" }]));
  assert.equal(c.etapa.id, "documentos");
  assert.ok(!c.progresso.etapas.some((e) => e.id === "bo" || e.id === "renovar"));
});

test("endereço: cada caminho mostra as etapas e os documentos certos", async () => {
  let { c } = await percorrer("web:unit-end-0001", "endereco", [{ acao: "opcao", valor: "chegou" }, { acao: "pular" }, { acao: "feito" }, { acao: "feito" }]);
  assert.equal(c.etapa.id, "documentos");
  assert.equal(c.etapa.servico, "jurisdicao");
  ({ c } = await percorrer("web:unit-end-0002", "endereco", [{ acao: "opcao", valor: "para" }, { acao: "data", valor: iso(-10) }]));
  assert.equal(c.etapa.servico, "endereco-veiculo");
  assert.equal(c.prazos[0].faltam, 20);
  ({ c } = await percorrer("web:unit-end-0003", "endereco", [{ acao: "opcao", valor: "saiu" }, { acao: "pular" }]));
  assert.equal(c.etapa.id, "outroEstado");
  assert.ok(!c.progresso.etapas.some((e) => e.id === "documentos"));
});

test("todas as jornadas chegam ao fim pelo caminho mais curto", async () => {
  for (const j of Object.values(J.JORNADAS)) {
    let est = await J.iniciar(t, `web:unit-fim-${j.id}`.slice(0, 52), j.id);
    for (let i = 0; i < 20; i++) {
      const c = J.cartao(t, est);
      if (c.concluida) break;
      const e = c.etapa;
      const p = e.tipo === "escolha" ? { acao: "opcao", valor: e.opcoes[0].id } : e.tipo === "data" ? { acao: "data", valor: br(iso(-1)) } : { acao: "feito" };
      let r = await J.responder(t, est, p);
      if (r.erro && e.tipo === "data") r = await J.responder(t, est, { acao: "data", valor: br(iso(5)) }); // etapa que pede data futura
      assert.ok(!r.erro, `${j.id}/${e.id}: ${r.erro}`);
      est = r.est;
    }
    assert.ok(J.cartao(t, est).concluida, `${j.id} não concluiu`);
  }
});

test("WhatsApp: LEVAR e cutucada com oferta de ajuda a partir do 2º aviso", () => {
  const c = { jornada: { titulo: "Comprei um veículo" }, etapa: { titulo: "Vistoria" }, progresso: { atual: 5, total: 9 }, prazos: [], levar: { itens: [{ nome: "Laudo de vistoria", condicional: null }] } };
  assert.match(J.textoLevar(c), /☐ Laudo de vistoria/);
  assert.doesNotMatch(J.textoCutucada(t, c, 0, null), /Travou/);
  assert.match(J.textoCutucada(t, c, 1, null), /Travou nessa etapa\?.*154/s);
});
