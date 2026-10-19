import {
  pad, ymd, parseYmd, addDays, WD_SHORT, normRecur, alignDate, isRecurring, occursOn,
  recurLabel, completedState, isIntraday, slotsOf, lastSlotKey, nextSlot, everyLabel,
} from "./lib/agenda.js";

const $ = s => document.querySelector(s);
const today = () => ymd(new Date());
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const fmtLong = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
const fmtWeekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
const fmtShort = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short" });
const ICON = {
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  rep: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 12V10a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
};

/* ---------- API ---------- */
let items = [], loaded = false, pending = 0;

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Sem conexão. Confira a internet e tente de novo.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "Não consegui salvar. Tente de novo.");
    e.status = res.status;
    if (res.status === 401 && path !== "/api/login") showLogin();
    throw e;
  }
  return data;
}

/* ---------- Login ---------- */
function showLogin() {
  if (!$("#loginScrim").hidden) return;
  $("#loginScrim").hidden = false;
  $("#storageNote").textContent = "Entre com sua senha para ver a agenda.";
  setTimeout(() => $("#f-pass").focus(), 0);
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  $("#loginBtn").disabled = true;
  try {
    await api("/api/login", { method: "POST", body: { password: $("#f-pass").value } });
    $("#f-pass").value = "";
    $("#loginMsg").textContent = "Digite a senha que você definiu para a sua agenda.";
    $("#loginScrim").hidden = true;
    refreshMe();
    await load();
  } catch (err) {
    $("#loginMsg").textContent = err.message;
    $("#f-pass").select();
  } finally {
    $("#loginBtn").disabled = false;
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  items = []; loaded = false; renderAll();
  showLogin();
});

const strip = it => { const { id, created, notifiedKey, ...rest } = it; return JSON.parse(JSON.stringify(rest)); };
const upsertLocal = it => { const i = items.findIndex(x => x.id === it.id); if (i >= 0) items[i] = it; else items.push(it); };

async function load() {
  if (pending) return;
  try {
    const data = await api("/api/items");
    if (pending) return;
    items = data.items; loaded = true; renderAll();
  } catch (e) {
    if (e.status === 401) return;
    if (!loaded) { loaded = true; renderAll(); }
    $("#storageNote").textContent = e.message;
  }
}

/** Aplica a mudança na tela na hora e confirma com o servidor. */
async function mutate(optimistic, call) {
  pending++;
  if (optimistic) { upsertLocal(optimistic); renderAll(); }
  try {
    const data = await call();
    if (data && data.item) upsertLocal(data.item);
    return data;
  } catch (e) {
    toast(e.message);
    throw e;
  } finally {
    pending--;
    if (!pending) renderAll();
  }
}

function refreshMe() {
  api("/api/me").then(me => {
    $("#logoutBtn").hidden = !me.login;
    $("#storageNote").textContent = me.slack
      ? `Lembretes também chegam no Slack${me.summaryTime ? ` · resumo diário às ${me.summaryTime}` : ""}.`
      : "Slack desligado: configure os segredos do bot para receber lembretes lá.";
  }).catch(e => { if (e.status !== 401) $("#storageNote").textContent = e.message; });
}

async function init() {
  renderAll();
  refreshMe();
  await load();
}

/* ---------- Ações ---------- */
function addItem(p) {
  return mutate(null, () => api("/api/items", { method: "POST", body: {
    kind: p.kind || "task", title: p.title, date: p.date, time: p.time || "", every: p.every || 0, until: p.until || "",
    prio: p.prio || 0, notes: p.notes || "", recur: normRecur(p.recur, p.date),
  } }));
}
function restore(id, before) {
  return mutate({ ...items.find(i => i.id === id), ...before }, () => api("/api/items/" + id, { method: "PUT", body: before })).catch(() => load());
}
function complete(it) {
  const before = strip(it);
  const next = completedState(it, today(), new Date().toISOString());
  mutate(next, () => api(`/api/items/${it.id}/complete`, { method: "POST" })).then(() => {
    if (isRecurring(it)) toast((isIntraday(it) ? "Parado por hoje. Volta " : "Feito. Próxima: ") + relDay(next.date) + (next.time ? " às " + next.time : ""), () => restore(it.id, before));
    else if (isIntraday(it)) toast("Parado. Sem mais avisos deste item.", () => restore(it.id, before));
    else toast(it.kind === "reminder" ? "Lembrete encerrado" : "Tarefa concluída", () => restore(it.id, before));
  }).catch(() => load());
}
const action = (it, name, optimistic, body) =>
  mutate(optimistic, () => api(`/api/items/${it.id}/${name}`, { method: "POST", body })).catch(() => load());
