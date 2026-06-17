/* ============================================================
   MEINE ARBEITSZEIT — Zeiterfassungs-App
   Alle Daten werden im Browser gespeichert (localStorage).
   Das heißt: Die Daten bleiben nur auf diesem Computer / in
   diesem Browser erhalten. Es gibt keinen Server, der Daten
   sammelt — alles passiert lokal bei dir.
   ============================================================ */

const STORAGE_KEY = "zeiterfassung_v1";

/* ---------- Grunddaten & Einstellungen ---------- */
const defaultState = {
  settings: {
    sollStundenWoche: 15,      // vom Nutzer festgelegt
    urlaubstageJahr: 18,        // vom Nutzer festgelegt
    arbeitstageWoche: 5,        // Standard: Mo-Fr, anpassbar
    stundenlohn: 0              // € pro Stunde, vom Nutzer festgelegt
  },
  entries: [] // jeder Eintrag: {id, date, type, start, end, pauseMin, note}
};

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    // Falls alte Daten unvollständig sind, mit Defaults auffüllen
    return {
      settings: { ...defaultState.settings, ...(parsed.settings||{}) },
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  }catch(e){
    console.error("Konnte gespeicherte Daten nicht lesen, starte neu.", e);
    return structuredClone(defaultState);
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

/* ---------- Hilfsfunktionen ---------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function fmtDate(d){
  // YYYY-MM-DD -> TT.MM.JJJJ
  const [y,m,day] = d.split("-");
  return `${day}.${m}.${y}`;
}

function todayISO(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function minutesToHM(min){
  const sign = min < 0 ? "-" : "";
  min = Math.abs(Math.round(min));
  const h = Math.floor(min/60);
  const m = min % 60;
  return `${sign}${h}:${String(m).padStart(2,"0")} h`;
}

function diffMinutes(start, end, pauseMin){
  const [sh,sm] = start.split(":").map(Number);
  const [eh,em] = end.split(":").map(Number);
  let mins = (eh*60+em) - (sh*60+sm);
  if(mins < 0) mins += 24*60; // falls über Mitternacht (selten, aber sicher ist sicher)
  return mins - (Number(pauseMin)||0);
}

function entryDurationMinutes(entry){
  if(entry.type !== "work") return 0;
  return diffMinutes(entry.start, entry.end, entry.pauseMin);
}

function sortedEntries(){
  return [...state.entries].sort((a,b)=> a.date.localeCompare(b.date));
}

function entriesInRange(startISO, endISO){
  return state.entries.filter(e => e.date >= startISO && e.date <= endISO);
}

/* Soll-Minuten pro Tag, abgeleitet aus Wochenstunden / Arbeitstagen */
function sollMinutenProTag(){
  const { sollStundenWoche, arbeitstageWoche } = state.settings;
  return (sollStundenWoche / arbeitstageWoche) * 60;
}

function isWeekday(dateISO){
  const day = new Date(dateISO + "T00:00:00").getDay(); // 0=So,6=Sa
  return day >= 1 && day <= 5;
}

/* Überstunden-Berechnung: für jeden Werktag von Beginn der Daten bis HEUTE
   (niemals weiter — auch wenn schon Einträge für die Zukunft existieren,
   z.B. ein im Voraus eingetragener Urlaubstag nächste Woche), vergleichen
   wir geleistete Minuten mit Soll-Minuten. Urlaubs- und Kranktage zählen
   als "erfüllt" (kein Minus). Zukünftige Einträge bleiben im Kalender und
   in den Listen sichtbar, fließen aber bewusst NICHT in den Saldo ein,
   bis der Tag tatsächlich erreicht ist. */
function berechneUeberstunden(){
  const todayIso = todayISO();

  // Nur Einträge bis und mit heute zählen für den Saldo
  const entries = sortedEntries().filter(e => e.date <= todayIso);
  if(entries.length === 0) return 0;

  const byDate = {};
  entries.forEach(e=>{
    if(!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const firstDate = entries[0].date;
  let cursor = new Date(firstDate + "T00:00:00");
  const endDate = new Date(todayIso + "T00:00:00");
  const sollProTag = sollMinutenProTag();
  let saldoMinuten = 0;

  while(cursor <= endDate){
    const iso = cursor.toISOString().slice(0,10);
    if(isWeekday(iso)){
      const dayEntries = byDate[iso] || [];
      const hasVacationOrSick = dayEntries.some(e=> e.type==="vacation" || e.type==="sick");
      const workedMin = dayEntries.reduce((sum,e)=> sum + entryDurationMinutes(e), 0);

      if(hasVacationOrSick){
        // Urlaub/Krank = Soll gilt als erfüllt, keine Gutschrift, kein Abzug
      } else if(dayEntries.length > 0){
        saldoMinuten += (workedMin - sollProTag);
      }
      // Tage ganz ohne Eintrag werden nicht gewertet (z.B. Vergangenheit vor Nutzungsbeginn,
      // oder einfach ein Tag, an dem noch nichts eingetragen wurde)
    }
    cursor.setDate(cursor.getDate()+1);
  }
  return saldoMinuten;
}

/* Verdienst-Berechnung: zählt alle Stunden bis HEUTE (genau wie die
   Überstunden), bei denen tatsächlich gearbeitet wurde, PLUS die
   Soll-Stunden für Urlaubs- und Krankheitstage (die zählen wie bezahlte
   Zeit). Zukünftige Tage fließen nicht ein. */
function berechneVerdienstMinuten(jahr, monat){
  // monat ist 0-indexiert (0=Januar), wie bei JS-Date üblich
  const todayIso = todayISO();
  const monatStr = `${jahr}-${String(monat+1).padStart(2,"0")}`;
  const sollProTag = sollMinutenProTag();

  const relevantEntries = state.entries.filter(e =>
    e.date.startsWith(monatStr) && e.date <= todayIso && isWeekday(e.date)
  );

  const byDate = {};
  relevantEntries.forEach(e=>{
    if(!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  let minuten = 0;
  Object.values(byDate).forEach(dayEntries=>{
    const hasVacationOrSick = dayEntries.some(e=> e.type==="vacation" || e.type==="sick");
    if(hasVacationOrSick){
      minuten += sollProTag; // bezahlte Zeit, wie ein normaler Arbeitstag
    } else {
      minuten += dayEntries.reduce((sum,e)=> sum + entryDurationMinutes(e), 0);
    }
  });

  return minuten;
}

function berechneVerdienstEuro(jahr, monat){
  const stunden = berechneVerdienstMinuten(jahr, monat) / 60;
  return stunden * (state.settings.stundenlohn || 0);
}

function fmtEuro(value){
  return new Intl.NumberFormat('de-DE', { style:'currency', currency:'EUR' }).format(value);
}

function urlaubsTageGenommen(jahr){
  return state.entries.filter(e => e.type === "vacation" && e.date.startsWith(String(jahr))).length;
}

function krankTageJahr(jahr){
  return state.entries.filter(e => e.type === "sick" && e.date.startsWith(String(jahr))).length;
}

/* ---------- Navigation ---------- */
const views = ["dashboard","entry","calendar","stats","settings"];
let activeView = "dashboard";
let calendarCursor = new Date(); // für Kalender-Navigation

document.getElementById("mainNav").addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-view]");
  if(!btn) return;
  setActiveView(btn.dataset.view);
});

function setActiveView(view){
  activeView = view;
  document.querySelectorAll("#mainNav button").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === view);
  });
  views.forEach(v=>{
    document.getElementById("view-"+v).classList.toggle("active", v===view);
  });
  renderActiveView();
}

function renderActiveView(){
  if(activeView==="dashboard") renderDashboard();
  if(activeView==="entry") renderEntry();
  if(activeView==="calendar") renderCalendar();
  if(activeView==="stats") renderStats();
  if(activeView==="settings") renderSettings();
}

function renderTodayPill(){
  const opts = { weekday:'long', day:'2-digit', month:'long', year:'numeric' };
  document.getElementById("todayPill").textContent =
    new Date().toLocaleDateString('de-DE', opts);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const el = document.getElementById("view-dashboard");
  const now = new Date();
  const jahr = now.getFullYear();
  const monat = now.getMonth();
  const saldo = berechneUeberstunden();
  const urlaubGenommen = urlaubsTageGenommen(jahr);
  const urlaubRest = state.settings.urlaubstageJahr - urlaubGenommen;
  const krankTage = krankTageJahr(jahr);
  const verdienst = berechneVerdienstEuro(jahr, monat);
  const monatsName = now.toLocaleDateString('de-DE', { month:'long' });

  const letzte = sortedEntries().slice(-6).reverse();

  el.innerHTML = `
    <div class="grid-cards">
      <div class="metric">
        <p class="label">Überstunden-Saldo</p>
        <p class="value ${saldo>=0?'pos':'neg'}">${minutesToHM(saldo)}</p>
        <p class="sub">${saldo>=0 ? 'im Plus' : 'im Minus'} · bis heute</p>
      </div>
      <div class="metric">
        <p class="label">Verdienst ${monatsName}</p>
        <p class="value">${state.settings.stundenlohn>0 ? fmtEuro(verdienst) : '—'}</p>
        <p class="sub">${state.settings.stundenlohn>0 ? `bei ${state.settings.stundenlohn} €/h, bis heute` : 'Stundenlohn in Einstellungen eintragen'}</p>
      </div>
      <div class="metric">
        <p class="label">Urlaub übrig</p>
        <p class="value">${urlaubRest} <span style="font-size:14px;color:var(--text-faint);">/ ${state.settings.urlaubstageJahr}</span></p>
        <p class="sub">${urlaubGenommen} Tage genommen ${jahr}</p>
      </div>
      <div class="metric">
        <p class="label">Krankheitstage</p>
        <p class="value">${krankTage}</p>
        <p class="sub">im Jahr ${jahr}</p>
      </div>
    </div>

    <h2 class="section-title">Letzte Einträge</h2>
    <div class="card">
      ${letzte.length === 0 ? emptyState("ti-clock", "Noch keine Einträge", "Trag deine erste Arbeitszeit, Urlaub oder Krankheit unter „Eintragen“ ein.") : renderEntryTable(letzte, false)}
    </div>
  `;
}

function emptyState(icon, title, sub){
  return `<div class="empty"><i class="ti ${icon}"></i><div style="font-weight:500;color:var(--text);margin-bottom:4px;">${title}</div><div>${sub}</div></div>`;
}

/* ============================================================
   EINTRAGEN
   ============================================================ */
function renderEntry(){
  const el = document.getElementById("view-entry");
  el.innerHTML = `
    <h2 class="section-title">Neuen Eintrag erfassen</h2>
    <div class="card" style="margin-bottom:28px;">
      <div class="form-row">
        <div>
          <label for="f-type">Art des Eintrags</label>
          <select id="f-type">
            <option value="work">Arbeitszeit</option>
            <option value="vacation">Urlaub</option>
            <option value="sick">Krankheit</option>
          </select>
        </div>
        <div>
          <label for="f-date">Datum</label>
          <input type="date" id="f-date" value="${todayISO()}">
        </div>
      </div>

      <div id="f-work-fields" class="form-row">
        <div>
          <label for="f-start">Beginn</label>
          <input type="time" id="f-start" value="09:00">
        </div>
        <div>
          <label for="f-end">Ende</label>
          <input type="time" id="f-end" value="17:00">
        </div>
        <div>
          <label for="f-pause">Pause (Minuten)</label>
          <input type="number" id="f-pause" value="30" min="0" step="5">
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label for="f-note">Notiz (optional)</label>
        <textarea id="f-note" placeholder="z.B. Projekt X abgeschlossen, Arzttermin am Nachmittag …"></textarea>
      </div>

      <div class="form-actions">
        <button class="btn primary" id="f-submit"><i class="ti ti-check"></i>Eintrag speichern</button>
      </div>
    </div>

    <h2 class="section-title">Alle Einträge</h2>
    <div class="card">
      ${state.entries.length===0 ? emptyState("ti-list", "Noch keine Einträge vorhanden", "Sobald du etwas einträgst, erscheint es hier.") : renderEntryTable(sortedEntries().reverse(), true)}
    </div>
  `;

  const typeSelect = document.getElementById("f-type");
  const workFields = document.getElementById("f-work-fields");
  typeSelect.addEventListener("change", ()=>{
    workFields.style.display = typeSelect.value === "work" ? "grid" : "none";
  });

  document.getElementById("f-submit").addEventListener("click", onSubmitEntry);

  // Lösch-Buttons in der Tabelle
  el.querySelectorAll("[data-delete]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(confirm("Diesen Eintrag wirklich löschen?")){
        state.entries = state.entries.filter(e=>e.id !== btn.dataset.delete);
        saveState();
        renderEntry();
      }
    });
  });
}

