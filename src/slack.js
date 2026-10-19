import { recurLabel, isRecurring, parseYmd, addDays, ymd } from "../public/lib/agenda.js";

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

export function reminderBlocks(it, today, env) {
  const meta = [`⏰ ${it.time} · ${dayLabel(it.date, today)}`];
  if (isRecurring(it)) meta.push(`↻ ${recurLabel(it.recur)}`);
  if (it.prio === 2) meta.push("prioridade alta");
  else if (it.prio === 1) meta.push("prioridade média");
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${mrkdwn(it.title)}*\n${meta.join(" · ")}${appLink(env)}` } },
  ];
  if (it.notes) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: mrkdwn(it.notes.slice(0, 500)) }] });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", action_id: "complete", value: it.id, style: "primary", text: { type: "plain_text", text: "Concluir" } },
      { type: "button", action_id: "snooze_10", value: it.id, text: { type: "plain_text", text: "Adiar 10 min" } },
      { type: "button", action_id: "snooze_60", value: it.id, text: { type: "plain_text", text: "Adiar 1 h" } },
    ],
  });
  return blocks;
}

export function sendReminder(env, it, today) {
  return slackApi(env, "chat.postMessage", {
    channel: env.SLACK_USER_ID,
    text: `⏰ ${it.time} · ${it.title}`,
    blocks: reminderBlocks(it, today, env),
  });
}

export function sendSummary(env, items, today) {
  const pending = items.filter(i => !i.done);
  const late = pending.filter(i => i.date < today);
  const todays = pending.filter(i => i.date === today)
    .sort((a, b) => (a.time || "99").localeCompare(b.time || "99") || b.prio - a.prio);
  const line = i => `• ${i.time ? `\`${i.time}\` ` : ""}${mrkdwn(i.title)}${i.prio === 2 ? " ‼️" : ""}`;
  const [y, m, d] = today.split("-").map(Number);
  const title = fmtDay.format(new Date(Date.UTC(y, m - 1, d)));
  const parts = [`*Bom dia! ${title.charAt(0).toUpperCase() + title.slice(1)}*`];
  if (todays.length) parts.push(`*Hoje (${todays.length})*\n${todays.map(line).join("\n")}`);
  else parts.push("Nada marcado para hoje.");
  if (late.length) parts.push(`*Atrasadas (${late.length})*\n${late.slice(0, 15).map(line).join("\n")}`);
  return slackApi(env, "chat.postMessage", {
    channel: env.SLACK_USER_ID,
    text: `Resumo do dia: ${todays.length} para hoje, ${late.length} atrasadas`,
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