/** Aviso atual: o último horário do dia que já passou (ou o primeiro, se nenhum passou). */
const dueKey = it => lastSlotKey(it, today(), nowHM()) || it.date + "T" + it.time;
/** Hora que representa o item na lista de hoje: o próximo aviso, ou o último se todos passaram. */
function effTime(it) {
  if (!isIntraday(it) || it.date !== today()) return it.time;
  return nextSlot(it, today(), nowHM()) || it.until;
}
const reopen = it => action(it, "reopen", { ...it, done: false, doneAt: null });
const dismiss = it => action(it, "dismiss", { ...it, ack: dueKey(it), snooze: 0 });
function snooze(it, min) {
  action(it, "snooze", { ...it, snooze: Date.now() + min * 60000 }, { minutes: min });
  toast("Aviso adiado " + min + " min");
}

/* ---------- Toast ---------- */
let toastTimer = 0, toastFn = null;
function toast(msg, undo) {
  $("#toastMsg").textContent = msg; toastFn = undo || null;
  $("#toastAct").hidden = !undo; $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; toastFn = null; }, undo ? 6000 : 3500);
}
$("#toastAct").addEventListener("click", () => { if (toastFn) toastFn(); toastFn = null; $("#toast").hidden = true; });

/* ---------- Render ---------- */
let view = "today";
function relDay(ds) {
  if (ds === today()) return "hoje";
  if (ds === ymd(addDays(new Date(), 1))) return "amanhã";
  if (ds === ymd(addDays(new Date(), -1))) return "ontem";
  return fmtShort.format(parseYmd(ds)).replace(/\./g, "");
}
const daysLate = ds => Math.round((parseYmd(today()) - parseYmd(ds)) / 864e5);
function sortDay(a, b) {
  if (a.time && b.time) return effTime(a).localeCompare(effTime(b)) || b.prio - a.prio;
  if (a.time) return -1;
  if (b.time) return 1;
  return b.prio - a.prio || (a.created || 0) - (b.created || 0);
}
/** Tarefas: prioridade primeiro, depois prazo. */
function sortTasks(a, b) {
  return b.prio - a.prio || (a.time || "99").localeCompare(b.time || "99") || (a.created || 0) - (b.created || 0);
}
/** Lista de um dia: lembretes pelo horário, depois tarefas. */
function sortMixed(a, b) {
  const ra = a.kind === "reminder", rb = b.kind === "reminder";
  if (ra !== rb) return ra ? -1 : 1;
  return ra ? sortDay(a, b) : sortTasks(a, b);
}
function itemHTML(it, opts = {}) {
  const meta = [], isRem = it.kind === "reminder", t = today();
  if (!isRem && !it.done && !opts.ghost) {
    if (it.date < t) {
      const n = daysLate(it.date);
      meta.push(`<span class="late">atrasada ${n === 1 ? "desde ontem" : "há " + n + " dias"}</span>`);
    } else if (opts.inDay) {
      if (it.time) meta.push(`<span>prazo ${esc(it.time)}</span>`);
    } else if (it.date === t) {
      const passed = it.time && it.time <= nowHM();
      meta.push(`<span class="${passed ? "late" : ""}">${passed ? "venceu" : "vence"} hoje${it.time ? " às " + esc(it.time) : ""}</span>`);
    } else meta.push(`<span>vence ${esc(relDay(it.date))}${it.time ? " às " + esc(it.time) : ""}</span>`);
  }
  if (isRem && opts.showDate) meta.push(`<span>${esc(relDay(it.date))}</span>`);
  if (isRem && !it.done) meta.push(`<span>${ICON.bell}${isIntraday(it) ? esc(everyLabel(it)) : "lembrete"}</span>`);
  if (isRecurring(it)) meta.push(`<span>${ICON.rep}${esc(recurLabel(it.recur))}</span>`);
  if (it.lastDone === t && opts.ghost) meta.push(`<span>feito hoje</span>`);
  if (it.notes) meta.push(`<span>${ICON.note}nota</span>`);
  const cls = ["item", isRem ? "is-rem" : "is-task"];
  if (it.prio) cls.push("p" + it.prio);
  if (it.done || opts.ghost) cls.push("done");
  const act = opts.ghost ? "" : (it.done ? "reopen" : "complete");
  const label = it.done ? "Reabrir" : isRem && isIntraday(it) ? "Parar por hoje" : "Concluir";
  const when = isRem ? esc(opts.slotTime ? effTime(it) : it.time) : "—";
  return `<li class="${cls.join(" ")}">
    <button class="check" type="button" data-act="${act}" data-id="${esc(it.id)}" aria-label="${label}: ${esc(it.title)}" title="${label}" ${opts.ghost ? "disabled" : ""}>${ICON.check}</button>
    <div class="when ${isRem ? "timed" : ""}">${when}</div>
    <button class="body" type="button" data-act="edit" data-id="${esc(it.id)}">
      <span class="title">${esc(it.title)}</span>
      ${meta.length ? `<span class="meta">${meta.join("")}</span>` : ""}
      ${it.notes && opts.notes ? `<span class="notes-prev">${esc(it.notes)}</span>` : ""}
    </button>
  </li>`;
}
function emptyHTML(title, text) {
  return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

function buckets() {
  const t = today(), open = items.filter(i => !i.done);
  const tasks = open.filter(i => i.kind !== "reminder"), rems = open.filter(i => i.kind === "reminder");
  const late = tasks.filter(i => i.date < t).sort((a, b) => a.date.localeCompare(b.date) || sortTasks(a, b));
  const dueToday = tasks.filter(i => i.date === t).sort(sortTasks);
  const remToday = rems.filter(i => i.date === t).sort(sortDay);
  const doneToday = items.filter(i => i.kind !== "reminder" && (
    (i.done && i.doneAt && ymd(new Date(i.doneAt)) === t) || (!i.done && isRecurring(i) && i.lastDone === t && i.date !== t)));
  return { late, dueToday, remToday, doneToday };
}
function weekOccurrences() {
  const days = [], base = new Date();
  for (let k = 1; k <= 7; k++) {
    const d = addDays(base, k), ds = ymd(d);
    const list = items.filter(i => !i.done && (isRecurring(i) ? occursOn(i, d) : i.date === ds)).sort(sortMixed);
    days.push({ ds, d, list });
  }
  return days;
}
function renderSummary() {
  const { late, dueToday, remToday, doneToday } = buckets(), hm = nowHM();
  const left = remToday.reduce((n, i) => n + slotsOf(i).filter(x => x > hm).length, 0);
  const pl = (n, one, many) => `<b>${n}</b> ${n === 1 ? one : many}`;
  $("#summary").innerHTML = !loaded ? "" : [
    late.length ? `<span class="stat late">${pl(late.length, "tarefa atrasada", "tarefas atrasadas")}</span>` : "",
    `<span class="stat">${pl(dueToday.length, "tarefa para hoje", "tarefas para hoje")}</span>`,
    `<span class="stat">${pl(left, "aviso restante", "avisos restantes")}</span>`,
    `<span class="stat ok">${pl(doneToday.length, "feita hoje", "feitas hoje")}</span>`,
  ].join("");
  $("#nToday").textContent = loaded ? (late.length + dueToday.length + remToday.length || "") : "";
  const wk = weekOccurrences().reduce((n, d) => n + d.list.length, 0);
  $("#nWeek").textContent = loaded && wk ? wk : "";
  const all = items.filter(i => !i.done).length;
  $("#nAll").textContent = loaded && all ? all : "";
}
function renderToday() {
  const { late, dueToday, remToday, doneToday } = buckets(), hm = nowHM();
  const group = (title, aux, rows, cls = "") =>
    `<section class="group"><div class="group-h"><h2 class="${cls}">${title}</h2><span class="aux">${aux}</span></div><ul class="list">${rows}</ul></section>`;
  let html = "";
  if (late.length) html += group("Tarefas atrasadas", late.length, late.map(i => itemHTML(i, { notes: true })).join(""), "late");
  if (dueToday.length) html += group("Tarefas de hoje", dueToday.length, dueToday.map(i => itemHTML(i, { notes: true })).join(""));
  if (remToday.length) {
    const nowRow = `<li class="nowline" aria-label="Agora ${hm}"><span class="nl-dot"></span><span class="nl-t">${hm}</span><span class="nl-bar"></span></li>`;
    let rows = "", placed = false;
    for (const i of remToday) {
      if (!placed && effTime(i) > hm) { rows += nowRow; placed = true; }
      rows += itemHTML(i, { notes: true, slotTime: true });
    }
    if (!placed) rows += nowRow;
    const left = remToday.reduce((n, i) => n + slotsOf(i).filter(x => x > hm).length, 0);
    html += group("Lembretes de hoje", `${left} aviso${left === 1 ? "" : "s"} restante${left === 1 ? "" : "s"}`, rows);
  }
  if (!html) {
    html = items.length
      ? emptyHTML("Dia livre", doneToday.length ? "Tudo de hoje está feito. Adicione algo acima ou veja os próximos dias." : "Nada vence nem avisa hoje. Adicione algo acima ou veja os próximos dias.")
      : emptyHTML("Comece pelo que precisa fazer ou lembrar", "Tarefa tem data de vencimento e aparece no resumo diário até ser concluída. Lembrete avisa num horário, uma vez ou várias vezes no dia.");
  }
  if (doneToday.length) html += `<details class="donebox"><summary>Tarefas feitas hoje · ${doneToday.length}</summary><ul class="list">${doneToday.map(i => itemHTML(i, { ghost: !i.done })).join("")}</ul></details>`;
  return html;
}
function renderWeek() {
  const days = weekOccurrences();
  if (!days.some(d => d.list.length)) return emptyHTML("Semana em branco", "Nada marcado para os próximos 7 dias.");
  return days.filter(d => d.list.length).map(({ ds, d, list }) => {
    const label = ds === ymd(addDays(new Date(), 1)) ? "Amanhã" : fmtWeekday.format(d);
    return `<section class="group"><div class="group-h"><h2>${esc(label)}</h2><span class="aux">${esc(fmtLong.format(d))}</span></div><ul class="list">${list.map(i => itemHTML(i, { inDay: true })).join("")}</ul></section>`;
  }).join("");
}
function renderAllView() {
  const open = items.filter(i => !i.done), t = today();
  const byDate = (a, b) => a.date.localeCompare(b.date) || sortMixed(a, b);
  const byTitle = (a, b) => a.title.localeCompare(b.title, "pt-BR");
  const tasks = open.filter(i => i.kind !== "reminder"), rems = open.filter(i => i.kind === "reminder");
  const sections = [
    ["Tarefas", tasks.filter(i => !isRecurring(i)).sort(byDate)],
    ["Tarefas recorrentes", tasks.filter(isRecurring).sort(byTitle)],
    ["Lembretes", rems.filter(i => !isRecurring(i)).sort(byDate)],
    ["Lembretes recorrentes", rems.filter(isRecurring).sort(byTitle)],
  ];
  let html = sections.filter(([, list]) => list.length).map(([title, list]) =>
    `<section class="group"><div class="group-h"><h2>${title}</h2><span class="aux">${list.length}</span></div><ul class="list">${list.map(i => itemHTML(i, { showDate: true })).join("")}</ul></section>`).join("");
  if (!html) html = emptyHTML("Nada pendente", "Tudo o que você adicionar aparece aqui, separado em tarefas e lembretes.");
  const doneOld = items.filter(i => i.done && i.doneAt && ymd(new Date(i.doneAt)) < t);
  if (doneOld.length) html += `<div class="footer-tools"><span class="hint">${doneOld.length} concluído${doneOld.length > 1 ? "s" : ""} de dias anteriores</span><button class="btn" type="button" id="purgeBtn">Limpar concluídos</button></div>`;
  return html;
}
function renderView() {
  const v = $("#view");
  if (!loaded) { v.innerHTML = emptyHTML("Abrindo sua agenda…", "Buscando suas tarefas e lembretes."); return; }
  v.innerHTML = `<div class="stack">${view === "today" ? renderToday() : view === "week" ? renderWeek() : renderAllView()}</div>`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y) / 864e5 + 1) / 7);
}
function renderHeader() {
  const d = new Date();
  $("#hdrWeekday").textContent = fmtWeekday.format(d);
  $("#hdrDate").innerHTML = `<span class="mark">${esc(fmtLong.format(d))}</span>`;
  $("#clock").textContent = nowHM();
  const doy = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  $("#weekNo").textContent = `semana ${isoWeek(d)} · dia ${doy}`;
}
function renderAll() { renderHeader(); renderSummary(); renderView(); renderAlerts(); }

