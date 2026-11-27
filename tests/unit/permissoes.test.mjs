// 27/11/2026: teste dos estagiários (erro crítico) — o Balcão não entra na Central de Gestão.
import test from "node:test";
import assert from "node:assert/strict";
import { podeAcessar, exigir } from "../../lib/auth.js";
import { assinarToken } from "../../lib/cripto.js";

test("perfis por área: Balcão só no Copiloto; Tutor só na Tutoria", () => {
  for (const area of ["gestao", "central", "atendimento", "painel", "admin", "tutor"]) assert.equal(podeAcessar("BALCAO", area), false, `BALCAO em ${area}`);
  assert.equal(podeAcessar("BALCAO", "balcao"), true);
  assert.equal(podeAcessar("TUTOR", "central"), true);
  for (const area of ["gestao", "atendimento", "painel", "balcao"]) assert.equal(podeAcessar("TUTOR", area), false, `TUTOR em ${area}`);
  for (const area of ["gestao", "central", "atendimento", "painel", "balcao", "tutor"]) assert.equal(podeAcessar("GESTOR", area), true, `GESTOR em ${area}`);
});

test("rota da Central responde 403 para o token do Balcão", () => {
  const token = assinarToken({ uid: "u1", tid: "t-go", slug: "go", perfil: "BALCAO" });
  let status = 0, passou = false;
  const res = { status: (s) => ((status = s), { json: () => {} }) };
  exigir("gestao")({ headers: { authorization: `Bearer ${token}` }, tenant: { id: "t-go" } }, res, () => (passou = true));
  assert.equal(passou, false);
  assert.equal(status, 403);
});
