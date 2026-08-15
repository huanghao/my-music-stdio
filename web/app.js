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

// Vamp/Jam play server-side via fluidsynth (src/player.py), not through the
// browser's Web Audio graph, so the shared master-volume slider (fbMasterGain,
// fretboard.js) can't reach it through gain nodes like the other pages do —
// push live changes to the backend instead, which applies them as MIDI CC7.
function vampJamApplyVolumeChange(e) {
  api('/api/volume', 'PUT', { volume: e.detail.gain }).catch(() => {});
}

// ── Init ──
const CURRENT_PAGE_KEY = 'mps_current_page';
const NAV_PAGES = ['vamp', 'jam', 'licks', 'fretboard', 'chordmatch', 'speed', 'songloop', 'progressions', 'prefs'];

async function init() {
  transportLoadPos();  // restore the floating pill's last position before anything registers a transport
  initTransportDrag();
  transportApplyPos(); // the panel is visible from the start now (it hosts the always-on practice timer)
  fbRenderDeviceBar(); // global mic/speaker pickers — no server dependency, so this works even if the backend is down
  document.addEventListener('fb-master-volume-change', vampJamApplyVolumeChange);
  ptInit();            // practice timer — page-independent, always available
  agentInit();         // floating agent assistant — page-independent, always available
  await pingServer();
  setTimeout(_pingLoop, _pingDelay());
  if (_connOk) await loadApp();
  // Prefer a route already in the URL (a deep link, or a refresh after
  // navigateTo already wrote one) over the old "last page" breadcrumb —
  // falls back to that breadcrumb only for a plain reload with no hash yet
  // (e.g. upgrading from before this routing existed). Either way this is a
  // *restore*, not a new navigation, so it replaces the initial history
  // entry instead of pushing on top of it.
  const savedPage = localStorage.getItem(CURRENT_PAGE_KEY);
  const initialRoute = location.hash
    ? navParseHash(location.hash)
    : (savedPage && NAV_PAGES.includes(savedPage) && savedPage !== 'vamp') ? { page: savedPage } : { page: 'vamp' };
  history.replaceState(initialRoute, '', navHashFor(initialRoute));
  if (initialRoute.page === 'vamp' && !initialRoute.lickId) {
    updateTransportForPage('vamp'); // default page skips showPage — register its transport directly
  } else {
    navApplyRoute(initialRoute);
  }
}

// Stop polling when the tab is hidden; resume when it becomes visible again.
const _PAGE_PREFIX_MAP = {
  'page-vamp': 'vamp', 'page-jam': 'jam',
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

// ── URL-based navigation (Back/Forward) ─────────────────────────────────
// showPage() below only ever toggled DOM classes + a localStorage "last
// page" breadcrumb — the URL never changed, so there was nothing for the
// browser's Back/Forward to act on, and a cross-feature jump (e.g. a Lick's
// "Practice with Song Loop" button) left no trace of where you came from.
//
// navigateTo() is the fix: a single choke point for anything that should be
// Back-able — both top-level page switches and deep jumps into a specific
// sub-view (a Lick's detail page, a loaded Song Loop track). Every call
// pushes one history entry; Back/Forward re-runs the *same* restore logic
// (navApplyRoute) via the popstate listener below, not a separate "what
// does Back do" code path — that symmetry is what makes it actually
// correct instead of "go to the page, but reset its state".
//
// URL shape (hash-based — no server routing changes, works with the
// existing single-page index.html):
//   #/<page>                                  top-level page, e.g. #/fretboard
//   #/licks/<lickId>                          a Lick's detail/practice view
//   #/licks/<lickId>/edit                     that Lick's full-page notes editor
//   #/songloop?url=<enc>&label=<enc>          a loaded Song Loop track

function navHashFor(route) {
  if (route.lickId) {
    return `#/licks/${encodeURIComponent(route.lickId)}${route.lickEdit ? '/edit' : ''}`;
  }
  if (route.page === 'songloop' && route.songUrl) {
    const params = new URLSearchParams({ url: route.songUrl });
    if (route.songLabel) params.set('label', route.songLabel);
    return `#/songloop?${params.toString()}`;
  }
  return `#/${route.page}`;
}

function navParseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const route = { page: segments[0] || 'vamp' };
  if (route.page === 'licks' && segments[1]) route.lickId = decodeURIComponent(segments[1]);
  if (route.lickId && segments[2] === 'edit') route.lickEdit = true;
  if (route.page === 'songloop' && queryPart) {
    const params = new URLSearchParams(queryPart);
    if (params.has('url')) route.songUrl = params.get('url');
    if (params.has('label')) route.songLabel = params.get('label');
  }
  return route;
}

