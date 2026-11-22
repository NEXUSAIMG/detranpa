// Cache das perguntas frequentes e medição de tempo (estado em memória).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerCache, guardarCache, invalidarCache, cacheavel, normalizarPergunta, registrarTempo, resumoTempos } from "../../lib/cache-respostas.js";

test("pergunta igual com outra grafia acerta o cache", async () => {
  assert.equal(await guardarCache("u1", "Como renovar a CNH?", { reply: "Assim." }), true);
  assert.equal((await lerCache("u1", "como RENOVAR a cnh"))?.reply, "Assim.");
  assert.equal(normalizarPergunta("Renovação  da CNH!"), "renovacao da cnh");
});

test("cada DETRAN tem o seu cache", async () => {
  await guardarCache("u2", "qual o telefone do detran", { reply: "154" });
  assert.equal(await lerCache("u3", "qual o telefone do detran"), null);
});

test("perguntas com dados pessoais não entram", () => {
  assert.equal(cacheavel("meu cpf é 12345678900, tenho multa?"), false);
  assert.equal(cacheavel("placa ABC1D23 tem multa?"), false);
  assert.equal(cacheavel("meu email é a@b.com"), false);
  assert.equal(cacheavel("oi"), false);
  assert.equal(cacheavel("como transferir um carro"), true);
});

test("resposta com número longo não é guardada", async () => {
  assert.equal(await guardarCache("u4", "qual o protocolo", { reply: "Seu protocolo é 2026123456789" }), false);
});

test("ensinar na Tutoria invalida o cache do DETRAN", async () => {
  await guardarCache("u5", "como tirar a segunda via", { reply: "Antiga." });
  assert.ok(await lerCache("u5", "como tirar a segunda via"));
  await new Promise((r) => setTimeout(r, 5));
  await invalidarCache("u5");
  assert.equal(await lerCache("u5", "como tirar a segunda via"), null);
});

test("desligado por variável de ambiente", async () => {
  process.env.CACHE_RESPOSTAS = "0";
  try { assert.equal(await guardarCache("u6", "como renovar a cnh", { reply: "x" }), false); }
  finally { delete process.env.CACHE_RESPOSTAS; }
});

test("resumo de tempos: mediana, 95% e parcela abaixo de 8 s", async () => {
  for (const ms of [1000, 2000, 3000, 4000, 9000]) await registrarTempo("u7", ms, "bot");
  await registrarTempo("u7", 5, "cache");
  const r = await resumoTempos("u7");
  assert.equal(r.n, 6);
  assert.equal(r.doCache, 1);
  assert.equal(r.p95Ms, 9000);
  assert.equal(r.abaixo8s, 83);
});
