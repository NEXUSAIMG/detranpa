// 24/11/2026: documentos para preencher aparecem dentro das jornadas.
import test from "node:test";
import assert from "node:assert/strict";
import { cartao, textoWhatsApp, JORNADAS } from "../../lib/jornadas.js";

const T = { slug: "go", sigla: "DETRAN-GO", uf: "GO", portalUrl: "https://www.detran.go.gov.br" };
const est = (jornada, dados = {}, idx = 0) => ({ jornada, idx, dados });

test("2ª via mostra a declaração de residência em todas as etapas, menos na final", () => {
  const c = cartao(T, est("segundavia"));
  assert.deepEqual(c.formularios.map((f) => f.id), ["declaracao-residencia"]);
  assert.equal(c.formularios[0].titulo, "Declaração de residência");
  const ultima = JORNADAS.segundavia.etapas.length - 1;
  const fim = cartao(T, est("segundavia", { motivo: "dano", validade: "valida" }, ultima));
  assert.equal(fim.concluida, true);
  assert.deepEqual(fim.formularios, []);
});

test("venda: o documento da etapa não se repete na lista; CRV de papel troca as declarações", () => {
  const digital = cartao(T, est("venda", { documento: "digital" }, 2)); // etapa "Intenção de venda"
  assert.equal(digital.etapa.formId, "intencao-venda");
  assert.ok(!digital.formularios.some((f) => f.id === "intencao-venda"));
  const papel = cartao(T, est("venda", { documento: "papel" }, 0));
  const ids = papel.formularios.map((f) => f.id);
  assert.ok(ids.includes("assinatura-indevida") && !ids.includes("intencao-venda"));
});

test("WhatsApp lista os links dos documentos", () => {
  const antes = process.env.PUBLIC_URL;
  process.env.PUBLIC_URL = "https://exemplo.test";
  try {
    const s = textoWhatsApp(cartao(T, est("compra")));
    assert.match(s, /Documentos para preencher/);
    assert.match(s, /Procuração particular: https:\/\/exemplo\.test\/go\?doc=procuracao/);
  } finally { process.env.PUBLIC_URL = antes; }
});

test("licenciamento e defesa não oferecem documentos", () => {
  assert.deepEqual(cartao(T, est("licenciamento")).formularios, []);
  assert.deepEqual(cartao(T, est("defesa")).formularios, []);
});
