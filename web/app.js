// ── Utilities ──

/** Escape a value for safe insertion into HTML (prevents XSS). */
function htmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Constants ──
const ALL_KEYS = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B',
                  'Am','Bm','Cm','Dm','Em','F#m','Gm'];

function keyOptions(selected) {
  return ALL_KEYS.map(k => `<option value="${k}" ${k===selected?'selected':''}>${k}</option>`).join('');
}

// ── State ──
const state = {
  styles: [],
  vamp: { chord: 'Am', style: 'pop', bpm: 120, loops: 3 },
  jam:  { bars: [], bpm: 120, key: 'C', style: 'pop', loops: 3 },
  editor: { song: null, bars: [] },
  sightread: { song: null, bars: [] },
  modal: { _onConfirm: null },
  playback: { polling: null },
  prefs: { bars_per_row: 4 },
};

// ── Connection indicator ──
let _connOk = null;
let _connFailures = 0;

function setConn(ok) {
  if (_connOk === ok) return;
  _connOk = ok;
  const dot = document.getElementById('conn-dot');
  const lbl = document.getElementById('conn-label');
  if (!dot) return;
  dot.className = 'conn-dot ' + (ok ? 'ok' : 'err');
  lbl.textContent = ok ? 'connected' : 'disconnected';
  if (!ok) setStatus('Server disconnected');
}

async function pingServer() {
  try {
    await fetch('/api/status', { method: 'GET' });
    const wasDown = _connOk === false;
    _connFailures = 0;
    setConn(true);
    if (wasDown) await loadApp();  // reinitialize after reconnect
  } catch(_) {
    _connFailures++;
    setConn(false);
    if (_connFailures >= 7) setStatus('Server unreachable — retrying in 30s');
  }
}

function _pingDelay() {
  if (_connFailures >= 7) return 30000;
  if (_connFailures >= 4) return 10000;
  return 3000;
}

async function _pingLoop() {
  await pingServer();
  setTimeout(_pingLoop, _pingDelay());
}

// ── Last selection (persisted across reloads) ──
// Vamp/Jam controls are "live scratchpad" state, not saved Songs — without
// this they silently reset to hardcoded defaults on every refresh, which is
// surprising once you've actually dialed in a chord/tempo/progression.
const LAST_SELECTION_KEY = 'mps_last_selection';

function loadLastSelection() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LAST_SELECTION_KEY)) || {}; } catch (_) { saved = {}; }
  if (saved.vamp) {
    if (typeof saved.vamp.chord === 'string') state.vamp.chord = saved.vamp.chord;
    if (typeof saved.vamp.style === 'string') state.vamp.style = saved.vamp.style;
    if (Number.isFinite(saved.vamp.bpm)) state.vamp.bpm = saved.vamp.bpm;
    if (Number.isFinite(saved.vamp.loops)) state.vamp.loops = saved.vamp.loops;
  }
  if (saved.jam) {
    if (Array.isArray(saved.jam.bars)) state.jam.bars = saved.jam.bars;
    if (typeof saved.jam.style === 'string') state.jam.style = saved.jam.style;
    if (typeof saved.jam.key === 'string') state.jam.key = saved.jam.key;
    if (Number.isFinite(saved.jam.bpm)) state.jam.bpm = saved.jam.bpm;
    if (Number.isFinite(saved.jam.loops)) state.jam.loops = saved.jam.loops;
  }
}

function saveLastSelection() {
  localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify({
    vamp: state.vamp,
    jam: state.jam,
  }));
}

async function loadApp() {
  state.styles = await api('/api/styles');
  loadLastSelection();
  renderVampControls();
  renderJamControls();
  renderPrefsForm();
  if (state.jam.bars.length) {
    renderJamChart();
  } else {
    applyStyle(document.getElementById('jam-style')?.value || 'pop', 'jam');
  }
  const p = await api('/api/prefs');
  state.prefs = p;
  document.getElementById('status-sf').textContent = (p.soundfont_path || '').split('/').pop();
}

// ── Init ──
const CURRENT_PAGE_KEY = 'mps_current_page';
const NAV_PAGES = ['vamp', 'jam', 'songs', 'licks', 'sightread', 'fretboard', 'speed', 'prefs'];

async function init() {
  fbRenderDeviceBar(); // global mic/speaker pickers — no server dependency, so this works even if the backend is down
  await pingServer();
  setTimeout(_pingLoop, _pingDelay());
  if (_connOk) await loadApp();
  const savedPage = localStorage.getItem(CURRENT_PAGE_KEY);
  if (savedPage && NAV_PAGES.includes(savedPage) && savedPage !== 'vamp') showPage(savedPage);
  else updateTransportForPage('vamp'); // default page skips showPage — register its transport directly
}

// Stop polling when the tab is hidden; resume when it becomes visible again.
const _PAGE_PREFIX_MAP = {
  'page-vamp': 'vamp', 'page-jam': 'jam',
  'page-editor': 'ed', 'page-sightread': 'sightread',
};
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    stopPolling();
  } else if (state.playback.polling === null) {
    const pageId = document.querySelector('.page.active')?.id || '';
    const prefix = _PAGE_PREFIX_MAP[pageId];
    if (prefix) {
      api('/api/status').then(s => { if (s.playing) startPolling(prefix); }).catch(() => {});
    }
  }
});

// ── Page nav ──
function showPage(name) {
  if (name !== 'fretboard' && document.getElementById('page-fretboard')?.classList.contains('active')) fbLeavePage();
  if (name !== 'speed' && document.getElementById('page-speed')?.classList.contains('active')) stStop();
  localStorage.setItem(CURRENT_PAGE_KEY, name);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  if (name === 'songs')     loadSongs();
  if (name === 'licks')     loadLicks();
  if (name === 'prefs')     renderPrefsForm();
  if (name === 'fretboard') initFretboardPage();
  if (name === 'sightread') loadSightReadPicker();
  if (name === 'speed')     { initSpeedPage(); renderActiveLickBanner(); }
  updateTransportForPage(name);  // point the bottom transport bar at this page's action
}

