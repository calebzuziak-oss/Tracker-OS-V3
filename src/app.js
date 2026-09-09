// --- Constants & helpers ---
const STORAGE_KEY = 'tip-entries-v2';
const SHIFT_TYPES = ['Lunch','Dinner','Brunch','Double','Other'];
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const todayISO = () => new Date().toISOString().slice(0,10);
const fmt = n => (n||0).toFixed(2);
const fmtSigned = n => (n>=0?'+':'-') + Math.abs(n).toFixed(2);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function formatShort(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {month:'short', day:'numeric'});
}
function formatFull(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
}

// --- State ---
let state = {
  entries: [],
  showForm: false,
  editingId: null,
  form: { date: todayISO(), shiftType: 'Dinner', hours: '', tips: '', sales: '', wage: '', notes: '' },
  confirmDeleteId: null,
  confirmClear: false,
  error: null,
  theme: 'system'
};

// --- Persistence ---
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state.entries = JSON.parse(raw);
    const themeRaw = localStorage.getItem(STORAGE_KEY + '-theme');
    if (themeRaw) state.theme = themeRaw;
  } catch(e) { state.entries = []; }
  render();
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
    localStorage.setItem(STORAGE_KEY + '-theme', state.theme);
    state.error = null;
  } catch(e) {
    state.error = "Couldn't save. Check that this browser allows local storage.";
  }
}

// --- Theme ---
function cycleTheme() {
  const order = ['system','dark','light'];
  const idx = order.indexOf(state.theme);
  state.theme = order[(idx+1)%order.length];
  persist();
  // For this demo, theme is primarily CSS media-query based; you can extend to class toggles if desired.
  showToast(`Theme: ${state.theme}`);
}

// --- Stats computation ---
function computeStats() {
  const entries = state.entries;
  const totalTips = entries.reduce((s,e)=>s+e.tips,0);
  const totalHours = entries.reduce((s,e)=>s+e.hours,0);
  const avgPerHour = totalHours ? totalTips/totalHours : 0;

  const weekMap = {};
  entries.forEach(e => {
    const ws = getWeekStart(e.date);
    if (!weekMap[ws]) weekMap[ws] = { weekStart: ws, tips: 0, hours: 0, count: 0 };
    weekMap[ws].tips += e.tips;
    weekMap[ws].hours += e.hours;
    weekMap[ws].count += 1;
  });
  const weeks = Object.values(weekMap).sort((a,b)=>a.weekStart.localeCompare(b.weekStart)).slice(-8);
  const currentWeekStart = getWeekStart(todayISO());
  const prevWeekStart = addDays(currentWeekStart, -7);
  const currentWeek = weekMap[currentWeekStart] || { tips:0, hours:0, count:0 };
  const prevWeek = weekMap[prevWeekStart] || { tips:0, hours:0, count:0 };
  const weekDelta = currentWeek.tips - prevWeek.tips;
  const weekPct = prevWeek.tips ? (weekDelta/prevWeek.tips)*100 : (currentWeek.tips ? 100 : 0);

  const dayMap = {};
  DAY_NAMES.forEach(d => dayMap[d] = { tips:0, hours:0, count:0 });
  entries.forEach(e => {
    const jsDay = new Date(e.date+'T00:00:00').getDay();
    const name = DAY_NAMES[(jsDay+6)%7];
    dayMap[name].tips += e.tips;
    dayMap[name].hours += e.hours;
    dayMap[name].count += 1;
  });
  const dayStats = DAY_NAMES.map(name => ({
    day: name,
    avgPerHour: dayMap[name].hours ? dayMap[name].tips/dayMap[name].hours : 0,
    count: dayMap[name].count
  }));
  const bestDay = dayStats.reduce((best,d) => (d.count>0 && d.avgPerHour > best.avgPerHour) ? d : best, {avgPerHour:-1, day:null});

  const currentWeekEntries = entries.filter(e => getWeekStart(e.date) === currentWeekStart).sort((a,b)=>a.date.localeCompare(b.date));

  // Shift-type analytics
  const shiftMap = {};
  SHIFT_TYPES.forEach(t => shiftMap[t] = { tips:0, hours:0, count:0 });
  entries.forEach(e => {
    const t = e.shiftType || 'Other';
    if (!shiftMap[t]) shiftMap[t] = { tips:0, hours:0, count:0 };
    shiftMap[t].tips += e.tips;
    shiftMap[t].hours += e.hours;
    shiftMap[t].count += 1;
  });
  const shiftStats = SHIFT_TYPES.map(t => ({
    type: t,
    avgPerHour: shiftMap[t].hours ? shiftMap[t].tips/shiftMap[t].hours : 0,
    count: shiftMap[t].count
  })).filter(s => s.count > 0).sort((a,b)=>b.avgPerHour - a.avgPerHour);

  return { totalTips, totalHours, avgPerHour, shiftCount: entries.length, weeks, currentWeekStart, currentWeek, prevWeek, weekDelta, weekPct, dayStats, bestDay, currentWeekEntries, shiftStats };
}

