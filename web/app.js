// ── Constants ──
const ALL_KEYS = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B',
                  'Am','Bm','Cm','Dm','Em','F#m','Gm'];

function keyOptions(selected) {
  return ALL_KEYS.map(k => `<option value="${k}" ${k===selected?'selected':''}>${k}</option>`).join('');
}

// ── State ──
const state = {
  styles: [],
  jam: { bars: [], bpm: 120, key: 'C', style: 'pop', loops: 3 },
  editor: { song: null, bars: [] },
  modal: { _onConfirm: null },
  playback: { polling: null },  // polling interval id
};

// ── Init ──
async function init() {
  state.styles = await api('/api/styles');
  renderJamControls();
  renderPrefsForm();
  applyStyle('pop', 'jam');
  const p = await api('/api/prefs');
  const sf = p.soundfont_path || '';
  document.getElementById('status-sf').textContent = sf.split('/').pop();
}

// ── Page nav ──
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  if (name === 'songs') loadSongs();
  if (name === 'prefs') renderPrefsForm();
}

// ── API helper ──
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
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

  const BARS_PER_ROW = 4;
  const totalRows = Math.ceil(Math.max(bars.length, 1) / BARS_PER_ROW);

  for (let rowStart = 0; rowStart < totalRows * BARS_PER_ROW; rowStart += BARS_PER_ROW) {
    const row = document.createElement('div');
    row.className = 'chart-row';

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
            <span class="chord-name">${chord.name}</span>
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

// ── Jam page ──

function renderJamControls() {
  const el = document.getElementById('jam-controls');
  el.innerHTML = `
    <div class="controls-bar">
      <div class="field">
        <label>Style</label>
        <select id="jam-style" onchange="applyStyle(this.value,'jam')">
          ${state.styles.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Key</label>
        <select id="jam-key">${keyOptions(state.jam.key)}</select>
      </div>
      <div class="field">
        <label>BPM</label>
        <input type="number" id="jam-bpm" value="120" min="40" max="240" oninput="updateJamDuration()">
      </div>
      <div class="field">
        <label>Loops</label>
        <input type="number" id="jam-loops" value="3" min="1" max="20" oninput="updateJamDuration()">
        <span class="duration-hint" id="jam-duration">≈ 0:58 min</span>
      </div>
      <div class="divider"></div>
      <button class="btn btn-primary" id="jam-play-btn" onclick="jamPlay()">▶ Play</button>
      <button class="btn btn-stop" id="jam-stop-btn" style="display:none" onclick="jamStop()">■ Stop</button>
      <button class="btn btn-ghost" id="jam-pause-btn" style="display:none" onclick="jamPause()">⏸ Pause</button>
      <button class="btn btn-ghost" id="jam-resume-btn" style="display:none" onclick="jamResume()">▶ Resume</button>
      <button class="btn btn-ghost" onclick="jamSaveAs()">Save as Song…</button>
    </div>
  `;
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
  }
}

function updateJamDuration() {
  const bpm = parseInt(document.getElementById('jam-bpm')?.value) || 120;
  const loops = parseInt(document.getElementById('jam-loops')?.value) || 1;
  const bars = state.jam.bars.length;
  const sec = Math.round(bars * loops * 4 * 60 / bpm);
  const el = document.getElementById('jam-duration');
  if (el) el.textContent = `≈ ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} min`;
}

function renderJamChart() {
  const rerender = () => { renderJamChart(); updateJamDuration(); };
  const h = makeChordHandlers(() => state.jam.bars, rerender);
  renderChart(document.getElementById('jam-chart'), state.jam.bars,
    h.onChordClick, h.onChordCtx, h.onBarCtx, h.onAddBar, h.onDeleteChord, rerender);
}

function setPlaybackUI(prefix, state_) {
  const play    = document.getElementById(`${prefix}-play-btn`);
  const stop    = document.getElementById(`${prefix}-stop-btn`);
  const pause   = document.getElementById(`${prefix}-pause-btn`);
  const resume  = document.getElementById(`${prefix}-resume-btn`);
  if (!play) return;
  play.style.display   = state_ === 'stopped' ? '' : 'none';
  stop.style.display   = state_ !== 'stopped' ? '' : 'none';
  pause.style.display  = state_ === 'playing'  ? '' : 'none';
  resume.style.display = state_ === 'paused'   ? '' : 'none';
}

