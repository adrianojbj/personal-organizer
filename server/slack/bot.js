import bolt from '@slack/bolt';
import { db, logEvent } from '../db.js';
import { parseStatus, statusLabel } from '../parser.js';

const { App } = bolt;

let app = null;
let isReady = false;

export function getBotEnabled() {
  return isReady;
}

export async function startBot() {
  const token = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!token || !appToken || token.startsWith('xoxb-your') || appToken.startsWith('xapp-your')) {
    console.warn('[slack] SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set — Slack bot disabled.');
    return null;
  }

  app = new App({
    token,
    appToken,
    socketMode: true,
  });

  app.message(async ({ message, client, say }) => {
    if (message.subtype || message.bot_id) return;
    if (message.channel_type !== 'im') return;

    const slackUserId = message.user;
    const text = (message.text || '').trim();

    const person = db
      .prepare('SELECT * FROM people WHERE slack_user_id = ?')
      .get(slackUserId);
    if (!person) {
      await say("I don't recognize you yet — ask the organizer to add your Slack ID.");
      return;
    }

    const activeTasks = db
      .prepare(
        `SELECT * FROM tasks
         WHERE assignee_id = ? AND status NOT IN ('done')
         ORDER BY (due_date IS NULL), due_date ASC, id DESC`
      )
      .all(person.id);

    if (activeTasks.length === 0) {
      await say('You have no active tasks right now. 🎉');
      return;
    }

    const status = parseStatus(text);

    let targetTask = null;
    const idMatch = text.match(/#(\d+)/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      targetTask = activeTasks.find((t) => t.id === id) || null;
    }
    if (!targetTask) targetTask = activeTasks[0];

    if (status) {
      db.prepare(
        "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(status, targetTask.id);
      logEvent(targetTask.id, 'status_change', `via slack: ${status} — "${text}"`);
      await say(
        `Got it — task *#${targetTask.id} ${targetTask.title}* set to *${statusLabel(status)}*.`
      );
    } else {
      logEvent(targetTask.id, 'reply', text);
      await say(
        `Noted on task *#${targetTask.id} ${targetTask.title}*. (Reply with "done", "in progress", "blocked", or "ack" to update status.)`
      );
    }
  });

  await app.start();
  isReady = true;
  console.log('[slack] Bolt app connected via Socket Mode.');
  return app;
}

export async function sendDM(slackUserId, text) {
  if (!app || !isReady) {
    console.warn('[slack] sendDM skipped — bot not running.');
    return false;
  }
  if (!slackUserId) return false;
  try {
    const im = await app.client.conversations.open({ users: slackUserId });
    await app.client.chat.postMessage({
      channel: im.channel.id,
      text,
    });
    return true;
  } catch (err) {
    console.error('[slack] sendDM error:', err.message);
    return false;
  }
}

export function formatTaskMessage(task, assigneeName) {
  const lines = [
    `📌 *Task #${task.id}: ${task.title}*`,
    task.description ? `_${task.description}_` : null,
    task.due_date ? `🗓️ Due: ${task.due_date}` : null,
    `Status: *${statusLabel(task.status)}*`,
    '',
    'Reply with `done`, `in progress`, `blocked`, or `ack` to update.',
    'Use `#<id>` in your message to target a specific task if you have several.',
  ].filter(Boolean);
  return lines.join('\n');
}