/* ---------- Lembretes na página ---------- */
const announced = new Set();
let audioCtx = null, soundOn = true;
try { soundOn = localStorage.getItem("meudia.sound") !== "off"; } catch {}
const renderSoundBtn = () => { $("#soundBtn").textContent = soundOn ? "Som dos avisos: ligado" : "Som dos avisos: desligado"; };
$("#soundBtn").addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem("meudia.sound", soundOn ? "on" : "off"); } catch {}
  renderSoundBtn();
  if (soundOn) beep();
});
renderSoundBtn();
document.addEventListener("pointerdown", () => { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } }, { once: true });
function beep() {
  if (!soundOn || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, 0.18].forEach((off, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0, t0 + off);
      g.gain.linearRampToValueAtTime(0.18, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + off + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + off); o.stop(t0 + off + 0.3);
    });
  } catch {}
}
const canNotify = () => { try { return "Notification" in window && Notification.permission === "granted"; } catch { return false; } };
try { if ("Notification" in window && Notification.permission === "default") $("#notifBtn").hidden = false; } catch {}
$("#notifBtn").addEventListener("click", async () => {
  try {
    const r = await Notification.requestPermission();
    $("#notifBtn").hidden = true;
    toast(r === "granted" ? "Avisos do sistema ativados" : "Avisos do sistema bloqueados. Os lembretes continuam aparecendo aqui e no Slack.");
  } catch {
    $("#notifBtn").hidden = true;
    toast("Este navegador não permite avisos do sistema. Os lembretes aparecem aqui e no Slack.");
  }
});
function dueAlerts() {
  const now = new Date(), ts = ymd(now);
  return items.filter(it => {
    if (it.kind !== "reminder" || !it.time || it.done || it.date !== ts) return false;
    const at = parseYmd(it.date);
    const [h, m] = it.time.split(":").map(Number);
    at.setHours(h, m, 0, 0);
    if (at > now) return false;
    const key = lastSlotKey(it, ts, nowHM());
    if (!key || key <= (it.ack || "")) return false;
    return !(it.snooze && it.snooze > now.getTime());
  }).sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
}
const baseTitle = document.title;
function renderAlerts() {
  if (!loaded) { $("#alerts").innerHTML = ""; return; }
  const list = dueAlerts();
  $("#alerts").innerHTML = list.map(it => `<div class="alert" role="alert">
      <span class="a-time">${it.date === today() ? "" : esc(relDay(it.date)) + " "}${esc(dueKey(it).slice(11))}</span>
      <span class="a-title">${esc(it.title)}</span>
      <span class="a-actions">${isIntraday(it) ? `
        <button type="button" class="primary" data-act="dismiss" data-id="${esc(it.id)}">Feito</button>
        <button type="button" data-act="snooze" data-id="${esc(it.id)}">Adiar 10 min</button>
        <button type="button" data-act="complete" data-id="${esc(it.id)}">Parar por hoje</button>` : `
        <button type="button" class="primary" data-act="complete" data-id="${esc(it.id)}">Feito</button>
        <button type="button" data-act="snooze" data-id="${esc(it.id)}">Adiar 10 min</button>`}
      </span></div>`).join("");
  let fresh = false;
  for (const it of list) {
    const k = it.id + "|" + dueKey(it) + "|" + (it.snooze || 0);
    if (announced.has(k)) continue;
    announced.add(k); fresh = true;
    if (canNotify()) { try { new Notification("Lembrete · " + dueKey(it).slice(11), { body: it.title, tag: it.id }); } catch {} }
  }
  if (fresh) beep();
  document.title = list.length ? `(${list.length}) ${baseTitle}` : baseTitle;
}

