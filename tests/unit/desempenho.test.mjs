// Correções de desempenho (22/11/2026): relatos de golpe, orientação, limites e avaliação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pareceVerificacao, pareceRelatoDeGolpe, perguntaCobrancaPorMensagem, respostaCobrancaPorMensagem, analisarSuspeita } from "../../lib/antigolpe.js";
import { limparResposta, nota010, corrigir } from "../../scripts/avaliar-respostas.mjs";

const T = { sigla: "DETRAN-PA", portalUrl: "https://www.detran.pa.gov.br", telefone: "154" };
const { perguntas } = JSON.parse(readFileSync(new URL("../avaliacao/perguntas-pa.json", import.meta.url), "utf8"));

test("relatos de golpe vão para o antigolpe e saem como GOLPE", () => {
  for (const p of [
    "Recebi SMS dizendo que minha CNH vai ser bloqueada e pedindo PIX. É verdade?",
    "Me mandaram um boleto de multa com 70% de desconto pelo WhatsApp, posso pagar?",
    "recebi um sms com link pra regularizar minha multa",
    "Me ligaram dizendo que minha CNH foi suspensa e pediram meu código",
  ]) {
    assert.ok(pareceVerificacao(p), p);
    assert.equal(analisarSuspeita(p, T).nivel, "golpe", p);
  }
});

test("relato sem sinal claro pede a mensagem (não acusa à toa)", () => {
  const p = "Recebi um e-mail com o boleto do licenciamento, posso pagar?";
  assert.ok(pareceRelatoDeGolpe(p));
  assert.equal(analisarSuspeita(p, T).nivel, "sem_dados");
});

test("perguntas comuns NÃO são desviadas para o antigolpe (conjunto de 111)", () => {
  const desviadas = perguntas.filter((q) => !q.cat.startsWith("Golpes") && (pareceVerificacao(q.p) || perguntaCobrancaPorMensagem(q.p)));
  assert.deepEqual(desviadas.map((q) => q.id), []);
  for (const p of ["Recebi uma notificação de autuação pelo correio, o que faço?", "Recebi mensagem do DETRAN no WhatsApp dizendo que a CNH ficou pronta"]) assert.ok(!pareceVerificacao(p), p);
});

test("orientação: o DETRAN não cobra por link/WhatsApp", () => {
  assert.ok(perguntaCobrancaPorMensagem("O DETRAN manda cobrança por link no WhatsApp?"));
  assert.ok(perguntaCobrancaPorMensagem("o detran envia sms pedindo pix?"));
  assert.ok(!perguntaCobrancaPorMensagem("Qual o telefone do DETRAN?"));
  const r = respostaCobrancaPorMensagem(T);
  assert.match(r, /Não\. O DETRAN-PA não cobra/);
  assert.match(r, /golpe/);
  assert.match(r, /detran\.pa\.gov\.br/);
});

test("avaliação: limpa marcadores como o site e dá nota de 0 a 10", () => {
  const limpa = limparResposta("Parte 1\n[[BREAK]]\nParte 2 [[FORM:procuracao]]\n[[JORNADA:venda]]");
  assert.ok(!/\[\[/.test(limpa) && /^Parte 1\n\n+Parte 2$/.test(limpa), JSON.stringify(limpa));
  assert.equal(nota010(87.4), 8.7);
  assert.equal(corrigir({ deve: [["golpe"]] }, limparResposta("🚨 É golpe\n[[BREAK]]\nNão pague")).ok, true);
});
