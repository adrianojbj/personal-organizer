import {
  pad, ymd, parseYmd, addDays, WD_SHORT, normRecur, alignDate, isRecurring, occursOn,
  recurLabel, completedState,
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
    title: p.title, date: p.date, time: p.time || "", prio: p.prio || 0, notes: p.notes || "", recur: normRecur(p.recur, p.date),
  } }));
}
function restore(id, before) {
  return mutate({ ...items.find(i => i.id === id), ...before }, () => api("/api/items/" + id, { method: "PUT", body: before })).catch(() => load());
}
function complete(it) {
  const before = strip(it);
  const next = completedState(it, today(), new Date().toISOString());
  mutate(next, () => api(`/api/items/${it.id}/complete`, { method: "POST" })).then(() => {
    if (isRecurring(it)) toast("Feito. Próxima: " + relDay(next.date) + (next.time ? " às " + next.time : ""), () => restore(it.id, before));
    else toast("Concluída", () => restore(it.id, before));
  }).catch(() => load());
}
const action = (it, name, optimistic, body) =>
  mutate(optimistic, () => api(`/api/items/${it.id}/${name}`, { method: "POST", body })).catch(() => load());
const dueKey = it => it.date + "T" + it.time;
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
  if (a.time && b.time) return a.time.localeCompare(b.time) || b.prio - a.prio;
  if (a.time) return -1;
  if (b.time) return 1;
  return b.prio - a.prio || (a.created || 0) - (b.created || 0);
}
function itemHTML(it, opts = {}) {
  const meta = [];
  if (opts.late) { const n = daysLate(it.date); meta.push(`<span class="late">atrasada ${n === 1 ? "desde ontem" : "há " + n + " dias"}</span>`); }
  if (opts.showDate) meta.push(`<span>${esc(relDay(it.date))}</span>`);
  if (it.time && !it.done) meta.push(`<span>${ICON.bell}lembrete</span>`);
  if (isRecurring(it)) meta.push(`<span>${ICON.rep}${esc(recurLabel(it.recur))}</span>`);
  if (it.lastDone === today() && opts.ghost) meta.push(`<span>feito hoje</span>`);
  if (it.notes) meta.push(`<span>${ICON.note}nota</span>`);
  const cls = ["item"];
  if (it.prio) cls.push("p" + it.prio);
  if (it.done || opts.ghost) cls.push("done");
  const act = opts.ghost ? "" : (it.done ? "reopen" : "complete");
  return `<li class="${cls.join(" ")}">
    <button class="check" type="button" data-act="${act}" data-id="${esc(it.id)}" aria-label="${it.done ? "Reabrir" : "Concluir"}: ${esc(it.title)}" ${opts.ghost ? "disabled" : ""}>${ICON.check}</button>
    <div class="when ${it.time ? "timed" : ""}">${it.time ? esc(it.time) : "—"}</div>
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
  const late = open.filter(i => i.date < t).sort((a, b) => a.date.localeCompare(b.date) || sortDay(a, b));
  const todayList = open.filter(i => i.date === t).sort(sortDay);
  const doneToday = items.filter(i => (i.done && i.doneAt && ymd(new Date(i.doneAt)) === t) || (!i.done && isRecurring(i) && i.lastDone === t && i.date !== t));
  return { late, todayList, doneToday };
}
function weekOccurrences() {
  const days = [], base = new Date();
  for (let k = 1; k <= 7; k++) {
    const d = addDays(base, k), ds = ymd(d);
    const list = items.filter(i => !i.done && (isRecurring(i) ? occursOn(i, d) : i.date === ds)).sort(sortDay);
    days.push({ ds, d, list });
  }
  return days;
}
function renderSummary() {
  const { late, todayList, doneToday } = buckets(), hm = nowHM();
  const left = todayList.filter(i => i.time && i.time > hm).length;
  $("#summary").innerHTML = !loaded ? "" : [
    late.length ? `<span class="stat late"><b>${late.length}</b> atrasada${late.length > 1 ? "s" : ""}</span>` : "",
    `<span class="stat"><b>${todayList.length}</b> para hoje</span>`,
    `<span class="stat"><b>${left}</b> lembrete${left === 1 ? "" : "s"} restante${left === 1 ? "" : "s"}</span>`,
    `<span class="stat ok"><b>${doneToday.length}</b> feita${doneToday.length === 1 ? "" : "s"} hoje</span>`,
  ].join("");
  $("#nToday").textContent = loaded ? (late.length + todayList.length || "") : "";
  const wk = weekOccurrences().reduce((n, d) => n + d.list.length, 0);
  $("#nWeek").textContent = loaded && wk ? wk : "";
  const all = items.filter(i => !i.done).length;
  $("#nAll").textContent = loaded && all ? all : "";
}
function renderToday() {
  const { late, todayList, doneToday } = buckets(), hm = nowHM();
  let html = "";
  if (late.length) html += `<section class="group"><div class="group-h"><h2 class="late">Atrasadas</h2><span class="aux">${late.length}</span></div><ul class="list">${late.map(i => itemHTML(i, { late: true })).join("")}</ul></section>`;
  if (todayList.length) {
    const timed = todayList.filter(i => i.time), untimed = todayList.filter(i => !i.time);
    const nowRow = `<li class="nowline" aria-label="Agora ${hm}"><span class="nl-dot"></span><span class="nl-t">${hm}</span><span class="nl-bar"></span></li>`;
    let rows = "", placed = false;
    for (const i of timed) {
      if (!placed && i.time > hm) { rows += nowRow; placed = true; }
      rows += itemHTML(i, { notes: true });
    }
    if (timed.length && !placed) rows += nowRow;
    rows += untimed.map(i => itemHTML(i, { notes: true })).join("");
    html += `<section class="group"><div class="group-h"><h2>Hoje</h2><span class="aux">${timed.length} com horário · ${untimed.length} sem</span></div><ul class="list">${rows}</ul></section>`;
  }
  if (!late.length && !todayList.length) {
    html += items.length
      ? emptyHTML("Dia livre", doneToday.length ? "Tudo de hoje está feito. Adicione algo acima ou veja os próximos dias." : "Nada marcado para hoje. Adicione uma tarefa acima ou veja os próximos dias.")
      : emptyHTML("Comece pelo que precisa lembrar hoje", "Escreva a tarefa acima e escolha o dia. Com hora, ela vira lembrete. Também dá para definir prioridade e repetição.");
  }
  if (doneToday.length) html += `<details class="donebox"><summary>Feitas hoje · ${doneToday.length}</summary><ul class="list">${doneToday.map(i => itemHTML(i, { ghost: !i.done })).join("")}</ul></details>`;
  return html;
}
function renderWeek() {
  const days = weekOccurrences();
  if (!days.some(d => d.list.length)) return emptyHTML("Semana em branco", "Nada marcado para os próximos 7 dias.");
  return days.filter(d => d.list.length).map(({ ds, d, list }) => {
    const label = ds === ymd(addDays(new Date(), 1)) ? "Amanhã" : fmtWeekday.format(d);
    return `<section class="group"><div class="group-h"><h2>${esc(label)}</h2><span class="aux">${esc(fmtLong.format(d))}</span></div><ul class="list">${list.map(i => itemHTML(i)).join("")}</ul></section>`;
  }).join("");
}
function renderAllView() {
  const open = items.filter(i => !i.done);
  const rec = open.filter(isRecurring).sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const once = open.filter(i => !isRecurring(i)).sort((a, b) => a.date.localeCompare(b.date) || sortDay(a, b));
  const doneOld = items.filter(i => i.done && i.doneAt && ymd(new Date(i.doneAt)) < today());
  let html = "";
  if (rec.length) html += `<section class="group"><div class="group-h"><h2>Recorrentes</h2><span class="aux">${rec.length}</span></div><ul class="list">${rec.map(i => itemHTML(i, { showDate: true })).join("")}</ul></section>`;
  if (once.length) html += `<section class="group"><div class="group-h"><h2>Agendadas</h2><span class="aux">${once.length}</span></div><ul class="list">${once.map(i => itemHTML(i, { showDate: true, late: i.date < today() })).join("")}</ul></section>`;
  if (!html) html = emptyHTML("Nada pendente", "Tudo o que você adicionar aparece aqui, separado entre recorrentes e agendadas.");
  if (doneOld.length) html += `<div class="footer-tools"><span class="hint">${doneOld.length} concluída${doneOld.length > 1 ? "s" : ""} de dias anteriores</span><button class="btn" type="button" id="purgeBtn">Limpar concluídas</button></div>`;
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
    if (!it.time || it.done || it.date > ts) return false;
    const at = parseYmd(it.date);
    const [h, m] = it.time.split(":").map(Number);
    at.setHours(h, m, 0, 0);
    if (at > now || it.ack === dueKey(it)) return false;
    return !(it.snooze && it.snooze > now.getTime());
  }).sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
}
const baseTitle = document.title;
function renderAlerts() {
  if (!loaded) { $("#alerts").innerHTML = ""; return; }
  const list = dueAlerts();
  $("#alerts").innerHTML = list.map(it => `<div class="alert" role="alert">
      <span class="a-time">${it.date === today() ? esc(it.time) : esc(relDay(it.date)) + " " + esc(it.time)}</span>
      <span class="a-title">${esc(it.title)}</span>
      <span class="a-actions">
        <button type="button" class="primary" data-act="complete" data-id="${esc(it.id)}">Concluir</button>
        <button type="button" data-act="snooze" data-id="${esc(it.id)}">Adiar 10 min</button>
        <button type="button" data-act="dismiss" data-id="${esc(it.id)}">Dispensar</button>
      </span></div>`).join("");
  let fresh = false;
  for (const it of list) {
    const k = it.id + "|" + dueKey(it) + "|" + (it.snooze || 0);
    if (announced.has(k)) continue;
    announced.add(k); fresh = true;
    if (canNotify()) { try { new Notification("Lembrete · " + it.time, { body: it.title, tag: it.id }); } catch {} }
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

function fieldsHTML(p, { notesCollapsed }) {
  const notes = `<textarea id="${p}-notes" maxlength="4000" aria-label="Notas"></textarea>`;
  return `
    <div class="fields">
      <div class="field f-date"><label for="${p}-date">Dia</label>
        <div class="date-row">
          <input id="${p}-date" type="date" required>
          <div class="quick-days">
            <button type="button" data-setday="0" data-form="${p}" aria-pressed="false">Hoje</button>
            <button type="button" data-setday="1" data-form="${p}" aria-pressed="false">Amanhã</button>
          </div>
        </div>
      </div>
      <div class="field"><label for="${p}-time">Hora do lembrete</label><input id="${p}-time" type="time"></div>
      <div class="field"><span class="lbl">Prioridade</span>
        <div class="seg">${PRIOS.map(([v, l]) => `<label><input type="radio" name="${p}-prio" id="${p}-p${v}" value="${v}"><span>${l}</span></label>`).join("")}</div>
      </div>
      <div class="field f-recur"><label for="${p}-recur">Repetir</label>
        <select id="${p}-recur">${RECUR_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      </div>
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

function readFields(p) {
  const date = fld(p, "date").value || today();
  const t = fld(p, "recur").value;
  const recur = normRecur({ t, days: t === "weekly" ? checkedDays(p) : undefined }, date);
  return {
    date: alignDate(recur, date),
    time: fld(p, "time").value || "",
    prio: +(document.querySelector(`input[name="${p}-prio"]:checked`)?.value || 0),
    notes: fld(p, "notes").value.trim(),
    recur,
  };
}

function writeFields(p, src) {
  fld(p, "date").value = src.date || today();
  fld(p, "time").value = src.time || "";
  fld(p, "p" + (src.prio || 0)).checked = true;
  fld(p, "recur").value = (src.recur && src.recur.t) || "none";
  const days = (src.recur && src.recur.days) || [];
  [0, 1, 2, 3, 4, 5, 6].forEach(w => { fld(p, "d" + w).checked = days.includes(w); });
  fld(p, "notes").value = src.notes || "";
  const box = $(`#${p}-notesBox`);
  if (box) box.open = !!src.notes;
  syncFields(p);
}

/** Mostra os dias da semana quando precisa e resume em uma frase o que vai ser salvo. */
function syncFields(p) {
  const t = fld(p, "recur").value;
  fld(p, "daysField").hidden = t !== "weekly";
  const date = fld(p, "date").value;
  document.querySelectorAll(`[data-form="${p}"][data-setday]`).forEach(b => {
    b.setAttribute("aria-pressed", String(date === ymd(addDays(new Date(), +b.dataset.setday))));
  });
  if (!date) { fld(p, "summary").textContent = "Escolha um dia."; return; }
  const v = readFields(p);
  const when = v.time ? ` às <b>${esc(v.time)}</b>, com lembrete` : ", sem lembrete";
  fld(p, "summary").innerHTML = v.recur.t === "none"
    ? `Para <b>${esc(relDay(v.date))}</b>${when}.`
    : `Repete <b>${esc(recurLabel(v.recur))}</b>${when}. Próxima: <b>${esc(relDay(v.date))}</b>.`;
}

function mountFields(p, container, opts) {
  container.innerHTML = fieldsHTML(p, opts);
  container.addEventListener("input", () => syncFields(p));
  container.addEventListener("change", e => {
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

const BLANK = { date: "", time: "", prio: 0, notes: "", recur: { t: "none" } };

/* ---------- Adicionar ---------- */
const quick = $("#quick");
mountFields("q", $("#qFields"), { notesCollapsed: true });
writeFields("q", { ...BLANK, date: today() });
quick.addEventListener("input", () => { $("#addBtn").disabled = !quick.value.trim(); });
$("#composer").addEventListener("submit", e => {
  e.preventDefault();
  const title = quick.value.trim();
  if (!title) { quick.focus(); return; }
  const data = { title, ...readFields("q") };
  quick.value = ""; $("#addBtn").disabled = true;
  writeFields("q", { ...BLANK, date: today() });
  quick.focus();
  addItem(data).then(() => toast(`Adicionado para ${relDay(data.date)}${data.time ? " às " + data.time : ""}`))
    .catch(() => { quick.value = title; $("#addBtn").disabled = false; writeFields("q", data); });
});

/* ---------- Editor ---------- */
let editing = null, delArmed = false;
mountFields("f", $("#fFields"), { notesCollapsed: false });
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
  const prev = editing, data = { title, ...readFields("f") };
  const changedWhen = prev.date !== data.date || prev.time !== data.time;
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