/* ---------- Relógio e sincronização ---------- */
let lastDay = today(), lastMin = nowHM();
setInterval(() => {
  const t = today(), m = nowHM();
  if (t !== lastDay) { lastDay = t; renderAll(); return; }
  if (m !== lastMin) { lastMin = m; renderHeader(); renderSummary(); if (view === "today") renderView(); renderAlerts(); }
}, 5000);
setInterval(() => { if (document.visibilityState === "visible" && $("#scrim").hidden) load(); }, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });

/* ---------- Campos do formulário (usados no "Adicionar" e no editor) ---------- */
const RECUR_OPTS = [["none", "Não repete"], ["daily", "Todo dia"], ["weekdays", "Dias úteis (seg–sex)"], ["weekly", "Toda semana"], ["monthly", "Todo mês"]];
const PRIOS = [[0, "Normal"], [1, "Média"], [2, "Alta"]];
const EVERY_OPTS = [[0, "Só uma vez"], [15, "A cada 15 min"], [30, "A cada 30 min"], [60, "A cada 1 h"], [90, "A cada 1 h 30"], [120, "A cada 2 h"], [180, "A cada 3 h"], [240, "A cada 4 h"]];
const KINDS = [["task", "Tarefa"], ["reminder", "Lembrete"]];
const KIND_TEXT = {
  task: { date: "Vence em", time: "Hora limite (opcional)", placeholder: "O que você precisa fazer?" },
  reminder: { date: "Dia", time: "Hora do aviso", placeholder: "Do que você quer ser lembrado?" },
};

