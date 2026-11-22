// Todos os arquivos JavaScript compilam, e o registro de falhas não guarda dados pessoais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IGNORAR = new Set(["node_modules", ".git", ".vercel", "_to_delete_git", "data", "documentos", "tests"]);
function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (IGNORAR.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(m?js)$/.test(n) ? [p] : [];
  });
}

test("todos os arquivos .js compilam (node --check)", () => {
  const lista = arquivos(RAIZ);
  assert.ok(lista.length > 20, `achou ${lista.length} arquivos`);
  const ruins = [];
  for (const f of lista) {
    try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
    catch (e) { ruins.push(`${f.slice(RAIZ.length)}: ${String(e.stderr).split("\n").find((l) => /Error/.test(l))}`); }
  }
  assert.deepEqual(ruins, []);
});

test("registro de falha mascara números longos e endereços", async () => {
  const { registrarFalha } = await import("../../lib/saude.js");
  const item = registrarFalha("teste", new Error("falhou para 5591988887777 em https://zap.exemplo/instancia/abc"));
  assert.doesNotMatch(item.msg, /5591988887777/);
  assert.doesNotMatch(item.msg, /https?:/);
  assert.equal(item.componente, "teste");
});