function fmt(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}

function startPolling(dotId, labelId) {
  stopPolling();
  state.playback.polling = setInterval(async () => {
    try {
      const s = await api('/api/status');
      if (!s.playing) {
        // playback finished naturally
        stopPolling();
        const dot = document.getElementById(dotId);
        const label = document.getElementById(labelId);
        if (dot) dot.className = 'gen-dot ready';
        if (label) label.textContent = 'Done';
        // figure out which prefix is active and reset buttons
        const prefix = dotId.startsWith('jam') ? 'jam' : 'ed';
        setPlaybackUI(prefix, 'stopped');
        setStatus('Ready');
        return;
      }
      const dot = document.getElementById(dotId);
      const label = document.getElementById(labelId);
      if (!dot || !label) return;
      if (s.paused) {
        dot.className = 'gen-dot draft';
        label.textContent = 'Paused';
        return;
      }
      dot.className = 'gen-dot playing';
      if (s.duration_sec) {
        const pct = Math.min(100, Math.round(s.elapsed_sec / s.duration_sec * 100));
        label.textContent = `Loop ${s.current_loop}/${s.loops}  ${fmt(s.elapsed_sec)} / ${fmt(s.duration_sec)}  (${pct}%)`;
      }
    } catch(_) {}
  }, 500);
}

function stopPolling() {
  if (state.playback.polling) {
    clearInterval(state.playback.polling);
    state.playback.polling = null;
  }
}

