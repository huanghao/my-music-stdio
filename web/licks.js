// ── Lick Tracker ─────────────────────────────────────────────────────────────
// Tracks short practice exercises (licks / riffs) with per-session BPM + time
// data, so the user can see their progress over weeks and months.
//
// Data lives on the server (GET/POST /api/licks, /api/licks/:id/sessions).
// State and routing are handled here; the Speed Trainer integration
// (activeLick banner + Log Session button) hooks into state.activeLick.

// ── State ──

const licksState = {
  activeLick: null,   // { id, title, lastBpm } — set when practicing a lick
  currentLick: null,  // full lick object currently in detail view
  licksById: {},      // id → { title, last_bpm } cache from list response
};

// ── List page ──

async function loadLicks() {
  const el = document.getElementById('licks-list');
  if (!el) return;
  el.innerHTML = '<p class="empty-state">Loading…</p>';
  const licks = await api('/api/licks');
  if (!licks.length) {
    el.innerHTML = '<p class="empty-state">No licks yet — click "+ New Lick" to start tracking.</p>';
    return;
  }
  licks.forEach(l => { licksState.licksById[l.id] = l; });
  const totalSessions = licks.reduce((sum, l) => sum + (l.session_count || 0), 0);
  const mostRecent = licks
    .map(l => l.last_date).filter(Boolean).sort().pop();
  const summary = totalSessions === 0 ? '' : `
    <p class="lick-list-summary">
      ${licks.length} lick${licks.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
      ${totalSessions} session${totalSessions !== 1 ? 's' : ''} total
      ${mostRecent ? `&nbsp;·&nbsp; last practice: ${timeAgo(mostRecent)}` : ''}
    </p>`;
  el.innerHTML = summary + licks.map(l => {
    const lastBpm  = l.last_bpm  ? `${l.last_bpm} BPM` : 'no sessions yet';
    const lastDate = l.last_date ? timeAgo(l.last_date) : '—';
    const count    = l.session_count || 0;
    return `
      <div class="lick-card" onclick="openLick('${l.id}')">
        <div class="lick-card-body">
          <div class="lick-card-title">${htmlEsc(l.title)}</div>
          <div class="lick-card-meta">${lastBpm} &nbsp;·&nbsp; last: ${lastDate} &nbsp;·&nbsp; ${count} session${count !== 1 ? 's' : ''}</div>
        </div>
        <button class="btn btn-primary btn-sm lick-practice-btn"
          onclick="event.stopPropagation(); practiceLick('${l.id}')">
          Practice →
        </button>
      </div>`;
  }).join('');
  // Render the practice heatmap below the list (non-blocking)
  renderLickHeatmap();
}

