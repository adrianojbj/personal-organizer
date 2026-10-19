// Lógica de datas, recorrência e entrada em linguagem natural.
// Compartilhada entre a página (public/) e o Worker (src/), sem dependências.

export const pad = n => String(n).padStart(2, "0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysInMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
export const norm = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
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

/** Estado do item depois de concluído. Recorrentes avançam para a próxima data. */
export function completedState(it, today, nowIso) {
  if (isRecurring(it)) {
    const from = it.date < today ? today : it.date;
    return { ...it, date: nextAfter(it, from), lastDone: today, ack: "", snooze: 0 };
  }
  return { ...it, done: true, doneAt: nowIso };
}

/* ---------- Entrada em linguagem natural ---------- */

const WD = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const WDALT = "domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado";
const rx = s => new RegExp("(?<![\\p{L}\\d])(?:" + s + ")(?![\\p{L}\\d])", "iu");

export function parseQuick(text, now = new Date()) {
  let s = " " + text + " ";
  const t = now;
  const out = { title: "", date: null, time: "", prio: 0, recur: { t: "none" } };
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m || fn(m) === false) return false;
    s = s.replace(m[0], " ");
    return true;
  };

  take(rx("(?:tod[oa]s? (?:os )?)?dias? (?:[uú]teis|[uú]til)|de seg(?:unda)? a sex(?:ta)?|seg(?:unda)? a sex(?:ta)?"), () => { out.recur = { t: "weekdays" }; }) ||
  take(rx("todo dia (\\d{1,2})"), m => { const n = +m[1]; if (n < 1 || n > 31) return false; out.recur = { t: "monthly", dom: n }; }) ||
  take(rx("todo dia|todos os dias|diariamente"), () => { out.recur = { t: "daily" }; }) ||
  take(rx("tod[oa]s? (?:as |os )?((?:" + WDALT + ")(?:s|-feiras?)?(?:(?:,\\s*|\\s+e\\s+)(?:" + WDALT + ")(?:s|-feiras?)?)*)"), m => {
    const days = [...m[1].matchAll(new RegExp(WDALT, "giu"))].map(x => WD[norm(x[0])]);
    out.recur = { t: "weekly", days: [...new Set(days)] };
  }) ||
  take(rx("toda semana|semanalmente"), () => { out.recur = { t: "weekly", days: [] }; }) ||
  take(rx("todo m[eê]s|mensalmente"), () => { out.recur = { t: "monthly" }; });

  take(rx("depois de amanh[aã]"), () => { out.date = ymd(addDays(t, 2)); }) ||
  take(rx("amanh[aã]"), () => { out.date = ymd(addDays(t, 1)); }) ||
  take(rx("hoje"), () => { out.date = ymd(t); }) ||
  take(rx("(?:dia )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?"), m => {
    let y = m[3] ? +m[3] : t.getFullYear();
    if (y < 100) y += 2000;
    const mo = +m[2], da = +m[1];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
    const d = new Date(y, mo - 1, da);
    if (!m[3] && ymd(d) < ymd(t)) d.setFullYear(y + 1);
    out.date = ymd(d);
  }) ||
  take(rx("(?:(?:na|no|nesta|neste|essa|esta|pr[oó]xim[ao]) )?(" + WDALT + ")(?:-feira)?"), m => {
    const w = WD[norm(m[1])];
    let d = addDays(t, 1);
    while (d.getDay() !== w) d = addDays(d, 1);
    out.date = ymd(d);
  });

  take(rx("(?:[aà]s |a )?(\\d{1,2})(?:[:h](\\d{2})|h)"), m => {
    const h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 23 || mi > 59) return false;
    out.time = pad(h) + ":" + pad(mi);
  }) ||
  take(rx("[aà]s (\\d{1,2})"), m => { if (+m[1] > 23) return false; out.time = pad(+m[1]) + ":00"; }) ||
  take(rx("ao meio[- ]dia"), () => { out.time = "12:00"; });

  const pm = s.match(/(?:^|\s)(!{1,3})(?=\s|$)/);
  if (pm) { out.prio = Math.min(pm[1].length, 2); s = s.replace(pm[0], " "); }

  let title = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    title = title
      .replace(/[\s,;-]+(?:às|as|no|na|de|em|e|para|pra)?$/iu, "")
      .replace(/^(?:às|as|no|na|de|em)\s+/iu, "")
      .trim();
  }
  out.title = title;

  if (!out.date) out.date = out.recur.t !== "none" ? firstOnOrAfter(normRecur(out.recur, ymd(t)), ymd(t)) : ymd(t);
  out.recur = normRecur(out.recur, out.date);
  out.date = alignDate(out.recur, out.date);
  return out;
}
