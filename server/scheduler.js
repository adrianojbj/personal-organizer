import cron from 'node-cron';
import { db, logEvent } from './db.js';
import { sendDM, formatTaskMessage } from './slack/bot.js';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function notifyDueToday() {
  const today = todayISO();
  const tasks = db
    .prepare(
      `SELECT t.*, p.name AS assignee_name, p.slack_user_id AS assignee_slack
       FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id
       WHERE t.due_date = ?
         AND t.status NOT IN ('done')
         AND (t.last_due_notified_at IS NULL OR substr(t.last_due_notified_at,1,10) <> ?)`
    )
    .all(today, today);

  for (const t of tasks) {
    const ownerId = process.env.OWNER_SLACK_ID;
    const target = t.is_owner_task ? ownerId : t.assignee_slack;
    if (!target) continue;
    const ok = await sendDM(target, `⏰ Due today:\n\n${formatTaskMessage(t)}`);
    if (ok) {
      db.prepare("UPDATE tasks SET last_due_notified_at = datetime('now') WHERE id = ?").run(t.id);
      logEvent(t.id, 'due_reminder', target);
    }
  }
}

async function dailyDigest() {
  const today = todayISO();
  const overdue = db
    .prepare(
      `SELECT t.*, p.name AS assignee_name, p.slack_user_id AS assignee_slack
       FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id
       WHERE t.status NOT IN ('done')
         AND t.due_date IS NOT NULL
         AND t.due_date < ?`
    )
    .all(today);

  const byTarget = new Map();
  const ownerId = process.env.OWNER_SLACK_ID;
  for (const t of overdue) {
    const target = t.is_owner_task ? ownerId : t.assignee_slack;
    if (!target) continue;
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(t);
  }

  for (const [target, list] of byTarget.entries()) {
    const lines = ['📋 *Overdue tasks digest:*', ''];
    for (const t of list) {
      lines.push(`• #${t.id} *${t.title}* — due ${t.due_date} (${t.status})`);
    }
    await sendDM(target, lines.join('\n'));
  }

  if (ownerId) {
    const allOpen = db
      .prepare(
        `SELECT t.*, p.name AS assignee_name
         FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id
         WHERE t.status NOT IN ('done')
         ORDER BY (t.due_date IS NULL), t.due_date ASC`
      )
      .all();
    const lines = ['☀️ *Daily summary — all open tasks:*', ''];
    for (const t of allOpen) {
      const who = t.is_owner_task ? 'you' : (t.assignee_name || 'unassigned');
      lines.push(`• #${t.id} *${t.title}* — ${who} — due ${t.due_date || 'n/a'} (${t.status})`);
    }
    if (allOpen.length === 0) lines.push('_No open tasks._');
    await sendDM(ownerId, lines.join('\n'));
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', () => {
    notifyDueToday().catch((e) => console.error('[cron] due-today error:', e));
  });
  cron.schedule('0 9 * * *', () => {
    dailyDigest().catch((e) => console.error('[cron] digest error:', e));
  });
  console.log('[cron] schedulers started (due-today every minute, digest daily at 09:00).');
}