// Actually performs the page switch / deep-link restore for `route` — shared
// by navigateTo (new navigation), the popstate listener (Back/Forward), and
// init() (restoring on a fresh load/refresh). Returns whatever the
// underlying async call returns, so callers that need to sequence work
// after the navigation (e.g. newLick() opening the edit modal right after)
// can await it.
function navApplyRoute(route) {
  if (route.lickId) {
    if (route.lickEdit) {
      return typeof openLickEditor === 'function' ? openLickEditor(route.lickId) : undefined;
    }
    return typeof practiceLick === 'function' ? practiceLick(route.lickId) : undefined;
  }
  showPage(route.page);
  if (route.page === 'songloop' && route.songUrl && typeof slLoadFromUrl === 'function') {
    return slLoadFromUrl(route.songUrl, route.songLabel || undefined).catch((e) => {
      if (typeof setStatus === 'function') setStatus('Error loading track: ' + e.message);
    });
  }
}

function navigateTo(route) {
  history.pushState(route, '', navHashFor(route));
  return navApplyRoute(route);
}

// Convenience wrappers for the common cases — keeps HTML onclick attributes
// and call sites reading the same as the plain showPage()/practiceLick()
// calls they replace.
function navGoToPage(page) { return navigateTo({ page }); }
function navOpenLick(lickId) { return navigateTo({ page: 'licks', lickId }); }
function navOpenLickEdit(lickId) { return navigateTo({ page: 'licks', lickId, lickEdit: true }); }

window.addEventListener('popstate', (e) => {
  navApplyRoute(e.state || navParseHash(location.hash));
});

// ── Page nav ──
function showPage(name) {
  // Fretboard and Chord Match are separate pages that both drive the same
  // shared mic (fbMic) — release it when leaving whichever one currently
  // owns it, regardless of which of the two we're navigating away from.
  const leavingMicPage = (name !== 'fretboard' && document.getElementById('page-fretboard')?.classList.contains('active'))
    || (name !== 'chordmatch' && document.getElementById('page-chordmatch')?.classList.contains('active'));
  if (leavingMicPage) fbLeavePage();
  // The metronome panel (#st-panel) can currently be hosted on either the
  // standalone Speed Trainer page or embedded in an actively-practiced
  // Lick's detail page (see licksSyncPracticePanelHome) — stop it when
  // leaving whichever one is currently hosting it. The lick editor page
  // counts as a host too: it's a side-trip from the detail page, not the end
  // of practice (editing notes must not stop the metronome or auto-log the
  // session), so it's exempt as a *destination* alongside 'speed' — but
  // leaving the editor for anywhere else still ends practice here.
  const leavingSpeedPanel = document.getElementById('page-speed')?.classList.contains('active')
    || (document.getElementById('page-lick-detail')?.classList.contains('active')
        && typeof licksState !== 'undefined' && licksState.activeLick)
    || (document.getElementById('page-lick-edit')?.classList.contains('active')
        && typeof licksState !== 'undefined' && licksState.activeLick);
  if (name !== 'speed' && name !== 'lick-edit' && leavingSpeedPanel) {
    stStop();
    // Navigating away (to anywhere but the standalone Speed Trainer page,
    // which keeps hosting the same practice — see licksSyncPracticePanelHome)
    // is the "I'm done" signal now that there's no manual Stop button:
    // auto-log and clear the active lick with zero clicks required.
    if (typeof licksState !== 'undefined' && licksState.activeLick && typeof licksEndPractice === 'function') {
      licksEndPractice();
    }
  }
  // The lick notes' inline audio players live inside the lick detail /
  // editor pages; leaving either one without stopping them would leave
  // audio playing with no visible controls (page re-renders stop them
  // separately, at the point their DOM is rebuilt — see licksAudioStopAll).
  const leavingLickAudioPage = (name !== 'lick-detail' && document.getElementById('page-lick-detail')?.classList.contains('active'))
    || (name !== 'lick-edit' && document.getElementById('page-lick-edit')?.classList.contains('active'));
  if (leavingLickAudioPage && typeof licksAudioStopAll === 'function') licksAudioStopAll();
  localStorage.setItem(CURRENT_PAGE_KEY, name);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });
  if (name === 'licks')     loadLicks();
  if (name === 'prefs')     { renderPrefsForm(); fbRenderSoundVolumePrefs(); initMaterialsPrefsSection(); }
  if (name === 'fretboard') initFretboardPage();
  if (name === 'chordmatch') initChordMatchPage();
  if (name === 'speed')     { initSpeedPage(); renderActiveLickBanner(); }
  if (name === 'songloop')  initSongLoopPage();
  if (name === 'progressions') initProgressionLabPage();
  if (name === 'keydrill') initKeyDrillPage();
  // Move the metronome panel back to its standalone-page home if it was
  // embedded in a Lick detail page we're now navigating away from.
  if (typeof licksSyncPracticePanelHome === 'function') licksSyncPracticePanelHome();
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

