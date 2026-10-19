import { normRecur, alignDate, lastSlotKey, MAX_SLOTS } from "../public/lib/agenda.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ValidationError extends Error {}

const toMinutes = hm => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

export function rowToItem(r) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    date: r.date,
    time: r.time,
    every: r.every_min,
    until: r.until_hm,
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
  const kind = v.kind === "reminder" ? "reminder" : "task";
  const time = v.time ?? "";
  if (time !== "" && !TIME_RE.test(time)) throw new ValidationError("Hora inválida. Use HH:MM.");
  if (kind === "reminder" && !time) throw new ValidationError("Lembrete precisa de um horário de aviso.");
  let every = Number(v.every) || 0, until = String(v.until ?? "");
  if (kind === "task") { every = 0; until = ""; }
  if (every) {
    if (!Number.isInteger(every) || every < 5 || every > 720) throw new ValidationError("O intervalo deve ficar entre 5 minutos e 12 horas.");
    if (!TIME_RE.test(until) || until <= time) throw new ValidationError("O horário final precisa ser depois do horário inicial.");
    const count = Math.floor((toMinutes(until) - toMinutes(time)) / every) + 1;
    if (count > MAX_SLOTS) throw new ValidationError(`São no máximo ${MAX_SLOTS} avisos por dia. Aumente o intervalo.`);
  } else until = "";
  // Prioridade só existe em tarefas; lembretes avisam no horário.
  const prio = kind === "task" ? Number(v.prio ?? 0) : 0;
  if (![0, 1, 2].includes(prio)) throw new ValidationError("Prioridade deve ser 0, 1 ou 2.");
  const notes = String(v.notes ?? "");
  if (notes.length > 4000) throw new ValidationError("As notas passam de 4000 caracteres.");
  const recur = normRecur(v.recur, v.date);
  const date = alignDate(recur, v.date);
  return {
    kind, title, date, time, every, until, prio, notes, recur,
    done: !!v.done,
    doneAt: v.doneAt ?? null,
    lastDone: v.lastDone ?? null,
    ack: kind === "reminder" ? String(v.ack ?? "") : "",
    snooze: kind === "reminder" ? Number(v.snooze) || 0 : 0,
  };
}

const sameSchedule = (a, b) =>
  a.date === b.date && a.time === b.time && (a.every || 0) === (b.every || 0) && (a.until || "") === (b.until || "");

/**
 * Último aviso considerado enviado. Avisos que já passaram quando o item foi criado
 * ou reprogramado não vão para o Slack; adiar libera o aviso atual de novo.
 */
export function notifiedKeyFor(next, prev, local) {
  if (next.kind !== "reminder" || !next.time) return "";
  const newSnooze = next.snooze && next.snooze > Date.now() && (!prev || next.snooze !== prev.snooze);
  if (newSnooze) return "";
  if (prev && sameSchedule(prev, next) && next.snooze === prev.snooze) return prev.notifiedKey;
  return lastSlotKey(next, local.date, local.hm) || "";
}

/** Ao criar ou reprogramar um lembrete, os horários que já passaram contam como vistos na página. */
export function skipPassedSlots(next, prev, local) {
  if (next.kind !== "reminder" || (prev && sameSchedule(prev, next))) return next;
  const key = lastSlotKey(next, local.date, local.hm);
  return key && key > (next.ack || "") ? { ...next, ack: key } : next;
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
    `INSERT INTO items (id, title, date, time, prio, notes, recur, done, done_at, last_done, ack, snooze, notified_key, created, every_min, until_hm, kind)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, date = excluded.date, time = excluded.time, prio = excluded.prio,
       every_min = excluded.every_min, until_hm = excluded.until_hm, kind = excluded.kind,
       notes = excluded.notes, recur = excluded.recur, done = excluded.done, done_at = excluded.done_at,
       last_done = excluded.last_done, ack = excluded.ack, snooze = excluded.snooze,
       notified_key = excluded.notified_key`
  ).bind(
    id, it.title, it.date, it.time, it.prio, it.notes, JSON.stringify(it.recur),
    it.done ? 1 : 0, it.doneAt, it.lastDone, it.ack, it.snooze, notifiedKey, created, it.every, it.until, it.kind
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

/** Lembretes até hoje: candidatos a aviso ou a passar para o próximo dia. */
export async function remindersUntil(db, localDate) {
  const { results } = await db.prepare(
    "SELECT * FROM items WHERE kind = 'reminder' AND done = 0 AND date <= ?1 ORDER BY date, time"
  ).bind(localDate).all();
  return results.map(rowToItem);
}

/** Aviso que deve sair agora: o último horário que passou, ainda não enviado nem dispensado. */
export function pendingSlotKey(it, local, nowMs) {
  if (it.snooze && it.snooze > nowMs) return null;
  const key = lastSlotKey(it, local.date, local.hm);
  return key && key > (it.notifiedKey || "") && key > (it.ack || "") ? key : null;
}

export async function markNotified(db, id, key) {
  await db.prepare("UPDATE items SET notified_key = ?2, snooze = 0 WHERE id = ?1").bind(id, key).run();
}

export async function getMeta(db, key) {
  const r = await db.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first();
  return r ? r.value : null;
}

export async function setMeta(db, key, value) {
  await db.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}
