// 24/11/2026: protocolo no fim da jornada (validações e texto do chamado).
import test from "node:test";
import assert from "node:assert/strict";
import { lerAnexo, normalizarFone, descricaoPedido } from "../../lib/protocolo-jornada.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
const pdf = Buffer.from("%PDF-1.4 teste").toString("base64");

test("telefone vira 55 + DDD + número", () => {
  assert.equal(normalizarFone("(91) 99116-0000"), "5591991160000");
  assert.equal(normalizarFone("5562988887777"), "5562988887777");
  assert.equal(normalizarFone("1234"), null);
});

test("anexo: aceita JPG e PDF de verdade, recusa tipo trocado e arquivo grande", () => {
  assert.equal(lerAnexo({ nome: "cnh.jpg", mime: "image/jpeg", base64: "data:image/jpeg;base64," + jpeg }).mime, "image/jpeg");
  assert.equal(lerAnexo({ nome: "bo.pdf", mime: "application/pdf", base64: pdf }).nome, "bo.pdf");
  assert.match(lerAnexo({ nome: "x.pdf", mime: "application/pdf", base64: jpeg }).erro, /não confere/);
  assert.match(lerAnexo({ nome: "x.exe", mime: "application/x-msdownload", base64: jpeg }).erro, /foto .* ou PDF/);
  const grande = Buffer.alloc(2_600_000, 0); grande[0] = 0x25; grande[1] = 0x50;
  assert.match(lerAnexo({ nome: "g.pdf", mime: "application/pdf", base64: grande.toString("base64") }).erro, /2,5 MB/);
  assert.equal(lerAnexo({ nome: "../../etc/passwd", mime: "application/pdf", base64: pdf }).nome.includes("/"), false);
});

test("descrição do chamado traz as respostas, os prazos e o aviso de demonstração", () => {
  const t = { slug: "go", sigla: "DETRAN-GO", uf: "GO", portalUrl: "https://www.detran.go.gov.br", demonstracao: true };
  const est = { jornada: "segundavia", idx: 5, dados: { motivo: "perda", validade: "valida" } };
  const d = descricaoPedido(t, est, { nome: "Maria Teste da Silva", cpf: "", telefone: "5562999990000", observacao: "Teste", anexos: [{ nome: "bo.pdf" }] });
  assert.match(d, /2ª via da CNH/);
  assert.match(d, /DEMONSTRAÇÃO/);
  assert.match(d, /O que aconteceu: Perdi/);
  assert.match(d, /A CNH está na validade\?: Sim, estava válida/);
  assert.match(d, /Anexos \(1\): bo\.pdf/);
  assert.match(d, /Observação do cidadão:\nTeste/);
});