function kindHTML(p) {
  return `<div class="seg kind-seg" role="radiogroup" aria-label="Tipo">${KINDS.map(([v, l]) =>
    `<label><input type="radio" name="${p}-kind" id="${p}-k-${v}" value="${v}"><span>${l}</span></label>`).join("")}</div>`;
}

function fieldsHTML(p, { notesCollapsed }) {
  const notes = `<textarea id="${p}-notes" maxlength="4000" aria-label="Notas"></textarea>`;
  return `
    <div class="fields">
      <div class="field f-date"><label for="${p}-date" id="${p}-dateLbl">Dia</label>
        <div class="date-row">
          <input id="${p}-date" type="date" required>
          <div class="quick-days">
            <button type="button" data-setday="0" data-form="${p}" aria-pressed="false">Hoje</button>
            <button type="button" data-setday="1" data-form="${p}" aria-pressed="false">Amanhã</button>
          </div>
        </div>
      </div>
      <div class="field"><label for="${p}-time" id="${p}-timeLbl">Hora</label><input id="${p}-time" type="time"></div>
      <div class="field" id="${p}-prioField"><span class="lbl">Prioridade</span>
        <div class="seg">${PRIOS.map(([v, l]) => `<label><input type="radio" name="${p}-prio" id="${p}-p${v}" value="${v}"><span>${l}</span></label>`).join("")}</div>
      </div>
      <div class="field f-recur"><label for="${p}-recur">Repetir em dias</label>
        <select id="${p}-recur">${RECUR_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      </div>
      <div class="field" id="${p}-everyField"><label for="${p}-every">Avisos no dia</label>
        <select id="${p}-every">${EVERY_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      </div>
      <div class="field" id="${p}-untilField"><label for="${p}-until">Até</label><input id="${p}-until" type="time"></div>
    </div>
    <div class="form-extra">
      <div class="field" id="${p}-daysField" hidden><span class="lbl">Dias da semana</span>
        <div class="days">${[1, 2, 3, 4, 5, 6, 0].map(w => `<label><input type="checkbox" id="${p}-d${w}" value="${w}">${WD_SHORT[w]}</label>`).join("")}</div>
      </div>
      <p class="form-summary" id="${p}-summary" aria-live="polite"></p>
      ${notesCollapsed
        ? `<details class="notes-toggle" id="${p}-notesBox"><summary>+ Adicionar nota</summary>${notes}</details>`
        : `<div class="field"><label for="${p}-notes">Notas</label>${notes}</div>`}
    </div>`;
}

