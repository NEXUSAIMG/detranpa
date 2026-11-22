// Verificação em duas etapas (TOTP, RFC 6238) e trilha de auditoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { base32, deBase32, codigoTotp, conferirTotp, novoSegredo, obrigatorio2fa, auditar } from "../../lib/seguranca.js";
import { lerLinhas } from "../../store.js";

test("vetor oficial da RFC 6238 (SHA-1, T=59 s)", () => {
  const segredo = base32(Buffer.from("12345678901234567890"));
  assert.equal(segredo, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(codigoTotp(segredo, 59 * 1000), "287082");
  assert.equal(codigoTotp(segredo, 1111111109 * 1000), "081804");
});

test("base32 vai e volta", () => {
  const b = Buffer.from([0, 1, 2, 250, 255, 7]);
  assert.deepEqual(deBase32(base32(b)), b);
});

test("aceita o código atual e o vizinho, recusa o resto", () => {
  const s = novoSegredo(), agora = Date.now();
  assert.equal(s.length, 32);
  assert.ok(conferirTotp(s, codigoTotp(s, agora), agora));
  assert.ok(conferirTotp(s, codigoTotp(s, agora - 30000), agora), "relógio 30 s atrasado");
  assert.ok(!conferirTotp(s, codigoTotp(s, agora - 120000), agora), "código velho");
  assert.ok(!conferirTotp(s, "12345", agora));
  assert.ok(!conferirTotp(s, "", agora));
});

test("obrigatoriedade por perfil vem de EXIGIR_2FA", () => {
  process.env.EXIGIR_2FA = "SUPERADMIN, ADMIN";
  try {
    assert.ok(obrigatorio2fa("ADMIN"));
    assert.ok(!obrigatorio2fa("BALCAO"));
  } finally { delete process.env.EXIGIR_2FA; }
  assert.ok(!obrigatorio2fa("ADMIN"));
});

test("auditoria grava e lista do mais novo para o mais antigo, sem IP completo", async () => {
  await auditar({ slug: "u-aud", uid: "u1", acao: "login-senha-ok", ip: "200.10.20.33" });
  await new Promise((r) => setTimeout(r, 3));
  await auditar({ slug: "u-aud", uid: "u1", acao: "alteracao", rota: "/api/t/x/gestao/conversas/123456789", metodo: "POST", status: 200 });
  const l = await lerLinhas("audit:u-aud");
  assert.equal(l.length, 2);
  assert.equal(l[0].acao, "alteracao");
  assert.doesNotMatch(l[0].rota, /123456789/);
  assert.equal(l[1].ip, "200.10.20.x");
});