function onSubmitEntry(){
  const type = document.getElementById("f-type").value;
  const date = document.getElementById("f-date").value;
  const note = document.getElementById("f-note").value.trim();

  if(!date){
    alert("Bitte ein Datum auswählen.");
    return;
  }

  let entry = { id: uid(), date, type, note };

  if(type === "work"){
    const start = document.getElementById("f-start").value;
    const end = document.getElementById("f-end").value;
    const pauseMin = Number(document.getElementById("f-pause").value) || 0;
    if(!start || !end){
      alert("Bitte Beginn und Ende der Arbeitszeit angeben.");
      return;
    }
    if(diffMinutes(start,end,pauseMin) <= 0){
      alert("Die Endzeit muss nach der Beginnzeit liegen (Pause berücksichtigt).");
      return;
    }
    entry = { ...entry, start, end, pauseMin };
  }

  state.entries.push(entry);
  saveState();
  renderEntry();
}

function entryTypeLabel(type){
  if(type==="work") return {cls:"work", icon:"ti-briefcase", text:"Arbeit"};
  if(type==="vacation") return {cls:"vacation", icon:"ti-beach", text:"Urlaub"};
  if(type==="sick") return {cls:"sick", icon:"ti-thermometer", text:"Krankheit"};
  return {cls:"work", icon:"ti-circle", text:type};
}

