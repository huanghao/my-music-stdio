// ── Song Loop: practice a section of a real recorded backing track — set a
// BPM (tap-tempo or manual), a key label, an A-B bar-range loop, and slow
// playback down without pitch shift. Layout/visual design ported from
// design_handoff_guitar_practice_tool (single-file HTML mockup with a fixed
// 32-bar demo and simulated timer-driven playback); this implementation
// keeps that visual design but drives it with a real decoded audio file
// (real waveform peaks, real seek/loop/speed) instead of the mockup's fake
// data. Audio is decoded client-side via decodeAudioData for playback, but
// a locally dropped/picked file is also uploaded to the server's materials
// library (POST /api/materials, same endpoint Licks' material picker uses)
// so it gets a stable URL and can be auto-persisted like any other track —
// see the "per-URL state" block below.
//
// Known deliberate gap vs. a "real" tool, kept because the ported design
// itself only supports a single constant BPM for the whole song (no per-
// section tempo changes) and no auto key/BPM detection — same limitation
// the original handoff's own README calls out for its "移调" pitch control
// (UI-only, not wired to real audio, pending a phase-vocoder/WSOLA engine).

const SL_STORAGE_KEY = 'sl_prefs';
const SL_ZOOM_MIN = 40;
const SL_ZOOM_MAX = 280;

const SL_KEY_OPTIONS = ['C 大调', 'G 大调', 'D 大调', 'A 大调', 'E 大调', 'F 大调', 'Bb 大调', 'Am 小调', 'Em 小调', 'Dm 小调', 'Bm 小调', 'Gm 小调'];
const SL_INTERVAL_NAMES = ['原调', '小二度', '大二度', '小三度', '大三度', '纯四度', '三全音'];

const slState = {
  inited: false, // guards initSongLoopPage() — see the comment there

  // Single global BPM for the whole song — matches the ported design's own
  // model (no per-section tempo changes, no drift correction). beatsPerBar
  // is fixed at 4 (the design always shows "4/4") but kept as a variable
  // rather than a literal, in case a future revision exposes it.
  bpm: 96, bpmManual: false, beatsPerBar: 4,
  key: SL_KEY_OPTIONS[1], keyManual: false, // default 'G 大调', matching the handoff's demo state
  pitch: 0, // semitones, -6..6 — UI-only, does not change actual playback pitch (see file header)

  loopFromBar: 5, loopToBar: 8, loopOn: false,
  bar1TimeSec: 0,
  speed: 100, preservePitch: true,
  zoomPxPerBar: 140, // horizontal zoom of the bar grid; a viewing preference, not song-specific

  duration: 0, channelData: null, peaks: null, // peaks: cached real per-bar waveform amplitude, recomputed on load/resize

  tapTimes: [],    // transient — tap-tempo BPM estimation only (last 6 taps within 2.5s, matches ported design)
  annotations: {}, // { [barNumber]: { chord, lyric, note } } persisted only via explicit sidecar JSON
  phraseStarts: [1], selectedPhraseStartBar: 1,

  // Set once the current track has a stable materials-library URL: either
  // it was loaded via slLoadFromUrl (a Lick's backing track), or a locally
  // picked/dropped file finished uploading to /api/materials. Null only
  // while a local file's upload is still in flight (or failed). See the
  // per-URL state block below for what this unlocks.
  sourceUrl: null,

  els: {}, // DOM refs, populated in initSongLoopPage()
};

// ── persistence ──────────────────────────────────────────────────────────
// This is a rough starting point only — a last-used default that shows up
// before a track's own per-URL state (below) has loaded and overridden it.
// Every track-specific field (bpm/key/pitch/annotations/phrase markers/loop
// range/offset/speed) has its own per-URL persistence once the track has a
// materials-library URL — which, since local files now auto-upload on load,
// is effectively always once that upload succeeds.
function slPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SL_STORAGE_KEY)) || {}; } catch (_) {}
  if (Number.isFinite(saved.loopFromBar)) slState.loopFromBar = saved.loopFromBar;
  if (Number.isFinite(saved.loopToBar)) slState.loopToBar = saved.loopToBar;
  if (typeof saved.loopOn === 'boolean') slState.loopOn = saved.loopOn;
  if (Number.isFinite(saved.bar1TimeSec)) slState.bar1TimeSec = saved.bar1TimeSec;
  if (Number.isFinite(saved.speed)) slState.speed = saved.speed;
  if (typeof saved.preservePitch === 'boolean') slState.preservePitch = saved.preservePitch;
  if (Number.isFinite(saved.zoomPxPerBar)) slState.zoomPxPerBar = slClampZoom(saved.zoomPxPerBar);
}
function slPrefsSave() {
  localStorage.setItem(SL_STORAGE_KEY, JSON.stringify({
    loopFromBar: slState.loopFromBar, loopToBar: slState.loopToBar, loopOn: slState.loopOn,
    bar1TimeSec: slState.bar1TimeSec,
    speed: slState.speed, preservePitch: slState.preservePitch,
    zoomPxPerBar: slState.zoomPxPerBar,
  }));
}

// ── per-URL state (any track with a materials-library URL) ─────────────────
// This now lives server-side, at PUT/GET /api/materials/<id>/state — see
// scheduleUrlStateSave/pushUrlState/applySavedUrlStateIfAny inside
// initSongLoopPage() (they need updateSidecarHint/els, so they can't live at
// module scope like the rest of this file's pure logic). The localStorage
// key below is kept only as a one-time migration source for tracks saved
// before this moved server-side — see slReadLegacyUrlState.
const SL_URL_STATE_PREFIX = 'sl_url_state_';

function slUrlStateKey(url) { return SL_URL_STATE_PREFIX + url; }

function slReadLegacyUrlState(url) {
  try { return JSON.parse(localStorage.getItem(slUrlStateKey(url))) || null; }
  catch (_) { return null; }
}

// Called alongside every user-edit persistence point (see
// slSaveCurrentFileState call sites below). A no-op until initSongLoopPage()
// has wired up slState.scheduleUrlStateSave (or the current track has no
// materials-library url yet — e.g. a local file's upload is still in flight
// or failed).
function slPersistUrlStateIfApplicable() {
  if (slState.sourceUrl && typeof slState.scheduleUrlStateSave === 'function') {
    slState.scheduleUrlStateSave();
  }
}

// ── local-file upload dedupe (name+size -> materials-library url) ──────────
// A locally picked/dropped file has no server identity of its own, so on
// first load it gets uploaded to /api/materials and the resulting url is
// cached here — keyed by name+size, not content hash, which is good enough
// for a personal practice tool (a same-name-same-size-but-different-content
// collision just means that reload won't be recognized as "new"). Re-opening
// the same file next time reuses the cached url instead of uploading again.
const SL_LOCAL_UPLOAD_MAP_KEY = 'sl_local_upload_map';

function slLocalUploadKey(name, size) { return `${name}::${size}`; }

function slLoadLocalUploadMap() {
  try { return JSON.parse(localStorage.getItem(SL_LOCAL_UPLOAD_MAP_KEY)) || {}; }
  catch (_) { return {}; }
}

