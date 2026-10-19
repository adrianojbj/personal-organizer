import { completedState, lastSlotKey, nextSlot, isIntraday, isRecurring, firstOnOrAfter } from "../public/lib/agenda.js";
import { isAuthorized, sameOrigin, login, logoutCookie } from "./auth.js";
import { localNow } from "./time.js";
import {
  ValidationError, cleanInput, notifiedKeyFor, listItems, getItem, saveItem, deleteItem,
  purgeDone, timedPending, pendingSlotKey, markNotified, getMeta, setMeta,
} from "./items.js";
import { slackEnabled, sendReminder, sendSummary, verifySlack, replaceMessage } from "./slack.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status, message) => json({ error: message }, status);
const newId = () => Date.now().toString(36) + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

async function readJson(request) {
  try { return await request.json(); } catch { throw new ValidationError("Corpo da requisição não é JSON válido."); }
}

/** Aviso atual do item: o último horário que passou (ou o primeiro, se nenhum passou). */
const currentKey = (it, local) => (it.time ? lastSlotKey(it, local.date, local.hm) || `${it.date}T${it.time}` : "");

/* ---------- API da página ---------- */

async function api(request, env, path) {
  const db = env.DB, method = request.method;
  const local = localNow(env.TZ);

  if (path === "/api/me" && method === "GET") {
    return json({ tz: env.TZ || "America/Sao_Paulo", slack: slackEnabled(env), summaryTime: env.DAILY_SUMMARY_TIME || null, login: env.ALLOW_UNAUTHENTICATED !== "true" });
  }
  if (path === "/api/items" && method === "GET") return json({ items: await listItems(db) });
  if (path === "/api/items" && method === "POST") {
    const it = cleanInput(await readJson(request));
    return json({ item: await saveItem(db, newId(), it, notifiedKeyFor(it, null, local), Date.now()) }, 201);
  }
  if (path === "/api/items/purge-done" && method === "POST") {
    return json({ removed: await purgeDone(db, local.date) });
  }

  const m = path.match(/^\/api\/items\/([A-Za-z0-9_-]{1,64})(?:\/(complete|reopen|snooze|dismiss))?$/);
  if (!m) return fail(404, "Rota não encontrada.");
  const [, id, action] = m;
  const prev = await getItem(db, id);
  if (!prev) return fail(404, "Item não encontrado. Ele pode ter sido excluído em outro aparelho.");

  if (!action && method === "PUT") {
    const it = cleanInput(await readJson(request));
    return json({ item: await saveItem(db, id, it, notifiedKeyFor(it, prev, local), prev.created) });
  }
  if (!action && method === "DELETE") { await deleteItem(db, id); return json({ ok: true }); }
  if (method !== "POST") return fail(405, "Método não permitido.");

  let next;
  if (action === "complete") next = completedState(prev, local.date, new Date().toISOString());
  else if (action === "reopen") next = { ...prev, done: false, doneAt: null };
  else if (action === "dismiss") next = { ...prev, ack: currentKey(prev, local), snooze: 0 };
  else if (action === "snooze") {
    const { minutes = 10 } = await readJson(request).catch(() => ({}));
    const mins = Math.min(Math.max(Number(minutes) || 10, 1), 24 * 60);
    next = { ...prev, snooze: Date.now() + mins * 60000 };
  }
  const it = cleanInput(next);
  return json({ item: await saveItem(db, id, it, notifiedKeyFor(it, prev, local), prev.created) });
}

/* ---------- Botões do Slack ---------- */

