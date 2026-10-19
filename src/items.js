import { normRecur, alignDate } from "../public/lib/agenda.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ValidationError extends Error {}

export function rowToItem(r) {
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    time: r.time,
    prio: r.prio,
    notes: r.notes,
    recur: JSON.parse(r.recur),
    done: !!r.done,
    doneAt: r.done_at,
    lastDone: r.last_done,
    ack: r.ack,
    snooze: r.snooze,
    notifiedKey: r.notified_key,
    created: r.created,
  };
}

/** Valida e normaliza o corpo vindo da página. */
export function cleanInput(body, base = {}) {
  const v = { ...base, ...body };
  const title = String(v.title ?? "").trim();
  if (!title || title.length > 200) throw new ValidationError("O título precisa ter entre 1 e 200 caracteres.");
  if (!DATE_RE.test(v.date ?? "")) throw new ValidationError("Data inválida. Use AAAA-MM-DD.");
  const time = v.time ?? "";
  if (time !== "" && !TIME_RE.test(time)) throw new ValidationError("Hora inválida. Use HH:MM.");
  const prio = Number(v.prio ?? 0);
  if (![0, 1, 2].includes(prio)) throw new ValidationError("Prioridade deve ser 0, 1 ou 2.");
  const notes = String(v.notes ?? "");
  if (notes.length > 4000) throw new ValidationError("As notas passam de 4000 caracteres.");
  const recur = normRecur(v.recur, v.date);
  const date = alignDate(recur, v.date);
  return {
    title, date, time, prio, notes, recur,
    done: !!v.done,
    doneAt: v.doneAt ?? null,
    lastDone: v.lastDone ?? null,
    ack: String(v.ack ?? ""),
    snooze: Number(v.snooze) || 0,
  };
}

const dueKey = it => (it.time ? `${it.date}T${it.time}` : "");

/**
 * Lembrete que já passou quando foi criado ou editado não deve chegar no Slack.
 * Mantém a marca se data/hora não mudaram.
 */
export function notifiedKeyFor(next, prev, localKey) {
  const key = dueKey(next);
  if (!key) return "";
  if (prev && dueKey(prev) === key && !(next.snooze && next.snooze !== prev.snooze)) return prev.notifiedKey;
  if (next.snooze && next.snooze > Date.now()) return "";
  return key <= localKey ? key : "";
}

export async function listItems(db) {
  const { results } = await db.prepare("SELECT * FROM items ORDER BY date, time").all();
  return results.map(rowToItem);
}

export async function getItem(db, id) {
  const r = await db.prepare("SELECT * FROM items WHERE id = ?1").bind(id).first();
  return r ? rowToItem(r) : null;
}

export async function saveItem(db, id, it, notifiedKey, created) {
  await db.prepare(
    `INSERT INTO items (id, title, date, time, prio, notes, recur, done, done_at, last_done, ack, snooze, notified_key, created)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, date = excluded.date, time = excluded.time, prio = excluded.prio,
       notes = excluded.notes, recur = excluded.recur, done = excluded.done, done_at = excluded.done_at,
       last_done = excluded.last_done, ack = excluded.ack, snooze = excluded.snooze,
       notified_key = excluded.notified_key`
  ).bind(
    id, it.title, it.date, it.time, it.prio, it.notes, JSON.stringify(it.recur),
    it.done ? 1 : 0, it.doneAt, it.lastDone, it.ack, it.snooze, notifiedKey, created
  ).run();
  return getItem(db, id);
}

export async function deleteItem(db, id) {
  await db.prepare("DELETE FROM items WHERE id = ?1").bind(id).run();
}

export async function purgeDone(db, beforeDate) {
  const r = await db.prepare("DELETE FROM items WHERE done = 1 AND substr(done_at, 1, 10) < ?1").bind(beforeDate).run();
  return r.meta?.changes ?? 0;
}

/** Lembretes vencidos que ainda não foram enviados ao Slack. */
export async function dueReminders(db, localKey, nowMs) {
  const { results } = await db.prepare(
    `SELECT * FROM items
     WHERE done = 0 AND time <> ''
       AND (date || 'T' || time) <= ?1
       AND notified_key <> (date || 'T' || time)
       AND ack <> (date || 'T' || time)
       AND (snooze = 0 OR snooze <= ?2)
     ORDER BY date, time LIMIT 25`
  ).bind(localKey, nowMs).all();
  return results.map(rowToItem);
}

export async function markNotified(db, it) {
  await db.prepare("UPDATE items SET notified_key = ?2, snooze = 0 WHERE id = ?1").bind(it.id, dueKey(it)).run();
}

export async function getMeta(db, key) {
  const r = await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first();
  return r ? r.value : null;
}

export async function setMeta(db, key, value) {
  await db.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}
