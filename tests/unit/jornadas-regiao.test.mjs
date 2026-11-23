// Jornadas em vários DETRANs: nada de "Pará" (guia, secretaria, unidades, expressões) fora do PA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JORNADAS, reg } from "../../lib/jornadas.js";

const PA = { slug: "pa", uf: "PA", sigla: "DETRAN-PA", portalUrl: "https://www.detran.pa.gov.br", telefone: "154" };
const GO = { slug: "go", uf: "GO", sigla: "DETRAN-GO", portalUrl: "https://www.detran.go.gov.br", telefone: "154" };
const dadosVariados = [{}, { documento: "papel", destino: "chegou", motivo: "roubo", validade: "vencida", dataVenda: "2026-11-01", recebimento: "2026-11-01" }, { documento: "digital", destino: "saiu", motivo: "perda" }];

function textos(t) {
  const out = [];
  for (const j of Object.values(JORNADAS)) {
    out.push(j.titulo, j.resumo);
    for (const d of dadosVariados) {
      for (const e of j.etapas) { out.push(e.titulo, e.texto(t, d), ...(e.opcoes || []).map((o) => o.rotulo)); }
      if (j.levarExtra) out.push(...j.levarExtra(t, d));
    }
  }
  return out.join("\n");
}

test("DETRAN-GO: nenhuma etapa fala do Pará", () => {
  const s = textos(GO);
  for (const proibido of [/Pará/, /Égua/, /CIRETRAN/, /Belém/, /\bSEFA\b/, /\bDAE\b/, /Pai D'Égua/]) assert.doesNotMatch(s, proibido, String(proibido));
  assert.match(s, /DUA/); assert.match(s, /Economia-GO/); assert.match(s, /em Goiás/); assert.match(s, /Vapt Vupt/);
});

test("DETRAN-PA: mantém os termos dele", () => {
  const s = textos(PA);
  for (const ok of [/Égua/, /\bDAE\b/, /SEFA/, /CIRETRAN/, /no Pará/, /Pai D'Égua/]) assert.match(s, ok, String(ok));
});

test("outro estado sem cadastro: termos neutros", () => {
  const r = reg({ uf: "MG" });
  assert.equal(r.noEstado, "em Minas Gerais");
  assert.equal(r.guia, "guia");
  assert.equal(reg({}).noEstado, "no seu estado");
  assert.doesNotMatch(textos({ slug: "mg", uf: "MG", sigla: "DETRAN-MG", portalUrl: "https://x" }), /Pará|Égua|CIRETRAN|\bDAE\b/);
});