function renderEntryTable(entries, withDelete){
  const rows = entries.map(e=>{
    const t = entryTypeLabel(e.type);
    let timeInfo = "—";
    if(e.type === "work"){
      const mins = entryDurationMinutes(e);
      timeInfo = `${e.start} – ${e.end} <span style="color:var(--text-faint);">(${minutesToHM(mins)})</span>`;
    }
    return `
      <tr>
        <td style="white-space:nowrap;">${fmtDate(e.date)}</td>
        <td><span class="badge ${t.cls}"><i class="ti ${t.icon}" style="font-size:13px;" aria-hidden="true"></i>${t.text}</span></td>
        <td>${timeInfo}
          ${e.note ? `<div class="row-note"><i class="ti ti-note" style="font-size:12px;" aria-hidden="true"></i>${escapeHtml(e.note)}</div>` : ""}
        </td>
        ${withDelete ? `<td style="text-align:right;"><button class="icon-btn" data-delete="${e.id}" aria-label="Eintrag löschen"><i class="ti ti-trash"></i></button></td>` : ""}
      </tr>
    `;
  }).join("");

  return `
    <table class="list">
      <thead><tr><th>Datum</th><th>Art</th><th>Details</th>${withDelete?'<th></th>':''}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   KALENDER
   ============================================================ */
function renderCalendar(){
  const el = document.getElementById("view-calendar");
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth(); // 0-indexed

  const monthNames = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const byDate = {};
  state.entries.forEach(e=>{
    if(!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  let cells = "";
  for(let i=0;i<startWeekday;i++) cells += `<div class="cal-day empty-day"></div>`;

  const todayIso = todayISO();
  for(let day=1; day<=daysInMonth; day++){
    const iso = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dayEntries = byDate[iso] || [];
    let cls = "";
    if(dayEntries.some(e=>e.type==="sick")) cls = "is-sick";
    else if(dayEntries.some(e=>e.type==="vacation")) cls = "is-vacation";
    else if(dayEntries.some(e=>e.type==="work")) cls = "is-work";
    const isToday = iso === todayIso ? "is-today" : "";

    cells += `
      <div class="cal-day ${cls} ${isToday}" data-date="${iso}" title="${dayEntries.length} Eintrag/Einträge">
        <span class="num">${day}</span>
        ${dayEntries.length ? `<span class="dot"></span>` : ""}
      </div>
    `;
  }

  el.innerHTML = `
    <div class="cal-header">
      <button class="icon-btn" id="cal-prev" aria-label="Vorheriger Monat"><i class="ti ti-chevron-left" style="font-size:20px;"></i></button>
      <div class="month-label">${monthNames[month]} ${year}</div>
      <button class="icon-btn" id="cal-next" aria-label="Nächster Monat"><i class="ti ti-chevron-right" style="font-size:20px;"></i></button>
    </div>
    <div class="card">
      <div class="cal-grid">
        ${["Mo","Di","Mi","Do","Fr","Sa","So"].map(d=>`<div class="cal-dow">${d}</div>`).join("")}
        ${cells}
      </div>
      <div class="cal-legend">
        <span><span class="dot-static" style="background:var(--accent);"></span>Arbeit</span>
        <span><span class="dot-static" style="background:var(--info);"></span>Urlaub</span>
        <span><span class="dot-static" style="background:var(--danger);"></span>Krankheit</span>
      </div>
    </div>
    <div id="cal-day-detail" style="margin-top:20px;"></div>
  `;

  document.getElementById("cal-prev").addEventListener("click", ()=>{
    calendarCursor = new Date(year, month-1, 1);
    renderCalendar();
  });
  document.getElementById("cal-next").addEventListener("click", ()=>{
    calendarCursor = new Date(year, month+1, 1);
    renderCalendar();
  });

  el.querySelectorAll(".cal-day[data-date]").forEach(cell=>{
    cell.addEventListener("click", ()=>{
      showDayDetail(cell.dataset.date, byDate[cell.dataset.date]||[]);
    });
  });
}

function showDayDetail(iso, entries){
  const detail = document.getElementById("cal-day-detail");

  const entriesHtml = entries.map(e => renderEditableEntry(e)).join("");

  detail.innerHTML = `
    <div class="card">
      <h3 class="sub-title" style="margin-top:0;">${fmtDate(iso)}</h3>
      ${entries.length === 0 ? `<p style="color:var(--text-faint);margin:0 0 14px;">Keine Einträge an diesem Tag.</p>` : `<div id="day-entries-list">${entriesHtml}</div>`}
      <button class="btn primary" id="add-for-day" style="margin-top:${entries.length?'14px':'0'};"><i class="ti ti-plus"></i>Eintrag für diesen Tag hinzufügen</button>
    </div>
  `;

  // Bearbeiten-Buttons
  detail.querySelectorAll("[data-edit-save]").forEach(btn=>{
    btn.addEventListener("click", ()=> saveEditedEntry(btn.dataset.editSave, iso));
  });
  detail.querySelectorAll("[data-edit-delete]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(confirm("Diesen Eintrag wirklich löschen?")){
        state.entries = state.entries.filter(e=>e.id !== btn.dataset.editDelete);
        saveState();
        renderCalendar();
        setTimeout(()=>{
          const byDate = {};
          state.entries.forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
          showDayDetail(iso, byDate[iso]||[]);
        }, 0);
      }
    });
  });
  // Bei Typ-Wechsel im Bearbeiten-Formular die passenden Felder ein/ausblenden
  detail.querySelectorAll("[data-edit-type]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const wrap = detail.querySelector(`[data-edit-workfields="${sel.dataset.editType}"]`);
      if(wrap) wrap.style.display = sel.value === "work" ? "grid" : "none";
    });
  });

  document.getElementById("add-for-day").addEventListener("click", ()=>{
    addNewEntryInline(iso);
  });
}

function renderEditableEntry(e){
  const t = entryTypeLabel(e.type);
  return `
    <div class="card" style="background:var(--surface-2);border:1px solid var(--border);margin-bottom:10px;padding:14px 16px;">
      <div class="form-row" style="margin-bottom:10px;">
        <div>
          <label>Art</label>
          <select data-edit-type="${e.id}" id="edit-type-${e.id}">
            <option value="work" ${e.type==="work"?"selected":""}>Arbeitszeit</option>
            <option value="vacation" ${e.type==="vacation"?"selected":""}>Urlaub</option>
            <option value="sick" ${e.type==="sick"?"selected":""}>Krankheit</option>
          </select>
        </div>
      </div>
      <div class="form-row" data-edit-workfields="${e.id}" style="display:${e.type==="work"?"grid":"none"};margin-bottom:10px;">
        <div>
          <label>Beginn</label>
          <input type="time" id="edit-start-${e.id}" value="${e.start||"09:00"}">
        </div>
        <div>
          <label>Ende</label>
          <input type="time" id="edit-end-${e.id}" value="${e.end||"17:00"}">
        </div>
        <div>
          <label>Pause (Min)</label>
          <input type="number" id="edit-pause-${e.id}" value="${e.pauseMin!=null?e.pauseMin:30}" min="0" step="5">
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label>Notiz</label>
        <input type="text" id="edit-note-${e.id}" value="${escapeHtml(e.note||"")}">
      </div>
      <div class="form-actions">
        <button class="btn primary" data-edit-save="${e.id}"><i class="ti ti-check"></i>Speichern</button>
        <button class="btn danger" data-edit-delete="${e.id}"><i class="ti ti-trash"></i>Löschen</button>
      </div>
    </div>
  `;
}

function saveEditedEntry(id, iso){
  const type = document.getElementById(`edit-type-${id}`).value;
  const note = document.getElementById(`edit-note-${id}`).value.trim();
  const entry = state.entries.find(e=>e.id===id);
  if(!entry) return;

  entry.type = type;
  entry.note = note;

  if(type === "work"){
    const start = document.getElementById(`edit-start-${id}`).value;
    const end = document.getElementById(`edit-end-${id}`).value;
    const pauseMin = Number(document.getElementById(`edit-pause-${id}`).value) || 0;
    if(!start || !end || diffMinutes(start,end,pauseMin) <= 0){
      alert("Die Endzeit muss nach der Beginnzeit liegen (Pause berücksichtigt).");
      return;
    }
    entry.start = start;
    entry.end = end;
    entry.pauseMin = pauseMin;
  } else {
    delete entry.start;
    delete entry.end;
    delete entry.pauseMin;
  }

  saveState();
  renderCalendar();
  setTimeout(()=>{
    const byDate = {};
    state.entries.forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
    showDayDetail(iso, byDate[iso]||[]);
  }, 0);
}

function addNewEntryInline(iso){
  const detail = document.getElementById("cal-day-detail");
  const newId = "_new_" + uid();
  const card = document.createElement("div");
  card.innerHTML = `
    <div class="card" style="margin-top:14px;padding:14px 16px;">
      <div class="form-row" style="margin-bottom:10px;">
        <div>
          <label>Art</label>
          <select id="new-type-${newId}">
            <option value="work">Arbeitszeit</option>
            <option value="vacation">Urlaub</option>
            <option value="sick">Krankheit</option>
          </select>
        </div>
      </div>
      <div class="form-row" id="new-workfields-${newId}" style="margin-bottom:10px;">
        <div>
          <label>Beginn</label>
          <input type="time" id="new-start-${newId}" value="09:00">
        </div>
        <div>
          <label>Ende</label>
          <input type="time" id="new-end-${newId}" value="17:00">
        </div>
        <div>
          <label>Pause (Min)</label>
          <input type="number" id="new-pause-${newId}" value="30" min="0" step="5">
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label>Notiz (optional)</label>
        <input type="text" id="new-note-${newId}">
      </div>
      <div class="form-actions">
        <button class="btn primary" id="new-save-${newId}"><i class="ti ti-check"></i>Speichern</button>
      </div>
    </div>
  `;
  detail.appendChild(card);

  document.getElementById(`new-type-${newId}`).addEventListener("change", function(){
    document.getElementById(`new-workfields-${newId}`).style.display = this.value==="work" ? "grid" : "none";
  });

  document.getElementById(`new-save-${newId}`).addEventListener("click", ()=>{
    const type = document.getElementById(`new-type-${newId}`).value;
    const note = document.getElementById(`new-note-${newId}`).value.trim();
    let entry = { id: uid(), date: iso, type, note };

    if(type === "work"){
      const start = document.getElementById(`new-start-${newId}`).value;
      const end = document.getElementById(`new-end-${newId}`).value;
      const pauseMin = Number(document.getElementById(`new-pause-${newId}`).value) || 0;
      if(!start || !end || diffMinutes(start,end,pauseMin) <= 0){
        alert("Die Endzeit muss nach der Beginnzeit liegen (Pause berücksichtigt).");
        return;
      }
      entry = { ...entry, start, end, pauseMin };
    }

    state.entries.push(entry);
    saveState();
    renderCalendar();
    setTimeout(()=>{
      const byDate = {};
      state.entries.forEach(e=>{ (byDate[e.date]=byDate[e.date]||[]).push(e); });
      showDayDetail(iso, byDate[iso]||[]);
    }, 0);
  });
}

/* ============================================================
   STATISTIK
   ============================================================ */
let chartRef = null;

function renderStats(){
  const el = document.getElementById("view-stats");
  const year = new Date().getFullYear();

  el.innerHTML = `
    <h2 class="section-title">Jahresübersicht ${year}</h2>
    <div style="position:relative;height:280px;margin-bottom:28px;">
      <canvas id="monthlyChart" role="img" aria-label="Balkendiagramm: geleistete Arbeitsstunden pro Monat im Jahr ${year}, verglichen mit der Soll-Arbeitszeit.">Monatliche Arbeitsstunden werden hier als Diagramm dargestellt.</canvas>
    </div>

    <div class="grid-cards">
      <div class="metric">
        <p class="label">Arbeitstage gesamt</p>
        <p class="value">${countWorkDays(year)}</p>
      </div>
      <div class="metric">
        <p class="label">Urlaubstage genommen</p>
        <p class="value">${urlaubsTageGenommen(year)}</p>
      </div>
      <div class="metric">
        <p class="label">Krankheitstage</p>
        <p class="value">${krankTageJahr(year)}</p>
      </div>
      <div class="metric">
        <p class="label">Gesamt-Saldo</p>
        <p class="value ${berechneUeberstunden()>=0?'pos':'neg'}">${minutesToHM(berechneUeberstunden())}</p>
      </div>
    </div>

    <h3 class="sub-title">Export</h3>
    <div class="card">
      <p style="margin:0 0 14px;color:var(--text-muted);">Lade alle deine Einträge als Tabelle (CSV) herunter, z.B. um sie an deinen Arbeitgeber zu schicken oder in Excel zu öffnen.</p>
      <button class="btn primary" id="export-btn"><i class="ti ti-download"></i>Als CSV-Tabelle exportieren</button>
    </div>
  `;

  document.getElementById("export-btn").addEventListener("click", exportCSV);

  const monthlyData = computeMonthlyHours(year);
  const sollProMonatStunden = (state.settings.sollStundenWoche/state.settings.arbeitstageWoche) * (state.settings.arbeitstageWoche) * 4.33 / state.settings.arbeitstageWoche;
  // einfacher: Soll pro Monat = Wochen-Soll * ca. 4.33 Wochen
  const sollMonat = state.settings.sollStundenWoche * 4.33;

  if(chartRef) chartRef.destroy();
  const ctx = document.getElementById("monthlyChart");
  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  chartRef = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],
      datasets: [
        {
          label: 'Gearbeitete Stunden',
          data: monthlyData,
          backgroundColor: isDark ? '#6FBF95' : '#2F6B4F',
          borderRadius: 4
        },
        {
          label: 'Soll-Stunden',
          data: new Array(12).fill(Math.round(sollMonat*10)/10),
          type: 'line',
          borderColor: isDark ? '#E0995F' : '#B5562B',
          borderDash: [6,4],
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v)=> v + ' h' } }
      }
    }
  });
}

function computeMonthlyHours(year){
  const result = new Array(12).fill(0);
  state.entries.forEach(e=>{
    if(e.type !== "work") return;
    if(!e.date.startsWith(String(year))) return;
    const month = Number(e.date.slice(5,7)) - 1;
    result[month] += entryDurationMinutes(e) / 60;
  });
  return result.map(v=> Math.round(v*10)/10);
}

function countWorkDays(year){
  const days = new Set();
  state.entries.forEach(e=>{
    if(e.type==="work" && e.date.startsWith(String(year))) days.add(e.date);
  });
  return days.size;
}

function exportCSV(){
  const header = ["Datum","Art","Beginn","Ende","Pause (Min)","Stunden","Notiz"];
  const rows = sortedEntries().map(e=>{
    const t = entryTypeLabel(e.type).text;
    if(e.type === "work"){
      const h = (entryDurationMinutes(e)/60).toFixed(2);
      return [fmtDate(e.date), t, e.start, e.end, e.pauseMin, h, (e.note||"").replace(/[\r\n,]+/g," ")];
    }
    return [fmtDate(e.date), t, "", "", "", "", (e.note||"").replace(/[\r\n,]+/g," ")];
  });
  const csv = [header, ...rows].map(r=>r.join(";")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `arbeitszeiten_${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   EINSTELLUNGEN
   ============================================================ */
function renderSettings(){
  const el = document.getElementById("view-settings");
  el.innerHTML = `
    <h2 class="section-title">Einstellungen</h2>
    <div class="card" style="margin-bottom:24px;">
      <div class="form-row">
        <div>
          <label for="s-soll">Soll-Arbeitszeit pro Woche (Stunden)</label>
          <input type="number" id="s-soll" value="${state.settings.sollStundenWoche}" min="1" step="0.5">
        </div>
        <div>
          <label for="s-tage">Arbeitstage pro Woche</label>
          <input type="number" id="s-tage" value="${state.settings.arbeitstageWoche}" min="1" max="7" step="1">
        </div>
        <div>
          <label for="s-urlaub">Urlaubstage pro Jahr</label>
          <input type="number" id="s-urlaub" value="${state.settings.urlaubstageJahr}" min="0" step="1">
        </div>
        <div>
          <label for="s-lohn">Stundenlohn (€)</label>
          <input type="number" id="s-lohn" value="${state.settings.stundenlohn}" min="0" step="0.5">
        </div>
      </div>
      <div class="form-actions">
        <button class="btn primary" id="s-save"><i class="ti ti-check"></i>Einstellungen speichern</button>
      </div>
    </div>

    <h3 class="sub-title">Import aus Excel oder CSV</h3>
    <div class="card" style="margin-bottom:24px;">
      <p style="margin:0 0 14px;color:var(--text-muted);">
        Lade eine Excel-Datei (.xlsx) oder CSV-Datei mit Einträgen hoch. Die Datei sollte die gleichen Spalten haben
        wie der Export unter „Statistik“: Datum, Art, Beginn, Ende, Pause (Min), Stunden, Notiz.
        Bei „Art“ werden die Werte „Arbeit“, „Urlaub“ und „Krankheit“ erkannt.
      </p>
      <input type="file" id="import-file" accept=".csv,.xlsx,.xls" style="margin-bottom:12px;">
      <div id="import-status" style="font-size:13px;color:var(--text-muted);"></div>
    </div>

    <h3 class="sub-title">Daten</h3>
    <div class="card">
      <p style="margin:0 0 14px;color:var(--text-muted);">
        Alle Daten werden ausschließlich lokal in diesem Browser gespeichert. Niemand außer dir hat Zugriff darauf.
        Wenn du den Browser-Verlauf löschst, gehen die Daten verloren — exportiere sie daher regelmäßig als CSV (unter „Statistik“).
      </p>
      <button class="btn danger" id="s-reset"><i class="ti ti-trash"></i>Alle Daten löschen</button>
    </div>
  `;

  document.getElementById("import-file").addEventListener("change", onImportFile);

  document.getElementById("s-save").addEventListener("click", ()=>{
    const soll = Number(document.getElementById("s-soll").value);
    const tage = Number(document.getElementById("s-tage").value);
    const urlaub = Number(document.getElementById("s-urlaub").value);
    const lohn = Number(document.getElementById("s-lohn").value);
    if(soll<=0 || tage<=0 || tage>7 || urlaub<0 || lohn<0){
      alert("Bitte gültige Werte eingeben.");
      return;
    }
    state.settings.sollStundenWoche = soll;
    state.settings.arbeitstageWoche = tage;
    state.settings.urlaubstageJahr = urlaub;
    state.settings.stundenlohn = lohn;
    saveState();
    alert("Einstellungen gespeichert.");
  });

  document.getElementById("s-reset").addEventListener("click", ()=>{
    if(confirm("Wirklich ALLE Einträge unwiderruflich löschen? Das kann nicht rückgängig gemacht werden.")){
      state = structuredClone(defaultState);
      saveState();
      renderSettings();
      alert("Alle Daten wurden gelöscht.");
    }
  });
}

/* ============================================================
   IMPORT AUS EXCEL / CSV
   ============================================================ */

/* Wandelt die Werte aus der Spalte "Art" in unsere internen Typen um.
   So funktioniert es auch, wenn jemand in Excel "arbeit" klein schreibt
   oder ein Leerzeichen zu viel hat. */
function parseTypeValue(raw){
  const v = String(raw||"").trim().toLowerCase();
  if(v.startsWith("arbeit") || v==="work") return "work";
  if(v.startsWith("urlaub") || v==="vacation") return "vacation";
  if(v.startsWith("krank") || v==="sick") return "sick";
  return null;
}

/* Wandelt verschiedene Datumsformate in unser internes Format YYYY-MM-DD um.
   Unterstützt: TT.MM.JJJJ (unser eigener Export), JJJJ-MM-TT, und
   Excel-Datums-Seriennummern (Excel speichert Datumswerte intern als Zahl). */
function parseDateValue(raw){
  if(raw == null || raw === "") return null;

  // Excel-Datumsseriennummer (z.B. 45678)
  if(typeof raw === "number"){
    const excelEpoch = new Date(Date.UTC(1899,11,30));
    const d = new Date(excelEpoch.getTime() + raw*86400000);
    return d.toISOString().slice(0,10);
  }

  const s = String(raw).trim();

  // TT.MM.JJJJ
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;

  // JJJJ-MM-TT
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;

  // TT/MM/JJJJ
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;

  return null;
}

/* Normalisiert Uhrzeit-Werte zu HH:MM. Excel liefert Zeiten manchmal als
   Bruchzahl des Tages (z.B. 0.375 = 09:00), manchmal als Text "9:00". */
function parseTimeValue(raw){
  if(raw == null || raw === "") return null;
  if(typeof raw === "number"){
    const totalMin = Math.round(raw*24*60);
    const h = Math.floor(totalMin/60), m = totalMin%60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if(m) return `${m[1].padStart(2,"0")}:${m[2]}`;
  return null;
}

/* Liest eine Reihe von Tabellenzeilen (Array von Objekten mit Spaltennamen
   als Schlüssel) und wandelt sie in unsere Eintrags-Struktur um.
   Gibt { gueltig: [...], fehler: [...] } zurück. */
function parseImportRows(rows){
  const gueltig = [];
  const fehler = [];

  rows.forEach((row, idx)=>{
    // Spaltennamen flexibel suchen (Groß-/Kleinschreibung, leicht abweichende Namen)
    const get = (...names) => {
      for(const key of Object.keys(row)){
        const norm = key.trim().toLowerCase();
        if(names.includes(norm)) return row[key];
      }
      return undefined;
    };

    const dateRaw = get("datum");
    const typeRaw = get("art");
    const date = parseDateValue(dateRaw);
    const type = parseTypeValue(typeRaw);

    if(!date || !type){
      fehler.push({ zeile: idx+2, grund: !date ? "Datum nicht erkannt" : "Art nicht erkannt (Arbeit/Urlaub/Krankheit erwartet)" });
      return;
    }

    const note = get("notiz") || "";

    if(type === "work"){
      const start = parseTimeValue(get("beginn"));
      const end = parseTimeValue(get("ende"));
      const pauseRaw = get("pause (min)", "pause");
      const pauseMin = Number(pauseRaw) || 0;
      if(!start || !end){
        fehler.push({ zeile: idx+2, grund: "Beginn oder Ende fehlt/unlesbar für Arbeitszeit-Eintrag" });
        return;
      }
      if(diffMinutes(start,end,pauseMin) <= 0){
        fehler.push({ zeile: idx+2, grund: "Ende liegt nicht nach Beginn" });
        return;
      }
      gueltig.push({ id: uid(), date, type, start, end, pauseMin, note: String(note||"") });
    } else {
      gueltig.push({ id: uid(), date, type, note: String(note||"") });
    }
  });

  return { gueltig, fehler };
}

function onImportFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const status = document.getElementById("import-status");
  status.textContent = "Datei wird gelesen …";

  const isCSV = file.name.toLowerCase().endsWith(".csv");

  const reader = new FileReader();
  reader.onerror = () => {
    status.textContent = "Die Datei konnte nicht gelesen werden.";
  };

  reader.onload = (evt) => {
    try{
      let rows;
      if(isCSV){
        rows = parseCSVText(evt.target.result);
      } else {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array", cellDates:false });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
      }

      const { gueltig, fehler } = parseImportRows(rows);

      if(gueltig.length === 0){
        status.innerHTML = `Es konnten keine gültigen Einträge gefunden werden.${fehler.length ? "<br>Beispiel-Problem: Zeile "+fehler[0].zeile+" – "+fehler[0].grund : ""}`;
        return;
      }

      let meldung = `${gueltig.length} Einträge gefunden`;
      if(fehler.length) meldung += `, ${fehler.length} Zeile(n) konnten nicht gelesen werden`;
      status.textContent = meldung + ". Bitte wähle, was passieren soll …";

      askImportMode(gueltig, fehler);

    }catch(err){
      console.error(err);
      status.textContent = "Die Datei hat ein unerwartetes Format und konnte nicht verarbeitet werden.";
    }
    e.target.value = ""; // Datei-Auswahl zurücksetzen, damit erneutes Hochladen derselben Datei funktioniert
  };

  if(isCSV) reader.readAsText(file, "utf-8");
  else reader.readAsArrayBuffer(file);
}

/* Einfacher CSV-Parser, passend zum eigenen Export-Format (Semikolon-getrennt). */
function parseCSVText(text){
  const cleanText = text.replace(/^\uFEFF/, ""); // BOM entfernen, falls vorhanden
  const lines = cleanText.split(/\r?\n/).filter(l => l.trim() !== "");
  if(lines.length === 0) return [];
  const headers = lines[0].split(";").map(h=>h.trim());
  return lines.slice(1).map(line=>{
    const cells = line.split(";");
    const obj = {};
    headers.forEach((h,i)=>{ obj[h] = cells[i] !== undefined ? cells[i].trim() : ""; });
    return obj;
  });
}

function askImportMode(gueltig, fehler){
  const status = document.getElementById("import-status");
  const fehlerListe = fehler.length
    ? `<div style="margin-top:8px;color:var(--warn);">${fehler.length} Zeile(n) übersprungen: ${fehler.slice(0,3).map(f=>`Zeile ${f.zeile} (${f.grund})`).join(", ")}${fehler.length>3 ? " …" : ""}</div>`
    : "";

  status.innerHTML = `
    <div class="card" style="margin-top:10px;padding:14px 16px;">
      <p style="margin:0 0 12px;">
        <strong>${gueltig.length} Einträge</strong> wurden in der Datei gefunden. Was soll passieren?
      </p>
      ${fehlerListe}
      <div class="form-actions" style="margin-top:12px;">
        <button class="btn primary" id="import-add"><i class="ti ti-plus"></i>Zu vorhandenen Einträgen hinzufügen</button>
        <button class="btn danger" id="import-replace"><i class="ti ti-replace"></i>Vorhandene Einträge ersetzen</button>
        <button class="btn" id="import-cancel"><i class="ti ti-x"></i>Abbrechen</button>
      </div>
    </div>
  `;

  document.getElementById("import-add").addEventListener("click", ()=>{
    state.entries = [...state.entries, ...gueltig];
    saveState();
    status.innerHTML = `<span style="color:var(--accent-strong);">${gueltig.length} Einträge wurden hinzugefügt.</span>`;
  });

  document.getElementById("import-replace").addEventListener("click", ()=>{
    if(!confirm("Wirklich ALLE vorhandenen Einträge durch die Datei ersetzen? Das kann nicht rückgängig gemacht werden.")) return;
    state.entries = gueltig;
    saveState();
    status.innerHTML = `<span style="color:var(--accent-strong);">Einträge wurden ersetzt (${gueltig.length} Einträge aus der Datei).</span>`;
  });

  document.getElementById("import-cancel").addEventListener("click", ()=>{
    status.textContent = "Import abgebrochen.";
  });
}

/* ============================================================
   START
   ============================================================ */
renderTodayPill();
renderActiveView();
