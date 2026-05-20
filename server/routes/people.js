import express from 'express';
import { db, logEvent } from '../db.js';
import { sendDM, formatTaskMessage } from '../slack/bot.js';

const router = express.Router();

router.get('/', (req, res) => {
  const people = db.prepare('SELECT * FROM people ORDER BY name').all();
  res.json(people);
});

router.post('/', (req, res) => {
  const { name, slack_user_id, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO people (name, slack_user_id, email) VALUES (?, ?, ?)')
    .run(name, slack_user_id || null, email || null);
  res.json(db.prepare('SELECT * FROM people WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, slack_user_id, email } = req.body;
  const info = db
    .prepare(
      'UPDATE people SET name = COALESCE(?, name), slack_user_id = ?, email = ? WHERE id = ?'
    )
    .run(name, slack_user_id || null, email || null, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json(db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.post('/:id/ping', async (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (!person) return res.status(404).json({ error: 'not found' });
  if (!person.slack_user_id) return res.status(400).json({ error: 'no slack_user_id' });
  const ok = await sendDM(person.slack_user_id, `👋 Hello ${person.name}, this is your organizer bot.`);
  res.json({ ok });
});

export default router;