function openModal(title, initialValue, onConfirm, showChordSuggestions = true) {
  state.modal._onConfirm = onConfirm;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-input').value = initialValue;
  const sugg = document.getElementById('modal-suggestions');
  sugg.innerHTML = showChordSuggestions ? COMMON_CHORDS.map(c =>
    `<span class="suggestion" onclick="document.getElementById('modal-input').value='${c}'">${c}</span>`
  ).join('') : '';
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
          <input type="number" id="vamp-loops" value="${state.vamp.loops}" min="1" max="999" style="width:60px"
            oninput="state.vamp.loops=parseInt(this.value)||1; syncFromLoops('vamp'); saveLastSelection()">
        </div>
        <div class="field"><label>Duration</label>
          <input type="number" id="vamp-dur-min" value="5.0" min="0.5" max="120" step="0.5" style="width:68px"
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
    fill_every: 8, volume: fbMasterGain(),
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
          <input type="number" id="jam-loops" value="${state.jam.loops}" min="1" max="99" style="width:60px"
            oninput="state.jam.loops=parseInt(this.value)||1; syncFromLoops('jam'); saveLastSelection()">
        </div>
        <div class="field"><label>Duration</label>
          <input type="number" id="jam-dur-min" value="3.0" min="0.5" max="120" step="0.5" style="width:68px"
            oninput="syncFromDuration('jam'); state.jam.loops=getLoops('jam'); saveLastSelection()">
          <span class="duration-hint">min</span>
        </div>
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
  const bpmId = { jam: 'jam-bpm', vamp: 'vamp-bpm' }[prefix] || `${prefix}-bpm`;
  const bpm = parseInt(document.getElementById(bpmId)?.value) || 120;
  let bars;
  if (prefix === 'vamp') bars = 1;
  else bars = state.jam.bars.length;
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
const TRANSPORT_POS_KEY = 'transport_pos';
let _transportPos = null;       // { x, y } persisted pill position, or null = default spot

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
  const bodyEl = document.getElementById('transport-body');
  if (!bodyEl) return;
  // The panel itself is always visible now (it also hosts the practice
  // timer, which works on every page) — an unregistered transport just
  // means this row renders empty, not that the whole pill hides.
  if (!_transport) { bodyEl.innerHTML = ''; return; }
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
  bodyEl.innerHTML = `${label}<span class="transport-actions">${btns}</span>`;
  transportApplyPos(); // content width just changed — re-clamp so it can't drift off-screen
}

// ── Floating pill: position persistence + drag ────────────────────────────
function transportLoadPos() {
  try {
    const s = JSON.parse(localStorage.getItem(TRANSPORT_POS_KEY));
    if (s && Number.isFinite(s.x) && Number.isFinite(s.y)) _transportPos = s;
  } catch (_) { _transportPos = null; }
}
function transportApplyPos() {
  const pill = document.getElementById('transport-pill');
  if (!pill) return;
  const w = pill.offsetWidth || 220, h = pill.offsetHeight || 44;
  let x, y;
  if (_transportPos) { x = _transportPos.x; y = _transportPos.y; }
  // Default: bottom-right corner. The panel is always visible now (it hosts
  // the practice timer even on pages with no registered transport), so it
  // needs a default spot unlikely to collide with a page's own top-right
  // header buttons (e.g. Licks/Songs' "+ New …") — bottom-right is where the
  // standalone practice timer used to live, with no such conflicts observed.
  else { x = window.innerWidth - w - 24; y = window.innerHeight - h - 24; }
  x = Math.max(4, Math.min(window.innerWidth  - w - 4, x));
  y = Math.max(4, Math.min(window.innerHeight - h - 4, y));
  pill.style.left = x + 'px'; pill.style.top = y + 'px';
  pill.style.right = 'auto'; pill.style.bottom = 'auto';
}
function initTransportDrag() {
  const pill = document.getElementById('transport-pill');
  if (!pill) return;
  // The whole pill is a drag surface (grip + label + padding, across both
  // rows) — only actual buttons are excluded, so clicks on Play/Stop/preset
  // buttons still register instead of starting a drag.
  const onButtons = e => e.target.closest('button');
  let sx, sy, ox, oy, dragging = false;
  pill.addEventListener('pointerdown', e => {
    if (onButtons(e)) return;
    dragging = true; pill.classList.add('dragging');
    const r = pill.getBoundingClientRect();
    ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
    pill.setPointerCapture(e.pointerId); e.preventDefault();
  });
  pill.addEventListener('pointermove', e => {
    if (!dragging) return;
    let x = ox + (e.clientX - sx), y = oy + (e.clientY - sy);
    x = Math.max(4, Math.min(window.innerWidth  - pill.offsetWidth  - 4, x));
    y = Math.max(4, Math.min(window.innerHeight - pill.offsetHeight - 4, y));
    pill.style.left = x + 'px'; pill.style.top = y + 'px'; pill.style.right = 'auto'; pill.style.bottom = 'auto';
  });
  pill.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false; pill.classList.remove('dragging');
    _transportPos = { x: parseInt(pill.style.left), y: parseInt(pill.style.top) };
    localStorage.setItem(TRANSPORT_POS_KEY, JSON.stringify(_transportPos));
  });
  pill.addEventListener('dblclick', e => { // reset to the default spot
    if (onButtons(e)) return;
    _transportPos = null; localStorage.removeItem(TRANSPORT_POS_KEY); transportApplyPos();
  });
  // keep it on-screen if the window shrinks — the panel is always visible now
  window.addEventListener('resize', () => transportApplyPos());
}
function transportPlay()   { _transport?.play?.(); }
function transportStop()   { _transport?.stop?.(); }
function transportPause()  { _transport?.pause?.(); }
function transportResume() { _transport?.resume?.(); }
// Debounce the start action — a mic Start Listening is async, so a fast double
// click could otherwise fire two starts before the bar re-renders to Stop.
transportPlay = guarded(transportPlay);