async function slackInteraction(request, env, ctx) {
  const raw = await request.text();
  if (!(await verifySlack(request, raw, env.SLACK_SIGNING_SECRET))) return new Response("assinatura inválida", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") || "{}");
  if (payload.user?.id !== env.SLACK_USER_ID) return new Response("", { status: 200 });
  const action = payload.actions?.[0];
  if (!action) return new Response("", { status: 200 });

  const db = env.DB, local = localNow(env.TZ);
  const prev = await getItem(db, action.value);
  let text;
  if (!prev) text = "Esse item não existe mais.";
  else if (action.action_id === "complete") {
    const it = cleanInput(completedState(prev, local.date, new Date().toISOString()));
    await saveItem(db, prev.id, it, notifiedKeyFor(it, prev, local), prev.created);
    const label = isIntraday(prev) ? "⏹ Parado por hoje" : "✅ Feito hoje";
    text = it.done ? `✅ Concluído · ~${prev.title}~` : `${label} · ${prev.title}\nPróxima: ${it.date}${it.time ? " às " + it.time : ""}`;
  } else if (action.action_id === "slot_done") {
    const it = cleanInput({ ...prev, ack: currentKey(prev, local), snooze: 0 });
    await saveItem(db, prev.id, it, notifiedKeyFor(it, prev, local), prev.created);
    const nxt = nextSlot(prev, local.date, local.hm);
    text = `👍 Feito · ${prev.title}${nxt ? `\nPróximo aviso às ${nxt}` : "\nSem mais avisos hoje"}`;
  } else if (action.action_id.startsWith("snooze_")) {
    const mins = Number(action.action_id.split("_")[1]) || 10;
    const it = cleanInput({ ...prev, snooze: Date.now() + mins * 60000 });
    await saveItem(db, prev.id, it, "", prev.created);
    text = `💤 Adiado ${mins >= 60 ? mins / 60 + " h" : mins + " min"} · ${prev.title}`;
  }
  if (text && payload.response_url) ctx.waitUntil(replaceMessage(payload.response_url, text));
  return new Response("", { status: 200 });
}

/* ---------- Cron: a cada minuto ---------- */

async function tick(env) {
  const db = env.DB, local = localNow(env.TZ), slack = slackEnabled(env);

  let sent = 0;
  for (const it of await timedPending(db, local.date)) {
    // Lembrete que repete no dia e entre dias passa sozinho para o próximo dia, sem virar "atrasado".
    if (isIntraday(it) && isRecurring(it) && it.date < local.date) {
      const next = cleanInput({ ...it, date: firstOnOrAfter(it.recur, local.date), ack: "", snooze: 0 });
      await saveItem(db, it.id, next, notifiedKeyFor(next, null, local), it.created);
      continue;
    }
    const key = pendingSlotKey(it, local, Date.now());
    if (!slack || !key || sent >= 25) continue;
    try {
      await sendReminder(env, it, key.slice(11), local.date);
      await markNotified(db, it.id, key);
      sent++;
    } catch (e) {
      console.error("lembrete não enviado", it.id, e.message);
    }
  }

  const st = env.DAILY_SUMMARY_TIME;
  if (slack && st && local.hm >= st && local.hm < addHour(st) && (await getMeta(db, "summary_date")) !== local.date) {
    await setMeta(db, "summary_date", local.date);
    try { await sendSummary(env, await listItems(db), local.date); }
    catch (e) { console.error("resumo não enviado", e.message); }
  }
}
const addHour = hm => `${String(Math.min(Number(hm.slice(0, 2)) + 1, 24)).padStart(2, "0")}${hm.slice(2)}`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/slack/interactions" && request.method === "POST") return slackInteraction(request, env, ctx);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && !sameOrigin(request)) return fail(403, "Origem não permitida.");
      if (url.pathname === "/api/login" && request.method === "POST") {
        const r = await login(request, env, env.DB);
        const res = r.cookie ? json({ ok: true }) : fail(r.status, r.error);
        if (r.cookie) res.headers.set("set-cookie", r.cookie);
        return res;
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        const res = json({ ok: true });
        res.headers.set("set-cookie", logoutCookie);
        return res;
      }
      if (!(await isAuthorized(request, env))) return fail(401, "Entre com sua senha para continuar.");
      try {
        return await api(request, env, url.pathname);
      } catch (e) {
        if (e instanceof ValidationError) return fail(400, e.message);
        console.error(e);
        return fail(500, "Erro interno ao salvar. Tente de novo.");
      }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
