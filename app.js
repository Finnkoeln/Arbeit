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
    arbeitstageWoche: 5         // Standard: Mo-Fr, anpassbar
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

/* Überstunden-Berechnung: für jeden Werktag von Beginn der Daten bis heute,
   vergleichen wir geleistete Minuten mit Soll-Minuten. Urlaubs- und Kranktage
   zählen als "erfüllt" (kein Minus). */
function berechneUeberstunden(){
  const entries = sortedEntries();
  if(entries.length === 0) return 0;

  const byDate = {};
  entries.forEach(e=>{
    if(!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const firstDate = entries[0].date;
  const last = todayISO();
  let cursor = new Date(firstDate + "T00:00:00");
  const endDate = new Date(last + "T00:00:00");
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
  const jahr = new Date().getFullYear();
  const saldo = berechneUeberstunden();
  const urlaubGenommen = urlaubsTageGenommen(jahr);
  const urlaubRest = state.settings.urlaubstageJahr - urlaubGenommen;
  const krankTage = krankTageJahr(jahr);

  const letzte = sortedEntries().slice(-6).reverse();

  el.innerHTML = `
    <div class="grid-cards">
      <div class="metric">
        <p class="label">Überstunden-Saldo</p>
        <p class="value ${saldo>=0?'pos':'neg'}">${minutesToHM(saldo)}</p>
        <p class="sub">${saldo>=0 ? 'im Plus' : 'im Minus'}</p>
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
      <div class="metric">
        <p class="label">Soll pro Woche</p>
        <p class="value">${state.settings.sollStundenWoche} h</p>
        <p class="sub">${state.settings.arbeitstageWoche} Arbeitstage</p>
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
  if(entries.length === 0){
    detail.innerHTML = `
      <div class="card">
        <h3 class="sub-title" style="margin-top:0;">${fmtDate(iso)}</h3>
        <p style="color:var(--text-faint);margin:0 0 12px;">Keine Einträge an diesem Tag.</p>
        <button class="btn primary" id="add-for-day"><i class="ti ti-plus"></i>Eintrag hinzufügen</button>
      </div>
    `;
    document.getElementById("add-for-day").addEventListener("click", ()=>{
      setActiveView("entry");
      setTimeout(()=>{ document.getElementById("f-date").value = iso; }, 0);
    });
  } else {
    detail.innerHTML = `
      <div class="card">
        <h3 class="sub-title" style="margin-top:0;">${fmtDate(iso)}</h3>
        ${renderEntryTable(entries, false)}
      </div>
    `;
  }
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
      </div>
      <div class="form-actions">
        <button class="btn primary" id="s-save"><i class="ti ti-check"></i>Einstellungen speichern</button>
      </div>
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

  document.getElementById("s-save").addEventListener("click", ()=>{
    const soll = Number(document.getElementById("s-soll").value);
    const tage = Number(document.getElementById("s-tage").value);
    const urlaub = Number(document.getElementById("s-urlaub").value);
    if(soll<=0 || tage<=0 || tage>7 || urlaub<0){
      alert("Bitte gültige Werte eingeben.");
      return;
    }
    state.settings.sollStundenWoche = soll;
    state.settings.arbeitstageWoche = tage;
    state.settings.urlaubstageJahr = urlaub;
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
   START
   ============================================================ */
renderTodayPill();
renderActiveView();
