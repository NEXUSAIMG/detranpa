// Antigolpe: veredictos determinísticos (sem rede, sem banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { analisarSuspeita, pareceVerificacao, textoParaChat, mod10 } from "../../lib/antigolpe.js";

const GO = { sigla: "DETRAN-GO", portalUrl: "https://www.goias.gov.br/detran" };

test("mensagem clássica de golpe -> golpe, com os sinais", () => {
  const r = analisarSuspeita("DETRAN-GO: sua CNH sera BLOQUEADA hoje. Pague a multa com 70% de desconto via PIX ou em bit.ly/detran-go-multa", GO);
  assert.equal(r.nivel, "golpe");
  const s = r.sinais.join(" ");
  assert.match(s, /encurtado/i);
  assert.match(s, /PIX/);
  assert.match(s, /desconto/i);
});

test("portal oficial -> sem sinais, com aviso de conferir", () => {
  const r = analisarSuspeita("Consulte seus debitos em https://www.goias.gov.br/detran", GO);
  assert.equal(r.nivel, "sem_sinais");
  assert.ok(r.aviso);
});

test("texto sem conteúdo verificável -> sem_dados", () => {
  assert.equal(analisarSuspeita("ola tudo bem?", GO).nivel, "sem_dados");
});

test("linha digitável correta: boleto comum, sem falar em dígito errado", () => {
  const r = analisarSuspeita("00190.00009 02712.345673 89012.345172 9 12340000015000", GO);
  assert.equal(r.nivel, "atencao");
  assert.ok(!r.sinais.some((s) => /verificador errado/.test(s)));
});

test("linha digitável com um número trocado: aponta dígito verificador errado", () => {
  const r = analisarSuspeita("00190.00009 02812.345673 89012.345172 9 12340000015000", GO);
  assert.ok(r.sinais.some((s) => /verificador errado/.test(s)));
});

test("mod10 confere o primeiro campo do boleto", () => {
  assert.equal(mod10("001900000"), 9);
});

test("texto para WhatsApp usa *negrito* e nunca **", () => {
  const r = analisarSuspeita("Pague via PIX em bit.ly/x com 70% de desconto, ultimo aviso", GO);
  const t = textoParaChat(r, { negrito: "*" });
  assert.match(t, /\*Muito prov.vel que seja GOLPE\*/);
  assert.doesNotMatch(t, /\*\*/);
});

test("pareceVerificacao reconhece pedido de conferência", () => {
  assert.equal(pareceVerificacao("recebi essa mensagem, é golpe? bit.ly/abc"), true);
  assert.equal(pareceVerificacao("como renovo minha cnh"), false);
});
