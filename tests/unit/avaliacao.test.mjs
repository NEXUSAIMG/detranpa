// O corretor da avaliação e o próprio conjunto de perguntas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { corrigir, normalizar } from "../../scripts/avaliar-respostas.mjs";

const conjunto = JSON.parse(readFileSync(new URL("../avaliacao/perguntas-pa.json", import.meta.url), "utf8"));

test("conjunto tem 100+ perguntas, ids únicos e grupos válidos", () => {
  const ps = conjunto.perguntas;
  assert.ok(ps.length >= 100, `só ${ps.length}`);
  assert.equal(new Set(ps.map((p) => p.id)).size, ps.length);
  for (const p of ps) {
    assert.ok(p.p && p.cat, p.id);
    assert.ok(Array.isArray(p.deve) && p.deve.length && p.deve.every((g) => Array.isArray(g) && g.length), p.id);
  }
  assert.ok(ps.filter((p) => p.id.startsWith("sab-")).length >= 5, "precisa testar o 'não inventar'");
});

test("corretor: ignora acentos e maiúsculas, exige cada grupo", () => {
  const item = { deve: [["30 dias"], ["comprador"]], nao: ["vendedor faz"] };
  assert.equal(corrigir(item, "O COMPRADOR tem 30 DIAS.").ok, true);
  assert.equal(corrigir(item, "Tem 30 dias.").ok, false);
  assert.equal(corrigir(item, "O comprador tem 30 dias, mas o vendedor faz antes.").ok, false);
  assert.equal(corrigir(item, "").ok, false);
  assert.equal(normalizar("Renovação"), "renovacao");
});

test("corretor reprova marcador interno vazado", () => {
  assert.equal(corrigir({ deve: [["cnh"]] }, "Renove a CNH [[SEMBASE]]").ok, false);
});
