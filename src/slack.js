import { recurLabel, isRecurring, isIntraday, everyLabel, parseYmd, addDays, ymd } from "../public/lib/agenda.js";

export const slackEnabled = env => !!(env.SLACK_BOT_TOKEN && env.SLACK_USER_ID);

const mrkdwn = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDay = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

function dayLabel(date, today) {
  if (date === today) return "hoje";
  if (date === ymd(addDays(parseYmd(today), -1))) return "ontem";
  const [y, m, d] = date.split("-").map(Number);
  return fmtDay.format(new Date(Date.UTC(y, m - 1, d)));
}

async function slackApi(env, method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

const appLink = env => (env.APP_URL ? ` · <${env.APP_URL}|Abrir Meu Dia>` : "");

export function reminderBlocks(it, slot, today, env) {
  const meta = [`⏰ ${slot} · ${dayLabel(it.date, today)}`];
  if (isIntraday(it)) meta.push(`↻ ${everyLabel(it)}`);
  if (isRecurring(it)) meta.push(`↻ ${recurLabel(it.recur)}`);
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${mrkdwn(it.title)}*\n${meta.join(" · ")}${appLink(env)}` } },
  ];
  if (it.notes) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: mrkdwn(it.notes.slice(0, 500)) }] });
  // Botões exigem que o Slack alcance /slack/interactions (URL pública).
  if (env.SLACK_INTERACTIVE !== "true") return blocks;
  const btn = (action_id, text, style) => ({ type: "button", action_id, value: it.id, text: { type: "plain_text", text }, ...(style ? { style } : {}) });
  blocks.push({
    type: "actions",
    elements: isIntraday(it)
      ? [btn("slot_done", "Feito", "primary"), btn("snooze_10", "Adiar 10 min"), btn("complete", "Parar por hoje")]
      : [btn("complete", "Feito", "primary"), btn("snooze_10", "Adiar 10 min"), btn("snooze_60", "Adiar 1 h")],
  });
  return blocks;
}

export function sendReminder(env, it, slot, today) {
  return slackApi(env, "chat.postMessage", {
    channel: env.SLACK_USER_ID,
    text: `⏰ ${slot} · ${it.title}`,
    blocks: reminderBlocks(it, slot, today, env),
  });
}

export function sendSummary(env, items, today) {
  const open = items.filter(i => !i.done);
  const tasks = open.filter(i => i.kind !== "reminder");
  const late = tasks.filter(i => i.date < today).sort((a, b) => a.date.localeCompare(b.date) || b.prio - a.prio);
  const due = tasks.filter(i => i.date === today).sort((a, b) => b.prio - a.prio || (a.time || "99").localeCompare(b.time || "99"));
  const reminders = open.filter(i => i.kind === "reminder" && i.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const flag = i => (i.prio === 2 ? " ‼️" : i.prio === 1 ? " ❗" : "");
  const taskLine = i => `• ${mrkdwn(i.title)}${i.time ? ` _(até ${i.time})_` : ""}${flag(i)}`;
  const lateLine = i => `• ${mrkdwn(i.title)} _(venceu ${dayLabel(i.date, today)})_${flag(i)}`;
  const remLine = i => `• \`${i.time}${isIntraday(i) ? `–${i.until}` : ""}\` ${mrkdwn(i.title)}${isIntraday(i) ? ` _(${everyLabel(i)})_` : ""}`;
  const [y, m, d] = today.split("-").map(Number);
  const title = fmtDay.format(new Date(Date.UTC(y, m - 1, d)));
  const parts = [`*Bom dia! ${title.charAt(0).toUpperCase() + title.slice(1)}*`];
  if (late.length) parts.push(`*Tarefas atrasadas (${late.length})*\n${late.slice(0, 15).map(lateLine).join("\n")}`);
  parts.push(due.length ? `*Tarefas que vencem hoje (${due.length})*\n${due.map(taskLine).join("\n")}` : "Nenhuma tarefa vence hoje.");
  if (reminders.length) parts.push(`*Lembretes de hoje (${reminders.length})*\n${reminders.map(remLine).join("\n")}`);
  return slackApi(env, "chat.postMessage", {
    channel: env.SLACK_USER_ID,
    text: `Resumo do dia: ${due.length} tarefas vencem hoje, ${late.length} atrasadas, ${reminders.length} lembretes`,
    blocks: [{ type: "section", text: { type: "mrkdwn", text: parts.join("\n\n") + appLink(env) } }],
  });
}

export async function replaceMessage(responseUrl, text) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replace_original: true, text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] }),
  });
}

/** Confere a assinatura das requisições do Slack (X-Slack-Signature). */
export async function verifySlack(request, rawBody, secret) {
  if (!secret) return false;
  const ts = request.headers.get("x-slack-request-timestamp");
  const sig = request.headers.get("x-slack-signature") || "";
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${rawBody}`)));
  const expected = "v0=" + [...mac].map(b => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
