import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { formaCanonica, lerCache, guardarCache, invalidarCache } from "../../lib/cache-respostas.js";
import { custoReais, precoDo, resumoUso, registrarUso } from "../../lib/uso-ia.js";
import { perguntarRapido, somarUso } from "../../lib/botayio.js";
import { montarResposta } from "../../lib/aquecer-cache.js";
import { urlComTeto } from "../../lib/db.js";
import { contarNaJanela } from "../../store.js";

test("forma canônica junta perguntas parecidas e separa as diferentes", () => {
  const iguais = ["Como renovo a CNH?", "como renovar a cnh", "Renovação da carteira de motorista", "Quero renovar minha habilitação"];
  assert.equal(new Set(iguais.map(formaCanonica)).size, 1);
  assert.notEqual(formaCanonica("Como tirar a CNH categoria A?"), formaCanonica("Como tirar a CNH categoria B?"));
  assert.notEqual(formaCanonica("Como renovar a CNH?"), formaCanonica("Como tirar a CNH?"));
  assert.notEqual(formaCanonica("multa de 2024"), formaCanonica("multa de 2025"));
});

test("cache responde a pergunta parecida e some quando a base muda", async () => {
  delete process.env.CACHE_RESPOSTAS;
  assert.equal(await guardarCache("tu", "Como renovo a CNH?", { reply: "Leve RG e CPF." }), true);
  assert.equal((await lerCache("tu", "renovação da carteira de motorista"))?.reply, "Leve RG e CPF.");
  assert.equal(await lerCache("tu", "como tirar a CNH?"), null);
  await invalidarCache("tu");
  assert.equal(await lerCache("tu", "Como renovo a CNH?"), null);
  assert.equal(await guardarCache("tu", "oi", { reply: "x" }), false, "pergunta vazia demais não entra");
});

test("custo real: preço por modelo, sem preço = null", () => {
  assert.deepEqual(precoDo("claude-haiku-4-5-20251001")?.chave, "claude-haiku-4-5");
  assert.equal(precoDo("modelo-desconhecido"), null);
  const c = custoReais({ entrada: 1_000_000, saida: 100_000, cache_lido: 500_000 }, "claude-haiku-4-5");
  assert.ok(Math.abs(c - (1 + 0.5 + 0.05) * 5.07) < 1e-9);
  process.env.PRECOS_IA = '{"meu-modelo":[2,4,0.5]}';
  assert.ok(custoReais({ entrada: 1e6 }, "meu-modelo-v2") > 0);
  delete process.env.PRECOS_IA;
});

test("uso registrado e somado no mês", async () => {
  await registrarUso("tu", "WEB", { entrada: 1000, saida: 200, cache_lido: 3000, cache_gravado: 0, chamadas: 1, modelos: ["claude-haiku-4-5"] });
  await registrarUso("tu", "WEB", { entrada: 500, saida: 100, cache_lido: 0, chamadas: 1, modelos: ["claude-haiku-4-5"] });
  await registrarUso("tu", "WEB", null);
  const r = await resumoUso("tu");
  assert.equal(r.respostas, 2);
  assert.equal(r.tokens.entrada, 1500);
  assert.ok(r.custoReais > 0 && r.custoPorResposta > 0);
  assert.deepEqual(somarUso({ entrada: 1, saida: 2, chamadas: 1, modelos: ["a"] }, { entrada: 3, chamadas: 1, modelos: ["b"] }).entrada, 4);
});

test("montarResposta tira [[SEMBASE]], junta partes e marca jornada", () => {
  const r = montarResposta({ contents: [{ text: "Não sei. [[SEMBASE]]" }, { text: "Veja o portal", buttons: [{ title: "Portal" }] }], handed_off: false }, "vendi meu carro, e agora?");
  assert.equal(r.semBase, true);
  assert.ok(!r.reply.includes("SEMBASE") && r.reply.includes("[[BREAK]]") && r.reply.includes("1. Portal"));
  assert.match(r.final, /\[\[JORNADA:venda\]\]$/);
});

test("teto de conexões na URL do banco", () => {
  assert.equal(urlComTeto("mysql://u@h/db", 3), "mysql://u@h/db?connection_limit=3&pool_timeout=10");
  assert.equal(urlComTeto("mysql://u@h/db?ssl=true", 2), "mysql://u@h/db?ssl=true&connection_limit=2&pool_timeout=10");
  assert.equal(urlComTeto("mysql://u@h/db?connection_limit=9", 3), "mysql://u@h/db?connection_limit=9");
});

test("contador compartilhado soma na janela", async () => {
  const k = "teste:" + Date.now();
  assert.equal(await contarNaJanela(k, 60), 1);
  assert.equal(await contarNaJanela(k, 60), 2);
});

// BotAyio falso: /stream manda pedaços; o normal responde JSON.
function botFalso(handler) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => handler(req, res, JSON.parse(b || "{}"))); });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

test("primeira pergunta: uma chamada só, com transmissão", async () => {
  const chamadas = [];
  const s = await botFalso((req, res, body) => {
    chamadas.push({ url: req.url, body });
    res.setHeader("Content-Type", "application/x-ndjson");
    res.write(JSON.stringify({ delta: "Para " }) + "\n");
    res.write(JSON.stringify({ delta: "renovar" }) + "\n");
    res.end(JSON.stringify({ fim: { contents: [{ text: "Para renovar" }], uso: { entrada: 10, saida: 2, chamadas: 1, modelos: ["m"] } } }) + "\n");
  });
  const pedacos = [];
  const url = `http://127.0.0.1:${s.address().port}/webhooks/seucartorio/x`;
  const r = await perguntarRapido({ url, secret: "s" }, "sess", "como renovo?", true, {}, (d) => pedacos.push(d));
  s.close();
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/stream$/);
  assert.equal(chamadas[0].body.sem_saudacao, true);
  assert.equal(chamadas[0].body.reiniciar, true);
  assert.deepEqual(pedacos, ["Para ", "renovar"]);
  assert.equal(r.contents[0].text, "Para renovar");
  assert.equal(r.uso.entrada, 10);
});

test("BotAyio antigo (sem /stream e sem sem_saudacao): cai no caminho de antes", async () => {
  const chamadas = [];
  const s = await botFalso((req, res, body) => {
    chamadas.push(req.url);
    if (req.url.endsWith("/stream")) { res.statusCode = 404; return res.end("{}"); }
    // sessão nova: só cumprimenta e avisa que o texto foi ignorado
    if (chamadas.length === 2) return res.end(JSON.stringify({ contents: [{ text: "Olá!" }], texto_ignorado: true }));
    res.end(JSON.stringify({ contents: [{ text: "Resposta" }] }));
  });
  const url = `http://127.0.0.1:${s.address().port}/webhooks/seucartorio/x`;
  const r = await perguntarRapido({ url, secret: "s" }, "sess", "como renovo?", true, {}, () => {});
  s.close();
  assert.equal(chamadas.length, 3);
  assert.deepEqual(r.contents.map((c) => c.text), ["Olá!", "Resposta"]);
});