// ── Practice heatmap ──
// GitHub-style calendar: last ~26 weeks as a grid of week-columns (7 rows,
// one per weekday).  Cell colour intensity = total practice minutes that day.
// Pure SVG, no dependencies.  Tooltips show date + minutes + lick count.
async function renderLickHeatmap() {
  const el = document.getElementById('lick-heatmap');
  if (!el) return;
  let sessions = [];
  try { sessions = await api('/api/licks/sessions/all'); }
  catch (_) { el.innerHTML = ''; return; }
  if (!sessions.length) { el.innerHTML = ''; return; }

  // Aggregate minutes per ISO date (YYYY-MM-DD)
  const byDate = {};
  sessions.forEach(s => {
    const d = s.date.slice(0, 10);
    if (!byDate[d]) byDate[d] = { min: 0, count: 0, licks: new Set() };
    byDate[d].min += s.duration_min;
    byDate[d].count++;
    byDate[d].licks.add(s.lick_title);
  });

  // Build a 26-week window ending today
  const WEEKS = 26;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Find the Sunday of the current week (column alignment)
  const startSunday = new Date(today);
  startSunday.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);

  const CELL = 13, GAP = 3, PAD_L = 28, PAD_T = 16, PAD_B = 16, PAD_R = 8;
  const colW = CELL + GAP;
  const W = PAD_L + PAD_R + WEEKS * colW;
  const H = PAD_T + PAD_B + 7 * colW;

  // Month labels along the top — show on the first column that starts a new month
  const monthLabels = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(startSunday);
    d.setDate(startSunday.getDate() + w * 7);
    if (d.getMonth() !== lastMonth) {
      monthLabels.push({ x: PAD_L + w * colW, label: d.toLocaleDateString('en-US', { month: 'short' }) });
      lastMonth = d.getMonth();
    }
  }

  // Weekday labels on the left (Mon/Wed/Fri)
  const dayLabels = [1, 3, 5].map(dow => ({
    y: PAD_T + dow * colW + CELL / 2,
    label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow],
  }));

  // Max minutes for colour scaling (cap at 60 so even a single 10-min session is visible)
  const maxMin = Math.max(60, ...Object.values(byDate).map(d => d.min));

  const cells = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + w * 7 + dow);
      if (d > today) continue;
      const iso = d.toISOString().slice(0, 10);
      const info = byDate[iso];
      const x = PAD_L + w * colW;
      const y = PAD_T + dow * colW;
      if (!info) {
        cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" class="heat-cell-empty"/>`);
      } else {
        const intensity = Math.min(1, info.min / maxMin);
        const lvl = Math.min(4, 1 + Math.floor(intensity * 4));
        const tip = `${iso}: ${Math.round(info.min)} min, ${info.count} session${info.count !== 1 ? 's' : ''} (${[...info.licks].join(', ')})`;
        cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" class="heat-cell heat-l${lvl}"><title>${tip}</title></rect>`);
      }
    }
  }

  const totalMin = Math.round(Object.values(byDate).reduce((s, d) => s + d.min, 0));
  const activeDays = Object.keys(byDate).length;

  el.innerHTML = `
    <div class="lick-heatmap-wrap">
      <h3 class="lick-heatmap-title">Practice — last 6 months</h3>
      <svg viewBox="0 0 ${W} ${H}" class="lick-heatmap-svg" preserveAspectRatio="xMidYMid meet">
        ${monthLabels.map(m => `<text x="${m.x}" y="${PAD_T - 5}" class="heat-month-label">${m.label}</text>`).join('')}
        ${dayLabels.map(d => `<text x="${PAD_L - 5}" y="${d.y}" class="heat-day-label" text-anchor="end" dominant-baseline="middle">${d.label}</text>`).join('')}
        ${cells.join('')}
      </svg>
      <div class="lick-heatmap-legend">
        <span>${activeDays} active day${activeDays !== 1 ? 's' : ''} · ${totalMin} min total</span>
        <span class="heat-scale">
          <span class="heat-cell-empty" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l1" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l2" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l3" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l4" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span style="margin-left:4px">more</span>
        </span>
      </div>
    </div>
  `;
}

async function newLick() {
  openModal('New Lick', 'My practice lick', async title => {
    const r = await api('/api/licks', 'POST', { title, notes: '', target_bpm: null });
    await openLick(r.id);  // navigate to detail first
    editLick(r.id);        // then open edit modal to fill notes + target BPM
  });
}

// ── Detail page ──

async function openLick(id) {
  const lick = await api(`/api/licks/${id}`);
  licksState.currentLick = lick;
  licksState.licksById[id] = lick;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-lick-detail').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  renderLickDetail(lick);
}

function renderLickDetail(lick) {
  const el = document.getElementById('lick-detail-content');
  if (!el) return;
  const sessions = lick.sessions || [];
  const lastBpm = sessions.length ? sessions[sessions.length - 1].bpm : 60;
  const targetLine = lick.target_bpm
    ? `<span class="lick-target">目标 ${lick.target_bpm} BPM</span>` : '';

  el.innerHTML = `
    <div class="lick-detail-header">
      <div>
        <h2 class="lick-detail-title" id="lick-detail-title">${htmlEsc(lick.title)}</h2>
        ${targetLine}
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="editLick('${lick.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm danger"
          onclick="deleteLick('${lick.id}')">Delete</button>
      </div>
    </div>

    ${lick.notes ? `<p class="lick-notes">${htmlEsc(lick.notes)}</p>` : ''}

    <div class="lick-chart-wrap" id="lick-chart-wrap">
      ${renderLickChart(sessions, lick.target_bpm)}
    </div>

    <div class="lick-sessions-header">
      <h3>Sessions (${sessions.length})</h3>
    </div>
    <div class="lick-sessions-list">
      ${sessions.length === 0
        ? '<p class="empty-state">No sessions yet — practice and log one!</p>'
        : (() => {
            const MAX = 20;
            const shown = [...sessions].reverse().slice(0, MAX);
            const rows = shown.map(s => `
              <div class="lick-session-row">
                <span class="lick-session-bpm">${s.bpm} BPM</span>
                <span class="lick-session-dur">${s.duration_min} min</span>
                <span class="lick-session-date">${fmtDate(s.date)}</span>
              </div>`).join('');
            const more = sessions.length > MAX
              ? `<p class="empty-state" style="padding:8px 0">… and ${sessions.length - MAX} earlier sessions</p>`
              : '';
            return rows + more;
          })()}
    </div>

    <div class="lick-detail-cta">
      <button class="btn btn-primary" onclick="practiceLick('${lick.id}')">
        🎯 Practice Now — ${lastBpm} BPM
      </button>
    </div>
  `;
}

