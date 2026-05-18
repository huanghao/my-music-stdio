// ── Constants ──
const ALL_KEYS = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B',
                  'Am','Bm','Cm','Dm','Em','F#m','Gm'];

function keyOptions(selected) {
  return ALL_KEYS.map(k => `<option value="${k}" ${k===selected?'selected':''}>${k}</option>`).join('');
}

// ── State ──
const state = {
  styles: [],
  jam: { bars: [], bpm: 120, key: 'C', style: 'pop', loops: 1 },
  editor: { song: null, bars: [] },
  modal: { _onConfirm: null },
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

function renderChart(containerEl, bars, onChordClick, onChordCtx, onBarCtx, onAddBar, onDeleteChord) {
  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';

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
      if (chordsWithBeats.length === 0) {
        const cell = document.createElement('div');
        cell.className = 'beat-cell empty';
        cell.innerHTML = '<span class="chord-name">+</span>';
        cell.addEventListener('click', e => { e.stopPropagation(); onChordClick(barIdx, 0, true); });
        beatsEl.appendChild(cell);
      } else {
        chordsWithBeats.forEach((chord, ci) => {
          // ＋ insert-before button between chords
          if (ci > 0) {
            const ins = document.createElement('div');
            ins.className = 'beat-insert';
            ins.innerHTML = '<span>+</span>';
            ins.title = 'Insert chord here';
            ins.addEventListener('click', e => { e.stopPropagation(); onChordClick(barIdx, ci, true); });
            beatsEl.appendChild(ins);
          }
          const cell = document.createElement('div');
          cell.className = 'beat-cell';
          cell.style.flex = chord.beats;
          // chord name (click to edit) + × delete button
          cell.innerHTML = `
            <span class="chord-name" title="Click to edit">${chord.name}</span>
            <button class="chord-del" title="Delete">×</button>
          `;
          cell.querySelector('.chord-name').addEventListener('click', e => {
            e.stopPropagation(); onChordClick(barIdx, ci, false);
          });
          cell.querySelector('.chord-del').addEventListener('click', e => {
            e.stopPropagation();
            if (onDeleteChord) onDeleteChord(barIdx, ci);
          });
          cell.addEventListener('contextmenu', e => { e.preventDefault(); onChordCtx(e, barIdx, ci); });
          beatsEl.appendChild(cell);
        });
        // ＋ append-after button at end of bar
        const appendBtn = document.createElement('div');
        appendBtn.className = 'beat-insert beat-append';
        appendBtn.innerHTML = '<span>+</span>';
        appendBtn.title = 'Add chord';
        appendBtn.addEventListener('click', e => {
          e.stopPropagation(); onChordClick(barIdx, chordsWithBeats.length, true);
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
        <input type="number" id="jam-loops" value="1" min="1" max="20" oninput="updateJamDuration()">
        <span class="duration-hint" id="jam-duration">≈ 0:58 min</span>
      </div>
      <div class="divider"></div>
      <button class="btn btn-primary" id="jam-play-btn" onclick="jamPlay()">▶ Play</button>
      <button class="btn btn-stop" id="jam-stop-btn" style="display:none" onclick="jamStop()">■ Stop</button>
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
  const h = makeChordHandlers(() => state.jam.bars, () => { renderJamChart(); updateJamDuration(); });
  renderChart(document.getElementById('jam-chart'), state.jam.bars,
    h.onChordClick, h.onChordCtx, h.onBarCtx, h.onAddBar, h.onDeleteChord);
}

async function jamPlay() {
  state.jam.bpm = parseInt(document.getElementById('jam-bpm').value) || 120;
  state.jam.loops = parseInt(document.getElementById('jam-loops').value) || 1;
  state.jam.style = document.getElementById('jam-style').value;
  state.jam.key = document.getElementById('jam-key').value;
  document.getElementById('jam-play-btn').style.display = 'none';
  document.getElementById('jam-stop-btn').style.display = '';
  document.getElementById('jam-dot').className = 'gen-dot playing';
  document.getElementById('jam-label').textContent = 'Generating & playing…';
  setStatus('Playing');
  try {
    const r = await api('/api/play', 'POST', state.jam);
    document.getElementById('jam-path').textContent = r.file || '';
  } catch(e) {
    setStatus('Error: ' + e.message);
    jamStop();
  }
}

async function jamStop() {
  await api('/api/stop', 'POST');
  document.getElementById('jam-stop-btn').style.display = 'none';
  document.getElementById('jam-play-btn').style.display = '';
  document.getElementById('jam-dot').className = 'gen-dot draft';
  document.getElementById('jam-label').textContent = 'Stopped';
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
  const h = makeChordHandlers(() => state.editor.bars, () => { renderEditorChart(); updateEditorDuration(); });
  renderChart(document.getElementById('editor-chart'), state.editor.bars,
    h.onChordClick, h.onChordCtx, h.onBarCtx, h.onAddBar, h.onDeleteChord);
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
  document.getElementById('ed-play-btn').style.display = 'none';
  document.getElementById('ed-stop-btn').style.display = '';
  document.getElementById('editor-dot').className = 'gen-dot playing';
  document.getElementById('editor-label').textContent = 'Generating & playing…';
  setStatus('Playing');
  try {
    await api('/api/play', 'POST', { ...s, bars: state.editor.bars });
    state.editor.song.generated = true;
    renderEditorGenStatus();
  } catch(e) { setStatus('Error: ' + e.message); editorStop(); }
}

async function editorStop() {
  await api('/api/stop', 'POST');
  document.getElementById('ed-stop-btn').style.display = 'none';
  document.getElementById('ed-play-btn').style.display = '';
  renderEditorGenStatus();
  setStatus('Ready');
}

// ── Preferences page ──

async function renderPrefsForm() {
  const p = await api('/api/prefs');
  document.getElementById('prefs-form').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;max-width:480px;">
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">Bars per row</label>
        <select id="pref-bars-per-row">
          <option value="2" ${p.bars_per_row==2?'selected':''}>2</option>
          <option value="4" ${p.bars_per_row==4?'selected':''}>4</option>
          <option value="8" ${p.bars_per_row==8?'selected':''}>8</option>
        </select>
      </div>
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">SoundFont path</label>
        <input type="text" id="pref-sf" value="${p.soundfont_path}" style="flex:1">
      </div>
      <div class="field" style="gap:12px;">
        <label style="width:160px;font-size:13px;color:#555;">Songs directory</label>
        <input type="text" id="pref-songs-dir" value="${p.songs_dir}" style="flex:1">
      </div>
      <div>
        <button class="btn btn-primary" onclick="savePrefs()">Save Preferences</button>
      </div>
    </div>
  `;
}

async function savePrefs() {
  const updates = {
    bars_per_row: parseInt(document.getElementById('pref-bars-per-row').value),
    soundfont_path: document.getElementById('pref-sf').value.trim(),
    songs_dir: document.getElementById('pref-songs-dir').value.trim(),
  };
  await api('/api/prefs', 'PUT', updates);
  setStatus('Preferences saved');
  document.getElementById('status-sf').textContent = updates.soundfont_path.split('/').pop();
}

// ── Start ──
init();
