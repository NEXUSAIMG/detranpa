import { test } from "node:test";
import assert from "node:assert/strict";
import { montarImpacto, compararMedicoes, limparOrigem, limparMedicao, ORIGEM_RE, linkComOrigem } from "../../lib/impacto.js";

const agora = Date.now();
const ev = (tipo, tema, diasAtras = 1) => ({ tipo, tema, criadoEm: new Date(agora - diasAtras * 86400_000).toISOString() });

test("montarImpacto conta viagens evitadas, taxa e horas", () => {
  const I = montarImpacto([
    ev("IMPACTO", "sim:conferencia:transferencia"), ev("IMPACTO", "sim:jornada:venda"), ev("IMPACTO", "nao:jornada:venda"), ev("IMPACTO", "talvez:conferencia:transferencia"),
    ev("MARCO", "conferencia-ok:transferencia"), ev("JORNADA", "venda:fim"), ev("JORNADA", "venda:debitos"),
    ev("GOLPE", "golpe"), ev("GOLPE", "atencao"), ev("TUTORIA", "ensinou"), ev("ORIGEM", "balcao-sede"), ev("ORIGEM", "balcao-sede"), ev("ORIGEM", "instagram"),
  ]);
  assert.equal(I.viagensEvitadas, 2);
  assert.equal(I.respostas, 4);
  assert.equal(I.taxaEvitou, 50);
  assert.equal(I.conferenciasOk, 1);
  assert.equal(I.jornadasConcluidas, 1);
  assert.equal(I.golpesBarrados, 1);
  assert.equal(I.lacunasCorrigidas, 1);
  assert.equal(I.horasCidadao, 4);
  assert.equal(I.horasServidor, 0.7);
  assert.deepEqual(I.origens[0], { origem: "balcao-sede", n: 2 });
  const venda = I.porContexto.find((x) => x.contexto === "jornada:venda");
  assert.equal(venda.sim, 1); assert.equal(venda.nao, 1);
});

test("montarImpacto respeita o corte de data e não inventa taxa sem respostas", () => {
  const I = montarImpacto([ev("IMPACTO", "sim:jornada:venda", 40)], { desde: agora - 30 * 86400_000 });
  assert.equal(I.viagensEvitadas, 0);
  assert.equal(I.taxaEvitou, null);
});

test("compararMedicoes: linha de base x última, sinal de melhora", () => {
  assert.equal(compararMedicoes([]), null);
  const c = compararMedicoes([
    { data: "2026-10-01", tempoBalcaoMin: 20, retornoPct: 30, atendimentosMes: 1000 },
    { data: "2026-11-01", tempoBalcaoMin: 15, retornoPct: 33, atendimentosMes: 900 },
  ]);
  assert.equal(c.base, "2026-10-01"); assert.equal(c.ultima, "2026-11-01"); assert.equal(c.mesma, false);
  const t = c.campos.find((x) => x.campo === "tempoBalcaoMin");
  assert.equal(t.variacao, -25); assert.equal(t.bom, true);
  assert.equal(c.campos.find((x) => x.campo === "retornoPct").bom, false);
  assert.equal(c.campos.find((x) => x.campo === "atendimentosMes").bom, null);
  assert.equal(compararMedicoes([{ data: "2026-10-01", esperaMin: 5 }]).mesma, true);
});

test("limparOrigem e ORIGEM_RE aceitam só rótulos simples", () => {
  assert.equal(limparOrigem("Balcão da Sede!"), "balcao-da-sede");
  assert.equal(limparOrigem("<script>"), "script");
  assert.ok(ORIGEM_RE.test("ciretran-santarem"));
  assert.ok(!ORIGEM_RE.test("a b"));
  assert.ok(!ORIGEM_RE.test("x".repeat(41)));
  assert.equal(linkComOrigem("https://x", "go", "balcao"), "https://x/go?origem=balcao");
});

test("limparMedicao descarta valores inválidos e limita textos", () => {
  const m = limparMedicao({ data: "ontem", tempoBalcaoMin: "12.34", esperaMin: -3, retornoPct: "abc", ligacoesMes: "", fonte: "x".repeat(300), extra: "nao" });
  assert.match(m.data, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(m.tempoBalcaoMin, 12.3);
  assert.ok(!("esperaMin" in m)); assert.ok(!("retornoPct" in m)); assert.ok(!("ligacoesMes" in m)); assert.ok(!("extra" in m));
  assert.equal(m.fonte.length, 200);
});