const fld = (p, name) => $(`#${p}-${name}`);
const checkedDays = p => [1, 2, 3, 4, 5, 6, 0].filter(w => fld(p, "d" + w).checked);
const kindOf = p => document.querySelector(`input[name="${p}-kind"]:checked`)?.value || "task";

function readFields(p) {
  const kind = kindOf(p);
  const date = fld(p, "date").value || today();
  const t = fld(p, "recur").value;
  const recur = normRecur({ t, days: t === "weekly" ? checkedDays(p) : undefined }, date);
  const time = fld(p, "time").value || "";
  const every = kind === "reminder" && time ? +fld(p, "every").value : 0;
  return {
    kind,
    date: alignDate(recur, date),
    time,
    every,
    until: every ? fld(p, "until").value || "" : "",
    prio: kind === "task" ? +(document.querySelector(`input[name="${p}-prio"]:checked`)?.value || 0) : 0,
    notes: fld(p, "notes").value.trim(),
    recur,
  };
}

function writeFields(p, src) {
  fld(p, "k-" + (src.kind === "reminder" ? "reminder" : "task")).checked = true;
  fld(p, "date").value = src.date || today();
  fld(p, "time").value = src.time || "";
  fld(p, "every").value = String(src.every || 0);
  fld(p, "until").value = src.until || "";
  fld(p, "p" + (src.prio || 0)).checked = true;
  fld(p, "recur").value = (src.recur && src.recur.t) || "none";
  const days = (src.recur && src.recur.days) || [];
  [0, 1, 2, 3, 4, 5, 6].forEach(w => { fld(p, "d" + w).checked = days.includes(w); });
  fld(p, "notes").value = src.notes || "";
  const box = $(`#${p}-notesBox`);
  if (box) box.open = !!src.notes;
  syncFields(p);
}