function updateTransportForPage(name) {
  switch (name) {
    case 'vamp':      registerTransport({ kind: 'playback', label: 'Vamp',          play: vampPlay,      stop: vampStop,      pause: vampPause,      resume: vampResume }); break;
    case 'jam':       registerTransport({ kind: 'playback', label: 'Jam',           play: jamPlay,       stop: jamStop,       pause: jamPause,       resume: jamResume }); break;
    case 'speed':     registerTransport({ kind: 'playback', label: 'Speed Trainer', play: stStart,       stop: stStop }); break;
    case 'songloop':  registerTransport({ kind: 'playback', label: 'Song Loop',     play: slPlay,        stop: slStop,        pause: slPause,        resume: slPlay }); break;
    case 'fretboard':   fbRenderControlAction(); break; // fretboard registers per active sub-mode
    case 'chordmatch':  fbRenderControlAction(); break;
    case 'lick-edit':
      // Editing the lick currently being practiced keeps the Speed Trainer
      // transport (the metronome may still be running — side-trip exemption,
      // see licksSyncPracticePanelHome); editing anything else clears it.
      if (typeof licksState !== 'undefined' && licksState.activeLick && licksState.editor
          && licksState.activeLick.id === licksState.editor.id) {
        registerTransport({ kind: 'playback', label: 'Speed Trainer', play: stStart, stop: stStop });
        setTransportState(stState.running ? 'playing' : 'stopped');
      } else {
        clearTransport();
      }
      break;
    default:            clearTransport();
  }
}

function setPlaybackUI(prefix, state_) {
  // The transport buttons themselves now live in the shared bottom bar; mirror
  // the state to it (this prefix is always the active page's, hence the active
  // transport).
  setTransportState(state_);

  // playback panel state
  const panel = document.getElementById(`${prefix}-playback`);
  const stateEl = document.getElementById(`${prefix}-state`);
  if (panel) panel.className = 'playback-panel' + (state_ === 'playing' ? ' playing' : '');
  if (stateEl) { stateEl.textContent = state_; stateEl.className = 'playback-state ' + state_; }

  if (state_ === 'stopped') {
    const elapsed = document.getElementById(`${prefix}-elapsed`);
    const loopVal = document.getElementById(`${prefix}-loop-val`);
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
  const panelPrefix = prefix;
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
    await api('/api/play', 'POST', { ...state.jam, fill_every: 8, volume: fbMasterGain() });
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
        <label>Accompaniments directory</label>
        <input type="text" id="pref-accompaniments-dir" value="${p.accompaniments_dir}" style="flex:1">
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
    accompaniments_dir: document.getElementById('pref-accompaniments-dir').value.trim(),
  };
  await api('/api/prefs', 'PUT', updates);
  state.prefs = { ...state.prefs, ...updates };
  const msg = document.getElementById('prefs-saved-msg');
  if (msg) { msg.style.display = ''; setTimeout(() => msg.style.display = 'none', 1500); }
  document.getElementById('status-sf').textContent = updates.soundfont_path.split('/').pop();
  setStatus('Preferences saved');
  renderJamChart();
}

// ── Start ──
init();
