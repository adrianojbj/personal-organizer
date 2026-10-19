import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuick, nextAfter, completedState, normRecur } from "../public/lib/agenda.js";

const MON = new Date(2026, 9, 19, 10, 0); // segunda, 19/10/2026

test("entende frases em português", () => {
  const cases = [
    ["revisar PRs todo dia útil 9h30", { title: "revisar PRs", date: "2026-10-19", time: "09:30", recur: { t: "weekdays" } }],
    ["ligar pro banco amanhã 10h !!", { title: "ligar pro banco", date: "2026-10-20", time: "10:00", prio: 2 }],
    ["1:1 com o time toda quinta 15h", { title: "1:1 com o time", date: "2026-10-22", time: "15:00", recur: { t: "weekly", days: [4] } }],
    ["academia toda segunda e quarta 7h", { title: "academia", date: "2026-10-19", recur: { t: "weekly", days: [1, 3] } }],
    ["pagar boleto dia 10/11 !", { title: "pagar boleto", date: "2026-11-10", prio: 1 }],
    ["aluguel todo dia 5", { title: "aluguel", date: "2026-11-05", recur: { t: "monthly", dom: 5 } }],
    ["reunião sexta às 14:30", { title: "reunião", date: "2026-10-23", time: "14:30" }],
    ["renovar CNH 03/01/2027", { title: "renovar CNH", date: "2027-01-03" }],
    ["comprar pão", { title: "comprar pão", date: "2026-10-19", time: "", prio: 0, recur: { t: "none" } }],
  ];
  for (const [text, want] of cases) {
    const got = parseQuick(text, MON);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${text} → ${k}`);
  }
});

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
