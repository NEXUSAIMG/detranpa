// 25/11/2026: conta rápida (telefone), conferência dos anexos, relatório mensal e monitor do site (sem banco).
import test from "node:test";
import assert from "node:assert/strict";
import { variantesFone, mascararFone } from "../../lib/conta-cidadao.js";
import { itensEsperados, avaliarAnexo, conferirAnexo, faltando, linhaCentral } from "../../lib/conferencia-anexo.js";
import { tratarProtocoloWhatsApp } from "../../lib/protocolo-jornada.js";
import { iniciar, responder } from "../../lib/jornadas.js";
import { limitesMes, mesAnterior, mesAtual, montarChamados, montarHumano } from "../../lib/relatorio-mensal.js";
import { urlPermitida, dominioPortal, textoDaPagina, diferencas, verificarSite, paginasDoTenant } from "../../lib/monitor-site.js";

const T = { id: "t-go", slug: "gotest2", sigla: "DETRAN-GO", uf: "GO", portalUrl: "https://www.detran.go.gov.br", demonstracao: true, conteudo: {} };
const JPEG = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3, 4, 5]);

test("telefone: variantes com e sem o 9 e máscara", () => {
  assert.deepEqual(variantesFone("(91) 99116-7641"), ["5591991167641", "559191167641"]);
  assert.deepEqual(variantesFone("559181167641"), ["559181167641", "5591981167641"]);
  assert.deepEqual(variantesFone("abc"), []);
  assert.equal(mascararFone("91991167641"), "(91) •••••-7641");
});

test("conferência dos anexos: itens esperados, avaliação e o que falta", async () => {
  const itens = itensEsperados(T, "segundavia");
  assert.ok(itens.some((i) => i.id === "identidade") && itens.some((i) => i.id === "comprovante"));
  assert.equal(itensEsperados(T, "nao-existe").length, 0);
  assert.equal(avaliarAnexo(itens, { legivel: false }).status, "ILEGIVEL");
  assert.equal(avaliarAnexo(itens, { legivel: true, cortado: true }).status, "CORTADO");
  assert.equal(avaliarAnexo(itens, { legivel: true, documento: "Boleto" }).status, "OUTRO");
  const ok = avaliarAnexo(itens, { legivel: true, item: "comprovante", documento: "Conta de luz" });
  assert.equal(ok.status, "OK"); assert.equal(ok.item, "comprovante");
  assert.match(linhaCentral(ok), /IA: Comprovante de residência, legível/);
  const falta = faltando(itens, [ok]);
  assert.ok(falta.includes("Documento de identidade com foto") && !falta.includes("Comprovante de residência"));
  assert.ok(!falta.some((x) => /Boletim/.test(x)), "item condicional não entra no 'falta'");

  let chamadas = 0;
  const llm = async () => { chamadas++; return '{"documento":"RG","item":"identidade","legivel":true,"cortado":false}'; };
  const r1 = await conferirAnexo(T, "segundavia", { mime: "image/jpeg", dados: JPEG(1) }, { llm });
  assert.equal(r1.status, "OK"); assert.equal(r1.item, "identidade");
  await conferirAnexo(T, "segundavia", { mime: "image/jpeg", dados: JPEG(1) }, { llm });
  assert.equal(chamadas, 1, "a mesma foto usa a leitura guardada");
  assert.equal(await conferirAnexo(T, "segundavia", { mime: "application/pdf", dados: Buffer.from("%PDF") }, { llm }), null, "PDF não vai para a IA");
});