// ── API helper ──
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(path, opts);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  } catch(e) {
    if (!_connOk) throw new Error('Server disconnected');
    throw e;
  }
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ── Chord Chart ──

function beatsForChords(chords) {
  const n = chords.length;
  if (n === 0) return [];
  if (n === 1) return chords.map(c => ({ ...c, beats: c.beats || 4 }));
  if (n === 2) return chords.map(c => ({ ...c, beats: c.beats || 2 }));
  if (n === 3) return chords.map((c, i) => ({ ...c, beats: c.beats || (i === 0 ? 2 : 1) }));
  return chords.map(c => ({ ...c, beats: c.beats || 1 }));
}

const CHORD_TOOLBAR = [
  ['maj', 'C','D','E','F','G','A','B'],
  ['min', 'Cm','Dm','Em','Fm','Gm','Am','Bm'],
  ['dom7', 'C7','D7','E7','F7','G7','A7','B7'],
  ['maj7', 'Cmaj7','Dmaj7','Fmaj7','Gmaj7','Amaj7'],
  ['min7', 'Cm7','Dm7','Em7','Fm7','Gm7','Am7','Bm7'],
  ['#/b', 'C#','Db','D#','Eb','F#','Gb','G#','Ab','A#','Bb'],
  ['sus', 'Csus2','Csus4','Gsus2','Gsus4'],
  ['dim/aug', 'Cdim','Ddim','Edim','Caug','Daug'],
];

function renderChart(containerEl, bars, onChordClick, onChordCtx, onBarCtx, onAddBar, onDeleteChord, onRerender) {
  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';

  // ── chord toolbar ──
  const toolbar = document.createElement('div');
  toolbar.className = 'chord-toolbar';
  CHORD_TOOLBAR.forEach(([label, ...chords]) => {
    const group = document.createElement('div');
    group.className = 'chord-toolbar-group';
    const lbl = document.createElement('span');
    lbl.className = 'chord-toolbar-label';
    lbl.textContent = label;
    group.appendChild(lbl);
    chords.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'chord-toolbar-btn';
      btn.textContent = c;
      btn.addEventListener('click', () => {
        // insert into focused inline input if one is open
        const active = containerEl.querySelector('.chord-inline-input');
        if (active) { active.value = c; active.focus(); }
      });
      group.appendChild(btn);
    });
    toolbar.appendChild(group);
  });
  wrap.appendChild(toolbar);

  const BARS_PER_ROW = state.prefs.bars_per_row || 4;
  const totalRows = Math.ceil(Math.max(bars.length, 1) / BARS_PER_ROW);

  for (let rowStart = 0; rowStart < totalRows * BARS_PER_ROW; rowStart += BARS_PER_ROW) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.style.gridTemplateColumns = `32px repeat(${BARS_PER_ROW}, 1fr)`;

    const tsig = document.createElement('div');
    tsig.className = 'chart-timesig';
    tsig.textContent = rowStart === 0 ? '4/4' : '';
    row.appendChild(tsig);

    for (let col = 0; col < BARS_PER_ROW; col++) {
      const barIdx = rowStart + col;
      const bar = bars[barIdx];
      const barEl = document.createElement('div');
      barEl.className = 'chart-bar';

      if (!bar) {
        row.appendChild(barEl);
        continue;
      }

      const numEl = document.createElement('div');
      numEl.className = 'bar-num';
      numEl.textContent = barIdx + 1;
      barEl.appendChild(numEl);

      const beatsEl = document.createElement('div');
      beatsEl.className = 'bar-beats';

      const chordsWithBeats = beatsForChords(bar.chords || []);

      function makeInlineEdit(cell, barIdx, ci, isNew) {
        const existing = cell.querySelector('.chord-name');
        const currentVal = isNew ? '' : (existing?.textContent || '');
        cell.classList.add('editing');
        const input = document.createElement('input');
        input.className = 'chord-inline-input';
        input.value = currentVal;
        input.autocomplete = 'off';
        input.spellcheck = false;
        cell.innerHTML = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        function commit() {
          const val = input.value.trim();
          if (val) {
            if (isNew) bar.chords.push({ name: val, beats: null });
            else bar.chords[ci].name = val;
          } else if (!isNew) {
            // empty → delete
            bar.chords.splice(ci, 1);
          }
          onRerender();
        }
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { onRerender(); }
        });
        input.addEventListener('blur', commit);
      }

      if (chordsWithBeats.length === 0) {
        const cell = document.createElement('div');
        cell.className = 'beat-cell empty';
        cell.innerHTML = '<span class="chord-name">+</span>';
        cell.addEventListener('click', e => { e.stopPropagation(); makeInlineEdit(cell, barIdx, 0, true); });
        beatsEl.appendChild(cell);
      } else {
        chordsWithBeats.forEach((chord, ci) => {
          if (ci > 0) {
            const ins = document.createElement('div');
            ins.className = 'beat-insert';
            ins.innerHTML = '<span>+</span>';
            ins.title = 'Insert chord here';
            ins.addEventListener('click', e => {
              e.stopPropagation();
              bar.chords.splice(ci, 0, { name: '', beats: null });
              onRerender();
              // after rerender, trigger edit on the new empty cell — handled via empty cell click
            });
            beatsEl.appendChild(ins);
          }
          const cell = document.createElement('div');
          cell.className = 'beat-cell';
          cell.style.flex = chord.beats;
          cell.innerHTML = `
            <span class="chord-name">${htmlEsc(chord.name)}</span>
            <button class="chord-del" title="Delete">×</button>
          `;
          cell.querySelector('.chord-name').addEventListener('click', e => {
            e.stopPropagation(); makeInlineEdit(cell, barIdx, ci, false);
          });
          cell.querySelector('.chord-del').addEventListener('click', e => {
            e.stopPropagation();
            if (onDeleteChord) onDeleteChord(barIdx, ci);
          });
          cell.addEventListener('contextmenu', e => { e.preventDefault(); onChordCtx(e, barIdx, ci); });
          beatsEl.appendChild(cell);
        });
        const appendBtn = document.createElement('div');
        appendBtn.className = 'beat-insert beat-append';
        appendBtn.innerHTML = '<span>+</span>';
        appendBtn.title = 'Add chord';
        appendBtn.addEventListener('click', e => {
          e.stopPropagation();
          bar.chords.push({ name: '', beats: null });
          onRerender();
        });
        beatsEl.appendChild(appendBtn);
      }

      barEl.appendChild(beatsEl);
      barEl.addEventListener('contextmenu', e => { e.preventDefault(); onBarCtx(e, barIdx); });
      row.appendChild(barEl);
    }
    wrap.appendChild(row);

    // Only add rows that have at least one real bar
    const hasContent = Array.from({length: BARS_PER_ROW}, (_, i) => bars[rowStart + i]).some(Boolean);
    if (!hasContent && rowStart > 0) {
      wrap.removeChild(row);
      break;
    }
  }

  const addRow = document.createElement('div');
  addRow.className = 'add-bar-row';
  addRow.textContent = '+ Add Bar';
  addRow.addEventListener('click', onAddBar);
  wrap.appendChild(addRow);

  containerEl.appendChild(wrap);
}

