// Despachante Parente: motor das jornadas (estado em memória; sem banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as J from "../../lib/jornadas.js";

const t = { id: "t-unit", slug: "unit", sigla: "DETRAN-TT", portalUrl: "https://detran.tt.gov.br" };
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const br = (iso) => iso.split("-").reverse().join("/");

test("gatilhos de cada jornada", () => {
  assert.equal(J.detectarJornada("vendi meu carro semana passada, o que faço?"), "venda");
  assert.equal(J.detectarJornada("minha CNH venceu, como renovar?"), "renovacao");
  assert.equal(J.detectarJornada("quero recorrer da multa que recebi"), "defesa");
  assert.equal(J.detectarJornada("qual o horário de atendimento?"), null);
});

test("dono válido: só web:<sessão> ou wa:<telefone>", () => {
  assert.ok(J.donoValido("web:abcdefgh12"));
  assert.ok(J.donoValido("wa:5591999998888"));
  assert.ok(!J.donoValido("web:../../x"));
  assert.ok(!J.donoValido("wa:123"));
});

test("venda digital: ramifica, recusa data futura, conta o prazo de 30 dias e conclui", async () => {
  const eventos = [];
  let est = await J.iniciar(t, "web:unit-venda-0001", "venda", { registrar: (e) => eventos.push(e) });
  assert.equal(J.cartao(t, est).etapa.id, "debitos");
  let r = await J.responder(t, est, { acao: "feito" });
  r = await J.responder(t, r.est, { acao: "feito" });
  assert.ok(r.erro, "escolha exige uma opção");
  r = await J.responder(t, r.est, { acao: "opcao", valor: "digital" });
  let c = J.cartao(t, r.est);
  assert.equal(c.etapa.id, "intencao");
  assert.ok(c.progresso.etapas.every((x) => x.id !== "crv"));
  r = await J.responder(t, r.est, { acao: "feito" });
  r = await J.responder(t, r.est, { acao: "feito" });
  assert.ok((await J.responder(t, r.est, { acao: "data", valor: "01/01/2099" })).erro);
  r = await J.responder(t, r.est, { acao: "data", valor: br(diasAtras(27)) });
  c = J.cartao(t, r.est);
  assert.equal(c.etapa.id, "comunicacao");
  assert.equal(c.prazos[0].faltam, 3);
  r = await J.responder(t, r.est, { acao: "voltar" });
  assert.equal(J.cartao(t, r.est).etapa.id, "dataVenda");
  r = await J.responder(t, r.est, { acao: "data", valor: diasAtras(27) });
  r = await J.responder(t, r.est, { acao: "feito" });
  assert.ok(J.cartao(t, r.est).concluida);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, "JORNADA");
  assert.equal(eventos[0].tema, "venda:debitos");
});

test("renovação: data obrigatória, prorrogação da Resolução 1.033 e exame opcional", async () => {
  const est = await J.iniciar(t, "web:unit-cnh-00001", "renovacao");
  assert.ok((await J.responder(t, est, { acao: "pular" })).erro);
  let r = await J.responder(t, est, { acao: "data", valor: "2026-08-15" });
  const c = J.cartao(t, r.est);
  assert.ok(c.prazos[0].aviso);
  assert.match(c.prazos[0].rotulo, /1\.033/);
  assert.equal(r.avisos[0].lembrete, "CNH");
  r = await J.responder(t, r.est, { acao: "feito" });
  r = await J.responder(t, r.est, { acao: "feito" });
  r = await J.responder(t, r.est, { acao: "pular" });
  assert.equal(J.cartao(t, r.est).etapa.id, "biometria");
});

test("WhatsApp: texto com progresso e comandos", async () => {
  const est = await J.iniciar(t, "wa:5591900000001", "defesa", { canal: "WHATSAPP" });
  const c = J.cartao(t, est);
  assert.match(J.textoWhatsApp(c), /etapa 1 de 6/);
  assert.equal(J.comandoWhatsApp(c, "10/11/2026")?.acao, "data");
  assert.equal(J.comandoWhatsApp(c, "qual o endereço?"), null);
  await J.sair(t, "wa:5591900000001");
  assert.equal(await J.lerJornada("unit", "wa:5591900000001"), null);
});
