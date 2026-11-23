// "O que levar" e o lembrete da transferência (sem estado: não usa o armazenamento).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JORNADAS } from "../../lib/jornadas.js";
import { oQueLevar } from "../../lib/jornadas-api.js";
import { montar, TIPOS } from "../../lib/lembretes.js";

const t = { id: "t-unit3", slug: "unit3", sigla: "DETRAN-TT", portalUrl: "https://detran.tt.gov.br", telefone: "154" };
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const br = (s) => s.split("-").reverse().join("/");

test("o que levar: itens da conferência do serviço + itens da jornada, sem repetir", () => {
  const papel = oQueLevar(t, JORNADAS.compra, { documento: "papel" });
  assert.ok(papel.itens.some((i) => /CRV/.test(i.nome) && /ATPV-e/.test(i.nome)));
  assert.equal(papel.itens.filter((i) => /vistoria/i.test(i.nome)).length, 1, "vistoria aparece uma vez só");
  assert.ok(papel.itens.some((i) => /DAE/.test(i.nome)));
  assert.equal(new Set(papel.itens.map((i) => i.nome)).size, papel.itens.length);
  assert.ok(oQueLevar(t, JORNADAS.primeira, {}).itens.some((i) => /CPF/.test(i.nome)));
  assert.ok(oQueLevar(t, JORNADAS.segundavia, {}).itens.some((i) => /[Bb]oletim/.test(i.nome)));
  assert.equal(oQueLevar(t, JORNADAS.endereco, { destino: "saiu" }), null);
  assert.ok(oQueLevar(t, JORNADAS.endereco, { destino: "chegou" }).itens.some((i) => /CRV original/.test(i.nome)));
  assert.ok(oQueLevar(t, JORNADAS.defesa, {}).itens.some((i) => /notificação/.test(i.nome)));
  for (const j of Object.values(JORNADAS)) oQueLevar(t, j, {}); // nenhuma quebra sem dados
});

test("lembrete da transferência: data da compra + 30 dias", () => {
  assert.ok(TIPOS.TRANSFERENCIA);
  const m = montar(t, { tipo: "TRANSFERENCIA", data: br(iso(-10)) });
  assert.ok(!m.erro, m.erro);
  assert.equal(m.dados.dataAlvo.toISOString().slice(0, 10), iso(20));
  assert.match(m.dados.descricao, /compra em/);
  assert.ok(montar(t, { tipo: "TRANSFERENCIA", data: br(iso(-40)) }).erro, "prazo já passou");
});