/** Problema que impede salvar, ou null. */
function formError(v) {
  if (v.kind === "reminder" && !v.time) return "Escolha a hora do aviso.";
  if (v.every && (!v.until || v.until <= v.time)) return "Em \"Até\", escolha um horário depois do início.";
  return null;
}

/** Mostra só os campos do tipo escolhido e resume em uma frase o que vai ser salvo. */
function syncFields(p) {
  const kind = kindOf(p), isRem = kind === "reminder", text = KIND_TEXT[kind];
  fld(p, "dateLbl").textContent = text.date;
  fld(p, "timeLbl").textContent = text.time;
  fld(p, "time").required = isRem;
  fld(p, "prioField").hidden = isRem;
  fld(p, "everyField").hidden = !isRem;
  fld(p, "untilField").hidden = !isRem;
  if (p === "q") $("#quick").placeholder = text.placeholder;
  fld(p, "daysField").hidden = fld(p, "recur").value !== "weekly";
  const date = fld(p, "date").value;
  document.querySelectorAll(`[data-form="${p}"][data-setday]`).forEach(b => {
    b.setAttribute("aria-pressed", String(date === ymd(addDays(new Date(), +b.dataset.setday))));
  });
  const hasTime = !!fld(p, "time").value, every = +fld(p, "every").value;
  fld(p, "every").disabled = !hasTime;
  fld(p, "until").disabled = !hasTime || !every;
  const out = fld(p, "summary");
  if (!date) { out.textContent = "Escolha um dia."; return; }
  const v = readFields(p), err = formError(v);
  if (err) { out.textContent = err; return; }
  const day = `<b>${esc(relDay(v.date))}</b>`;
  if (!isRem) {
    const limit = v.time ? ` até as <b>${esc(v.time)}</b>` : "";
    out.innerHTML = v.recur.t === "none"
      ? `Vence ${day}${limit}. Aparece no resumo diário até ser concluída.`
      : `Repete <b>${esc(recurLabel(v.recur))}</b>. Próximo vencimento: ${day}${limit}.`;
    return;
  }
  let when = ` às <b>${esc(v.time)}</b>`;
  if (v.every) {
    const slots = slotsOf(v), n = slots.length;
    when = `, <b>${esc(everyLabel(v).replace(/ até .*/, ""))}</b> das ${esc(v.time)} às ${esc(slots[n - 1])} (<b>${n}</b> aviso${n === 1 ? "" : "s"} por dia)`;
  }
  out.innerHTML = v.recur.t === "none"
    ? `Avisa ${day}${when}.`
    : `Avisa <b>${esc(recurLabel(v.recur))}</b>${when}. Próximo: ${day}.`;
}

function mountFields(p, kindBox, container, opts) {
  kindBox.innerHTML = kindHTML(p);
  container.innerHTML = fieldsHTML(p, opts);
  kindBox.addEventListener("change", () => {
    if (p === "q") { try { localStorage.setItem("meudia.kind", kindOf(p)); } catch {} }
    syncFields(p);
  });
  container.addEventListener("input", () => syncFields(p));
  container.addEventListener("change", e => {
    if (e.target === fld(p, "every") && +fld(p, "every").value && !fld(p, "until").value) {
      const t = fld(p, "time").value;
      fld(p, "until").value = t && t < "20:00" ? "20:00" : "23:00";
    }
    if (e.target === fld(p, "recur") && fld(p, "recur").value === "weekly" && !checkedDays(p).length) {
      fld(p, "d" + parseYmd(fld(p, "date").value || today()).getDay()).checked = true;
    }
    syncFields(p);
  });
  container.addEventListener("click", e => {
    const b = e.target.closest("[data-setday]");
    if (!b) return;
    fld(p, "date").value = ymd(addDays(new Date(), +b.dataset.setday));
    syncFields(p);
  });
}