test("WhatsApp: foto conferida na hora, TIRAR e aviso do que falta antes do SIM", async () => {
  const fone = "5562900000099";
  let est = await iniciar(T, `wa:${fone}`, "segundavia", { canal: "WHATSAPP" });
  est = (await responder(T, est, { acao: "opcao", valor: "dano" })).est;
  est = (await responder(T, est, { acao: "opcao", valor: "valida" })).est;
  for (let i = 0; i < 3; i++) est = (await responder(T, est, { acao: "feito" })).est;
  const baixar = async () => ({ ok: true, status: 200, arrayBuffer: async () => JPEG(9) });
  const leituras = [{ status: "ILEGIVEL", motivo: "A foto não está legível." }, { status: "OK", item: "identidade", documento: "Documento de identidade com foto" }];
  const conferir = async () => leituras.shift();
  const o = { baixar, conferir };
  await tratarProtocoloWhatsApp(T, fone, { texto: "protocolar" }, o);
  await tratarProtocoloWhatsApp(T, fone, { texto: "Maria Teste da Silva" }, o);
  await tratarProtocoloWhatsApp(T, fone, { texto: "pular" }, o);
  let r = await tratarProtocoloWhatsApp(T, fone, { texto: "", anexo: { url: "https://exemplo.test/1.jpg", mime: "image/jpeg" } }, o);
  assert.match(r.textos[0], /não está legível/); assert.match(r.textos[0], /TIRAR/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "tirar" }, o);
  assert.match(r.textos[0], /Tirei/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "", anexo: { url: "https://exemplo.test/2.jpg", mime: "image/jpeg" } }, o);
  assert.match(r.textos[0], /Recebi \(1 de até 6\)/); assert.match(r.textos[0], /✅ Documento de identidade com foto: legível/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "pronto" }, o);
  assert.match(r.textos[0], /Não encontrei nas fotos: .*Comprovante de residência/);
  // Mandou mais um arquivo depois do PRONTO: volta a juntar.
  leituras.push({ status: "OK", item: "comprovante", documento: "Comprovante de residência" });
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "", anexo: { url: "https://exemplo.test/3.jpg", mime: "image/jpeg" } }, o);
  assert.match(r.textos[0], /Recebi \(2 de até 6\)/);
  r = await tratarProtocoloWhatsApp(T, fone, { texto: "cancelar" }, o);
  assert.match(r.textos[0], /cancelei/);
});

test("relatório mensal: limites do mês (UTC-3) e números dos protocolos", () => {
  const L = limitesMes("2026-10");
  assert.equal(L.ini.toISOString(), "2026-10-01T03:00:00.000Z");
  assert.equal(L.fim.toISOString(), "2026-11-01T03:00:00.000Z");
  assert.equal(L.dias, 31); assert.equal(L.nome, "outubro de 2026");
  assert.equal(limitesMes("2026-13"), null);
  assert.equal(mesAnterior(new Date("2026-11-01T02:00:00Z")), "2026-09", "ainda é 31/10 em Belém");
  assert.equal(mesAnterior(new Date("2026-11-01T04:00:00Z")), "2026-10");
  assert.equal(mesAtual(new Date("2027-01-01T05:00:00Z")), "2027-01");
  const d = (s) => new Date(s);
  const chs = [
    { criadoEm: d("2026-10-02T12:00:00Z"), resolvidoEm: d("2026-10-03T12:00:00Z"), prazoEm: d("2026-10-05T12:00:00Z"), status: "RESOLVIDO", categoria: "Veículos", criadoPorNome: "Cidadão (site)" },
    { criadoEm: d("2026-10-10T12:00:00Z"), resolvidoEm: d("2026-10-20T12:00:00Z"), prazoEm: d("2026-10-13T12:00:00Z"), status: "RESOLVIDO", categoria: "Veículos", criadoPorNome: "Ana" },
    { criadoEm: d("2026-10-25T12:00:00Z"), resolvidoEm: null, prazoEm: d("2026-10-28T12:00:00Z"), status: "ABERTO", categoria: null, criadoPorNome: "Cidadão (WhatsApp)" },
    { criadoEm: d("2026-09-25T12:00:00Z"), resolvidoEm: d("2026-11-03T12:00:00Z"), prazoEm: d("2026-11-10T12:00:00Z"), status: "RESOLVIDO", categoria: "Multas", criadoPorNome: "Ana" },
  ];
  const P = montarChamados(chs, L);
  assert.equal(P.abertos, 3); assert.equal(P.peloCidadao, 2); assert.equal(P.resolvidos, 2);
  assert.equal(P.noPrazo, 1); assert.equal(P.taxaNoPrazo, 50);
  assert.equal(P.tempoMedianoHoras, 132); // (24 + 240) / 2
  assert.equal(P.pendentesNoFim, 2); assert.equal(P.vencidosNoFim, 1);
  assert.deepEqual(P.porCategoria[0], { nome: "Veículos", n: 2 });
  const H = montarHumano([
    { transbordoEm: d("2026-10-05T12:00:00Z"), primeiraRespostaEm: d("2026-10-05T12:10:00Z"), encerradaEm: d("2026-10-05T13:00:00Z"), avaliacao: 5 },
    { transbordoEm: d("2026-10-06T12:00:00Z"), primeiraRespostaEm: null, encerradaEm: d("2026-10-06T14:00:00Z"), avaliacao: 3 },
  ], L);
  assert.equal(H.encaminhadas, 2); assert.equal(H.primeiraRespostaMin, 10); assert.equal(H.notaMedia, 4);
});

