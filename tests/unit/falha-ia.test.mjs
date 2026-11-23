// IA do BotAyio fora (22/11/2026): a resposta padrão de falha vira erro e o cidadão
// recebe os canais oficiais, nunca "vou te encaminhar" sem encaminhamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chamarBotAyio, ehRespostaDeFalha, mensagemIndisponivel } from "../../lib/botayio.js";

const FALHA = "Desculpe, tive um problema para responder agora. Vou te encaminhar para um atendente.";
const T = { sigla: "DETRAN-PA", portalUrl: "https://www.detran.pa.gov.br", telefone: "154" };

test("reconhece a resposta padrão de falha do BotAyio", () => {
  assert.equal(ehRespostaDeFalha({ contents: [{ text: FALHA }] }), true);
  assert.equal(ehRespostaDeFalha({ contents: [{ text: "Para transferir o veículo, leve o CRV assinado." }] }), false);
  assert.equal(ehRespostaDeFalha({}), false);
});

test("chamarBotAyio transforma a resposta de falha em erro", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ contents: [{ text: FALHA }] }), { status: 200 });
  try {
    await assert.rejects(chamarBotAyio({ url: "https://bot.test/x", secret: "s" }, { text: "oi" }), /resposta padrão de falha/);
    globalThis.fetch = async () => new Response(JSON.stringify({ contents: [{ text: "ok" }] }), { status: 200 });
    assert.equal((await chamarBotAyio({ url: "https://bot.test/x", secret: "s" }, { text: "oi" })).contents[0].text, "ok");
  } finally { globalThis.fetch = original; }
});

test("mensagem honesta traz portal e telefone e não promete atendente", () => {
  const m = mensagemIndisponivel(T);
  assert.match(m, /detran\.pa\.gov\.br/);
  assert.match(m, /154/);
  assert.doesNotMatch(m, /encaminh|atendente/i);
  assert.match(mensagemIndisponivel(T, { negrito: true }), /\*154\*/);
  assert.match(mensagemIndisponivel({}), /portal oficial/);
});

test("cache não guarda nem devolve a resposta de falha", async () => {
  const { guardarCache, lerCache } = await import("../../lib/cache-respostas.js");
  const P = "Como faço a transferência de um veículo que comprei?";
  assert.equal(await guardarCache("teste-falha", P, { reply: FALHA }), false);
  assert.equal(await guardarCache("teste-falha", P, { reply: "Leve o CRV assinado ao DETRAN." }), true);
  assert.equal((await lerCache("teste-falha", P)).reply, "Leve o CRV assinado ao DETRAN.");
});
