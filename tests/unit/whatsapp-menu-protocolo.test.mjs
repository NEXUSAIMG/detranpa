// 24/11/2026: MENU por assunto e conversa de protocolo no WhatsApp (sem banco).
import test from "node:test";
import assert from "node:assert/strict";
import { tratarMenuWhatsApp, ASSUNTOS_PADRAO } from "../../lib/assuntos.js";
import { tratarProtocoloWhatsApp, urlBaixavel } from "../../lib/protocolo-jornada.js";
import { iniciar, responder, lerJornada, JORNADAS } from "../../lib/jornadas.js";
import { lerMensagem } from "../../whatsapp.js";

const T = { id: "t-go", slug: "gotest", sigla: "DETRAN-GO", uf: "GO", portalUrl: "https://www.detran.go.gov.br", demonstracao: true, conteudo: {} };

test("MENU lista os assuntos; números levam aos serviços e à jornada", async () => {
  const fone = "5562900000001";
  let r = await tratarMenuWhatsApp(T, fone, "menu");
  assert.match(r.textos[0], /\*1\* — .*Veículos/);
  r = await tratarMenuWhatsApp(T, fone, "2");
  assert.match(r.textos[0], /Habilitação/);
  assert.match(r.textos[0], /2ª via da CNH 🧭/);
  r = await tratarMenuWhatsApp(T, fone, "3"); // 2ª via da CNH -> jornada
  assert.match(r.textos[0], /2ª via da CNH\* — etapa 1/);
  assert.equal((await lerJornada(T.slug, `wa:${fone}`)).jornada, "segundavia");
  assert.equal(await tratarMenuWhatsApp(T, fone, "1"), null, "fora do menu, número não é do menu");
});

test("MENU: serviço sem jornada vira a pergunta para o assistente; 0 volta", async () => {
  const fone = "5562900000002";
  await tratarMenuWhatsApp(T, fone, "servicos");
  await tratarMenuWhatsApp(T, fone, "3"); // Multas
  let r = await tratarMenuWhatsApp(T, fone, "0");
  assert.match(r.textos[0], /Do que você precisa/);
  await tratarMenuWhatsApp(T, fone, "3");
  r = await tratarMenuWhatsApp(T, fone, "3"); // Consultar pontos
  assert.equal(r.pergunta, ASSUNTOS_PADRAO[2].itens[2].q);
});

test("PROTOCOLAR só depois de concluir; depois pede nome, CPF, arquivos e SIM", async () => {
  const fone = "5562900000003";
  let r = await tratarProtocoloWhatsApp(T, fone, { texto: "protocolar" });
  assert.match(r.textos[0], /primeiro conclua/);
  // conclui a 2ª via
  let est = await iniciar(T, `wa:${fone}`, "segundavia", { canal: "WHATSAPP" });
  est = (await responder(T, est, { acao: "opcao", valor: "dano" })).est;
  est = (await responder(T, est, { acao: "opcao", valor: "valida" })).est;
  for (let i = 0; i < 3; i++) est = (await responder(T, est, { acao: "feito" })).est;
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "PROTOCOLAR" });
  assert.match(r.textos[0], /nome completo/);
  assert.match(r.textos[0], /demonstração/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "Maria" });
  assert.match(r.textos[0], /nome completo/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "Maria Teste da Silva" });
  assert.match(r.textos[0], /CPF/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "PULAR" });
  assert.match(r.textos[0], /fotos ou PDFs/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "", anexo: { url: "https://exemplo.test/f.jpg", mime: "image/jpeg", nome: "" } });
  assert.match(r.textos[0], /Recebi \(1 de até 6\)/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "", anexo: { url: "https://exemplo.test/a.mp4", mime: "video/mp4", nome: "" } });
  assert.match(r.textos[0], /não consigo juntar/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "pronto" });
  assert.match(r.textos[0], /Nome: Maria Teste da Silva/);
  assert.match(r.textos[0], /Arquivos: 1/);
  assert.match(r.textos[0], /Responda \*SIM\*/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "talvez" });
  assert.match(r.textos[0], /Responda \*SIM\*/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "cancelar" });
  assert.match(r.textos[0], /cancelei/);
  assert.equal(await tratarProtocoloWhatsApp(T, fone, { texto: "oi" }), null, "sem protocolo em andamento, segue para o resto");
});

test("só baixa arquivos de endereço https público", () => {
  assert.equal(urlBaixavel("https://storage.exemplo.com/a.jpg"), true);
  assert.equal(urlBaixavel("http://storage.exemplo.com/a.jpg"), false);
  assert.equal(urlBaixavel("https://127.0.0.1/a.jpg"), false);
  assert.equal(urlBaixavel("https://localhost/a.jpg"), false);
  assert.equal(urlBaixavel("https://[::1]/a.jpg"), false);
});

test("lerMensagem traz o anexo de foto e de documento", () => {
  const foto = lerMensagem({ phone: "5562999990000", image: { imageUrl: "https://x.test/i.jpg", mimeType: "image/jpeg", caption: "" } });
  assert.deepEqual(foto.anexo, { url: "https://x.test/i.jpg", mime: "image/jpeg", nome: "" });
  const doc = lerMensagem({ phone: "5562999990000", document: { documentUrl: "https://x.test/b.pdf", mimeType: "application/pdf", fileName: "bo.pdf" } });
  assert.equal(doc.anexo.nome, "bo.pdf");
  assert.equal(lerMensagem({ phone: "5562999990000", text: { message: "oi" } }).anexo, null);
});

test("fim da jornada no WhatsApp oferece PROTOCOLAR", async () => {
  const { textoWhatsApp, cartao } = await import("../../lib/jornadas.js");
  const ultima = JORNADAS.segundavia.etapas.length - 1;
  const s = textoWhatsApp(cartao(T, { jornada: "segundavia", idx: ultima, dados: { motivo: "dano", validade: "valida" } }));
  assert.match(s, /PROTOCOLAR/);
});
