import express from 'express';
import { db, logEvent } from '../db.js';
import { sendDM, formatTaskMessage } from '../slack/bot.js';

const router = express.Router();

function getTask(id) {
  return db
    .prepare(
      `SELECT t.*, p.name AS assignee_name, p.slack_user_id AS assignee_slack
       FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id
       WHERE t.id = ?`
    )
    .get(id);
}

router.get('/', (req, res) => {
  const { assignee_id, status, mine } = req.query;
  const where = [];
  const params = [];
  if (assignee_id) { where.push('t.assignee_id = ?'); params.push(assignee_id); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (mine === '1') where.push('t.is_owner_task = 1');
  const sql = `
    SELECT t.*, p.name AS assignee_name, p.slack_user_id AS assignee_slack
    FROM tasks t LEFT JOIN people p ON p.id = t.assignee_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.due_date IS NULL), t.due_date ASC, t.id DESC
  `;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', async (req, res) => {
  const { title, description, assignee_id, due_date, is_owner_task, status } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, assignee_id, due_date, is_owner_task, status)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, 'pending'))`
    )
    .run(
      title,
      description || null,
      assignee_id || null,
      due_date || null,
      is_owner_task ? 1 : 0,
      status || null
    );
  const task = getTask(info.lastInsertRowid);
  logEvent(task.id, 'created', null);

  const ownerId = process.env.OWNER_SLACK_ID;
  const targetSlack = task.is_owner_task ? ownerId : task.assignee_slack;
  if (targetSlack) {
    const name = task.is_owner_task ? 'you' : task.assignee_name;
    await sendDM(targetSlack, `New task assigned to ${name}:\n\n${formatTaskMessage(task)}`);
    logEvent(task.id, 'assigned_notification', targetSlack);
  }

  res.json(task);
});

router.put('/:id', (req, res) => {
  const { title, description, assignee_id, due_date, is_owner_task, status } = req.body;
  const existing = getTask(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(
    `UPDATE tasks SET
       title = COALESCE(?, title),
       description = ?,
       assignee_id = ?,
       due_date = ?,
       is_owner_task = COALESCE(?, is_owner_task),
       status = COALESCE(?, status),
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title,
    description ?? null,
    assignee_id ?? null,
    due_date ?? null,
    typeof is_owner_task === 'boolean' ? (is_owner_task ? 1 : 0) : null,
    status || null,
    req.params.id
  );
  const task = getTask(req.params.id);
  if (status && status !== existing.status) {
    logEvent(task.id, 'status_change', `via web: ${status}`);
  }
  res.json(task);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/:id/notify', async (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  const ownerId = process.env.OWNER_SLACK_ID;
  const targetSlack = task.is_owner_task ? ownerId : task.assignee_slack;
  if (!targetSlack) return res.status(400).json({ error: 'no slack target' });
  const ok = await sendDM(targetSlack, `🔔 Reminder:\n\n${formatTaskMessage(task)}`);
  logEvent(task.id, 'manual_notification', targetSlack);
  res.json({ ok });
});

router.get('/:id/events', (req, res) => {
  const events = db
    .prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC')
    .all(req.params.id);
  res.json(events);
});

export default router;