function lastKind() { try { return localStorage.getItem("meudia.kind") === "reminder" ? "reminder" : "task"; } catch { return "task"; } }
const blank = () => ({ kind: lastKind(), date: today(), time: "", prio: 0, notes: "", recur: { t: "none" } });

/* ---------- Adicionar ---------- */
const quick = $("#quick");
mountFields("q", $("#qKind"), $("#qFields"), { notesCollapsed: true });
writeFields("q", blank());
quick.addEventListener("input", () => { $("#addBtn").disabled = !quick.value.trim(); });
$("#composer").addEventListener("submit", e => {
  e.preventDefault();
  const title = quick.value.trim();
  if (!title) { quick.focus(); return; }
  const data = { title, ...readFields("q") }, err = formError(data);
  if (err) { toast(err); fld("q", data.kind === "reminder" && !data.time ? "time" : "until").focus(); return; }
  quick.value = ""; $("#addBtn").disabled = true;
  writeFields("q", blank());
  quick.focus();
  const what = data.kind === "reminder" ? `Lembrete para ${relDay(data.date)} às ${data.time}` : `Tarefa para ${relDay(data.date)}`;
  addItem(data).then(() => toast(`${what} adicionado${data.kind === "reminder" ? "" : "a"}`))
    .catch(() => { quick.value = title; $("#addBtn").disabled = false; writeFields("q", data); });
});

/* ---------- Editor ---------- */
let editing = null, delArmed = false;
mountFields("f", $("#fKind"), $("#fFields"), { notesCollapsed: false });
function openEditor(it) {
  editing = it; delArmed = false;
  $("#f-title").value = it.title || "";
  writeFields("f", it);
  $("#delBtn").textContent = "Excluir";
  $("#scrim").hidden = false;
  setTimeout(() => $("#f-title").focus(), 0);
}
function closeEditor() { $("#scrim").hidden = true; editing = null; }
$("#cancelBtn").addEventListener("click", closeEditor);
$("#scrim").addEventListener("click", e => { if (e.target === $("#scrim")) closeEditor(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scrim").hidden) closeEditor(); });
$("#delBtn").addEventListener("click", () => {
  if (!editing) return;
  if (!delArmed) { delArmed = true; $("#delBtn").textContent = "Confirmar exclusão"; return; }
  const before = strip(editing), id = editing.id;
  closeEditor();
  items = items.filter(i => i.id !== id);
  mutate(null, () => api("/api/items/" + id, { method: "DELETE" }))
    .then(() => toast("Excluído", () => mutate(null, () => api("/api/items", { method: "POST", body: before })).catch(() => load())))
    .catch(() => load());
});
$("#editor").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("#f-title").value.trim();
  if (!title || !editing) return;
  const prev = editing, data = { title, ...readFields("f") }, err = formError(data);
  if (err) { toast(err); return; }
  const changedWhen = prev.kind !== data.kind || prev.date !== data.date || prev.time !== data.time
    || (prev.every || 0) !== data.every || (prev.until || "") !== data.until;
  const body = { ...strip(prev), ...data, ...(changedWhen ? { ack: "", snooze: 0 } : {}) };
  mutate({ ...prev, ...body }, () => api("/api/items/" + prev.id, { method: "PUT", body })).then(() => toast("Salvo")).catch(() => load());
  closeEditor();
});

/* ---------- Cliques ---------- */
document.addEventListener("click", e => {
  if (e.target.closest("#purgeBtn")) {
    mutate(null, () => api("/api/items/purge-done", { method: "POST" }))
      .then(r => { toast(`${r.removed} concluída${r.removed === 1 ? "" : "s"} removida${r.removed === 1 ? "" : "s"}`); return load(); })
      .catch(() => {});
    return;
  }
  const tab = e.target.closest(".tab");
  if (tab) {
    view = tab.dataset.view;
    document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", b === tab ? "true" : "false"));
    renderView();
    return;
  }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const it = items.find(i => i.id === el.dataset.id);
  if (!it) return;
  switch (el.dataset.act) {
    case "complete": complete(it); break;
    case "reopen": reopen(it); break;
    case "edit": openEditor(it); break;
    case "snooze": snooze(it, 10); break;
    case "dismiss": dismiss(it); break;
  }
});

init();
