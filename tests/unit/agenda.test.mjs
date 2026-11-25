import test from "node:test";
import assert from "node:assert/strict";
import { devidas } from "../../lib/agenda.js";

test("agenda: só roda depois do horário e uma vez por dia", () => {
  const feitas = new Map();
  assert.equal(devidas(new Date("2026-11-25T12:00:00Z"), feitas).length, 0);
  assert.deepEqual(devidas(new Date("2026-11-25T12:31:00Z"), feitas).map((t) => t.rota), ["/api/cron/aquecer"]);
  assert.equal(devidas(new Date("2026-11-25T13:10:00Z"), feitas).length, 2);
  feitas.set("/api/cron/diario", "2026-11-25");
  assert.deepEqual(devidas(new Date("2026-11-25T14:00:00Z"), feitas).map((t) => t.rota), ["/api/cron/aquecer"]);
  assert.equal(devidas(new Date("2026-11-26T13:10:00Z"), feitas).length, 2);
});