// ── Context menu ──
let _ctxMenu = null;
function showCtxMenu(x, y, items) {
  hideCtxMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.addEventListener('click', () => { hideCtxMenu(); item.action(); });
    menu.appendChild(el);
  });
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  _ctxMenu = menu;
}
function hideCtxMenu() {
  if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
}
document.addEventListener('click', hideCtxMenu);

// ── Chord modal ──
const COMMON_CHORDS = ['C','Am','F','G','Dm','Em','G7','Cmaj7','Am7','Fmaj7','A','D','E','Bm','A7','D7','E7'];

function openModal(title, initialValue, onConfirm) {
  state.modal._onConfirm = onConfirm;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-input').value = initialValue;
  const sugg = document.getElementById('modal-suggestions');
  sugg.innerHTML = COMMON_CHORDS.map(c =>
    `<span class="suggestion" onclick="document.getElementById('modal-input').value='${c}'">${c}</span>`
  ).join('');
  document.getElementById('modal-overlay').classList.add('show');
  setTimeout(() => document.getElementById('modal-input').focus(), 50);
}
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('show');
}
function confirmChord() {
  const val = document.getElementById('modal-input').value.trim();
  document.getElementById('modal-overlay').classList.remove('show');
  if (val && state.modal._onConfirm) state.modal._onConfirm(val);
}
document.getElementById('modal-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmChord();
  if (e.key === 'Escape') closeModal();
});

// ── Chord chart helpers (shared between Jam and Editor) ──
function makeChordHandlers(getBars, rerenderFn) {
  const onDeleteChord = (barIdx, chordIdx) => {
    getBars()[barIdx].chords.splice(chordIdx, 1);
    rerenderFn();
  };
  const onChordClick = (barIdx, chordIdx, isNew) => {
    const bar = getBars()[barIdx];
    openModal(isNew ? `Bar ${barIdx+1} · Add Chord` : `Bar ${barIdx+1} · Edit`,
      isNew ? '' : bar.chords[chordIdx]?.name || '',
      val => {
        if (isNew) bar.chords.push({ name: val, beats: null });
        else bar.chords[chordIdx].name = val;
        rerenderFn();
      });
  };
  const onChordCtx = (e, barIdx, chordIdx) => {
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'Edit', action: () => {
        openModal('Edit Chord', getBars()[barIdx].chords[chordIdx].name, val => {
          getBars()[barIdx].chords[chordIdx].name = val; rerenderFn();
        });
      }},
      { label: 'Insert Before', action: () => {
        openModal('New Chord', '', val => {
          getBars()[barIdx].chords.splice(chordIdx, 0, { name: val, beats: null }); rerenderFn();
        });
      }},
      { label: 'Insert After', action: () => {
        openModal('New Chord', '', val => {
          getBars()[barIdx].chords.splice(chordIdx+1, 0, { name: val, beats: null }); rerenderFn();
        });
      }},
      { label: 'Delete', danger: true, action: () => {
        getBars()[barIdx].chords.splice(chordIdx, 1); rerenderFn();
      }},
    ]);
  };
  const onBarCtx = (e, barIdx) => {
    showCtxMenu(e.clientX, e.clientY, [
      { label: 'Add Chord', action: () => {
        openModal('New Chord', '', val => {
          getBars()[barIdx].chords.push({ name: val, beats: null }); rerenderFn();
        });
      }},
      { label: 'Insert Bar Before', action: () => {
        getBars().splice(barIdx, 0, { chords: [] }); rerenderFn();
      }},
      { label: 'Insert Bar After', action: () => {
        getBars().splice(barIdx+1, 0, { chords: [] }); rerenderFn();
      }},
      { label: 'Delete Bar', danger: true, action: () => {
        getBars().splice(barIdx, 1); rerenderFn();
      }},
    ]);
  };
  const onAddBar = () => { getBars().push({ chords: [] }); rerenderFn(); };
  return { onChordClick, onChordCtx, onBarCtx, onAddBar, onDeleteChord };
}

// ── Vamp page ──