test("monitor do site: só o portal do DETRAN, texto limpo e o que mudou", async () => {
  assert.equal(dominioPortal(T), "detran.go.gov.br");
  assert.equal(urlPermitida(T, "https://www.detran.go.gov.br/taxas#x"), "https://www.detran.go.gov.br/taxas");
  assert.ok(urlPermitida(T, "https://servicos.detran.go.gov.br/a"));
  assert.equal(urlPermitida(T, "http://www.detran.go.gov.br/"), null);
  assert.equal(urlPermitida(T, "https://detran.go.gov.br.golpe.com/"), null);
  assert.equal(urlPermitida(T, "https://user:x@www.detran.go.gov.br/"), null);
  const txt = textoDaPagina(`<html><head><title>Taxas</title><script>var x=1</script></head><body><nav>Menu</nav><h1>Taxas &amp; valores</h1><p>Licenciamento: R$&nbsp;150,00</p><p>Atualizado em 20/11/2026</p><footer>rodapé</footer></body></html>`);
  assert.equal(txt, "Taxas & valores\nLicenciamento: R$ 150,00");
  assert.deepEqual(diferencas("a\nb", "a\nc"), { entrou: ["c"], saiu: ["b"] });

  const T2 = { ...T, slug: "gotest-site" };
  let preco = "150,00";
  const resp = (status, corpo, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] || null }, arrayBuffer: async () => Buffer.from(corpo) });
  const fetchImpl = async (url) => (url.endsWith("/velha")
    ? resp(301, "", { location: "https://golpe.example/x" })
    : resp(200, `<h1>Taxas</h1><p>Licenciamento: R$ ${preco}</p>`, { "content-type": "text/html" }));
  let r = await verificarSite(T2, { fetchImpl, agora: new Date("2026-11-20T12:00:00Z") });
  assert.deepEqual(r, { paginas: 1, mudaram: 0, erros: 0 }, "1ª leitura vira a referência");
  preco = "165,00";
  r = await verificarSite(T2, { fetchImpl, agora: new Date("2026-11-21T12:00:00Z") });
  assert.equal(r.mudaram, 1);
  const [p] = await paginasDoTenant(T2);
  assert.deepEqual(p.mudanca, { entrou: ["Licenciamento: R$ 165,00"], saiu: ["Licenciamento: R$ 150,00"] });
  assert.equal(p.decisao, null);
  assert.equal(p.semTexto, false);
  // Página "casca" de aplicativo (o portal do DETRAN-PA é assim): marcada como sem texto.
  const T3 = { ...T, slug: "gotest-spa" };
  await verificarSite(T3, { fetchImpl: async () => resp(200, '<html><head><title>DETRAN</title></head><body><div id="app"></div></body></html>', { "content-type": "text/html" }) });
  assert.equal((await paginasDoTenant(T3))[0].semTexto, true);
});