function slSaveLocalUploadMapEntry(key, url) {
  const map = slLoadLocalUploadMap();
  map[key] = url;
  localStorage.setItem(SL_LOCAL_UPLOAD_MAP_KEY, JSON.stringify(map));
}

function slBaseName(fileName) {
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  if (!name) return 'song-loop';
  return name.replace(/\.[^/.]+$/, '') || name;
}

function slSidecarFileName(fileName) {
  return `${slBaseName(fileName)}.songloop.json`;
}

function slNormalizePhraseStarts(arr) {
  const uniq = Array.from(new Set((Array.isArray(arr) ? arr : []).filter(n => Number.isInteger(n) && n >= 1)));
  uniq.sort((a, b) => a - b);
  return uniq.length > 0 ? uniq : [1];
}

function slNormalizeAnnotations(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([k, v]) => {
    const bar = parseInt(k, 10);
    if (!Number.isInteger(bar) || bar < 1 || !v || typeof v !== 'object') return;
    out[bar] = {
      chord: typeof v.chord === 'string' ? v.chord : '',
      lyric: typeof v.lyric === 'string' ? v.lyric : '',
      note: typeof v.note === 'string' ? v.note : '',
    };
  });
  return out;
}

function slSaveCurrentFileState() { slPersistUrlStateIfApplicable(); }

function slCaptureFileStatePayload() {
  return {
    version: 1,
    bar1TimeSec: slState.bar1TimeSec,
    bpm: slState.bpm,
    bpmManual: slState.bpmManual,
    key: slState.key,
    keyManual: slState.keyManual,
    pitch: slState.pitch,
    loopFromBar: slState.loopFromBar,
    loopToBar: slState.loopToBar,
    loopOn: slState.loopOn,
    phraseStarts: slState.phraseStarts,
    selectedPhraseStartBar: slState.selectedPhraseStartBar,
    annotations: slState.annotations,
  };
}

function slApplyFileStatePayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (Number.isFinite(payload.bar1TimeSec)) slState.bar1TimeSec = payload.bar1TimeSec;
  if (Number.isFinite(payload.bpm)) slState.bpm = payload.bpm;
  if (typeof payload.bpmManual === 'boolean') slState.bpmManual = payload.bpmManual;
  if (typeof payload.key === 'string') slState.key = payload.key;
  if (typeof payload.keyManual === 'boolean') slState.keyManual = payload.keyManual;
  if (Number.isFinite(payload.pitch)) slState.pitch = payload.pitch;
  if (Number.isFinite(payload.loopFromBar)) slState.loopFromBar = payload.loopFromBar;
  if (Number.isFinite(payload.loopToBar)) slState.loopToBar = payload.loopToBar;
  if (typeof payload.loopOn === 'boolean') slState.loopOn = payload.loopOn;
  slState.phraseStarts = slNormalizePhraseStarts(payload.phraseStarts);
  slState.selectedPhraseStartBar = Number.isInteger(payload.selectedPhraseStartBar)
    ? payload.selectedPhraseStartBar
    : slState.phraseStarts[0];
  if (!slState.phraseStarts.includes(slState.selectedPhraseStartBar)) {
    slState.selectedPhraseStartBar = slState.phraseStarts[0];
  }
  slState.annotations = slNormalizeAnnotations(payload.annotations);
}

function slBuildSidecarDocument(sourceFileName) {
  return {
    kind: 'my-music-songloop-sidecar',
    version: 1,
    sourceFileName: typeof sourceFileName === 'string' ? sourceFileName : '',
    savedAt: new Date().toISOString(),
    state: slCaptureFileStatePayload(),
  };
}

function slExtractSidecarState(rawDoc) {
  if (!rawDoc || typeof rawDoc !== 'object') return null;
  if (rawDoc.state && typeof rawDoc.state === 'object') return rawDoc.state;
  return rawDoc;
}

function slParseSidecarText(text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { return null; }
  return slExtractSidecarState(parsed);
}

// ── bar/time math (pure — no DOM) — single constant BPM, 1-based bars ────
function slSecPerBar() { return (60 / slState.bpm) * slState.beatsPerBar; }
function slTimeToBar(t) { return Math.floor((t - slState.bar1TimeSec) / slSecPerBar()) + 1; }
function slBarToTime(bar) { return slState.bar1TimeSec + (bar - 1) * slSecPerBar(); }
function slTotalBars() {
  return Math.max(1, Math.ceil((slState.duration - slState.bar1TimeSec) / slSecPerBar()));
}

// ── bar-grid zoom/scroll math (pure — no DOM) ─────────────────────────────
function slClampZoom(px) {
  return Math.max(SL_ZOOM_MIN, Math.min(SL_ZOOM_MAX, Math.round(px) || SL_ZOOM_MIN));
}
function slFitZoomPxPerBar(totalBars, containerWidth, labelWidth) {
  const bars = Math.max(1, totalBars);
  const available = Math.max(0, containerWidth - labelWidth);
  return slClampZoom(available / bars);
}
// Only recenter once the current bar's cell gets within marginRatio of either
// edge of the visible area — mirrors a DAW's "keep playhead roughly centered"
// follow behavior instead of scrollIntoView('nearest')'s edge-snap-every-bar.
function slShouldRecenter(cellLeft, cellRight, viewLeft, viewWidth, marginRatio = 0.15) {
  const margin = viewWidth * marginRatio;
  const viewRight = viewLeft + viewWidth;
  return cellLeft < viewLeft + margin || cellRight > viewRight - margin;
}
function slCenterScrollLeft(cellLeft, cellWidth, viewWidth) {
  return Math.max(0, cellLeft - viewWidth / 2 + cellWidth / 2);
}
// Maps the bar grid's current horizontal scroll position to a {leftPct,
// widthPct} box overlaid on the always-full-song overview waveform above it.
function slComputeViewportBox(scrollLeft, clientWidth, zoomPx, labelWidth, totalBars) {
  const bars = Math.max(1, totalBars);
  const contentWidth = Math.max(1, clientWidth - labelWidth);
  const barFrom = Math.max(0, scrollLeft / zoomPx);
  const barSpan = contentWidth / zoomPx;
  const leftPct = Math.min(100, (barFrom / bars) * 100);
  const widthPct = Math.max(0, Math.min(100 - leftPct, (barSpan / bars) * 100));
  return { leftPct, widthPct };
}