function renderVampControls() {
  const el = document.getElementById('vamp-controls');
  if (!el) return;
  el.innerHTML = `
    <div class="controls-bar">
      <div class="controls-row">
        <div class="field"><label>Chord</label>
          <input type="text" id="vamp-chord" class="input-chord" value="${htmlEsc(state.vamp.chord)}"
            autocomplete="off" spellcheck="false" oninput="state.vamp.chord=this.value.trim(); saveLastSelection()">
        </div>
        <div class="field"><label>Style</label>
          <select id="vamp-style" onchange="state.vamp.style=this.value; saveLastSelection()">
            ${state.styles.map(s => `<option value="${s.id}" ${s.id===state.vamp.style?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>BPM</label>
          <input type="number" id="vamp-bpm" value="${state.vamp.bpm}" min="40" max="240"
            oninput="state.vamp.bpm=parseInt(this.value)||120; syncFromDuration('vamp'); liveSetBpm(this.value); saveLastSelection()">
        </div>
        <div class="field"><label>Loops</label>
          <input type="number" id="vamp-loops" value="${state.vamp.loops}" min="1" max="999" style="width:52px"
            oninput="state.vamp.loops=parseInt(this.value)||1; syncFromLoops('vamp'); saveLastSelection()">
        </div>
        <div class="field"><label>Duration</label>
          <input type="number" id="vamp-dur-min" value="5.0" min="0.5" max="120" step="0.5" style="width:60px"
            oninput="syncFromDuration('vamp'); state.vamp.loops=getLoops('vamp'); saveLastSelection()">
          <span class="duration-hint">min</span>
        </div>
      </div>
    </div>
  `;
  // Duration-as-source-of-truth would clobber a restored `state.vamp.loops`
  // with whatever the hardcoded "5.0" duration default computes to — use
  // loops-as-source-of-truth instead, same as Jam/Editor controls do.
  syncFromLoops('vamp');
}

// 4/4 = 4 bars per phrase
const VAMP_PHRASE_BARS = 4;

function renderVampPhrase(activebar) {
  const el = document.getElementById('vamp-phrase');
  if (!el) return;
  el.innerHTML = `
    <div class="vamp-phrase">
      ${Array.from({length: VAMP_PHRASE_BARS}, (_, i) => `
        <div class="vamp-bar ${activebar === i ? 'active' : ''}">
          <span class="vamp-bar-num">${i + 1}</span>
        </div>
      `).join('')}
    </div>`;
}

async function vampPlay() {
  state.vamp.bpm   = parseInt(document.getElementById('vamp-bpm')?.value) || 120;
  state.vamp.loops = getLoops('vamp');
  state.vamp.style = document.getElementById('vamp-style')?.value || 'pop';
  state.vamp.chord = document.getElementById('vamp-chord')?.value.trim() || 'Am';
  const payload = {
    bars: [{ chords: [{ name: state.vamp.chord, beats: 4 }] }],
    bpm: state.vamp.bpm, loops: state.vamp.loops, style: state.vamp.style,
    fill_every: 8,
  };
  setPlaybackUI('vamp', 'playing');
  renderVampPhrase(-1);
  setStatus('Playing');
  try {
    await api('/api/play', 'POST', payload);
    startPolling('vamp');
  } catch(e) { setStatus('Error: ' + e.message); vampStop(); }
}
async function vampPause()  { await api('/api/pause',  'POST'); setPlaybackUI('vamp', 'paused');  setStatus('Paused'); }
async function vampResume() { await api('/api/resume', 'POST'); setPlaybackUI('vamp', 'playing'); setStatus('Playing'); }
async function vampStop()   {
  stopPolling();
  await api('/api/stop', 'POST');
  setPlaybackUI('vamp', 'stopped');
  const el = document.getElementById('vamp-phrase');
  if (el) el.innerHTML = '';
  setStatus('Ready');
}

// ── Jam page ──

function renderJamControls() {
  const el = document.getElementById('jam-controls');
  el.innerHTML = `
    <div class="controls-bar">
      <div class="controls-row">
        <div class="field"><label>Style</label>
          <select id="jam-style" onchange="applyStyle(this.value,'jam')">
            ${state.styles.map(s => `<option value="${s.id}" ${s.id===state.jam.style?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Key</label>
          <select id="jam-key" onchange="state.jam.key=this.value; saveLastSelection()">${keyOptions(state.jam.key)}</select>
        </div>
        <div class="field"><label>BPM</label>
          <input type="number" id="jam-bpm" value="${state.jam.bpm}" min="40" max="240"
            oninput="state.jam.bpm=parseInt(this.value)||120; syncFromDuration('jam'); liveSetBpm(this.value); saveLastSelection()">
        </div>
        <div class="field"><label>Loops</label>
          <input type="number" id="jam-loops" value="${state.jam.loops}" min="1" max="99" style="width:52px"
            oninput="state.jam.loops=parseInt(this.value)||1; syncFromLoops('jam'); saveLastSelection()">
        </div>
        <div class="field"><label>Duration</label>
          <input type="number" id="jam-dur-min" value="3.0" min="0.5" max="120" step="0.5" style="width:60px"
            oninput="syncFromDuration('jam'); state.jam.loops=getLoops('jam'); saveLastSelection()">
          <span class="duration-hint">min</span>
        </div>
      </div>
      <div class="controls-row">
        <button class="btn btn-ghost btn-sm" onclick="jamSaveAs()">Save as Song…</button>
      </div>
    </div>
  `;
  syncFromLoops('jam');
}

function applyStyle(styleId, context) {
  const s = state.styles.find(x => x.id === styleId);
  if (!s) return;
  if (context === 'jam') {
    state.jam.bars = s.default_progression.map(b => ({ chords: b.chords.map(c => ({...c})) }));
    state.jam.bpm = s.bpm_default;
    state.jam.key = s.default_key;
    state.jam.style = s.id;
    const bpmEl = document.getElementById('jam-bpm');
    const keyEl = document.getElementById('jam-key');
    if (bpmEl) bpmEl.value = s.bpm_default;
    if (keyEl) keyEl.value = s.default_key;
    updateJamDuration();
    renderJamChart();
    saveLastSelection();
  }
}

// ── Loops / Duration shared helpers ──

function secPerLoop(prefix) {
  const bpmId = { jam: 'jam-bpm', ed: 'ed-bpm', vamp: 'vamp-bpm' }[prefix] || `${prefix}-bpm`;
  const bpm = parseInt(document.getElementById(bpmId)?.value) || 120;
  let bars;
  if (prefix === 'vamp') bars = 1;
  else if (prefix === 'jam') bars = state.jam.bars.length;
  else bars = state.editor.bars.length;
  return Math.max(1, bars) * 4 * 60 / bpm;
}

function syncFromLoops(prefix) {
  const loops = parseInt(document.getElementById(`${prefix}-loops`)?.value) || 1;
  const sec = Math.round(loops * secPerLoop(prefix));
  const durEl = document.getElementById(`${prefix}-dur-min`);
  if (durEl) durEl.value = (sec / 60).toFixed(1);
}

function syncFromDuration(prefix) {
  const min = parseFloat(document.getElementById(`${prefix}-dur-min`)?.value) || 1;
  const spl = secPerLoop(prefix);
  const loops = Math.max(1, Math.round((min * 60) / spl));
  const loopsEl = document.getElementById(`${prefix}-loops`);
  if (loopsEl) loopsEl.value = loops;
}

function getLoops(prefix) {
  return parseInt(document.getElementById(`${prefix}-loops`)?.value) || 1;
}

function updateJamDuration() { syncFromLoops('jam'); }
function updateEditorDuration() { syncFromLoops('ed'); }

function renderJamChart() {
  const rerender = () => { renderJamChart(); updateJamDuration(); saveLastSelection(); };
  const h = makeChordHandlers(() => state.jam.bars, rerender);
  renderChart(document.getElementById('jam-chart'), state.jam.bars,
    h.onChordClick, h.onChordCtx, h.onBarCtx, h.onAddBar, h.onDeleteChord, rerender);
}

async function liveSetBpm(val) {
  const bpm = parseInt(val);
  if (!bpm || !_connOk) return;
  try { await api('/api/bpm', 'POST', { bpm }); } catch(_) {}
}

// ── App-wide transport bar (fixed at the bottom of the window) ─────────────
// Every page's primary action — Play/Pause/Stop for the backing-track pages,
// Start Listening/Stop for the mic drills — lives here instead of being
// scattered into each page. Exactly one transport is active at a time:
// whichever the current page registers. The bar renders itself from a single
// state, so pages only have to (a) register their handlers and (b) report
// state changes through the same setPlaybackUI/setTransportState funnel they
// already used.
//
//   kind 'playback'  ▶ Play → ⏸ Pause / ⏹ Stop  (pause/resume optional)
//   kind 'listen'    ● Start Listening → ⏹ Stop
let _transport = null;          // { kind, label, play, stop, pause, resume }
let _transportState = 'stopped';// 'stopped' | 'playing' | 'paused' | 'listening'

function registerTransport(t) {
  _transport = t;
  _transportState = 'stopped';
  renderTransportBar();
}
function clearTransport() {
  _transport = null;
  renderTransportBar();
}
function setTransportState(s) {
  _transportState = s;
  renderTransportBar();
}
function renderTransportBar() {
  const bar = document.getElementById('transport-bar');
  if (!bar) return;
  document.body.classList.toggle('has-transport', !!_transport);
  if (!_transport) { bar.classList.remove('active'); bar.innerHTML = ''; return; }
  bar.classList.add('active');
  let btns;
  if (_transport.kind === 'listen') {
    btns = _transportState === 'listening'
      ? `<button class="btn btn-stop" onclick="transportStop()">Stop</button>`
      : `<button class="btn btn-listen" onclick="transportPlay()">Start Listening</button>`;
  } else if (_transportState === 'playing') {
    btns = (_transport.pause ? `<button class="btn btn-ghost" onclick="transportPause()">⏸ Pause</button>` : '') +
      `<button class="btn btn-stop" onclick="transportStop()">Stop</button>`;
  } else if (_transportState === 'paused') {
    btns = `<button class="btn btn-play" onclick="transportResume()">Resume</button>` +
      `<button class="btn btn-stop" onclick="transportStop()">Stop</button>`;
  } else {
    btns = `<button class="btn btn-play" onclick="transportPlay()">Play</button>`;
  }
  const label = _transport.label ? `<span class="transport-label">${htmlEsc(_transport.label)}</span>` : '';
  bar.innerHTML = `${label}<span class="transport-actions">${btns}</span>`;
}
function transportPlay()   { _transport?.play?.(); }
function transportStop()   { _transport?.stop?.(); }
function transportPause()  { _transport?.pause?.(); }
function transportResume() { _transport?.resume?.(); }
// Debounce the start action — a mic Start Listening is async, so a fast double
// click could otherwise fire two starts before the bar re-renders to Stop.
transportPlay = guarded(transportPlay);

// Registers the right transport for a page (called from showPage, and directly
// from openEditor since the editor is opened without going through showPage).
function updateTransportForPage(name) {
  switch (name) {
    case 'vamp':      registerTransport({ kind: 'playback', label: 'Vamp',          play: vampPlay,      stop: vampStop,      pause: vampPause,      resume: vampResume }); break;
    case 'jam':       registerTransport({ kind: 'playback', label: 'Jam',           play: jamPlay,       stop: jamStop,       pause: jamPause,       resume: jamResume }); break;
    case 'editor':    registerTransport({ kind: 'playback', label: 'Song Editor',   play: editorPlay,    stop: editorStop,    pause: editorPause,    resume: editorResume }); break;
    case 'sightread': registerTransport({ kind: 'playback', label: 'Sight Read',    play: sightReadPlay, stop: sightReadStop, pause: sightReadPause, resume: sightReadResume }); break;
    case 'speed':     registerTransport({ kind: 'playback', label: 'Speed Trainer', play: stStart,       stop: stStop }); break;
    case 'fretboard': fbRenderControlAction(); break; // fretboard registers per active sub-mode
    default:          clearTransport();
  }
}

function setPlaybackUI(prefix, state_) {
  // The transport buttons themselves now live in the shared bottom bar; mirror
  // the state to it (this prefix is always the active page's, hence the active
  // transport).
  setTransportState(state_);

  // playback panel state
  const panel = document.getElementById(`${prefix === 'ed' ? 'editor' : prefix}-playback`);
  const stateEl = document.getElementById(`${prefix === 'ed' ? 'editor' : prefix}-state`);
  if (panel) panel.className = 'playback-panel' + (state_ === 'playing' ? ' playing' : '');
  if (stateEl) { stateEl.textContent = state_; stateEl.className = 'playback-state ' + state_; }

  if (state_ === 'stopped') {
    const elapsed = document.getElementById(`${prefix === 'ed' ? 'editor' : prefix}-elapsed`);
    const loopVal = document.getElementById(`${prefix === 'ed' ? 'editor' : prefix}-loop-val`);
    if (elapsed) elapsed.textContent = '—';
    if (loopVal) loopVal.textContent = '—';
    clearBarHighlight();
  }
}

function fmt(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function clearBarHighlight() {
  document.querySelectorAll('.chart-bar.active').forEach(el => el.classList.remove('active'));
}

function highlightBar(barIndex) {
  clearBarHighlight();
  const activePage = document.querySelector('.page.active');
  if (!activePage) return;
  const bars = activePage.querySelectorAll('.chart-bar');
  if (bars[barIndex]) {
    bars[barIndex].classList.add('active');
    bars[barIndex].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

function startPolling(prefix) {
  stopPolling();
  const panelPrefix = prefix === 'ed' ? 'editor' : prefix;
  let failCount = 0;
  state.playback.polling = setInterval(async () => {
    try {
      const s = await api('/api/status');
      failCount = 0;
      if (!s.playing) {
        stopPolling();
        setPlaybackUI(prefix, 'stopped');
        setStatus('Ready');
        return;
      }

      const elapsed = document.getElementById(`${panelPrefix}-elapsed`);
      const loopVal = document.getElementById(`${panelPrefix}-loop-val`);
      const stateEl = document.getElementById(`${panelPrefix}-state`);

      if (s.paused) {
        if (stateEl) { stateEl.textContent = 'paused'; stateEl.className = 'playback-state paused'; }
        return;
      }

      if (elapsed) elapsed.textContent = fmt(s.elapsed_sec || 0);
      if (loopVal && s.loops) loopVal.textContent = `${s.current_loop} / ${s.loops}`;
      if (stateEl) { stateEl.textContent = 'playing'; stateEl.className = 'playback-state playing'; }

      // highlight current bar (chord chart) or phrase cell (vamp)
      if (s.elapsed_sec != null && s.duration_sec && s.bars && s.loops) {
        const secPerBar = s.duration_sec / (s.bars * s.loops);
        const totalBarsSoFar = Math.floor(s.elapsed_sec / secPerBar);
        if (prefix === 'vamp') {
          renderVampPhrase(totalBarsSoFar % VAMP_PHRASE_BARS);
        } else {
          highlightBar(totalBarsSoFar % s.bars);
        }
      }
    } catch(_) {
      failCount++;
      if (failCount >= 5) {
        stopPolling();
        setPlaybackUI(prefix, 'stopped');
        setStatus('Server unreachable');
      }
    }
  }, 250);
}

function stopPolling() {
  if (state.playback.polling) {
    clearInterval(state.playback.polling);
    state.playback.polling = null;
  }
}

async function jamPlay() {
  state.jam.bpm   = parseInt(document.getElementById('jam-bpm')?.value) || 120;
  state.jam.loops = getLoops('jam');
  state.jam.style = document.getElementById('jam-style')?.value || 'pop';
  state.jam.key   = document.getElementById('jam-key')?.value || state.jam.key;
  setPlaybackUI('jam', 'playing');
  setStatus('Playing');
  try {
    await api('/api/play', 'POST', { ...state.jam, fill_every: 8 });
    startPolling('jam');
  } catch(e) {
    setStatus('Error: ' + e.message);
    jamStop();
  }
}

async function jamPause() {
  await api('/api/pause', 'POST');
  setPlaybackUI('jam', 'paused');
  setStatus('Paused');
}

async function jamResume() {
  await api('/api/resume', 'POST');
  setPlaybackUI('jam', 'playing');
  setStatus('Playing');
}

async function jamStop() {
  stopPolling();
  await api('/api/stop', 'POST');
  setPlaybackUI('jam', 'stopped');
  setStatus('Ready');
}

async function jamSaveAs() {
  openModal('Song Title', 'New Song', async title => {
    const song = { ...state.jam, title };
    try {
      await api('/api/songs', 'POST', song);
      setStatus(`Saved: ${title}`);
      showPage('songs');
    } catch(e) { setStatus('Error: ' + e.message); }
  });
}

// ── Songs page ──

async function loadSongs() {
  const songs = await api('/api/songs');
  const el = document.getElementById('songs-list');
  if (!songs.length) {
    el.innerHTML = '<p class="empty-state">No songs yet. Create one!</p>';
    return;
  }
  el.innerHTML = songs.map(s => {
    const totalBars = (s.bars?.length || 0) * (s.loops || 1);
    const sec = Math.round(totalBars * 4 * 60 / (s.bpm || 120));
    const dur = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
    const ago = timeAgo(s.updated_at);
    return `
      <div class="song-card" onclick="openEditor('${s.id}')">
        <div class="song-card-body">
          <div class="song-card-title">${htmlEsc(s.title)}</div>
          <div class="song-card-meta">${htmlEsc(s.key)} · ${htmlEsc(s.style)} · ${s.bpm} BPM &nbsp;·&nbsp; ${s.bars?.length||0} bars × ${s.loops||1} = ${dur} &nbsp;·&nbsp; ${ago}</div>
        </div>
        <span class="song-status ${s.generated ? 'ready' : 'draft'}">${s.generated ? 'Generated' : 'Draft'}</span>
        <div class="song-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="duplicateSong(event,'${s.id}')">Duplicate</button>
          <button class="btn btn-ghost btn-sm danger" onclick="deleteSong(event,'${s.id}')">×</button>
        </div>
      </div>
    `;
  }).join('');
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

async function newSong() {
  openModal('Song Title', 'New Song', async title => {
    const s = state.styles.find(x => x.id === 'pop');
    const song = {
      title, key: s.default_key, bpm: s.bpm_default, style: s.id,
      time_signature: '4/4', loops: 4,
      bars: s.default_progression.map(b => ({ chords: b.chords.map(c => ({...c})) })),
    };
    const r = await api('/api/songs', 'POST', song);
    openEditor(r.id);
  });
}

async function duplicateSong(e, id) {
  e.stopPropagation();
  const song = await api(`/api/songs/${id}`);
  song.title = song.title + ' (copy)';
  delete song.id;
  await api('/api/songs', 'POST', song);
  loadSongs();
}

async function deleteSong(e, id) {
  e.stopPropagation();
  if (!confirm('Delete this song?')) return;
  await api(`/api/songs/${id}`, 'DELETE');
  loadSongs();
}

// ── Song Editor ──

async function openEditor(id) {
  const song = await api(`/api/songs/${id}`);
  state.editor.song = song;
  state.editor.bars = song.bars.map(b => ({ chords: b.chords.map(c => ({...c})) }));
  renderEditorControls();
  renderEditorGenStatus();
  renderEditorChart();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-editor').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  updateTransportForPage('editor');  // opened outside showPage, so register here
}

function renderEditorControls() {
  const s = state.editor.song;
  document.getElementById('editor-controls').innerHTML = `
    <div class="page-back-row">
      <button class="btn btn-ghost btn-sm" onclick="showPage('songs')">← Songs</button>
    </div>
    <div class="controls-bar">
      <div class="controls-row">
        <div class="field"><label>Title</label>
          <input type="text" id="ed-title" value="${htmlEsc(s.title)}" style="width:150px">
        </div>
        <div class="field"><label>Key</label>
          <select id="ed-key">${keyOptions(s.key)}</select>
        </div>
        <div class="field"><label>BPM</label>
          <input type="number" id="ed-bpm" value="${s.bpm}" min="40" max="240" oninput="syncFromDuration('ed')">
        </div>
        <div class="field"><label>Style</label>
          <select id="ed-style">
            ${state.styles.map(st => `<option value="${st.id}" ${st.id===s.style?'selected':''}>${st.name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Loops</label>
          <input type="number" id="ed-loops" value="${s.loops}" min="1" max="99" style="width:52px"
            oninput="syncFromLoops('ed')">
        </div>
        <div class="field"><label>Duration</label>
          <input type="number" id="ed-dur-min" value="${(s.loops * state.editor.bars.length * 4 * 60 / (s.bpm || 120) / 60).toFixed(1)}"
            min="0.5" max="120" step="0.5" style="width:60px" oninput="syncFromDuration('ed')">
          <span class="duration-hint">min</span>
        </div>
      </div>
      <div class="controls-row">
        <button class="btn btn-ghost btn-sm" onclick="saveSong()">Save</button>
      </div>
    </div>
  `;
  updateEditorDuration();
}

function renderEditorGenStatus() {
  // no-op — status shown in playback-panel now
}

function renderEditorChart() {
  const rerender = () => { renderEditorChart(); updateEditorDuration(); };
  const h = makeChordHandlers(() => state.editor.bars, rerender);
  renderChart(document.getElementById('editor-chart'), state.editor.bars,
    h.onChordClick, h.onChordCtx, h.onBarCtx, h.onAddBar, h.onDeleteChord, rerender);
}

async function saveSong() {
  const s = state.editor.song;
  const updated = {
    ...s,
    title: document.getElementById('ed-title').value,
    key: document.getElementById('ed-key').value,
    bpm: parseInt(document.getElementById('ed-bpm').value),
    style: document.getElementById('ed-style').value,
    loops: getLoops('ed'),
    bars: state.editor.bars,
  };
  await api(`/api/songs/${s.id}`, 'PUT', updated);
  state.editor.song = { ...updated, id: s.id };
  setStatus('Saved');
}

async function editorPlay() {
  await saveSong();
  const s = state.editor.song;
  setPlaybackUI('ed', 'playing');
  setStatus('Playing');
  try {
    await api('/api/play', 'POST', { ...s, bars: state.editor.bars });
    state.editor.song.generated = true;
    startPolling('ed');
  } catch(e) { setStatus('Error: ' + e.message); editorStop(); }
}

async function editorPause() {
  await api('/api/pause', 'POST');
  setPlaybackUI('ed', 'paused');
  setStatus('Paused');
}

async function editorResume() {
  await api('/api/resume', 'POST');
  setPlaybackUI('ed', 'playing');
  setStatus('Playing');
}

async function editorStop() {
  stopPolling();
  await api('/api/stop', 'POST');
  setPlaybackUI('ed', 'stopped');
  setStatus('Ready');
}

// ── Sight Read page ──
// Standalone nav page: pick a song from a picker list, then read-only chord
// chart with no editing affordances, current bar highlighted (and scrolled
// into view) in sync with playback — for reading/playing along rather than
// building the song. Independent of the Songs/Editor flow.

async function loadSightReadPicker() {
  document.getElementById('sightread-view').style.display = 'none';
  document.getElementById('sightread-picker').style.display = '';
  const songs = await api('/api/songs');
  const el = document.getElementById('sightread-song-list');
  if (!songs.length) {
    el.innerHTML = '<p class="empty-state">No songs yet — create one on the Songs page first.</p>';
    return;
  }
  el.innerHTML = songs.map(s => `
    <div class="song-card" onclick="openSightRead('${s.id}')">
      <div class="song-card-body">
        <div class="song-card-title">${htmlEsc(s.title)}</div>
        <div class="song-card-meta">${htmlEsc(s.key)} · ${htmlEsc(s.style)} · ${s.bpm} BPM &nbsp;·&nbsp; ${s.bars?.length||0} bars × ${s.loops||1}</div>
      </div>
    </div>
  `).join('');
}

async function openSightRead(id) {
  const song = await api(`/api/songs/${id}`);
  state.sightread.song = song;
  state.sightread.bars = song.bars;
  renderSightReadControls();
  renderSightReadChart();
  document.getElementById('sightread-picker').style.display = 'none';
  document.getElementById('sightread-view').style.display = '';
}

function backToSightReadPicker() {
  sightReadStop();
  loadSightReadPicker();
}

function renderSightReadControls() {
  const s = state.sightread.song;
  document.getElementById('sightread-controls').innerHTML = `
    <div class="page-back-row">
      <button class="btn btn-ghost btn-sm" onclick="backToSightReadPicker()">← Choose another song</button>
    </div>
    <div class="controls-bar">
      <div class="controls-row">
        <div class="field"><label>Title</label>
          <div class="sightread-readonly">${htmlEsc(s.title)}</div>
        </div>
        <div class="field"><label>Key</label>
          <div class="sightread-readonly">${htmlEsc(s.key)}</div>
        </div>
        <div class="field"><label>Style</label>
          <div class="sightread-readonly">${htmlEsc(state.styles.find(st => st.id === s.style)?.name || s.style)}</div>
        </div>
        <div class="field"><label>BPM</label>
          <input type="number" id="sightread-bpm" value="${s.bpm}" min="40" max="240"
            oninput="liveSetBpm(this.value)">
        </div>
      </div>
    </div>
  `;
}

// Deliberately not `renderChart()`: that renderer always attaches inline-edit,
// insert and delete affordances (chord toolbar, "+" cells, "×" buttons) meant
// for building a song. Sight reading is a read-only "just play along" view,
// so this renders the same chart-row/chart-bar markup (highlightBar's
// `.chart-bar` lookup and the shared CSS both work unmodified) without any
// of that editing UI.
function renderSightReadChart() {
  const containerEl = document.getElementById('sightread-chart');
  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap sightread-wrap';
  const bars = state.sightread.bars;
  const BARS_PER_ROW = state.prefs.bars_per_row || 4;
  const totalRows = Math.ceil(Math.max(bars.length, 1) / BARS_PER_ROW);

  for (let rowStart = 0; rowStart < totalRows * BARS_PER_ROW; rowStart += BARS_PER_ROW) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.style.gridTemplateColumns = `32px repeat(${BARS_PER_ROW}, 1fr)`;

    const tsig = document.createElement('div');
    tsig.className = 'chart-timesig';
    tsig.textContent = rowStart === 0 ? '4/4' : '';
    row.appendChild(tsig);

    for (let col = 0; col < BARS_PER_ROW; col++) {
      const barIdx = rowStart + col;
      const bar = bars[barIdx];
      const barEl = document.createElement('div');
      barEl.className = 'chart-bar';

      if (bar) {
        const numEl = document.createElement('div');
        numEl.className = 'bar-num';
        numEl.textContent = barIdx + 1;
        barEl.appendChild(numEl);

        const beatsEl = document.createElement('div');
        beatsEl.className = 'bar-beats';
        beatsForChords(bar.chords || []).forEach(chord => {
          const cell = document.createElement('div');
          cell.className = 'beat-cell sightread-cell';
          cell.style.flex = chord.beats;
          cell.innerHTML = `<span class="chord-name">${htmlEsc(chord.name)}</span>`;
          beatsEl.appendChild(cell);
        });
        barEl.appendChild(beatsEl);
      }
      row.appendChild(barEl);
    }
    wrap.appendChild(row);

    const hasContent = Array.from({length: BARS_PER_ROW}, (_, i) => bars[rowStart + i]).some(Boolean);
    if (!hasContent && rowStart > 0) {
      wrap.removeChild(row);
      break;
    }
  }

  containerEl.appendChild(wrap);
}

async function sightReadPlay() {
  const s = state.sightread.song;
  const bpm = parseInt(document.getElementById('sightread-bpm')?.value) || s.bpm;
  setPlaybackUI('sightread', 'playing');
  setStatus('Playing');
  try {
    await api('/api/play', 'POST', { ...s, bpm, bars: state.sightread.bars });
    startPolling('sightread');
  } catch(e) { setStatus('Error: ' + e.message); sightReadStop(); }
}

async function sightReadPause()  { await api('/api/pause',  'POST'); setPlaybackUI('sightread', 'paused');  setStatus('Paused'); }
async function sightReadResume() { await api('/api/resume', 'POST'); setPlaybackUI('sightread', 'playing'); setStatus('Playing'); }
async function sightReadStop() {
  stopPolling();
  await api('/api/stop', 'POST');
  setPlaybackUI('sightread', 'stopped');
  setStatus('Ready');
}

// ── Preferences page ──

async function renderPrefsForm() {
  const [p, soundfonts] = await Promise.all([api('/api/prefs'), api('/api/soundfonts')]);
  const sfOptions = soundfonts.map(f => {
    const name = f.split('/').pop();
    return `<option value="${f}" ${f===p.soundfont_path?'selected':''}>${name}</option>`;
  }).join('');

  document.getElementById('prefs-form').innerHTML = `
    <div class="prefs-form">
      <div class="field">
        <label>Bars per row</label>
        <select id="pref-bars-per-row">
          <option value="2" ${p.bars_per_row==2?'selected':''}>2</option>
          <option value="4" ${p.bars_per_row==4?'selected':''}>4</option>
          <option value="8" ${p.bars_per_row==8?'selected':''}>8</option>
        </select>
      </div>
      <div class="field">
        <label>SoundFont</label>
        <select id="pref-sf" style="flex:1" onchange="applyPrefs()">${sfOptions}</select>
      </div>
      <div class="field">
        <label>Songs directory</label>
        <input type="text" id="pref-songs-dir" value="${p.songs_dir}" style="flex:1">
      </div>
      <div>
        <button class="btn btn-primary" onclick="savePrefs()">Save</button>
        <span id="prefs-saved-msg" class="saved-msg">Saved</span>
      </div>
    </div>
  `;
}

async function applyPrefs() {
  // SoundFont change takes effect immediately on next play — no restart needed
  // because server.py reads prefs.load() dynamically on each /api/play call.
  await savePrefs();
}

async function savePrefs() {
  const sfEl = document.getElementById('pref-sf');
  const updates = {
    bars_per_row: parseInt(document.getElementById('pref-bars-per-row').value),
    soundfont_path: sfEl?.value || '',
    songs_dir: document.getElementById('pref-songs-dir').value.trim(),
  };
  await api('/api/prefs', 'PUT', updates);
  state.prefs = { ...state.prefs, ...updates };
  const msg = document.getElementById('prefs-saved-msg');
  if (msg) { msg.style.display = ''; setTimeout(() => msg.style.display = 'none', 1500); }
  document.getElementById('status-sf').textContent = updates.soundfont_path.split('/').pop();
  setStatus('Preferences saved');
  renderJamChart();
  if (state.editor.song) renderEditorChart();
}

// ── Start ──
init();
