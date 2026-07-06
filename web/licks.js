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
  el.innerHTML = licks.map(l => {
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
}

async function newLick() {
  openModal('New Lick', 'My practice lick', async title => {
    const r = await api('/api/licks', 'POST', { title, notes: '', target_bpm: null });
    openLick(r.id);
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
        : [...sessions].reverse().slice(0, 20).map(s => `
          <div class="lick-session-row">
            <span class="lick-session-bpm">${s.bpm} BPM</span>
            <span class="lick-session-dur">${s.duration_min} min</span>
            <span class="lick-session-date">${fmtDate(s.date)}</span>
          </div>`).join('')}
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
  // Inline quick-edit: prompt for title and notes (simple approach)
  openModal('Rename', lick.title, async newTitle => {
    await api(`/api/licks/${id}`, 'PUT', {
      title: newTitle,
      notes: lick.notes || '',
      target_bpm: lick.target_bpm || null,
    });
    const updated = await api(`/api/licks/${id}`);
    renderLickDetail(updated);
  });
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
    modal.style.display = 'flex';
  }
}

function closeLickLogModal() {
  const modal = document.getElementById('lick-log-modal');
  if (modal) modal.style.display = 'none';
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
