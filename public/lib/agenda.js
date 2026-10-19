// Lógica de datas e recorrência.
// Compartilhada entre a página (public/) e o Worker (src/), sem dependências.

export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const WD_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const RECUR_TYPES = ["none", "daily", "weekdays", "weekly", "monthly"];

/* ---------- Recorrência ---------- */

export function normRecur(r, date) {
  r = r && RECUR_TYPES.includes(r.t) ? { ...r } : { t: "none" };
  const d = parseYmd(date);
  if (r.t === "weekly") {
    r.days = [...new Set((r.days || []).map(Number).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))];
    if (!r.days.length) r.days = [d.getDay()];
  } else delete r.days;
  if (r.t === "monthly") {
    const dom = Number(r.dom);
    r.dom = Number.isInteger(dom) && dom >= 1 && dom <= 31 ? dom : d.getDate();
  } else delete r.dom;
  return r;
}

export const isRecurring = it => !!(it.recur && it.recur.t && it.recur.t !== "none");

export function matchesRule(it, d) {
  const r = it.recur || { t: "none" }, w = d.getDay();
  switch (r.t) {
    case "daily": return true;
    case "weekdays": return w > 0 && w < 6;
    case "weekly": return (r.days || []).includes(w);
    case "monthly": return d.getDate() === Math.min(r.dom || 1, daysInMonth(d));
    default: return ymd(d) === it.date;
  }
}

export const occursOn = (it, d) => ymd(d) >= it.date && matchesRule(it, d);

export function nextAfter(it, fromStr) {
  let d = addDays(parseYmd(fromStr), 1);
  for (let i = 0; i < 800; i++, d = addDays(d, 1)) if (matchesRule(it, d)) return ymd(d);
  return ymd(addDays(parseYmd(fromStr), 1));
}

export function firstOnOrAfter(recur, fromStr) {
  const probe = { recur, date: fromStr };
  let d = parseYmd(fromStr);
  for (let i = 0; i < 800; i++, d = addDays(d, 1)) if (matchesRule(probe, d)) return ymd(d);
  return fromStr;
}

/** Ajusta a data para a primeira ocorrência válida da regra. */
export function alignDate(recur, date) {
  if (!recur || recur.t === "none") return date;
  return matchesRule({ recur, date }, parseYmd(date)) ? date : firstOnOrAfter(recur, date);
}

export function recurLabel(r) {
  if (!r) return "";
  switch (r.t) {
    case "daily": return "todo dia";
    case "weekdays": return "dias úteis";
    case "weekly": return "toda " + (r.days || []).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(x => WD_SHORT[x]).join(", ");
    case "monthly": return "todo dia " + r.dom;
    default: return "";
  }
}

/* ---------- Repetição dentro do dia ---------- */

const toMin = hm => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const toHM = t => `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
export const MAX_SLOTS = 96;

/** Item com hora inicial, intervalo (min) e hora final: avisa várias vezes no dia. */
export const isIntraday = it => !!(it.time && it.every > 0 && it.until);

/** Horários do dia em que o item avisa, em ordem. */
export function slotsOf(it) {
  if (!it.time) return [];
  if (!isIntraday(it)) return [it.time];
  const out = [];
  for (let t = toMin(it.time); t <= toMin(it.until) && out.length < MAX_SLOTS; t += it.every) out.push(toHM(t));
  return out;
}

/** Chave (data+hora) do último aviso que já passou em `date` às `hm`, ou null. */
export function lastSlotKey(it, date, hm) {
  if (!it.time || it.date > date) return null;
  const slots = slotsOf(it);
  const s = it.date < date ? slots[slots.length - 1] : [...slots].reverse().find(x => x <= hm);
  return s ? `${it.date}T${s}` : null;
}

/** Próximo horário de aviso depois de `hm` no dia do item, ou null. */
export function nextSlot(it, date, hm) {
  if (!it.time || it.date < date) return null;
  if (it.date > date) return slotsOf(it)[0];
  return slotsOf(it).find(x => x > hm) || null;
}

export function everyLabel(it) {
  if (!isIntraday(it)) return "";
  const e = it.every;
  const t = e % 60 === 0 ? `${e / 60} h` : e > 60 ? `${Math.floor(e / 60)} h ${e % 60} min` : `${e} min`;
  return `a cada ${t} até ${it.until}`;
}

/** Estado do item depois de concluído. Recorrentes avançam para a próxima data. */
export function completedState(it, today, nowIso) {
  if (isRecurring(it)) {
    const from = it.date < today ? today : it.date;
    return { ...it, date: nextAfter(it, from), lastDone: today, ack: "", snooze: 0 };
  }
  return { ...it, done: true, doneAt: nowIso };
}