async function jamPlay() {
  state.jam.bpm = parseInt(document.getElementById('jam-bpm').value) || 120;
  state.jam.loops = parseInt(document.getElementById('jam-loops').value) || 3;
  state.jam.style = document.getElementById('jam-style').value;
  state.jam.key = document.getElementById('jam-key').value;
  setPlaybackUI('jam', 'playing');
  document.getElementById('jam-dot').className = 'gen-dot playing';
  document.getElementById('jam-label').textContent = 'Generating…';
  setStatus('Playing');
  try {
    const r = await api('/api/play', 'POST', state.jam);
    document.getElementById('jam-path').textContent = r.file || '';
    document.getElementById('jam-label').textContent = `Loop 1/${r.loops}  0:00 / ${fmt(r.duration_sec)}`;
    startPolling('jam-dot', 'jam-label');
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
  document.getElementById('jam-dot').className = 'gen-dot draft';
  document.getElementById('jam-label').textContent = 'Stopped';
  document.getElementById('jam-path').textContent = '';
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
    el.innerHTML = '<p style="color:#aaa;font-size:13px;padding:20px 0">No songs yet. Create one!</p>';
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
          <div class="song-card-title">${s.title}</div>
          <div class="song-card-meta">${s.key} · ${s.style} · ${s.bpm} BPM &nbsp;·&nbsp; ${s.bars?.length||0} bars × ${s.loops||1} = ${dur} &nbsp;·&nbsp; ${ago}</div>
        </div>
        <span class="song-status ${s.generated ? 'ready' : 'draft'}">${s.generated ? 'Generated' : 'Draft'}</span>
        <div class="song-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="duplicateSong(event,'${s.id}')">Duplicate</button>
          <button class="btn btn-ghost btn-sm" style="color:#c04040" onclick="deleteSong(event,'${s.id}')">×</button>
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
}

function renderEditorControls() {
  const s = state.editor.song;
  document.getElementById('editor-controls').innerHTML = `
    <div style="margin-bottom:10px;">
      <button class="btn btn-ghost btn-sm" onclick="showPage('songs')">← Songs</button>
    </div>
    <div class="controls-bar">
      <div class="field">
        <label>Title</label>
        <input type="text" id="ed-title" value="${s.title}" style="width:160px">
      </div>
      <div class="field">
        <label>Key</label>
        <select id="ed-key">${keyOptions(s.key)}</select>
      </div>
      <div class="field">
        <label>BPM</label>
        <input type="number" id="ed-bpm" value="${s.bpm}" min="40" max="240" oninput="updateEditorDuration()">
      </div>
      <div class="field">
        <label>Style</label>
        <select id="ed-style">
          ${state.styles.map(st => `<option value="${st.id}" ${st.id===s.style?'selected':''}>${st.name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>Loops</label>
        <input type="number" id="ed-loops" value="${s.loops}" min="1" max="20" oninput="updateEditorDuration()">
        <span class="duration-hint" id="ed-duration"></span>
      </div>
      <div class="divider"></div>
      <button class="btn btn-primary" id="ed-play-btn" onclick="editorPlay()">▶ Generate &amp; Play</button>
      <button class="btn btn-stop" id="ed-stop-btn" style="display:none" onclick="editorStop()">■ Stop</button>
      <button class="btn btn-ghost" id="ed-pause-btn" style="display:none" onclick="editorPause()">⏸ Pause</button>
      <button class="btn btn-ghost" id="ed-resume-btn" style="display:none" onclick="editorResume()">▶ Resume</button>
      <button class="btn btn-ghost" onclick="saveSong()">Save</button>
    </div>
  `;
  updateEditorDuration();
}

function updateEditorDuration() {
  const bpm = parseInt(document.getElementById('ed-bpm')?.value) || 120;
  const loops = parseInt(document.getElementById('ed-loops')?.value) || 1;
  const bars = state.editor.bars.length;
  const sec = Math.round(bars * loops * 4 * 60 / bpm);
  const el = document.getElementById('ed-duration');
  if (el) el.textContent = `≈ ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')} min`;
}

function renderEditorGenStatus() {
  const s = state.editor.song;
  const dot = document.getElementById('editor-dot');
  const label = document.getElementById('editor-label');
  const path = document.getElementById('editor-path');
  if (s.generated) {
    dot.className = 'gen-dot ready';
    label.textContent = 'MIDI ready';
  } else {
    dot.className = 'gen-dot draft';
    label.textContent = 'Not generated yet';
  }
  path.textContent = `~/music-practice/songs/${s.id}/accompaniment.mid`;
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
    loops: parseInt(document.getElementById('ed-loops').value),
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
  document.getElementById('editor-dot').className = 'gen-dot playing';
  document.getElementById('editor-label').textContent = 'Generating…';
  setStatus('Playing');
  try {
    const r = await api('/api/play', 'POST', { ...s, bars: state.editor.bars });
    state.editor.song.generated = true;
    document.getElementById('editor-label').textContent = `Loop 1/${r.loops}  0:00 / ${fmt(r.duration_sec)}`;
    document.getElementById('editor-path').textContent = r.file || '';
    startPolling('editor-dot', 'editor-label');
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
  renderEditorGenStatus();
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
    <div style="display:flex;flex-direction:column;gap:16px;max-width:520px;">
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">Bars per row</label>
        <select id="pref-bars-per-row">
          <option value="2" ${p.bars_per_row==2?'selected':''}>2</option>
          <option value="4" ${p.bars_per_row==4?'selected':''}>4</option>
          <option value="8" ${p.bars_per_row==8?'selected':''}>8</option>
        </select>
      </div>
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">SoundFont</label>
        <select id="pref-sf" style="flex:1" onchange="applyPrefs()">${sfOptions}</select>
      </div>
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">Songs directory</label>
        <input type="text" id="pref-songs-dir" value="${p.songs_dir}" style="flex:1">
      </div>
      <div>
        <button class="btn btn-primary" onclick="savePrefs()">Save</button>
        <span id="prefs-saved-msg" style="font-size:12px;color:#7a9a7a;margin-left:10px;display:none">Saved</span>
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
  const msg = document.getElementById('prefs-saved-msg');
  if (msg) { msg.style.display = ''; setTimeout(() => msg.style.display = 'none', 1500); }
  document.getElementById('status-sf').textContent = updates.soundfont_path.split('/').pop();
  setStatus('Preferences saved');
}

// ── Start ──
init();