// ── SVG progress chart ──

function renderLickChart(sessions, targetBpm) {
  if (sessions.length < 1) {
    return '<div class="lick-chart-empty">Start practicing to see your progress here.</div>';
  }

  const W = 520, H = 160, PAD = { t: 16, r: 16, b: 32, l: 44 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;

  const bpms = sessions.map(s => s.bpm);
  const allBpms = targetBpm ? [...bpms, targetBpm] : bpms;
  const minB = Math.max(0, Math.min(...allBpms) - 10);
  const maxB = Math.max(...allBpms) + 10;

  const dates = sessions.map(s => new Date(s.date).getTime());
  const minD = dates[0], maxD = dates[dates.length - 1];
  const spanD = Math.max(maxD - minD, 1);

  const toX = d => PAD.l + ((d - minD) / spanD) * cW;
  const toY = b => PAD.t + cH - ((b - minB) / (maxB - minB)) * cH;

  // Y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round(minB + (maxB - minB) * i / yTicks);
    const y = toY(v);
    return `<text x="${PAD.l - 6}" y="${y}" class="lick-chart-label" text-anchor="end" dominant-baseline="middle">${v}</text>
      <line x1="${PAD.l}" y1="${y}" x2="${PAD.l + cW}" y2="${y}" class="lick-chart-grid"/>`;
  }).join('');

  // X-axis: show up to 6 date labels
  const step = Math.max(1, Math.ceil(sessions.length / 6));
  const xLabels = sessions.filter((_, i) => i % step === 0 || i === sessions.length - 1).map(s => {
    const x = toX(new Date(s.date).getTime());
    const label = fmtDateShort(s.date);
    return `<text x="${x}" y="${H - 6}" class="lick-chart-label" text-anchor="middle">${label}</text>`;
  }).join('');

  // Target BPM line
  const targetLine = targetBpm
    ? `<line x1="${PAD.l}" y1="${toY(targetBpm)}" x2="${PAD.l + cW}" y2="${toY(targetBpm)}"
        class="lick-chart-target"/>`
    : '';

  // Data line
  const pts = sessions.map(s => `${toX(new Date(s.date).getTime())},${toY(s.bpm)}`).join(' ');
  const polyline = sessions.length > 1
    ? `<polyline points="${pts}" class="lick-chart-line"/>` : '';

  // Dots + tooltips
  const dots = sessions.map((s, i) => {
    const x = toX(new Date(s.date).getTime()), y = toY(s.bpm);
    const tip = `${fmtDate(s.date)}: ${s.bpm} BPM, ${s.duration_min} min`;
    return `<circle cx="${x}" cy="${y}" r="4" class="lick-chart-dot" onclick="alert('${tip}')">
      <title>${tip}</title>
    </circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="lick-chart-svg">
      ${yLabels}
      ${xLabels}
      <text x="${PAD.l - 30}" y="${PAD.t + cH/2}" class="lick-chart-label"
        text-anchor="middle" transform="rotate(-90,${PAD.l-30},${PAD.t+cH/2})">BPM</text>
      ${targetLine}
      ${polyline}
      ${dots}
    </svg>`;
}

// ── CRUD actions ──

async function editLick(id) {
  const lick = await api(`/api/licks/${id}`);
  document.getElementById('lick-edit-title').value = lick.title || '';
  document.getElementById('lick-edit-notes').value = lick.notes || '';
  document.getElementById('lick-edit-target-bpm').value = lick.target_bpm ?? '';
  // Store the id so submitLickEdit() knows which lick to save
  document.getElementById('lick-edit-modal').dataset.lickId = id;
  document.getElementById('lick-edit-modal').classList.add('show');
}

function closeLickEditModal() {
  document.getElementById('lick-edit-modal').classList.remove('show');
}

async function submitLickEdit() {
  const id = document.getElementById('lick-edit-modal').dataset.lickId;
  if (!id) return;
  const title = document.getElementById('lick-edit-title').value.trim() || 'Untitled';
  const notes = document.getElementById('lick-edit-notes').value.trim();
  const rawBpm = document.getElementById('lick-edit-target-bpm').value;
  const target_bpm = rawBpm !== '' ? parseFloat(rawBpm) : null;
  try {
    await api(`/api/licks/${id}`, 'PUT', { title, notes, target_bpm });
    closeLickEditModal();
    const updated = await api(`/api/licks/${id}`);
    licksState.licksById[id] = updated;
    renderLickDetail(updated);
  } catch (e) {
    setStatus('Error saving: ' + e.message);
  }
}

async function deleteLick(id) {
  if (!confirm('Delete this lick and all its session history?')) return;
  await api(`/api/licks/${id}`, 'DELETE');
  showPage('licks');
}

// ── Speed Trainer integration ──

function practiceLick(id) {
  const cached = licksState.licksById[id] || {};
  // Use last_bpm from list summary, or last session's bpm from full detail
  const sessions = cached.sessions || [];
  const bpm = sessions.length ? sessions[sessions.length - 1].bpm
              : (cached.last_bpm || 60);
  const title = cached.title || id;
  licksState.activeLick = { id, title, lastBpm: bpm };
  // Pre-load Speed Trainer with the lick's last BPM
  stState.startBpm = bpm;
  stState.currentBpm = bpm;
  stApplyStateToUI();
  stPrefsSave();
  showPage('speed');
}

function renderActiveLickBanner() {
  const el = document.getElementById('st-active-lick-banner');
  if (!el) return;
  const a = licksState.activeLick;
  if (!a) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <span class="st-lick-banner-text">🎯 Practicing: <strong>${htmlEsc(a.title)}</strong></span>
    <button class="btn btn-primary btn-sm" onclick="openLogSessionModal()">📝 Log Session</button>
    <button class="btn btn-ghost btn-sm" onclick="licksState.activeLick=null; renderActiveLickBanner()">✕ Cancel</button>
  `;
}

function openLogSessionModal() {
  const a = licksState.activeLick;
  if (!a) return;
  const currentBpm = stState.currentBpm || a.lastBpm;
  const modal = document.getElementById('lick-log-modal');
  if (modal) {
    document.getElementById('lick-log-bpm').value = currentBpm;
    document.getElementById('lick-log-dur').value = 5;
    modal.classList.add('show');
  }
}

function closeLickLogModal() {
  const modal = document.getElementById('lick-log-modal');
  if (modal) modal.classList.remove('show');
}

async function submitLickSession() {
  const a = licksState.activeLick;
  if (!a) return;
  const bpm = parseFloat(document.getElementById('lick-log-bpm').value) || stState.currentBpm;
  const dur = parseFloat(document.getElementById('lick-log-dur').value) || 5;
  try {
    await api(`/api/licks/${a.id}/sessions`, 'POST', { bpm, duration_min: dur });
    licksState.activeLick = { ...a, lastBpm: bpm };
    closeLickLogModal();
    setStatus(`Session logged: ${bpm} BPM, ${dur} min`);
  } catch (e) {
    setStatus('Error logging session: ' + e.message);
  }
}

// ── Date helpers ──

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Keyboard shortcuts for lick modals ──

document.addEventListener('DOMContentLoaded', () => {
  // lick-edit-modal: Escape closes, Enter in title submits
  const editTitle = document.getElementById('lick-edit-title');
  if (editTitle) {
    editTitle.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitLickEdit();
      if (e.key === 'Escape') closeLickEditModal();
    });
  }
  // lick-log-modal: Escape closes
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('lick-edit-modal')?.classList.contains('show')) closeLickEditModal();
    if (document.getElementById('lick-log-modal')?.classList.contains('show')) closeLickLogModal();
  });
});
