// Observatório (montagem pura), estado curto em memória e tema dos eventos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarObservatorio } from "../../lib/observatorio.js";
import { kvSetEx, kvGetStr, kvDel, kvSetNxEx, storageMode } from "../../store.js";
import { classificarTema } from "../../lib/registro.js";

test("funil das jornadas por etapa, na ordem", () => {
  const agora = Date.now();
  const ev = (tema, n) => Array.from({ length: n }, () => ({ tipo: "JORNADA", tema, criadoEm: new Date(agora - 86400000) }));
  const ob = montarObservatorio({ dias: 7, agora, balcao: [], mensagens: [], eventos: [...ev("venda:debitos", 10), ...ev("venda:documento", 8), ...ev("venda:intencao", 3), ...ev("venda:fim", 2)] });
  const fv = ob.jornadas.find((x) => x.id === "venda");
  assert.ok(fv);
  assert.equal(fv.etapas[0].n, 10);
  assert.equal(fv.etapas[1].n, 8);
  assert.equal(fv.etapas.at(-1).n, 2);
  assert.equal(ob.jornadas.length, 1);
});

test("termos em alta nunca trazem endereço de site", () => {
  const agora = Date.now();
  const msg = (t) => ({ papel: "CIDADAO", texto: t, criadoEm: new Date(agora - 3600000) });
  const ob = montarObservatorio({ dias: 7, agora, balcao: [], eventos: [], mensagens: Array.from({ length: 6 }, () => msg("é golpe? https://bit.ly/abc renovar cnh")) });
  const termos = JSON.stringify(ob.emAlta || []);
  assert.doesNotMatch(termos, /https?|bit\.ly|www\./i);
});

test("estado curto sem KV nem banco: memória, com expiração e gravação única", async () => {
  assert.equal(storageMode(), "memoria");
  await kvSetEx("u:a", "1", 60);
  assert.equal(await kvGetStr("u:a"), "1");
  assert.equal(await kvSetNxEx("u:a", "2", 60), false);
  assert.equal(await kvSetNxEx("u:b", "2", 60), true);
  await kvDel("u:a");
  assert.equal(await kvGetStr("u:a"), null);
  await kvSetEx("u:c", "x", -1);
  assert.equal(await kvGetStr("u:c"), null, "expirado");
});

test("tema dos eventos: golpe e CNH", () => {
  assert.equal(classificarTema("recebi um boleto, é golpe?"), "golpe");
  assert.match(String(classificarTema("como renovar minha cnh")), /cnh/i);
});