// --- Charts (SVG) ---
function barChartSVG(data) {
  const width = 300, height = 170, padBottom = 26, padTop = 8;
  const max = Math.max(...data.map(d=>d.value), 0.0001);
  const n = data.length;
  const slot = width / n;
  let bars = '';
  data.forEach((d,i) => {
    const h = max ? (d.value/max)*(height-padBottom-padTop) : 0;
    const x = i*slot + slot*0.2;
    const w = slot*0.6;
    const y = height - padBottom - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="4" fill="var(--gold)"/>`;
    bars += `<text x="${(x+w/2).toFixed(1)}" y="${height-10}" text-anchor="middle" font-size="9" fill="var(--muted)">${d.label}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:${height}px;" aria-hidden="true">${bars}</svg>`;
}

// --- Renderers ---
function renderStats(stats) {
  const deltaColor = stats.weekDelta >= 0 ? 'var(--sage)' : (stats.weekDelta < 0 ? 'var(--rose)' : 'var(--muted)');
  const weekSub = (stats.prevWeek.tips || stats.currentWeek.tips)
    ? `${fmtSigned(stats.weekDelta)} (${stats.weekPct>=0?'+':''}${stats.weekPct.toFixed(0)}% vs last wk)`
    : 'no prior week';

  const cards = [
    { label: 'This Week', value: fmt(stats.currentWeek.tips), sub: weekSub, subColor: deltaColor },
    { label: 'All-Time', value: fmt(stats.totalTips), sub: `${stats.shiftCount} shifts` },
    { label: 'Avg / Hour', value: fmt(stats.avgPerHour), sub: `${stats.totalHours.toFixed(1)} hrs logged` },
    { label: 'Best Day', value: stats.bestDay.day || '—', sub: stats.bestDay.day ? `${fmt(stats.bestDay.avgPerHour)}/hr` : 'log more shifts' }
  ];

  const html = cards.map(c => `
    <div class="stat-card">
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-sub" style="color:${c.subColor||'var(--muted)'}">${c.sub}</div>
    </div>
  `).join('');

  document.getElementById('stats').innerHTML = html;
}

function renderReceipt(stats) {
  const lines = stats.currentWeekEntries.length === 0
    ? `<div class="receipt-lines"><p style="font-size:13px; color:var(--muted); padding:8px 0; margin:0;">No tickets rung in yet this week.</p></div>`
    : `<div class="receipt-lines">
        ${stats.currentWeekEntries.map(e =>
          `<div class="receipt-line"><span>${formatShort(e.date)} · ${esc(e.shiftType)} · ${e.hours}h</span><span>${fmt(e.tips)}</span></div>`
        ).join('')}
       </div>`;

  document.getElementById('receipt').innerHTML = `
    <div class="receipt-head">
      <span class="r-label">Guest Checks</span>
      <span class="range">${formatShort(stats.currentWeekStart)} – ${formatShort(addDays(stats.currentWeekStart,6))}</span>
    </div>
    ${lines}
    <div class="receipt-total">
      <span class="lbl">Totals</span>
      <span class="val">${fmt(stats.currentWeek.tips)}</span>
    </div>
    <div class="receipt-meta">${stats.currentWeek.count} ${stats.currentWeek.count===1?'shift':'shifts'} · ${stats.currentWeek.hours.toFixed(1)} hrs</div>
  `;
}

function renderCharts(stats) {
  const weekChart = stats.weeks.length < 2
    ? `<div class="empty-chart">Log a couple more weeks to see a trend.</div>`
    : barChartSVG(stats.weeks.map(w => ({ label: formatShort(w.weekStart), value: w.tips, color: 'var(--gold)' })));

  const dayChart = barChartSVG(stats.dayStats.map(d => ({
    label: d.day,
    value: d.avgPerHour.toFixed(2),
    color: d.count===0 ? 'var(--border)' : (d.day===stats.bestDay.day ? 'var(--gold)' : 'var(--sage)')
  })));

  const shiftChart = stats.shiftStats.length === 0
    ? `<div class="empty-chart">No shift-type data yet.</div>`
    : barChartSVG(stats.shiftStats.map(s => ({ label: s.type, value: s.avgPerHour.toFixed(2), color: 'var(--gold)' })));

  document.getElementById('charts').innerHTML = `
    <div class="card"><div class="card-label">Weekly Trend</div>${weekChart}</div>
    <div class="card"><div class="card-label">Best Shifts to Work</div>${dayChart}</div>
    <div class="card" style="grid-column: 1 / -1;"><div class="card-label">Tips/Hour by Shift Type</div>${shiftChart}</div>
  `;
}

function renderForm() {
  const f = state.form;
  document.getElementById('formCard').innerHTML = `
    <div class="form-head">
      <span class="f-label">${state.editingId ? 'Edit Ticket' : 'New Ticket'}</span>
      <button class="icon-btn" aria-label="Close form" onclick="closeForm()">✕</button>
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Date</label>
        <input class="input" type="date" value="${esc(f.date)}" oninput="updateForm('date',this.value)">
      </div>
      <div class="field">
        <label>Shift</label>
        <select class="input" onchange="updateForm('shiftType',this.value)">
          ${SHIFT_TYPES.map(s => `<option value="${s}" ${f.shiftType===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Hours worked</label>
        <input class="input" type="number" step="0.25" min="0" placeholder="6.5" value="${esc(f.hours)}" oninput="updateForm('hours',this.value)">
      </div>
      <div class="field">
        <label>Tips</label>
        <input class="input" type="number" step="0.01" min="0" placeholder="140.00" value="${esc(f.tips)}" oninput="updateForm('tips',this.value)">
      </div>
      <div class="field">
        <label>Sales (optional)</label>
        <input class="input" type="number" step="0.01" min="0" placeholder="for tip %" value="${esc(f.sales)}" oninput="updateForm('sales',this.value)">
      </div>
      <div class="field">
        <label>Hourly wage (optional)</label>
        <input class="input" type="number" step="0.01" min="0" placeholder="2.13" value="${esc(f.wage)}" oninput="updateForm('wage',this.value)">
      </div>
    </div>
    <div class="field">
      <label>Notes (optional)</label>
      <input class="input" type="text" placeholder="slow section, big party, etc." value="${esc(f.notes)}" oninput="updateForm('notes',this.value)">
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" onclick="submitForm()">${state.editingId ? 'Save changes' : 'Ring in ticket'}</button>
      <button class="btn btn-ghost" onclick="closeForm()">Cancel</button>
    </div>
  `;
  document.getElementById('formCard').classList.remove('hidden');
}

function renderHistory(entries) {
  const emptyMsg = entries.length === 0
    ? `<p style="color:var(--muted); font-size:13px;">No tickets yet. Ring in your first shift above.</p>`
    : '';
  const html = `
    <div class="card-label" style="margin-top:6px;">Ticket History</div>
    ${emptyMsg}
    ${entries.map(renderHistoryItem).join('')}
  `;
  document.getElementById('history').innerHTML = html;
}

function renderHistoryItem(e) {
  const perHour = e.hours ? e.tips/e.hours : 0;
  const tipPct = e.sales ? (e.tips/e.sales)*100 : null;
  const actions = state.confirmDeleteId === e.id
    ? `<div class="confirm-row">
         <span>Delete this ticket?</span>
         <button style="background:var(--rose); color:#0b1220;" onclick="doDelete('${e.id}')">Delete</button>
         <button style="background:var(--surface); color:var(--text); border:1px solid var(--border);" onclick="cancelDeleteConfirm()">Cancel</button>
       </div>`
    : `<div class="history-actions">
         <button onclick="startEdit('${e.id}')">Edit</button>
         <button onclick="askDelete('${e.id}')">Delete</button>
       </div>`;
  return `
    <div class="history-item">
      <div class="history-top">
        <div>
          <div class="history-date">${formatFull(e.date)} <span class="badge-shift">${esc(e.shiftType)}</span></div>
          <div class="history-meta">${e.hours}h · ${fmt(perHour)}/hr${tipPct!==null ? ' · '+tipPct.toFixed(1)+'% of sales' : ''}</div>
          ${e.notes ? `<div class="history-notes">${esc(e.notes)}</div>` : ''}
        </div>
        <div class="history-tips">${fmt(e.tips)}</div>
      </div>
      ${actions}
    </div>
  `;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function render() {
  const entries = state.entries;
  const stats = computeStats();
  renderStats(stats);
  renderReceipt(stats);
  renderCharts(stats);

  const openFormBtn = document.getElementById('openFormBtn');
  openFormBtn.style.display = (entries.length === 0 && !state.showForm) ? 'inline-flex' : 'flex';

  if (state.showForm) renderForm();
  else document.getElementById('formCard').classList.add('hidden');

  renderHistory(entries);

  if (state.error) {
    showToast(state.error);
    state.error = null;
  }
}

// --- Actions ---
function openForm() { state.showForm = true; render(); renderForm(); }
function closeForm() {
  state.showForm = false;
  state.editingId = null;
  state.form = { date: todayISO(), shiftType: 'Dinner', hours: '', tips: '', sales: '', wage: '', notes: '' };
  render();
}
function updateForm(field, value) { state.form[field] = value; }

function submitForm() {
  const hours = parseFloat(state.form.hours);
  const tips = parseFloat(state.form.tips);
  if (!state.form.date || isNaN(hours) || hours<=0 || isNaN(tips) || tips<0) {
    showToast('Enter a date, hours worked, and tips to ring this in.');
    return;
  }
  const entry = {
    id: state.editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
    date: state.form.date,
    shiftType: state.form.shiftType,
    hours,
    tips,
    sales: state.form.sales ? parseFloat(state.form.sales) : null,
    wage: state.form.wage ? parseFloat(state.form.wage) : null,
    notes: state.form.notes.trim()
  };
  if (state.editingId) {
    state.entries = state.entries.map(en => en.id === state.editingId ? {...en, ...entry} : en);
  } else {
    state.entries = [...state.entries, entry];
  }
  state.entries.sort((a,b)=>b.date.localeCompare(a.date));
  persist();
  state.form = { date: todayISO(), shiftType: 'Dinner', hours: '', tips: '', sales: '', wage: '', notes: '' };
  state.editingId = null;
  state.showForm = false;
  showToast(state.editingId ? 'Ticket updated' : 'Ticket logged');
  render();
}

function startEdit(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  state.form = {
    date: entry.date,
    shiftType: entry.shiftType,
    hours: String(entry.hours),
    tips: String(entry.tips),
    sales: entry.sales!==null ? String(entry.sales) : '',
    wage: entry.wage!==null ? String(entry.wage) : '',
    notes: entry.notes||''
  };
  state.editingId = id;
  state.showForm = true;
  render();
  renderForm();
  const card = document.getElementById('formCard');
  if (card) card.scrollIntoView({behavior:'smooth', block:'center'});
}

function askDelete(id) { state.confirmDeleteId = id; render(); }
function cancelDeleteConfirm() { state.confirmDeleteId = null; render(); }
function doDelete(id) {
  state.entries = state.entries.filter(e => e.id !== id);
  persist();
  state.confirmDeleteId = null;
  showToast('Ticket deleted');
  render();
}

function askClear() {
  if (confirm('Clear every ticket? This cannot be undone.')) {
    state.entries = [];
    persist();
    showToast('All data cleared');
    render();
  }
}

function exportCSV() {
  const entries = state.entries;
  if (!entries.length) { showToast('No tickets to export.'); return; }
  const headers = ['date','shiftType','hours','tips','sales','wage','notes'];
  const rows = entries.map(e => [
    e.date, e.shiftType, e.hours, e.tips, e.sales??'', e.wage??'', (e.notes||'').replace(/"/g,'""')
  ].map(v => typeof v === 'number' ? String(v) : `"${String(v)}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tips-export-v2.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

// --- Wire up header buttons ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('themeToggle').addEventListener('click', cycleTheme);
  document.getElementById('exportBtn').addEventListener('click', exportCSV);
  document.getElementById('openFormBtn').addEventListener('click', openForm);
  document.getElementById('clearAllBtn').addEventListener('click', askClear);
  load();
});
