import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanInput, notifiedKeyFor, ValidationError } from "../src/items.js";
import { verifySlack } from "../src/slack.js";
import { localNow } from "../src/time.js";

test("valida a entrada da API", () => {
  assert.throws(() => cleanInput({ title: "", date: "2026-10-19" }), ValidationError);
  assert.throws(() => cleanInput({ title: "x", date: "19/10/2026" }), ValidationError);
  assert.throws(() => cleanInput({ title: "x", date: "2026-10-19", time: "25:00" }), ValidationError);
  const it = cleanInput({ title: " x ", date: "2026-10-20", recur: { t: "weekly", days: [4] } });
  assert.equal(it.title, "x");
  assert.equal(it.date, "2026-10-22"); // alinhado à primeira quinta
});

test("lembrete criado com horário já passado não vai para o Slack", () => {
  const local = "2026-10-19T15:00";
  assert.equal(notifiedKeyFor({ date: "2026-10-19", time: "09:00" }, null, local), "2026-10-19T09:00");
  assert.equal(notifiedKeyFor({ date: "2026-10-19", time: "16:00" }, null, local), "");
  assert.equal(notifiedKeyFor({ date: "2026-10-19", time: "" }, null, local), "");
});

test("adiar libera um novo envio", () => {
  const prev = { date: "2026-10-19", time: "09:00", snooze: 0, notifiedKey: "2026-10-19T09:00" };
  const next = { ...prev, snooze: Date.now() + 600000 };
  assert.equal(notifiedKeyFor(next, prev, "2026-10-19T09:05"), "");
  assert.equal(notifiedKeyFor({ ...prev }, prev, "2026-10-19T09:05"), "2026-10-19T09:00");
});

test("converte o horário para o fuso configurado", () => {
  const r = localNow("America/Sao_Paulo", new Date("2026-10-19T12:30:00Z"));
  assert.deepEqual(r, { date: "2026-10-19", hm: "09:30", key: "2026-10-19T09:30" });
});

test("confere a assinatura do Slack", async () => {
  const secret = "s3cret", body = "payload=%7B%7D", ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${body}`)));
  const sig = "v0=" + [...mac].map(b => b.toString(16).padStart(2, "0")).join("");
  const req = sig => ({ headers: new Headers({ "x-slack-request-timestamp": ts, "x-slack-signature": sig }) });
  assert.equal(await verifySlack(req(sig), body, secret), true);
  assert.equal(await verifySlack(req(sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a")), body, secret), false);
  assert.equal(await verifySlack(req(sig), body + "x", secret), false);
});

test("login por senha: sessão válida, senha errada e bloqueio", async () => {
  const { login, isAuthorized } = await import("../src/auth.js");
  const meta = new Map();
  const db = { prepare: sql => ({ bind: (...a) => ({
    first: async () => (meta.has(a[0]) ? { value: meta.get(a[0]) } : null),
    run: async () => { meta.set(a[0], a[1]); },
  }) }) };
  const env = { APP_PASSWORD: "correta", SESSION_SECRET: "x".repeat(32) };
  const req = (password, cookie) => new Request("https://meu-dia.test/api/login", {
    method: "POST", body: JSON.stringify({ password }),
    headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4", ...(cookie ? { cookie } : {}) },
  });

  const ok = await login(req("correta"), env, db);
  assert.equal(ok.status, 200);
  const cookie = ok.cookie.split(";")[0];
  assert.equal(await isAuthorized(req("", cookie), env), true);
  assert.equal(await isAuthorized(req("", cookie.replace(/.$/, c => (c === "a" ? "b" : "a"))), env), false);
  assert.equal(await isAuthorized(req("", cookie), { ...env, APP_PASSWORD: "nova" }), false); // trocar a senha derruba a sessão
  assert.equal(await isAuthorized(req(""), env), false);

  for (let i = 0; i < 5; i++) assert.equal((await login(req("errada"), env, db)).status, 401);
  assert.equal((await login(req("correta"), env, db)).status, 429);
});
