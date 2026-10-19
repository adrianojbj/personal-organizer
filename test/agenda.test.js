import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAfter, completedState, normRecur, alignDate, slotsOf, lastSlotKey, nextSlot, everyLabel } from "../public/lib/agenda.js";

test("dias úteis pulam o fim de semana", () => {
  assert.equal(nextAfter({ recur: { t: "weekdays" } }, "2026-10-23"), "2026-10-26");
});

test("mensal no dia 31 cai no último dia de meses curtos", () => {
  const it = { date: "2026-10-31", recur: normRecur({ t: "monthly" }, "2026-10-31") };
  assert.equal(nextAfter(it, "2026-10-31"), "2026-11-30");
  assert.equal(nextAfter(it, "2026-11-30"), "2026-12-31");
});

test("concluir recorrente atrasado avança a partir de hoje", () => {
  const it = { date: "2026-10-15", time: "09:00", recur: { t: "daily" }, done: false };
  const next = completedState(it, "2026-10-19", "x");
  assert.equal(next.date, "2026-10-20");
  assert.equal(next.lastDone, "2026-10-19");
  assert.equal(next.done, false);
});

test("concluir item único marca como feito", () => {
  const next = completedState({ date: "2026-10-19", recur: { t: "none" } }, "2026-10-19", "2026-10-19T12:00:00.000Z");
  assert.equal(next.done, true);
  assert.equal(next.doneAt, "2026-10-19T12:00:00.000Z");
});

test("recorrência semanal começa no próximo dia marcado", () => {
  const recur = normRecur({ t: "weekly", days: [4] }, "2026-10-19");
  assert.equal(alignDate(recur, "2026-10-19"), "2026-10-22");
  assert.equal(alignDate({ t: "none" }, "2026-10-19"), "2026-10-19");
});

test("horários de 2 em 2 h entre 9h e 20h", () => {
  const it = { date: "2026-10-19", time: "09:00", every: 120, until: "20:00" };
  assert.deepEqual(slotsOf(it), ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"]);
  assert.equal(lastSlotKey(it, "2026-10-19", "08:59"), null);
  assert.equal(lastSlotKey(it, "2026-10-19", "12:30"), "2026-10-19T11:00");
  assert.equal(lastSlotKey(it, "2026-10-20", "08:00"), "2026-10-19T19:00");
  assert.equal(nextSlot(it, "2026-10-19", "12:30"), "13:00");
  assert.equal(nextSlot(it, "2026-10-19", "19:30"), null);
  assert.equal(everyLabel(it), "a cada 2 h até 20:00");
  assert.deepEqual(slotsOf({ time: "08:00" }), ["08:00"]);
});
