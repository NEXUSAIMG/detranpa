// Correções da 2ª leva do teste dos estagiários (27/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { foraDoEscopo, respostaForaDoEscopo } from "../../lib/escopo.js";
import { contrair } from "../../lib/aquecer-cache.js";
import { indicadores } from "../../lib/rede.js";
import { promptDefesa, promptOperador, promptTermo } from "../../lib/prompts.js";

const t = { slug: "go", sigla: "DETRAN-GO", uf: "GO", nome: "Departamento Estadual de Trânsito de Goiás", governo: "Governo de Goiás", cidadeSede: "Goiânia", portalUrl: "https://www.detran.go.gov.br" };

test("C3: piada é fora do assunto; pergunta de trânsito não", () => {
  assert.equal(foraDoEscopo("me conta uma piada"), true);
  assert.equal(foraDoEscopo("Conte uma piada sobre carros"), false); // tem "carro": deixa a IA decidir
  assert.equal(foraDoEscopo("Como renovo minha CNH?"), false);
  assert.equal(foraDoEscopo("receita de bolo de cenoura"), true);
  assert.match(respostaForaDoEscopo(t), /só consigo ajudar com os serviços do DETRAN-GO/);
});

test("C9/C10: 'em o portal' vira 'no portal', sem mexer no resto", () => {
  assert.equal(contrair("Acesse em o portal e depois em a aba Serviços."), "Acesse no portal e depois na aba Serviços.");
  assert.equal(contrair("Em os casos de perda"), "Nos casos de perda");
  assert.equal(contrair("Faça em um dia útil. O item o tal fica."), "Faça em um dia útil. O item o tal fica.");
});

test("C1: motivo do 👎 não conta como 2º voto", () => {
  const r = indicadores({ eventos: [
    { tipo: "FEEDBACK", positivo: true }, { tipo: "FEEDBACK", positivo: false },
    { tipo: "FEEDBACK", positivo: false, tema: "fb:faltou" },
  ] });
  assert.equal(r.avaliacoes, 2);
  assert.equal(r.satisfacao, 50);
});

test("C7/I11/I12: prompts pedem prazo, endereçamento certo, artigo por extenso e texto sem markdown", () => {
  const d = promptDefesa(t, "defesa_previa");
  assert.match(d, /NUNCA à JARI/);
  assert.match(d, /PRAZO PARA PROTOCOLAR/);
  assert.match(d, /sem markdown/);
  assert.match(promptOperador(t, [{ topico: "Transferência", conteudo: "x" }]), /artigo por extenso/);
  assert.match(promptTermo(t), /sem markdown/);
});