function slFmtTime(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function slPitchLabelFor(n) {
  if (n === 0) return '原调（不移调）';
  const dir = n > 0 ? '升' : '降';
  const idx = Math.abs(n);
  const name = SL_INTERVAL_NAMES[idx] || (idx + '个半音');
  return dir + Math.abs(n) + '半音 · ' + name;
}

// ── shared master-volume integration — same singleton fbMasterGain() used
// by Fretboard/Speed Trainer, so the top-bar volume slider controls every
// page's audio consistently. ──────────────────────────────────────────────
function slPlaybackVolume() {
  return typeof fbMasterGain === 'function' ? fbMasterGain() : 1;
}
function slApplyPlaybackVolume() {
  if (slState.els.audioEl) {
    slState.els.audioEl.volume = Math.max(0, Math.min(1, slPlaybackVolume()));
  }
}

// ── Transport (app-wide floating panel) ───────────────────────────────────
// Registered via updateTransportForPage('songloop') in app.js — same
// play/stop pattern as Vamp/Jam/etc., consolidating what used to be a
// standalone inline ▶/❚❚ button into the shared panel. slState.duration is
// 0 until a file finishes loading, so play() is a safe no-op before then.
function slPlay() {
  if (!slState.duration || !slState.els.audioEl) return;
  slState.els.audioEl.play();
}
function slStop() {
  if (slState.els.audioEl) slState.els.audioEl.pause();
}

// Entry point for Licks' "🎧 Practice with Song Loop" button — call after
// showPage('songloop') (which already calls initSongLoopPage(), so this one
// is just a safety net for callers that haven't shown the page yet).
// `label` is an optional clean display name (e.g. the Markdown link text) —
// without it, the displayed/sidecar filename falls back to whatever's in
// the URL itself, which for a materials-library URL is the timestamp-
// prefixed on-disk filename, not the original.
async function slLoadFromUrl(url, label) {
  initSongLoopPage();
  await slState.loadFileFromUrl(url, label);
}

// ── page init — all DOM access lives below this line, guarded so revisiting
// the page doesn't stack duplicate listeners (same pattern as Speed
// Trainer's initSpeedPage). ────────────────────────────────────────────────
function initSongLoopPage() {
  if (slState.inited) return;
  slState.inited = true;

  const $ = (id) => document.getElementById(id);
  const els = slState.els = {
    dropzoneRow: $('sl-dropzone-row'), dropzone: $('sl-dropzone'), dropzoneText: $('sl-dropzone-text'),
    timeReadout: $('sl-time-readout'),
    speedSlider: $('sl-speed-slider'), speedNum: $('sl-speed-num'),
    zoomSlider: $('sl-zoom-slider'), zoomNum: $('sl-zoom-num'), zoomFitBtn: $('sl-zoom-fit'),
    pitchDownBtn: $('sl-pitch-down'), pitchUpBtn: $('sl-pitch-up'), pitchLabel: $('sl-pitch-label'),
    loopPanel: $('sl-loop-panel'), loopToggle: $('sl-loop-toggle'),
    loopFromInput: $('sl-loop-from'), loopToInput: $('sl-loop-to'), loopHint: $('sl-loop-hint'),
    offsetPanel: $('sl-offset-panel'), offsetMinusBar: $('sl-offset-minus-bar'),
    offsetMinusBeat: $('sl-offset-minus-beat'), offsetSetHere: $('sl-offset-set-here'),
    offsetPlusBeat: $('sl-offset-plus-beat'), offsetPlusBar: $('sl-offset-plus-bar'),
    offsetReadout: $('sl-offset-readout'),
    phrasePanel: $('sl-phrase-panel'), phraseSetHere: $('sl-phrase-set-here'),
    phrasePrev: $('sl-phrase-prev'), phraseNext: $('sl-phrase-next'),
    phraseClear: $('sl-phrase-clear'), phraseReadout: $('sl-phrase-readout'),
    wave: $('sl-wave'), waveMeta: $('sl-wave-meta'), waveLoop: $('sl-wave-loop'),
    waveBars: $('sl-wave-bars'), wavePlayhead: $('sl-wave-playhead'), waveViewport: $('sl-wave-viewport'),
    keySelect: $('sl-key-select'), keyTag: $('sl-key-tag'),
    bpmInput: $('sl-bpm-input'), bpmTag: $('sl-bpm-tag'), tapBtn: $('sl-tap-btn'),
    barGrid: $('sl-bar-grid'), barGridEmpty: $('sl-bar-grid-empty'), barFooter: $('sl-bar-footer'),
    sidecarSaveBtn: $('sl-sidecar-save'), sidecarLoadBtn: $('sl-sidecar-load'),
    sidecarHint: $('sl-sidecar-hint'), sidecarInput: $('sl-sidecar-input'),
    browseLibraryBtn: $('sl-browse-library-btn'), libraryModal: $('sl-library-modal'),
    libraryList: $('sl-library-list'), libraryCloseBtn: $('sl-library-close-btn'),
    audioEl: $('sl-player'),
  };

  let rowsByBar = new Map(); // rebuilt each renderBarGrid() call — bar -> [cells for that bar across rows]
  let lastHighlightedBar = null;
  let fileLabel = { name: '', sampleRate: 0 };
  let sidecarHandle = null; // FileSystemFileHandle from the first showSaveFilePicker save this track — reused so later saves overwrite silently instead of re-prompting
  let loadGeneration = 0; // bumped on every loadFile() call, so a stale in-flight upload from a since-replaced track can detect it's obsolete and bail out

  els.keySelect.innerHTML = SL_KEY_OPTIONS.map(k => `<option value="${htmlEsc(k)}">${htmlEsc(k)}</option>`).join('');

  function applyPrefsToUI() {
    els.speedSlider.value = slState.speed;
    els.speedNum.value = slState.speed;
    els.zoomSlider.value = slState.zoomPxPerBar;
    els.zoomNum.value = slState.zoomPxPerBar;
    els.loopFromInput.value = slState.loopFromBar;
    els.loopToInput.value = slState.loopToBar;
    els.loopToggle.checked = slState.loopOn;
    els.keySelect.value = slState.key;
    els.bpmInput.value = slState.bpm;
    updateLoopPanelStyle();
    updatePitchLabel();
    updateKeyTag();
    updateBpmTag();
    updatePhrasePanelStyle();
    updatePhraseReadout();
  }

  function updatePitchLabel() { els.pitchLabel.textContent = slPitchLabelFor(slState.pitch); }
  function updateKeyTag() { els.keyTag.textContent = slState.keyManual ? '手动指定' : '默认'; }
  function updateBpmTag() { els.bpmTag.textContent = slState.bpmManual ? '已手动校准' : '默认'; }
  function updateLoopPanelStyle() {
    els.loopPanel.classList.toggle('gp-loop-on', slState.loopOn);
    els.loopHint.textContent = slState.loopOn ? '在区间内不断循环，直到关闭' : '关闭时正常播放全曲';
  }

  function updateTimeReadout() {
    els.timeReadout.textContent = slFmtTime(els.audioEl.currentTime) + ' / ' + slFmtTime(slState.duration);
  }

  function updateOffsetReadout() {
    const beats = (slState.bar1TimeSec / slSecPerBar()) * slState.beatsPerBar;
    const bars = beats / slState.beatsPerBar;
    const beatText = `${beats >= 0 ? '+' : ''}${Math.round(beats * 100) / 100}`;
    const barText = `${bars >= 0 ? '+' : ''}${Math.round(bars * 100) / 100}`;
    els.offsetReadout.textContent = beats === 0 ? '0 拍' : `${beatText} 拍 (${barText} 小节)`;
  }

  function updatePhrasePanelStyle() {
    els.phrasePanel.classList.toggle('gp-phrase-on', slState.selectedPhraseStartBar != null);
  }

  function updatePhraseReadout() {
    if (slState.selectedPhraseStartBar == null) {
      els.phraseReadout.textContent = '尚未选择句首';
      return;
    }
    els.phraseReadout.textContent = `当前句首：第 ${slState.selectedPhraseStartBar} 小节`;
  }

  function updateSidecarHint(msg) {
    if (!els.sidecarHint) return;
    els.sidecarHint.textContent = msg;
  }

  function normalizePhraseStarts() {
    slState.phraseStarts = slNormalizePhraseStarts(slState.phraseStarts);
    if (slState.selectedPhraseStartBar != null && !slState.phraseStarts.includes(slState.selectedPhraseStartBar)) {
      slState.selectedPhraseStartBar = slState.phraseStarts[slState.phraseStarts.length - 1];
    }
    if (slState.selectedPhraseStartBar == null) slState.selectedPhraseStartBar = slState.phraseStarts[0];
  }

  function isPhraseStart(bar) {
    return slState.phraseStarts.includes(bar);
  }

  function selectPhraseStart(bar) {
    if (!slState.phraseStarts.includes(bar)) return;
    slState.selectedPhraseStartBar = bar;
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderBarGrid();
    slSaveCurrentFileState();
  }

  function addPhraseStartAt(bar) {
    slState.phraseStarts.push(Math.max(1, Math.round(bar)));
    normalizePhraseStarts();
    slState.selectedPhraseStartBar = Math.max(1, Math.round(bar));
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderBarGrid();
    slSaveCurrentFileState();
  }

  function shiftSelectedPhraseStart(deltaBars) {
    if (slState.selectedPhraseStartBar == null) return;
    const next = Math.max(1, slState.selectedPhraseStartBar + deltaBars);
    slState.phraseStarts = slState.phraseStarts.map(b => (b === slState.selectedPhraseStartBar ? next : b));
    normalizePhraseStarts();
    slState.selectedPhraseStartBar = next;
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderBarGrid();
    slSaveCurrentFileState();
  }

  function removeSelectedPhraseStart() {
    if (slState.selectedPhraseStartBar == null) return;
    const target = slState.selectedPhraseStartBar;
    slState.phraseStarts = slState.phraseStarts.filter(b => b !== target);
    normalizePhraseStarts();
    slState.selectedPhraseStartBar = slState.phraseStarts[0] ?? null;
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderBarGrid();
    slSaveCurrentFileState();
  }

  function shiftBar1ByBeats(deltaBeats) {
    slState.bar1TimeSec += deltaBeats * (slSecPerBar() / slState.beatsPerBar);
    updateOffsetReadout();
    renderBarGrid();
    updateWaveOverlays();
    slSaveCurrentFileState();
  }

  function setBar1ToCurrentTime() {
    slState.bar1TimeSec = els.audioEl.currentTime;
    updateOffsetReadout();
    renderBarGrid();
    updateWaveOverlays();
    updateTimeReadout();
    updateBarGridHighlight();
    slSaveCurrentFileState();
  }

  // ── waveform: real per-segment peak amplitude, rendered as plain DOM bars
  // (not canvas) — matches the ported design's own markup and sidesteps the
  // devicePixelRatio class of bug a canvas-based waveform is prone to. ─────
  function computePeaks(barCount) {
    const data = slState.channelData;
    const samplesPerBar = Math.max(1, Math.floor(data.length / barCount));
    const peaks = new Array(barCount);
    for (let i = 0; i < barCount; i++) {
      let peak = 0;
      const start = i * samplesPerBar, end = Math.min(start + samplesPerBar, data.length);
      for (let j = start; j < end; j++) { const v = Math.abs(data[j]); if (v > peak) peak = v; }
      peaks[i] = peak;
    }
    return peaks;
  }

  function renderWaveBars() {
    const count = 48;
    slState.peaks = computePeaks(count);
    els.waveBars.innerHTML = slState.peaks.map(p => {
      const h = Math.max(6, Math.round(p * 90));
      return `<div class="gp-wave-bar" style="height:${h}%"></div>`;
    }).join('');
  }

  function updateWaveOverlays() {
    if (slState.duration <= 0) return;
    const total = slTotalBars();
    if (slState.loopOn) {
      const leftPct = ((slState.loopFromBar - 1) / total) * 100;
      const widthPct = ((slState.loopToBar - slState.loopFromBar) / total) * 100;
      els.waveLoop.style.left = leftPct + '%';
      els.waveLoop.style.width = widthPct + '%';
      els.waveLoop.style.display = 'block';
    } else {
      els.waveLoop.style.display = 'none';
    }
    const pct = Math.min(100, (els.audioEl.currentTime / slState.duration) * 100);
    els.wavePlayhead.style.left = pct + '%';
  }

  // Shows, as a box on the always-full-song overview waveform, which slice
  // of the (independently zoomable/scrollable) bar grid below is visible.
  function updateWaveViewportBox() {
    if (slState.duration <= 0) { els.waveViewport.style.display = 'none'; return; }
    const { leftPct, widthPct } = slComputeViewportBox(
      els.barGrid.scrollLeft, els.barGrid.clientWidth, slState.zoomPxPerBar, 92, slTotalBars()
    );
    if (widthPct >= 100) { els.waveViewport.style.display = 'none'; return; }
    els.waveViewport.style.display = 'block';
    els.waveViewport.style.left = leftPct + '%';
    els.waveViewport.style.width = widthPct + '%';
  }

  // ── bar grid: click the bar number to seek; click elsewhere in the cell
  // to edit the bar's chord/lyric metadata. That keeps seeking on the
  // least ambiguous hit target and makes the rest of the row feel like an
  // editing surface instead of a transport button. ───────────────────────
  function annotationFor(bar) {
    return slState.annotations[bar] || (slState.annotations[bar] = { chord: '', lyric: '', note: '' });
  }

  function seekToBar(bar) {
    els.audioEl.currentTime = slBarToTime(bar);
    updateTimeReadout();
    updateWaveOverlays();
    updateBarGridHighlight();
  }

  function renderBarGrid() {
    els.barGrid.innerHTML = '';
    rowsByBar = new Map();
    lastHighlightedBar = null;
    if (slState.duration <= 0) { els.barGridEmpty.style.display = 'block'; els.barFooter.textContent = ''; return; }
    els.barGridEmpty.style.display = 'none';

    const total = slTotalBars();
    els.barGrid.style.setProperty('--sl-bar-count', total);
    els.barGrid.style.setProperty('--sl-bar-width', slState.zoomPxPerBar + 'px');
    const board = document.createElement('div');
    board.className = 'gp-track-board';

    function addRow(labelText, rowClass, cellFactory) {
      const label = document.createElement('div');
      label.className = rowClass === 'ruler' ? 'gp-track-ruler-label' : 'gp-track-label';
      label.textContent = labelText;
      board.appendChild(label);
      for (let bar = 1; bar <= total; bar++) {
        const cell = cellFactory(bar);
        const bucket = rowsByBar.get(bar) || [];
        bucket.push(cell);
        rowsByBar.set(bar, bucket);
        board.appendChild(cell);
      }
    }

    addRow('小节', 'ruler', (bar) => {
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell gp-track-ruler-cell';
      const numEl = document.createElement('div');
      numEl.className = 'gp-bar-num';
      numEl.textContent = bar;
      numEl.title = '点击跳到这一小节';
      cell.appendChild(numEl);
      if (isPhraseStart(bar)) {
        const phraseBadge = document.createElement('button');
        phraseBadge.type = 'button';
        phraseBadge.className = 'gp-bar-phrase-badge' + (slState.selectedPhraseStartBar === bar ? ' active' : '');
        phraseBadge.textContent = '句首';
        phraseBadge.title = '选中这个句首';
        phraseBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          selectPhraseStart(bar);
        });
        cell.appendChild(phraseBadge);
      }
      cell.addEventListener('click', () => seekToBar(bar));
      return cell;
    });

    addRow('句首', 'phrase', (bar) => {
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell gp-track-phrase-cell';
      cell.title = '点击这一格标记 / 选中句首';
      if (isPhraseStart(bar)) {
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'gp-bar-phrase-badge' + (slState.selectedPhraseStartBar === bar ? ' active' : '');
        badge.textContent = '句首';
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          selectPhraseStart(bar);
        });
        cell.appendChild(badge);
      } else {
        const ghost = document.createElement('div');
        ghost.className = 'gp-track-ghost';
        ghost.textContent = '点这里';
        cell.appendChild(ghost);
      }
      cell.addEventListener('click', () => {
        if (isPhraseStart(bar)) selectPhraseStart(bar);
        else addPhraseStartAt(bar);
      });
      return cell;
    });

    addRow('和弦', 'chord', (bar) => {
      const ann = annotationFor(bar);
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'gp-track-field gp-track-chord';
      input.placeholder = '和弦';
      input.value = ann.chord;
      input.addEventListener('input', () => { ann.chord = input.value; slSaveCurrentFileState(); });
      cell.addEventListener('click', () => input.focus());
      cell.appendChild(input);
      return cell;
    });

    addRow('歌词', 'lyric', (bar) => {
      const ann = annotationFor(bar);
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell';
      const input = document.createElement('textarea');
      input.className = 'gp-track-field gp-track-lyric';
      input.placeholder = '歌词';
      input.value = ann.lyric;
      input.addEventListener('input', () => { ann.lyric = input.value; slSaveCurrentFileState(); });
      cell.addEventListener('click', () => input.focus());
      cell.appendChild(input);
      return cell;
    });

    addRow('简谱 / 备注', 'note', (bar) => {
      const ann = annotationFor(bar);
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell';
      const input = document.createElement('textarea');
      input.className = 'gp-track-field gp-track-note';
      input.placeholder = '简谱 / 备注';
      input.value = ann.note || '';
      input.addEventListener('input', () => { ann.note = input.value; slSaveCurrentFileState(); });
      cell.addEventListener('click', () => input.focus());
      cell.appendChild(input);
      return cell;
    });

    els.barGrid.appendChild(board);
    els.barFooter.textContent = '共 ' + total + ' 小节 · 上排数字负责跳转，句首行负责标记句子边界，其余三行直接编辑';
    applyBarGridHighlightClasses();
    updateWaveViewportBox();
  }

  function applyBarGridHighlightClasses() {
    rowsByBar.forEach((cells, bar) => {
      cells.forEach((cell) => {
        cell.classList.toggle('gp-bar-in-loop', slState.loopOn && bar >= slState.loopFromBar && bar <= slState.loopToBar);
      });
    });
  }

  function updateBarGridHighlight() {
    const curBar = slTimeToBar(els.audioEl.currentTime);
    if (curBar === lastHighlightedBar) return;
    if (lastHighlightedBar != null && rowsByBar.has(lastHighlightedBar)) {
      rowsByBar.get(lastHighlightedBar).forEach(cell => cell.classList.remove('gp-bar-current'));
    }
    if (rowsByBar.has(curBar)) {
      const cells = rowsByBar.get(curBar);
      cells.forEach(cell => cell.classList.add('gp-bar-current'));
      scrollGridToBar(curBar, { behavior: 'smooth' });
    }
    lastHighlightedBar = curBar;
  }

  // Keeps the playhead's bar roughly centered instead of scrollIntoView's
  // edge-snap (which, during continuous forward playback, looks like the
  // grid staying pinned to the right edge). Only scrolls when the bar's
  // cell actually nears an edge, so steady playback doesn't jitter-scroll
  // every single bar.
  function scrollGridToBar(bar, opts = {}) {
    const cells = rowsByBar.get(bar);
    if (!cells || !cells.length) return;
    const cell = cells[0];
    const container = els.barGrid;
    const cellLeft = cell.offsetLeft, cellRight = cellLeft + cell.offsetWidth;
    const viewLeft = container.scrollLeft, viewWidth = container.clientWidth;
    if (!slShouldRecenter(cellLeft, cellRight, viewLeft, viewWidth)) return;
    const target = slCenterScrollLeft(cellLeft, cell.offsetWidth, viewWidth);
    container.scrollTo({ left: target, behavior: opts.behavior || 'auto' });
  }

  // ── file loading ──────────────────────────────────────────────────────
  function resetForNewTrack(label, sampleRate) {
    fileLabel = { name: label, sampleRate };
    sidecarHandle = null; // new track — don't silently overwrite the previous track's sidecar file
    slState.annotations = {};
    slState.phraseStarts = [1];
    slState.selectedPhraseStartBar = 1;
    slState.bpmManual = false;
    slState.keyManual = false;
    slState.bpm = 96;
    slState.key = SL_KEY_OPTIONS[1];
    slState.tapTimes = [];
    slState.bar1TimeSec = 0;

    els.dropzoneRow.style.display = 'none';
    els.tapBtn.disabled = false;

    els.bpmInput.value = slState.bpm;
    els.keySelect.value = slState.key;
    normalizePhraseStarts();
    els.bpmInput.value = slState.bpm;
    els.keySelect.value = slState.key;
    els.loopFromInput.value = slState.loopFromBar;
    els.loopToInput.value = slState.loopToBar;
    els.loopToggle.checked = slState.loopOn;
    updateKeyTag();
    updateBpmTag();
    updateOffsetReadout();
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderWaveBars();
    updateWaveMeta();
    updateTimeReadout();
    updateWaveOverlays();
    renderBarGrid();
    updateSidecarHint(`将保存为 ${slSidecarFileName(fileLabel.name)}（同目录）`);
    slPrefsSave();
  }

  function updateWaveMeta() {
    els.waveMeta.textContent = fileLabel.name + ' · ' + slFmtTime(slState.duration) + ' · ' + (fileLabel.sampleRate / 1000).toFixed(1) + 'kHz';
  }

  function slSidecarDownloadBlob(doc, suggestedName) {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveSidecarFile() {
    if (!fileLabel.name) {
      updateSidecarHint('先加载一个 mp3，再保存 sidecar。');
      return;
    }
    const suggestedName = slSidecarFileName(fileLabel.name);
    const doc = slBuildSidecarDocument(fileLabel.name);
    if (window.showSaveFilePicker) {
      try {
        // Only prompt for a location on the first save of this track; every
        // save after that reuses the same handle and just overwrites it —
        // no repeat picker, no extra confirmation.
        if (!sidecarHandle) {
          sidecarHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'Song Loop sidecar', accept: { 'application/json': ['.json'] } }],
          });
        }
        const writable = await sidecarHandle.createWritable();
        await writable.write(JSON.stringify(doc, null, 2));
        await writable.close();
        updateSidecarHint(`已保存为 ${sidecarHandle.name}（${new Date().toLocaleTimeString('zh-CN', { hour12: false })}）`);
        slSaveCurrentFileState();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        sidecarHandle = null; // handle went stale (e.g. permission revoked) — next click reopens the picker
        updateSidecarHint('保存失败，请重试');
        return;
      }
    }
    slSidecarDownloadBlob(doc, suggestedName);
    updateSidecarHint(`已下载 ${suggestedName}`);
    slSaveCurrentFileState();
  }

  function applySidecarStateFromText(text, sourceName) {
    const state = slParseSidecarText(text);
    if (!state) {
      updateSidecarHint(`无法解析 ${sourceName || 'sidecar 文件'}`);
      return false;
    }
    slApplyFileStatePayload(state);
    normalizePhraseStarts();
    els.bpmInput.value = slState.bpm;
    els.keySelect.value = slState.key;
    els.loopFromInput.value = slState.loopFromBar;
    els.loopToInput.value = slState.loopToBar;
    els.loopToggle.checked = slState.loopOn;
    updateKeyTag();
    updateBpmTag();
    updateOffsetReadout();
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderBarGrid();
    updateWaveOverlays();
    slSaveCurrentFileState();
    updateSidecarHint(`已载入 ${sourceName || 'sidecar 文件'}`);
    return true;
  }

  async function loadSidecarFromFile(file) {
    if (!file) return;
    const text = await file.text();
    applySidecarStateFromText(text, file.name);
  }

  async function pickAndLoadSidecar() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Song Loop sidecar', accept: { 'application/json': ['.json'] } }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        await loadSidecarFromFile(file);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    els.sidecarInput.click();
  }

  async function loadFile(file) {
    loadGeneration++; // invalidates any in-flight upload from a track we're replacing
    slState.sourceUrl = null; // cleared until loadFileFromUrl / a successful local upload sets it
    const url = URL.createObjectURL(file);
    els.audioEl.src = url;
    const arrBuf = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const actx = new AudioCtx();
    const decoded = await actx.decodeAudioData(arrBuf.slice(0));
    slState.channelData = decoded.getChannelData(0);
    slState.duration = decoded.duration;
    const sampleRate = decoded.sampleRate;
    actx.close();
    resetForNewTrack(file.name, sampleRate);
  }

  // ── per-URL state: debounced write to the server, read on load ──────────
  // Writes: coalesce rapid edits (typing a lyric, dragging a slider) into
  // one PUT after 600ms of quiet. url+payload are snapshotted at *schedule*
  // time, not when the timer fires — otherwise switching tracks mid-debounce
  // would write the new track's data under the old track's url.
  let urlStateSaveTimer = null;
  function scheduleUrlStateSave() {
    if (!slState.sourceUrl) return;
    const url = slState.sourceUrl;
    const payload = { ...slCaptureFileStatePayload(), speed: slState.speed };
    clearTimeout(urlStateSaveTimer);
    urlStateSaveTimer = setTimeout(() => pushUrlState(url, payload), 600);
  }
  async function pushUrlState(url, payload) {
    try {
      const res = await fetch(`${url}/state`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
    } catch (err) {
      updateSidecarHint('自动保存失败（网络问题）· 请稍后重试或用"保存 sidecar"手动备份');
    }
  }
  slState.scheduleUrlStateSave = scheduleUrlStateSave;

  // Applies this track's remembered bpm/key/loop/offset/speed/pitch/phrase
  // markers/annotations (if any) and refreshes every bit of UI that depends
  // on them. Shared by a Lick's materials-library track (loadFileFromUrl)
  // and a local file that's already been seen before (loadLocalFile's
  // dedupe-hit path) — both end up with the same kind of stable url.
  //
  // Reads from the server first; if that comes back empty (a brand-new
  // material, or a track saved before this state moved server-side), falls
  // back to the legacy localStorage copy as a one-time migration seed, then
  // pushes it server-side and clears the old key so this only happens once.
  async function applySavedUrlStateIfAny(url) {
    let saved = await fetch(`${url}/state`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (saved && Object.keys(saved).length === 0) saved = null;
    if (!saved) {
      const legacy = slReadLegacyUrlState(url);
      if (legacy) {
        saved = legacy;
        pushUrlState(url, legacy);
        localStorage.removeItem(slUrlStateKey(url));
      }
    }
    if (!saved) return;
    slApplyFileStatePayload(saved);
    if (Number.isFinite(saved.speed)) { slState.speed = saved.speed; applySpeed(); }
    normalizePhraseStarts();
    applyPrefsToUI();
    updateKeyTag();
    updateBpmTag();
    updateOffsetReadout();
    updatePhrasePanelStyle();
    updatePhraseReadout();
    renderWaveBars();
    renderBarGrid();
    updateWaveOverlays();
    updateTimeReadout();
  }

  // External entry point for a Lick's materials-library backing track (see
  // slLoadFromUrl below, module scope) — fetches the URL into a Blob and
  // funnels it through the exact same decode/waveform pipeline as a local
  // file, then restores this specific track's remembered state, since the
  // URL is a stable id.
  async function loadFileFromUrl(url, label) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    const blob = await res.blob();
    // Prefer the caller's clean display name — falling back to the URL's
    // own last path segment (e.g. for direct testing/console use) means a
    // materials-library URL's timestamp-prefixed on-disk filename, which is
    // only ever a fallback, not what a caller that has the real name sees.
    const name = label || decodeURIComponent(url.split('/').pop() || 'track');
    await loadFile(new File([blob], name, { type: blob.type }));
    slState.sourceUrl = url;
    await applySavedUrlStateIfAny(url);
    updateSidecarHint('来自素材库 · 改动会自动保存 · 也可用"保存 sidecar"额外导出备份');
  }
  slState.loadFileFromUrl = loadFileFromUrl;

  // Uploads a freshly-picked local file to the same materials library Licks
  // uses (POST /api/materials — see web/licks.js's materialUploadAndInsert
  // for the same call shape), then treats it exactly like a Lick's track
  // from then on: sourceUrl gets set, so every future edit auto-persists.
  // Failure (offline, server down, >100MB) leaves sourceUrl null — the
  // track still plays fine locally, just falls back to manual "保存
  // sidecar" for anything you want to keep across a refresh.
  async function registerAsLibraryMaterial(file, dedupeKey) {
    const myGeneration = loadGeneration;
    updateSidecarHint('正在加入素材库…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/materials', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      const { url } = await res.json();
      if (myGeneration !== loadGeneration) return; // a different track has since been loaded
      slSaveLocalUploadMapEntry(dedupeKey, url);
      slState.sourceUrl = url;
      slSaveCurrentFileState(); // persists the current (default) state under the new url right away
      updateSidecarHint('已加入素材库 · 改动会自动保存 · 也可用"保存 sidecar"额外导出备份');
    } catch (err) {
      if (myGeneration !== loadGeneration) return;
      updateSidecarHint('未加入素材库（离线或上传失败）· 请用"保存 sidecar"手动备份，避免刷新丢失');
    }
  }

  // Entry point for the local file picker/dropzone. Decodes+plays
  // immediately (doesn't wait on the network), then either recognizes the
  // file from a previous session (same name+size, see the local-upload
  // dedupe map at module scope) and restores its saved state, or uploads it
  // as a brand-new materials-library entry.
  async function loadLocalFile(file) {
    await loadFile(file);
    const key = slLocalUploadKey(file.name, file.size);
    const knownUrl = slLoadLocalUploadMap()[key];
    if (knownUrl) {
      slState.sourceUrl = knownUrl;
      await applySavedUrlStateIfAny(knownUrl);
      updateSidecarHint('已从素材库恢复上次进度 · 改动会自动保存');
      return;
    }
    await registerAsLibraryMaterial(file, key);
  }

  // "从资料库选择": lists every audio material regardless of whether any
  // Lick links to it (unlike Licks' own material picker, which is really
  // for inserting a link into a lick's notes). Reuses licksIsAudioUrl
  // (defined in licks.js, loaded on the same page — see the existing
  // cross-file precedent already used elsewhere in this app) and the
  // existing slLoadFromUrl entry point, so opening a picked track goes
  // through the exact same path as Licks' "🎧 Practice with Song Loop".
  async function openLibraryPicker() {
    els.libraryModal.classList.add('show');
    els.libraryList.innerHTML = '加载中…';
    try {
      const materials = await (await fetch('/api/materials')).json();
      const audio = materials.filter(m => licksIsAudioUrl(m.url));
      els.libraryList.innerHTML = audio.length
        ? audio.map(m => `<div class="material-picker-item" data-url="${htmlEsc(m.url)}" data-filename="${htmlEsc(m.filename)}">🎧 ${htmlEsc(m.filename)}</div>`).join('')
        : '<p class="empty-state">资料库里还没有音频文件。</p>';
    } catch (e) {
      els.libraryList.innerHTML = '加载失败：' + htmlEsc(e.message);
    }
  }
  function closeLibraryPicker() {
    els.libraryModal.classList.remove('show');
  }
  els.browseLibraryBtn.addEventListener('click', openLibraryPicker);
  els.libraryCloseBtn.addEventListener('click', closeLibraryPicker);
  els.libraryModal.addEventListener('click', (e) => { if (e.target === els.libraryModal) closeLibraryPicker(); });
  els.libraryList.addEventListener('click', (e) => {
    const item = e.target.closest('.material-picker-item');
    if (!item) return;
    closeLibraryPicker();
    slLoadFromUrl(item.dataset.url, item.dataset.filename);
  });

  const fileInput = document.getElementById('sl-file-input');
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadLocalFile(e.target.files[0]); });
  els.sidecarSaveBtn.addEventListener('click', saveSidecarFile);
  els.sidecarLoadBtn.addEventListener('click', pickAndLoadSidecar);
  els.sidecarInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) loadSidecarFromFile(e.target.files[0]);
    e.target.value = '';
  });
  ['dragover', 'dragenter'].forEach(ev => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
  els.dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadLocalFile(f); });
  // clicking the waveform before a file is loaded re-opens the file picker,
  // since the dropzone row hides itself after a track loads (matches the
  // ported design's single always-visible waveform slot)
  els.wave.addEventListener('click', () => { if (!slState.duration) fileInput.click(); });

  // ── transport ─────────────────────────────────────────────────────────
  // Play/Stop themselves (slPlay/slStop, module-scope above) are registered
  // with the app-wide floating panel via updateTransportForPage('songloop')
  // — this just keeps the panel's Play/Stop buttons in sync with the audio
  // element's actual state, however it changes (panel click, spacebar, or
  // the element finishing/erroring out on its own).
  els.audioEl.addEventListener('play', () => setTransportState('playing'));
  els.audioEl.addEventListener('pause', () => setTransportState('stopped'));

  function toggleSpacebarPlay() {
    if (!slState.duration) return;
    if (els.audioEl.paused) slPlay(); else slStop();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-songloop')?.classList.contains('active')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    toggleSpacebarPlay();
  });

  // seeking by clicking/dragging the waveform itself
  let scrubbing = false;
  function seekFromEvent(e) {
    const rect = els.wave.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    els.audioEl.currentTime = frac * slState.duration;
    updateTimeReadout();
    updateWaveOverlays();
    updateBarGridHighlight();
  }
  els.wave.addEventListener('pointerdown', (e) => {
    if (!slState.duration) return;
    scrubbing = true;
    els.wave.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  els.wave.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
  els.wave.addEventListener('pointerup', () => { scrubbing = false; });
  els.wave.addEventListener('pointercancel', () => { scrubbing = false; });

  // ── speed ─────────────────────────────────────────────────────────────
  function applySpeed() {
    els.audioEl.playbackRate = slState.speed / 100;
    els.audioEl.preservesPitch = slState.preservePitch;
    els.audioEl.webkitPreservesPitch = slState.preservePitch;
    els.audioEl.mozPreservesPitch = slState.preservePitch;
  }
  function setSpeed(v) {
    v = Math.max(50, Math.min(150, Math.round(v) || 100));
    slState.speed = v;
    els.speedSlider.value = v;
    els.speedNum.value = v;
    applySpeed();
    slPrefsSave();
    slSaveCurrentFileState();
  }
  els.speedSlider.addEventListener('input', () => setSpeed(parseInt(els.speedSlider.value)));
  els.speedNum.addEventListener('change', () => setSpeed(parseInt(els.speedNum.value)));

  // ── zoom (bar grid horizontal scale — a viewing preference, saved via
  // slPrefsSave alongside speed/loopOn, not per-song) ──────────────────────
  function setZoom(px) {
    slState.zoomPxPerBar = slClampZoom(px);
    els.zoomSlider.value = slState.zoomPxPerBar;
    els.zoomNum.value = slState.zoomPxPerBar;
    renderBarGrid();
    updateWaveOverlays();
    scrollGridToBar(slTimeToBar(els.audioEl.currentTime), { behavior: 'auto' });
    slPrefsSave();
  }
  function fitZoomToWidth() {
    setZoom(slFitZoomPxPerBar(slTotalBars(), els.barGrid.clientWidth, 92));
  }
  els.zoomSlider.addEventListener('input', () => setZoom(parseInt(els.zoomSlider.value)));
  els.zoomNum.addEventListener('change', () => setZoom(parseInt(els.zoomNum.value)));
  els.zoomFitBtn.addEventListener('click', fitZoomToWidth);
  els.barGrid.addEventListener('scroll', () => requestAnimationFrame(updateWaveViewportBox));

  // ── pitch (UI-only — see file header) ────────────────────────────────
  els.pitchUpBtn.addEventListener('click', () => { slState.pitch = Math.min(6, slState.pitch + 1); updatePitchLabel(); slSaveCurrentFileState(); });
  els.pitchDownBtn.addEventListener('click', () => { slState.pitch = Math.max(-6, slState.pitch - 1); updatePitchLabel(); slSaveCurrentFileState(); });

  // ── key / BPM / tap-tempo ─────────────────────────────────────────────
  els.keySelect.addEventListener('change', () => {
    slState.key = els.keySelect.value;
    slState.keyManual = true;
    updateKeyTag();
    slSaveCurrentFileState();
  });

  function setBpm(v, manual) {
    v = Math.max(40, Math.min(220, Math.round(v) || slState.bpm));
    slState.bpm = v;
    if (manual) slState.bpmManual = true;
    els.bpmInput.value = v;
    updateBpmTag();
    renderWaveBars(); // bar boundaries moved — nothing to redraw for peaks themselves, but overlays/grid depend on them
    renderBarGrid();
    updateWaveOverlays();
    slSaveCurrentFileState();
  }
  els.bpmInput.addEventListener('change', () => setBpm(parseInt(els.bpmInput.value), true));

  function doTap() {
    const now = Date.now();
    slState.tapTimes = slState.tapTimes.filter(t => now - t < 2500);
    slState.tapTimes.push(now);
    slState.tapTimes = slState.tapTimes.slice(-6);
    if (slState.tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < slState.tapTimes.length; i++) intervals.push(slState.tapTimes[i] - slState.tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setBpm(Math.round(60000 / avg), true);
    }
  }
  els.tapBtn.addEventListener('click', doTap); // deliberately not guarded — rapid repeated taps are the point

  // ── A-B loop ──────────────────────────────────────────────────────────
  function readLoopInputs() {
    slState.loopFromBar = Math.max(1, parseInt(els.loopFromInput.value) || 1);
    slState.loopToBar = Math.max(slState.loopFromBar, parseInt(els.loopToInput.value) || slState.loopFromBar);
    els.loopToInput.value = slState.loopToBar;
    slState.loopOn = els.loopToggle.checked;
    updateLoopPanelStyle();
    applyBarGridHighlightClasses();
    updateWaveOverlays();
    if (slState.loopOn && !els.audioEl.paused) startLoopGuard();
    else if (!slState.loopOn) stopLoopGuard();
    slPrefsSave();
    slSaveCurrentFileState();
  }
  [els.loopFromInput, els.loopToInput].forEach(el => el.addEventListener('change', readLoopInputs));
  els.loopToggle.addEventListener('change', readLoopInputs);
  els.offsetMinusBar.addEventListener('click', () => shiftBar1ByBeats(-slState.beatsPerBar));
  els.offsetMinusBeat.addEventListener('click', () => shiftBar1ByBeats(-1));
  els.offsetSetHere.addEventListener('click', setBar1ToCurrentTime);
  els.offsetPlusBeat.addEventListener('click', () => shiftBar1ByBeats(1));
  els.offsetPlusBar.addEventListener('click', () => shiftBar1ByBeats(slState.beatsPerBar));
  els.phraseSetHere.addEventListener('click', () => addPhraseStartAt(slTimeToBar(els.audioEl.currentTime)));
  els.phrasePrev.addEventListener('click', () => shiftSelectedPhraseStart(-1));
  els.phraseNext.addEventListener('click', () => shiftSelectedPhraseStart(1));
  els.phraseClear.addEventListener('click', removeSelectedPhraseStart);

  // ── main tick loop ────────────────────────────────────────────────────
  function enforceLoop() {
    if (!slState.loopOn || slState.duration <= 0 || els.audioEl.paused) return;
    const loopStartTime = slBarToTime(slState.loopFromBar);
    const loopEndTime = slBarToTime(slState.loopToBar + 1);
    if (loopEndTime <= loopStartTime) return;
    if (els.audioEl.currentTime >= loopEndTime) els.audioEl.currentTime = loopStartTime;
  }
  let loopGuardTimerId = null;
  function startLoopGuard() {
    if (loopGuardTimerId != null) return;
    loopGuardTimerId = setInterval(enforceLoop, 50);
  }
  function stopLoopGuard() {
    if (loopGuardTimerId == null) return;
    clearInterval(loopGuardTimerId);
    loopGuardTimerId = null;
  }
  function tick() {
    if (!els.audioEl.paused && slState.duration > 0) {
      enforceLoop();
      updateTimeReadout();
      updateWaveOverlays();
      updateBarGridHighlight();
    }
    requestAnimationFrame(tick);
  }
  els.audioEl.addEventListener('seeked', () => { updateTimeReadout(); updateWaveOverlays(); updateBarGridHighlight(); });
  els.audioEl.addEventListener('timeupdate', () => {
    enforceLoop();
    if (els.audioEl.paused) { updateTimeReadout(); updateWaveOverlays(); }
  });
  els.audioEl.addEventListener('play', () => { if (slState.loopOn) startLoopGuard(); });
  els.audioEl.addEventListener('pause', stopLoopGuard);
  window.addEventListener('beforeunload', stopLoopGuard);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) enforceLoop(); });

  document.addEventListener('fb-master-volume-change', slApplyPlaybackVolume);

  slPrefsLoad();
  normalizePhraseStarts();
  applyPrefsToUI();
  applySpeed();
  slApplyPlaybackVolume();
  updateOffsetReadout();
  updateSidecarHint('保存句首 / 歌词 / 简谱 / 偏移到同目录的 .songloop.json');
  requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    slState, slPrefsLoad, slPrefsSave, slSecPerBar, slTimeToBar, slBarToTime, slTotalBars,
    slFmtTime, slPitchLabelFor, slPlaybackVolume, slApplyPlaybackVolume, initSongLoopPage,
    slBaseName, slSidecarFileName,
    slBuildSidecarDocument, slParseSidecarText, slExtractSidecarState,
    slSaveCurrentFileState, slPersistUrlStateIfApplicable,
    slReadLegacyUrlState, slUrlStateKey,
    slLocalUploadKey, slLoadLocalUploadMap, slSaveLocalUploadMapEntry,
    slCaptureFileStatePayload, slApplyFileStatePayload,
    slClampZoom, slFitZoomPxPerBar, slShouldRecenter, slCenterScrollLeft, slComputeViewportBox,
    SL_KEY_OPTIONS, SL_INTERVAL_NAMES, SL_ZOOM_MIN, SL_ZOOM_MAX,
  };
}
