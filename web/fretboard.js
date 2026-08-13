// ── Fretboard trainer: note names + CAGED chord shapes ──
// Standalone module, no server dependency. Hooked from showPage('fretboard') in app.js.

// Leading-edge debounce for action buttons.  Fires immediately on first call,
// then blocks for `ms` ms to prevent rapid double-clicks from double-advancing
// or double-playing.  Used to wrap "Next →", "Play", "New …" functions below.
function guarded(fn, ms = 400) {
  let blocked = false;
  return function(...args) {
    if (blocked) return;
    blocked = true;
    setTimeout(() => { blocked = false; }, ms);
    return fn.apply(this, args);
  };
}

const FB_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// low string (6th) → high string (1st)
const FB_STRING_NAMES = ['E','A','D','G','B','E'];
const FB_STRING_OPEN  = [4, 9, 2, 7, 11, 4];

function fbNoteAt(stringIdx, fret) {
  return FB_NOTE_NAMES[(FB_STRING_OPEN[stringIdx] + fret) % 12];
}

// MIDI note numbers of open strings, low → high (standard tuning).
const FB_STRING_OPEN_MIDI = [40, 45, 50, 55, 59, 64];
function fbFreqFromMidi(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function fbOctaveOf(midi) { return Math.floor(midi / 12) - 1; }

// Open-position CAGED shapes: fret offsets from the shape's own "fret 0",
// low string (index 0) → high string (index 5). 'x' = muted.
const FB_CAGED_SHAPES = {
  E: { frets: [0, 2, 2, 1, 0, 0], rootString: 0, rootFret: 0 },
  A: { frets: ['x', 0, 2, 2, 2, 0], rootString: 1, rootFret: 0 },
  D: { frets: ['x', 'x', 0, 2, 3, 2], rootString: 2, rootFret: 0 },
  G: { frets: [3, 2, 0, 0, 0, 3], rootString: 0, rootFret: 3 },
  C: { frets: ['x', 3, 2, 0, 1, 0], rootString: 1, rootFret: 3 },
};
const FB_SHAPE_ORDER = ['C', 'A', 'G', 'E', 'D'];

// shape needs { rootString, rootFret }. rootNote/target can be a note name or a 0-11 pitch class index.
function fbBarreFretForShape(target, shape) {
  const targetPc = typeof target === 'string' ? FB_NOTE_NAMES.indexOf(target) : target;
  const open = FB_STRING_OPEN[shape.rootString];
  return ((targetPc - open - shape.rootFret) % 12 + 12) % 12;
}

function fbBarreFretFor(rootNote, shapeLetter) {
  return fbBarreFretForShape(rootNote, FB_CAGED_SHAPES[shapeLetter]);
}

const fbState = {
  inited: false,
  chordInited: false,
  prefsLoaded: false,
  activeMode: 'pitch',
  pitch: { target: null, matches: 0, total: 0, streak: 0, matched: false, startTime: 0,
           strings: [true, true, true, true, true, true], practiceMode: 'all', stats: {},
           showBoard: false, naturalsOnly: false,
           _holdCount: 0, _wrongNote: null, _wrongHoldCount: 0, _lastWrongMsgAt: -Infinity },
  tuner: { tuned: [false, false, false, false, false, false], activeString: -1, _holdCount: 0, _holdString: -1 },
  chord: { target: null, matches: 0, total: 0, streak: 0, matched: false, startTime: 0,
           qualities: { '': true, m: true, maj7: true, '7': true, m7: true, dim7: true, m7b5: true, sus2: false, sus4: false,
                        '6': false, m6: false, add9: false, madd9: false, '9': false, m9: false, maj9: false,
                        dim: false, aug: false, '7sus4': false, '6/9': false, mmaj7: false, '7b9': false, '7#9': false },
           notationStyle: 'standard', showFormula: false, showDegreesOnDiagram: false, showChordDiagram: false, diagramSize: 200,
           source: 'random', fixedRoot: 0, practiceMode: 'all',
           progression: { def: null, keyRoot: 0, chords: null, stepIdx: 0, repeatsLeft: 0,
                          repeatCount: 2, lockKey: false, lockedKeyRoot: 0, categoryFilter: 'all' },
           stats: {},
           _holdCount: 0, _wrongSymbol: null, _wrongHoldCount: 0, _lastWrongMsgAt: -Infinity,
           _hiddenMs: 0, _hiddenSince: null },
  ear: { scale: 'minor', mode: 'two', autoAdvance: true, wrongPauseSec: 3, showDiagram: true, waveform: 'sine',
         playbackStyle: 'melodic', noteGapSec: 0.25, direction: 'both', range: 'mid', practiceMode: 'all', stats: {},
         two: { correct: 0, total: 0, streak: 0, current: null, answered: false, timeoutId: null,
                playingUntil: 0, exploreFirstIdx: null, exploreArc: null, diagramCurrent: null },
         three: { correct: 0, total: 0, streak: 0, current: null, answered: false, step: 1, step1Correct: null, timeoutId: null,
                  playingUntil: 0, exploreFirstIdx: null, exploreArc: null, diagramCurrent: null } },
  bend: {
    subMode: 'bend', strings: {3: true, 4: true, 5: false}, intervals: {quarter: false, half: false, full: true, full_half: false},
    phase: 'idle', baseFreq: null, _stableFr: 0, _holdSinceMs: 0, _lastInZoneAt: 0, _lastFreq: null, _nextAt: null, _readyAt: null, _history: [], _lastFreqTs: null, _smoothedCents: null,
    _ampHistory: [], _lastAttackAt: 0,
    current: null, correct: 0, total: 0, streak: 0,
  },
  vibrato: {
    targetHz: 5, phase: 'idle', baseFreq: null,
    _history: [], _stableFr: 0, _lastFreq: null, _successFr: 0, _startTime: null,
    correct: 0, total: 0, speed: null, depth: null,
  },
  seq: {
    mode: 'reference', keyRoot: 0, scale: 'major', pattern: 'thirds', direction: 'asc', startFret: 0,
    showPositionHint: false,
    sequence: [], idx: 0, completed: 0,
    _holdCount: 0, _wrongNote: null, _wrongHoldCount: 0, _lastWrongMsgAt: -Infinity, _lastReading: null,
  },
};

// Global, not scoped to the Fretboard page — every mic-based drill here and
// Speed Trainer's metronome all share the same fbMic/fbOutput singletons, so
// this is rendered once at app startup (see init() in app.js), not gated
// behind visiting any particular page.
function fbRenderDeviceBar() {
  fbMasterVolumeLoad();
  fbSoundVolumesLoad();
  document.getElementById('fb-device-bar').innerHTML = `
    <span>Input device:</span>
    <select class="fb-device-select" onchange="fbMicDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    ${fbOutputDeviceSelectHtml()}
    <span style="margin-left:12px">🔊 Volume:</span>
    <input type="range" class="fb-master-volume-slider" min="0" max="1" step="0.01" value="${fbMasterVolume}"
      style="width:100px" oninput="fbMasterVolumeChange(this.value)"
      title="Scales every sound this app generates — use this if your audio interface's output isn't controlled by the OS volume keys">
  `;
  fbRefreshOutputDevices();
}

// fb_prefs bundles every drill's settings (pitch/chord/ear/bend/seq) into one
// blob, but Fretboard and Chord Match are now separate pages that can be
// visited in either order — this makes sure the blob loads exactly once
// regardless of which page gets there first, so a later visit to the other
// page doesn't re-run fbPrefsLoad() and clobber any in-memory state (stats,
// unsaved option changes) accumulated since the first load.
function fbEnsurePrefsLoaded() {
  if (fbState.prefsLoaded) return;
  fbState.prefsLoaded = true;
  fbPrefsLoad();
  fbApplyDiagramSize();  // apply saved diagram size as CSS variable
}

function initFretboardPage() {
  if (fbState.inited) return;
  fbState.inited = true;
  fbEnsurePrefsLoaded();
  fbPitchLoadStats();
  fbRenderEarOptions();
  fbEarLoadStats();
  fbEarTwoNext();
  fbEarThreeNext();
  fbEarSetMode(fbState.ear.mode);
  fbRenderPitchOptions();
  fbPitchNewNote();
  fbRenderPitchStatsTable();
  fbRenderTunerStrings();
  fbBendInit();
  fbRenderSeqOptions();
  fbSeqBuild();
  fbSeqSetMode(fbState.seq.mode);
  fbCidInit();
  fbShowMode(fbState.activeMode);
}

// Chord Match used to be one of Fretboard's tabs (fbShowMode('chord')); it's
// now a standalone top-level page so it isn't also nested a level down —
// same fbState.chord / fbMic underneath, just its own page lifecycle.
function initChordMatchPage() {
  if (fbState.chordInited) return;
  fbState.chordInited = true;
  fbEnsurePrefsLoaded();
  fbChordLoadStats();
  fbRenderChordOptions();
  fbChordNewChord();
  fbRenderChordStatsTable();
  fbRenderControlAction(); // register this page's mic drill on the shared transport bar
}

function fbShowMode(mode) {
  if (fbMic.listening) {
    fbMicStop();
    document.getElementById('fb-pitch-meter').innerHTML = '';
    document.getElementById('fb-tuner-meter').innerHTML = '';
    document.getElementById('fb-seq-verify-meter').innerHTML = '';
    fbRenderChroma(new Array(12).fill(0), null);
  }
  document.querySelectorAll('.fb-tab').forEach(b => b.classList.toggle('active', b.dataset.fbmode === mode));
  document.querySelectorAll('.fb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('fb-' + mode).classList.add('active');
  fbState.activeMode = mode;
  fbRenderControlAction();
  fbPrefsSave();
}

// releases the mic when navigating away from Fretboard or Chord Match
// entirely (see showPage()'s leavingMicPage check in app.js)
function fbLeavePage() {
  if (fbMic.listening) fbMicStop();
}

// ── Practice preferences (persisted across sessions, separate from stats) ──

const FB_PREFS_KEY = 'fb_prefs';

function fbPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  if (saved.pitch) {
    if (Array.isArray(saved.pitch.strings) && saved.pitch.strings.length === 6) fbState.pitch.strings = saved.pitch.strings;
    if (saved.pitch.practiceMode === 'all' || saved.pitch.practiceMode === 'weak') fbState.pitch.practiceMode = saved.pitch.practiceMode;
    if (typeof saved.pitch.showBoard === 'boolean') fbState.pitch.showBoard = saved.pitch.showBoard;
    if (typeof saved.pitch.naturalsOnly === 'boolean') fbState.pitch.naturalsOnly = saved.pitch.naturalsOnly;
  }
  if (saved.chord && saved.chord.qualities) {
    Object.keys(fbState.chord.qualities).forEach(k => {
      if (typeof saved.chord.qualities[k] === 'boolean') fbState.chord.qualities[k] = saved.chord.qualities[k];
    });
  }
  if (saved.chord && (saved.chord.notationStyle === 'standard' || saved.chord.notationStyle === 'jazz')) {
    fbState.chord.notationStyle = saved.chord.notationStyle;
  }
  if (saved.chord && typeof saved.chord.showFormula === 'boolean') fbState.chord.showFormula = saved.chord.showFormula;
  if (saved.chord && typeof saved.chord.showDegreesOnDiagram === 'boolean') fbState.chord.showDegreesOnDiagram = saved.chord.showDegreesOnDiagram;
  if (saved.chord && typeof saved.chord.showChordDiagram === 'boolean') fbState.chord.showChordDiagram = saved.chord.showChordDiagram;
  if (saved.chord && typeof saved.chord.diagramSize === 'number') fbState.chord.diagramSize = saved.chord.diagramSize;
  if (saved.chord && ['random', 'progression', 'fixed_root'].includes(saved.chord.source)) fbState.chord.source = saved.chord.source;
  if (saved.chord && ['all', 'weak'].includes(saved.chord.practiceMode)) fbState.chord.practiceMode = saved.chord.practiceMode;
  if (saved.chord && Number.isInteger(saved.chord.fixedRoot) && saved.chord.fixedRoot >= 0 && saved.chord.fixedRoot < 12) fbState.chord.fixedRoot = saved.chord.fixedRoot;
  if (saved.chord && saved.chord.progression) {
    const sp = saved.chord.progression;
    if (Number.isInteger(sp.repeatCount) && sp.repeatCount >= 1) fbState.chord.progression.repeatCount = sp.repeatCount;
    if (typeof sp.lockKey === 'boolean') fbState.chord.progression.lockKey = sp.lockKey;
    if (Number.isInteger(sp.lockedKeyRoot) && sp.lockedKeyRoot >= 0 && sp.lockedKeyRoot < 12) fbState.chord.progression.lockedKeyRoot = sp.lockedKeyRoot;
    if (['all', 'functional', 'circle5', 'stepwise', 'blues'].includes(sp.categoryFilter)) fbState.chord.progression.categoryFilter = sp.categoryFilter;
  }
  if (saved.ear && Object.prototype.hasOwnProperty.call(FB_EAR_SCALES, saved.ear.scale)) {
    fbState.ear.scale = saved.ear.scale;
  }
  if (saved.ear && (saved.ear.mode === 'two' || saved.ear.mode === 'three')) {
    fbState.ear.mode = saved.ear.mode;
  }
  if (saved.ear && typeof saved.ear.autoAdvance === 'boolean') {
    fbState.ear.autoAdvance = saved.ear.autoAdvance;
  }
  if (saved.ear && typeof saved.ear.wrongPauseSec === 'number' && saved.ear.wrongPauseSec > 0) {
    fbState.ear.wrongPauseSec = saved.ear.wrongPauseSec;
  }
  if (saved.ear && typeof saved.ear.showDiagram === 'boolean') {
    fbState.ear.showDiagram = saved.ear.showDiagram;
  }
  if (saved.ear && ['sine', 'triangle', 'square', 'sawtooth'].includes(saved.ear.waveform)) {
    fbState.ear.waveform = saved.ear.waveform;
  }
  if (saved.ear && ['melodic', 'harmonic', 'both'].includes(saved.ear.playbackStyle)) {
    fbState.ear.playbackStyle = saved.ear.playbackStyle;
  }
  if (saved.ear && typeof saved.ear.noteGapSec === 'number' && saved.ear.noteGapSec >= 0) {
    fbState.ear.noteGapSec = saved.ear.noteGapSec;
  }
  if (saved.ear && ['asc', 'desc', 'both'].includes(saved.ear.direction)) {
    fbState.ear.direction = saved.ear.direction;
  }
  if (saved.ear && Object.prototype.hasOwnProperty.call(FB_EAR_RANGE_BASE, saved.ear.range)) {
    fbState.ear.range = saved.ear.range;
  }
  if (saved.ear && ['all', 'weak'].includes(saved.ear.practiceMode)) {
    fbState.ear.practiceMode = saved.ear.practiceMode;
  }
  if (saved.bend) {
    if (saved.bend.subMode === 'bend' || saved.bend.subMode === 'vibrato') fbState.bend.subMode = saved.bend.subMode;
    if (saved.bend.strings && typeof saved.bend.strings === 'object') {
      [3, 4, 5].forEach(i => {
        if (typeof saved.bend.strings[i] === 'boolean') fbState.bend.strings[i] = saved.bend.strings[i];
      });
      // Keep at least one string enabled
      if (!Object.values(fbState.bend.strings).some(Boolean)) fbState.bend.strings[4] = true;
    }
    if (saved.bend.intervals && typeof saved.bend.intervals === 'object') {
      ['quarter', 'half', 'full', 'full_half'].forEach(k => {
        if (typeof saved.bend.intervals[k] === 'boolean') fbState.bend.intervals[k] = saved.bend.intervals[k];
      });
      if (!Object.values(fbState.bend.intervals).some(Boolean)) fbState.bend.intervals.full = true;
    }
  }
  if (saved.vibrato && [3, 5, 7].includes(+saved.vibrato.targetHz)) {
    fbState.vibrato.targetHz = +saved.vibrato.targetHz;
  }
  if (saved.seq) {
    if (Number.isInteger(saved.seq.keyRoot) && saved.seq.keyRoot >= 0 && saved.seq.keyRoot < 12) fbState.seq.keyRoot = saved.seq.keyRoot;
    if (['major', 'naturalMinor', 'harmonicMinor'].includes(saved.seq.scale)) fbState.seq.scale = saved.seq.scale;
    if (['thirds', 'sixths', 'triad', 'seventh'].includes(saved.seq.pattern)) fbState.seq.pattern = saved.seq.pattern;
    if (['asc', 'desc', 'both'].includes(saved.seq.direction)) fbState.seq.direction = saved.seq.direction;
    if (Number.isInteger(saved.seq.startFret) && saved.seq.startFret >= 0 && saved.seq.startFret <= 12) fbState.seq.startFret = saved.seq.startFret;
    if (saved.seq.mode === 'reference' || saved.seq.mode === 'verify') fbState.seq.mode = saved.seq.mode;
    if (typeof saved.seq.showPositionHint === 'boolean') fbState.seq.showPositionHint = saved.seq.showPositionHint;
  }
  // 'chord' deliberately excluded — Chord Match moved off the Fretboard tab
  // strip onto its own page, so a stale saved 'chord' (from before that
  // change) must fall through to the default 'pitch' rather than restore a
  // mode fbShowMode can no longer find a tab/panel for.
  if (['pitch', 'tuner', 'ear', 'bend', 'seq', 'chordid'].includes(saved.activeMode)) {
    fbState.activeMode = saved.activeMode;
  }
}

function fbPrefsSave() {
  localStorage.setItem(FB_PREFS_KEY, JSON.stringify({
    pitch: { strings: fbState.pitch.strings, practiceMode: fbState.pitch.practiceMode, showBoard: fbState.pitch.showBoard,
             naturalsOnly: fbState.pitch.naturalsOnly },
    chord: {
      qualities: fbState.chord.qualities,
      notationStyle: fbState.chord.notationStyle,
      showFormula: fbState.chord.showFormula, showDegreesOnDiagram: fbState.chord.showDegreesOnDiagram,
      showChordDiagram: fbState.chord.showChordDiagram,
      diagramSize: fbState.chord.diagramSize,
      source: fbState.chord.source, fixedRoot: fbState.chord.fixedRoot, practiceMode: fbState.chord.practiceMode,
      progression: { repeatCount: fbState.chord.progression.repeatCount,
                     lockKey: fbState.chord.progression.lockKey,
                     lockedKeyRoot: fbState.chord.progression.lockedKeyRoot,
                     categoryFilter: fbState.chord.progression.categoryFilter },
    },
    ear: { scale: fbState.ear.scale, mode: fbState.ear.mode, autoAdvance: fbState.ear.autoAdvance,
           wrongPauseSec: fbState.ear.wrongPauseSec, showDiagram: fbState.ear.showDiagram, waveform: fbState.ear.waveform,
           playbackStyle: fbState.ear.playbackStyle, noteGapSec: fbState.ear.noteGapSec, direction: fbState.ear.direction,
           range: fbState.ear.range, practiceMode: fbState.ear.practiceMode },
    bend: { subMode: fbState.bend.subMode, strings: fbState.bend.strings, intervals: fbState.bend.intervals },
    vibrato: { targetHz: fbState.vibrato.targetHz },
    seq: { keyRoot: fbState.seq.keyRoot, scale: fbState.seq.scale, pattern: fbState.seq.pattern,
           direction: fbState.seq.direction, startFret: fbState.seq.startFret, mode: fbState.seq.mode,
           showPositionHint: fbState.seq.showPositionHint },
    activeMode: fbState.activeMode,
  }));
}

// ── Shared SVG board drawing ──

function fbBuildBoard(numFrets, startFret) {
  const FRET_W = 78, STRING_H = 42, PAD_L = 58, PAD_T = 26, PAD_R = 26, PAD_B = 34;
  const width = PAD_L + numFrets * FRET_W + PAD_R;
  const height = PAD_T + 5 * STRING_H + PAD_B;
  const xFret = i => PAD_L + i * FRET_W;             // i = 0..numFrets (fret line index)
  // j is still the string index (0 = low E .. 5 = high e), but the standard
  // horizontal fretboard convention draws high e on top and low E on the
  // bottom (matches TAB and how a player looks down at their own neck) —
  // so row position is inverted relative to the index.
  const yString = j => PAD_T + (5 - j) * STRING_H;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const text = (x, y, str, cls, anchor = 'middle') => {
    const el = document.createElementNS(ns, 'text');
    el.setAttribute('x', x); el.setAttribute('y', y);
    el.setAttribute('class', cls);
    el.setAttribute('text-anchor', anchor);
    el.textContent = str;
    svg.appendChild(el);
    return el;
  };
  const circle = (cx, cy, r, cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };

  // strings (horizontal)
  for (let j = 0; j < 6; j++) {
    line(xFret(0), yString(j), xFret(numFrets), yString(j), 'fb-string');
  }
  // fret lines (vertical)
  for (let i = 0; i <= numFrets; i++) {
    const isNut = startFret === 0 && i === 0;
    line(xFret(i), yString(0), xFret(i), yString(5), isNut ? 'fb-nut' : 'fb-fretline');
  }
  // inlay dots + fret numbers. Standard guitar convention: single dot at
  // 3/5/7/9 (and again an octave up at 15/17/19/21), double dot at the
  // octave marker itself (12, 24, ...) — not every marked fret gets the
  // same single dot.
  const SINGLE_DOT_FRET_MODS = [3, 5, 7, 9];
  for (let i = 1; i <= numFrets; i++) {
    const absFret = startFret + i;
    const cx = (xFret(i - 1) + xFret(i)) / 2;
    if (absFret > 0 && absFret % 12 === 0) {
      circle(cx, yString(0) + 16 - 6, 4, 'fb-inlay');
      circle(cx, yString(0) + 16 + 6, 4, 'fb-inlay');
    } else if (SINGLE_DOT_FRET_MODS.includes(absFret % 12)) {
      circle(cx, yString(0) + 16, 4, 'fb-inlay'); // below the visually-bottom row (string index 0, low E)
    }
    text(cx, yString(5) - 10, String(absFret), 'fb-fret-num'); // above the top (high e) row
  }
  if (startFret > 0) {
    text(xFret(0) - 14, (yString(0) + yString(5)) / 2, startFret + 'fr', 'fb-fret-num', 'end');
  }

  // string names at the headstock side (only makes sense where the nut is shown)
  if (startFret === 0) {
    FB_STRING_NAMES.forEach((n, j) => {
      text(xFret(0) - 34, yString(j) + 5, n, 'fb-string-name', 'middle');
    });
  }

  return { svg, xFret, yString, PAD_L, FRET_W };
}

function fbMarkerX(b, fretIdx) {
  // fretIdx is relative to the window (0 = open/nut of this window)
  return fretIdx === 0 ? b.xFret(0) : (b.xFret(fretIdx - 1) + b.xFret(fretIdx)) / 2;
}

// A consistent header above each drill's accuracy table — same title/reset
// layout everywhere, so "Reset stats" always lives in one predictable spot
// instead of being scattered into each drill's options row.
function fbStatsTableHead(title, resetFn) {
  return `<div class="fb-stats-table-head"><span>${title}</span>` +
    `<button class="btn btn-ghost btn-sm danger" onclick="${resetFn}()">Reset stats</button></div>`;
}

// shape: { frets: [6 values, 'x' or fret-offset], rootString, rootFret }
// Standard vertical chord-box diagram (the convention used in every chord
// book / Ultimate Guitar / etc.): strings are vertical lines, low E on the
// left through high e on the right; frets are horizontal lines, the nut (or
// the barre reference fret) at the top, increasing downward. Rendered via
// the svguitar library (MIT, https://github.com/omnibrain/svguitar) rather
// than hand-rolled SVG — a hand-rolled version of this had a real off-by-one
// bug (fretted notes drawn a row too high whenever the diagram didn't start
// at the nut), and getting chord-box geometry exactly right is a solved
// problem not worth re-solving by hand.
//
// svguitar's own conventions (verified against its README example, not just
// assumed): string numbers run 1 (high e) → 6 (low E) — opposite of this
// file's internal low-to-high indexing — and relative fret numbers are
// 1-indexed starting at the diagram's first row (so shape offset v=0, "the
// barre/reference position itself", is relative fret 1, not 0). `position`
// is the real starting fret shown in the first row; 1 doubles as "show the
// nut" when the shape is genuinely unbarred.
function fbShapeToSvguitarChord(shape, barreFret, degreeLabels, forceNoBarre = false) {
  const fingers = [];
  const barredMyIndices = [];
  shape.frets.forEach((v, i) => {
    const svString = 6 - i; // my index 0 (low E) -> string 6, index 5 (high e) -> string 1
    if (v === 'x') {
      fingers.push([svString, svguitar.SILENT]);
      return;
    }
    const isRoot = i === shape.rootString && v === shape.rootFret;
    const label = degreeLabels && degreeLabels[i] ? degreeLabels[i] : undefined;
    if (v === 0 && barreFret === 0) {
      fingers.push([svString, svguitar.OPEN, label ? { text: label } : undefined]);
      return;
    }
    if (v === 0) barredMyIndices.push(i);
    // shape offset v -> relative fret (1-indexed from svguitar's `position`).
    // When barred (barreFret > 0), position === barreFret, so relFret = v + 1.
    // When genuinely open (barreFret === 0), svguitar's position is pinned to
    // the sentinel value 1 (not 0) to draw the nut, which shifts the mapping:
    // relFret = (absoluteFret - position) + 1 = (v - 1) + 1 = v.
    const relFret = barreFret === 0 ? v : v + 1;
    const opts = { color: isRoot ? '#b8843a' : '#4a7c4a' };
    if (label) opts.text = label;
    fingers.push([svString, relFret, opts]);
  });

  const barres = [];
  if (!forceNoBarre && barreFret > 0 && barredMyIndices.length > 1) {
    // my low-to-high index order is the reverse of svguitar's string numbering
    barres.push({
      fromString: 6 - Math.min(...barredMyIndices),
      toString: 6 - Math.max(...barredMyIndices),
      fret: 1,
    });
  }

  // Dynamic fret-row count: use only as many rows as the chord needs (min 2).
  // Same logic as the chord reference sheet.
  let maxFret = 1;
  fingers.forEach(f => { if (typeof f[1] === 'number') maxFret = Math.max(maxFret, f[1]); });
  barres.forEach(b => { if (b.fret > maxFret) maxFret = b.fret; });
  const fretsToShow = Math.max(2, maxFret);

  return { fingers, barres, position: barreFret === 0 ? 1 : barreFret, fretsToShow };
}

// Apply the chord diagram size.
// 1) Sets CSS variable so newly-rendered cards pick up the size.
// 2) Directly patches existing .fb-shape-card elements for immediate feedback
//    (the CSS cascade alone can lag behind when cards are already in the DOM).
function fbApplyDiagramSize() {
  const px = (fbState.chord.diagramSize || 200) + 'px';
  document.documentElement.style.setProperty('--fb-diagram-size', px);
  document.querySelectorAll('.fb-shape-card').forEach(function(card) {
    card.style.width = px;
  });
}

function fbRenderShapeBox(containerEl, shape, barreFret, degreeLabels, forceNoBarre = false) {
  containerEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fb-board fb-svguitar-box';
  containerEl.appendChild(box);
  const { fingers, barres, position, fretsToShow } = fbShapeToSvguitarChord(shape, barreFret, degreeLabels, forceNoBarre);
  new svguitar.SVGuitarChord(box)
    .configure({
      strings: 6, frets: fretsToShow,
      tuning: FB_STRING_NAMES,
      color: '#8a8578',
      fingerColor: '#4a7c4a',
      fingerTextColor: '#fff',
      barreChordStrokeWidth: 0,
      fretLabelFontSize: 32,
      tuningsFontSize: 24,
    })
    .chord({ fingers, barres, position })
    .draw();
}

// ── Ear Training drill ──
// Interval recognition within a pentatonic/blues scale: the app plays 2 (or
// 3) notes drawn from the scale and asks which interval spans them. Every
// interval that can occur between any two scale tones is included as an
// answer choice — deriving that set from the scale itself (rather than a
// fixed list) is what makes adding a new scale (blues, or later modes) just
// a matter of adding a degrees array, no other code changes.

const FB_INTERVAL_NAMES = ['Unison', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];

// Degrees are semitone offsets from the root, spanning one octave (the last
// entry is always the root an octave up, included so intervals that cross
// the octave boundary — e.g. b7 to the next root — are reachable too).
const FB_EAR_SCALES = {
  minor: { label: 'Minor Pentatonic', degrees: [0, 3, 5, 7, 10, 12], labels: ['1', 'b3', '4', '5', 'b7', '1\''] },
  blues: { label: 'Blues Scale', degrees: [0, 3, 5, 6, 7, 10, 12], labels: ['1', 'b3', '4', 'b5', '5', 'b7', '1\''] },
  major: { label: 'Major (Ionian)', degrees: [0, 2, 4, 5, 7, 9, 11, 12], labels: ['1', '2', '3', '4', '5', '6', '7', '1\''] },
  naturalMinor: { label: 'Natural Minor (Aeolian)', degrees: [0, 2, 3, 5, 7, 8, 10, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', 'b7', '1\''] },
  harmonicMinor: { label: 'Harmonic Minor', degrees: [0, 2, 3, 5, 7, 8, 11, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', '7', '1\''] },
};

// Classic "anchor song" mnemonics — the standard ear-training trick for
// intervals that are hard to place by raw size alone (fine for m2/m3/M3,
// much harder for P4 upward): recognizing the opening of a song you already
// know by heart is faster than judging distance in the abstract.
const FB_EAR_INTERVAL_HINTS = {
  m2: "Jaws theme",
  M2: "Happy Birthday (1st-2nd note)",
  m3: "Greensleeves (opening)",
  M3: "Kumbaya (1st-2nd note)",
  P4: "Here Comes the Bride / Auld Lang Syne",
  TT: "The Simpsons theme (opening)",
  P5: "Twinkle Twinkle Little Star / Star Wars theme",
  m6: "The Entertainer (opening) / Love Story theme",
  M6: "My Bonnie Lies Over the Ocean / NBC chimes",
  m7: "Star Trek (original series) theme",
  M7: "Take On Me (chorus leap)",
  P8: "Somewhere Over the Rainbow (opening)",
};

// Three registers to play notes in, so questions aren't always centered on
// the same octave — 'low' sits in typical guitar low-string range, 'mid' is
// the original default (roughly middle C ± an octave), 'high' shifts up an
// octave from that.
const FB_EAR_RANGE_BASE = { low: 36, mid: 48, high: 60 };
const FB_EAR_RANGE_LABELS = { low: 'Low (C2-B3ish)', mid: 'Mid (C3-B4ish, default)', high: 'High (C4-B5ish)' };

function fbEarIntervalName(semitones) {
  return FB_INTERVAL_NAMES[semitones];
}

// Every distinct interval (by semitone count) formed between any two of the
// scale's degrees, sorted small to large and named — this is exactly the
// answer-choice set for that scale.
function fbEarPossibleIntervals(degrees) {
  const semitones = new Set();
  for (let i = 0; i < degrees.length; i++) {
    for (let j = i + 1; j < degrees.length; j++) {
      semitones.add(degrees[j] - degrees[i]);
    }
  }
  return [...semitones].sort((a, b) => a - b).map(fbEarIntervalName);
}

// The two adjacent intervals actually heard in a 3-note question, in the
// order they're played — order is 3 scale-degree indices (e.g. [i, mid, j]
// ascending or [j, mid, i] descending); the interval between notes 1-2 and
// notes 2-3 is what's asked, regardless of which direction it's played.
function fbEarAdjacentIntervals(degrees, order) {
  return [
    Math.abs(degrees[order[1]] - degrees[order[0]]),
    Math.abs(degrees[order[2]] - degrees[order[1]]),
  ];
}

// Lazily created on first Play click (browsers require a user gesture before
// audio can start) and reused for every question after that.
let fbEarAudioCtx = null;
function fbEarGetAudioCtx() {
  if (!fbEarAudioCtx) {
    fbEarAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fbRegisterAudioContext(fbEarAudioCtx);
  }
  if (fbEarAudioCtx.state === 'suspended') fbEarAudioCtx.resume();
  return fbEarAudioCtx;
}

// Plays a sequence of MIDI notes according to fbState.ear.playbackStyle:
// 'melodic' (one after another, the default), 'harmonic' (all at once, like
// a chord), or 'both' (melodic run, then the same notes stacked together).
// Returns the total playback duration in ms so callers can debounce repeat
// clicks for exactly as long as the audio is actually playing.
function fbEarPlaySequence(midiNotes) {
  const ctx = fbEarGetAudioCtx();
  const noteDur = 0.9;
  const gap = fbState.ear.noteGapSec;
  const style = fbState.ear.playbackStyle;
  const start = ctx.currentTime + 0.05;

  const playOne = (midi, atTime) => {
    const osc = ctx.createOscillator();
    osc.type = fbState.ear.waveform;
    osc.frequency.value = fbFreqFromMidi(midi);
    // Square/sawtooth are harmonic-rich enough to sound harsh at full volume —
    // a gentle lowpass rounds off the edge without changing the waveform choice.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    const peak = 0.3 * fbMasterGain() * fbSoundGain('practiceTones');
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, atTime);
    gain.gain.linearRampToValueAtTime(peak, atTime + 0.015);
    gain.gain.setValueAtTime(peak, atTime + noteDur - 0.05);
    gain.gain.linearRampToValueAtTime(0, atTime + noteDur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(atTime);
    osc.stop(atTime + noteDur + 0.02);
  };

  let melodicEnd = start;
  if (style !== 'harmonic') {
    let t = start;
    midiNotes.forEach((midi, idx) => {
      playOne(midi, t);
      melodicEnd = t + noteDur;
      if (idx < midiNotes.length - 1) t += noteDur + gap;
    });
  }

  let totalEnd = melodicEnd;
  if (style === 'harmonic') {
    midiNotes.forEach(midi => playOne(midi, start));
    totalEnd = start + noteDur;
  } else if (style === 'both') {
    const chordStart = melodicEnd + 0.2;
    midiNotes.forEach(midi => playOne(midi, chordStart));
    totalEnd = chordStart + noteDur;
  }

  return Math.ceil((totalEnd - start) * 1000) + 150;
}

// Debounces repeat clicks (Play button, or clicking dots on the diagram) so
// a fast double-click can't overlap two copies of the same audio.
function fbEarPlayNotesFor(subMode, midiNotes) {
  const s = fbState.ear[subMode];
  const now = Date.now();
  if (s.playingUntil && now < s.playingUntil) return;
  s.playingUntil = now + fbEarPlaySequence(midiNotes);
}

function fbEarPlayCurrent(subMode) {
  fbEarPlayNotesFor(subMode, fbState.ear[subMode].current.notes);
}

// "Fill the gap": for a hard-to-place interval (e.g. a 6th or 7th), plays
// every scale step from the lower quiz note up to the higher one — not just
// the two endpoints — so it's heard as a short scale walk instead of one
// blind jump. Ascending regardless of which direction the quiz itself played.
function fbEarPlayScaffold(subMode) {
  const c = fbState.ear[subMode].current;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const notes = [];
  for (let idx = c.i; idx <= c.j; idx++) notes.push(c.rootMidi + degrees[idx]);
  fbEarPlayNotesFor(subMode, notes);
}

// Shared markup for the output-device picker — dropped into every options
// panel that has an input-device picker too (see fbOutput above).
function fbOutputDeviceSelectHtml() {
  return `
    <label>Output device:
      <select class="fb-output-select" onchange="fbOutputDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    </label>
    ${FB_SETSINKID_SUPPORTED ? '' : '<span style="color:#888">(this browser can only play through the system default output)</span>'}
  `;
}

function fbRenderEarOptions() {
  document.getElementById('fb-ear-options').innerHTML = `
    <label>Scale:
      <select onchange="fbEarSetScale(this.value)">
        ${Object.entries(FB_EAR_SCALES).map(([key, s]) =>
          `<option value="${key}" ${fbState.ear.scale === key ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </label>
    <label>Tone:
      <select onchange="fbState.ear.waveform=this.value; fbPrefsSave()">
        <option value="sine" ${fbState.ear.waveform === 'sine' ? 'selected' : ''}>Sine (soft)</option>
        <option value="triangle" ${fbState.ear.waveform === 'triangle' ? 'selected' : ''}>Triangle</option>
        <option value="square" ${fbState.ear.waveform === 'square' ? 'selected' : ''}>Square</option>
        <option value="sawtooth" ${fbState.ear.waveform === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
      </select>
    </label>
    <label>Playback:
      <select onchange="fbState.ear.playbackStyle=this.value; fbPrefsSave()">
        <option value="melodic" ${fbState.ear.playbackStyle === 'melodic' ? 'selected' : ''}>Melodic (one after another)</option>
        <option value="harmonic" ${fbState.ear.playbackStyle === 'harmonic' ? 'selected' : ''}>Harmonic (all together)</option>
        <option value="both" ${fbState.ear.playbackStyle === 'both' ? 'selected' : ''}>Both (melodic, then together)</option>
      </select>
    </label>
    <label>Note gap:
      <input type="number" min="0" max="2" step="0.05" value="${fbState.ear.noteGapSec}" style="width:56px"
        onchange="fbState.ear.noteGapSec=Math.max(0, parseFloat(this.value)||0); fbPrefsSave()"> sec</label>
    <label>Direction:
      <select onchange="fbState.ear.direction=this.value; fbPrefsSave()">
        <option value="both" ${fbState.ear.direction === 'both' ? 'selected' : ''}>Both (random)</option>
        <option value="asc" ${fbState.ear.direction === 'asc' ? 'selected' : ''}>Ascending only</option>
        <option value="desc" ${fbState.ear.direction === 'desc' ? 'selected' : ''}>Descending only</option>
      </select>
    </label>
    <label>Range:
      <select onchange="fbState.ear.range=this.value; fbPrefsSave()">
        ${Object.keys(FB_EAR_RANGE_BASE).map(k => `<option value="${k}" ${fbState.ear.range === k ? 'selected' : ''}>${FB_EAR_RANGE_LABELS[k]}</option>`).join('')}
      </select>
    </label>
    <label>Practice:
      <select onchange="fbState.ear.practiceMode=this.value; fbPrefsSave()">
        <option value="all"  ${fbState.ear.practiceMode === 'all'  ? 'selected' : ''}>All intervals</option>
        <option value="weak" ${fbState.ear.practiceMode === 'weak' ? 'selected' : ''}>Focus on weak</option>
      </select>
    </label>
    <label><input type="checkbox" ${fbState.ear.autoAdvance ? 'checked' : ''}
      onchange="fbEarSetAutoAdvance(this.checked)"> Auto-advance</label>
    <label>Pause after wrong answer:
      <input type="number" min="0.5" max="15" step="0.5" value="${fbState.ear.wrongPauseSec}" style="width:56px"
        onchange="fbState.ear.wrongPauseSec=parseFloat(this.value)||3; fbPrefsSave()"> sec</label>
    <label><input type="checkbox" ${fbState.ear.showDiagram ? 'checked' : ''}
      onchange="fbState.ear.showDiagram=this.checked; fbPrefsSave(); fbEarRefreshDiagrams()"> Show scale diagram</label>
  `;
}

// Notes laid out on an axis where 1 semitone = 1 unit of width, so interval
// sizes are visually honest (a whole tone really does look twice as wide as
// a half tone) — labels the gap between each pair of *adjacent* scale
// degrees by default. `current` (when given) draws one accent arc per entry
// in current.arcs (the interval(s) actually being tested, revealed after
// answering) and highlights current.dots. Every dot is always clickable,
// independent of any active question: click two dots to hear that pair
// played and see its interval drawn as a second "explore" arc.
function fbRenderEarScaleDiagram(containerEl, scaleKey, current, subMode) {
  const { degrees, labels } = FB_EAR_SCALES[scaleKey];
  const s = fbState.ear[subMode];
  const UNIT = 34, PAD_L = 24, PAD_R = 24;
  const width = PAD_L + 12 * UNIT + PAD_R;
  const height = 140;
  const baseY = 70;
  const x = semi => PAD_L + semi * UNIT;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
  };
  const text = (tx, ty, str, cls) => {
    const el = document.createElementNS(ns, 'text');
    el.setAttribute('x', tx); el.setAttribute('y', ty);
    el.setAttribute('class', cls);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = str;
    svg.appendChild(el);
  };
  const circle = (cx, cy, r, cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const arc = (i, j, y, lineCls, labelCls) => {
    const xa = x(degrees[i]), xb = x(degrees[j]);
    line(xa, y, xb, y, lineCls);
    line(xa, y - 5, xa, y + 5, lineCls);
    line(xb, y - 5, xb, y + 5, lineCls);
    text((xa + xb) / 2, y - 8, fbEarIntervalName(degrees[j] - degrees[i]), labelCls);
  };

  line(x(0), baseY, x(12), baseY, 'fb-ear-tick-minor');
  for (let semi = 0; semi <= 12; semi++) {
    const onScale = degrees.includes(semi);
    line(x(semi), baseY - (onScale ? 10 : 5), x(semi), baseY + (onScale ? 10 : 5), onScale ? 'fb-ear-tick-major' : 'fb-ear-tick-minor');
  }

  for (let k = 0; k < degrees.length - 1; k++) {
    const xa = x(degrees[k]), xb = x(degrees[k + 1]), y = baseY + 22;
    line(xa, y, xb, y, 'fb-ear-adj-line');
    line(xa, y - 4, xa, y + 4, 'fb-ear-adj-line');
    line(xb, y - 4, xb, y + 4, 'fb-ear-adj-line');
    text((xa + xb) / 2, y + 14, fbEarIntervalName(degrees[k + 1] - degrees[k]), 'fb-ear-adj-label');
  }

  degrees.forEach((semi, idx) => {
    let cls = 'fb-ear-dot';
    if (current && current.dots && current.dots.includes(idx)) cls += ' highlight';
    if (s.exploreFirstIdx === idx) cls += ' armed';
    const dot = circle(x(semi), baseY, 9, cls);
    dot.addEventListener('click', () => fbEarDotClicked(subMode, idx));
    text(x(semi), baseY - 16, labels[idx], 'fb-ear-dot-label');
  });

  if (current && current.arcs) {
    current.arcs.forEach(({ i, j }) => arc(i, j, baseY - 26, 'fb-ear-highlight-line', 'fb-ear-highlight-label'));
  }
  if (s.exploreArc) {
    arc(s.exploreArc.i, s.exploreArc.j, baseY - 42, 'fb-ear-explore-line', 'fb-ear-explore-label');
  }

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board fb-ear-diagram';
  wrap.appendChild(svg);
  containerEl.appendChild(wrap);
}

// Click-to-explore: first click arms a note (waiting for a second pick),
// second click plays that pair (in the order clicked — direction doesn't
// change the interval) and draws it as a blue arc. Purely exploratory, not
// part of question scoring, and works whether or not a question has been
// answered yet.
function fbEarDotClicked(subMode, idx) {
  const s = fbState.ear[subMode];
  if (s.exploreFirstIdx === null) {
    s.exploreFirstIdx = idx;
    fbEarRenderDiagramFor(subMode);
    return;
  }
  const first = s.exploreFirstIdx;
  s.exploreFirstIdx = null;
  if (first === idx) { fbEarRenderDiagramFor(subMode); return; }
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  fbEarPlayNotesFor(subMode, [first, idx].map(i => s.current.rootMidi + degrees[i]));
  s.exploreArc = { i: Math.min(first, idx), j: Math.max(first, idx) };
  fbEarRenderDiagramFor(subMode);
}

function fbEarRenderDiagramFor(subMode, current) {
  const s = fbState.ear[subMode];
  if (current !== undefined) s.diagramCurrent = current;
  const el = document.getElementById(`fb-ear-${subMode}-diagram`);
  if (!fbState.ear.showDiagram) { el.innerHTML = ''; return; }
  fbRenderEarScaleDiagram(el, fbState.ear.scale, s.diagramCurrent, subMode);
}

function fbEarRefreshDiagrams() {
  fbEarRenderDiagramFor('two');
  fbEarRenderDiagramFor('three');
}

// ── Ear Training per-interval stats ──────────────────────────────────────

const FB_EAR_STATS_KEY = 'fb_ear_stats';

function fbEarLoadStats() {
  try { fbState.ear.stats = JSON.parse(localStorage.getItem(FB_EAR_STATS_KEY)) || {}; }
  catch (_) { fbState.ear.stats = {}; }
}

function fbEarSaveStats() {
  localStorage.setItem(FB_EAR_STATS_KEY, JSON.stringify(fbState.ear.stats));
}

// ── Scale Sequences drill (diatonic 3rds/6ths/triad/7th-arpeggio sequences,
// walked up/down a chosen scale) ──────────────────────────────────────────
// Reuses FB_EAR_SCALES as the single source of scale data — restricted to
// the three full 7-note diatonic scales, since a "sequence" (in the classic
// technical-exercise sense) needs a distinct note on every scale step; the
// pentatonic/blues entries don't have one.
const FB_SEQ_SCALE_KEYS = ['major', 'naturalMinor', 'harmonicMinor'];
// offsets are scale-STEP counts (not semitones) from each group's starting
// degree: thirds/sixths are dyads, triad/seventh are stacked-3rd arpeggios.
const FB_SEQ_PATTERNS = {
  thirds:  { label: 'Diatonic 3rds', offsets: [0, 2] },
  sixths:  { label: 'Diatonic 6ths', offsets: [0, 5] },
  triad:   { label: 'Triad Arpeggios', offsets: [0, 2, 4] },
  seventh: { label: '7th Arpeggios', offsets: [0, 2, 4, 6] },
};

// The 7 unique scale-step semitone offsets for a scale — drops FB_EAR_SCALES'
// trailing octave duplicate (e.g. major's 8-entry [0,2,4,5,7,9,11,12] -> the
// first 7).
function fbSeqScaleSteps(scaleKey) {
  return FB_EAR_SCALES[scaleKey].degrees.slice(0, 7);
}

// One ascending pass, one octave (7 diatonic groups), as absolute semitone
// offsets from the tonic — not yet transposed to a key or fretted. E.g.
// thirds in major: groups start on scale-steps 0..6, each group being
// [step, step+2] read through the octave-extended scale, giving the classic
// "up two, back one" sawtooth contour of a real diatonic 3rds sequence.
function fbSeqBuildAscending(scaleKey, patternKey) {
  const steps = fbSeqScaleSteps(scaleKey);
  const offsets = FB_SEQ_PATTERNS[patternKey].offsets;
  const extended = i => steps[i % 7] + 12 * Math.floor(i / 7);
  const notes = [];
  for (let g = 0; g < 7; g++) offsets.forEach(off => notes.push(extended(g + off)));
  return notes;
}

// direction: 'asc' | 'desc' | 'both'. 'desc' reverses the whole ascending
// pass (groups and the notes within them); 'both' plays the ascending pass
// then the same pass in reverse — the turnaround note repeats once, which is
// normal in real technical-exercise practice.
function fbSeqBuildSemitoneOffsets(scaleKey, patternKey, direction) {
  const asc = fbSeqBuildAscending(scaleKey, patternKey);
  if (direction === 'asc') return asc;
  const desc = asc.slice().reverse();
  return direction === 'desc' ? desc : asc.concat(desc);
}

// Width (in frets) of the single hand position the whole sequence is
// confined to — matches how real "one octave, one position" scale-box
// exercises are taught (a comfortable span using all 6 strings, no shifting
// mid-sequence). For a window of this width starting at fret F, the 6
// strings' reachable pitches ([open+F, open+F+4] each) join into one
// *contiguous* range [40+F, 68+F] regardless of which string anchors it —
// open strings are 5,5,5,4,5 semitones apart, so each string's span links
// seamlessly to the next.
const FB_SEQ_WINDOW_WIDTH = 5;

// Picks which string the tonic (semitone offset 0) sits on, and at which
// fret. Two constraints: (1) the fret should be the nearest occurrence of
// the key at or after startFret (search only ever moves up the neck, never
// below the requested fret), and (2) the whole sequence (up to maxOffset
// semitones above the tonic) must still fit inside one FB_SEQ_WINDOW_WIDTH
// window — per the coverage note above, that requires
// FB_STRING_OPEN_MIDI[stringIdx] + maxOffset <= (open high-e) + width - 1.
// Only strings satisfying that are considered, so wide patterns (7th
// arpeggios, "both" directions) naturally fall back to the low E/A strings
// where there's enough headroom, while narrower patterns (3rds, one octave)
// get to use any string and can land closer to the requested startFret.
function fbSeqAnchorPosition(keyRootPc, startFret, maxOffset) {
  const headroomCeiling = FB_STRING_OPEN_MIDI[5] + FB_SEQ_WINDOW_WIDTH - 1;
  let best = null;
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    if (FB_STRING_OPEN_MIDI[stringIdx] + maxOffset > headroomCeiling) continue;
    let fret = startFret;
    while (((FB_STRING_OPEN[stringIdx] + fret) % 12 + 12) % 12 !== keyRootPc) fret++;
    const dist = Math.abs(fret - startFret);
    if (!best || dist < best.dist) best = { stringIdx, fret, midi: FB_STRING_OPEN_MIDI[stringIdx] + fret, dist };
  }
  return { stringIdx: best.stringIdx, fret: best.fret, midi: best.midi };
}

// Frets every target semitone offset (from the anchor) strictly within the
// single-position window [anchor.fret, anchor.fret + FB_SEQ_WINDOW_WIDTH - 1]
// across all 6 strings — the whole point being that the player never has to
// shift hand position mid-sequence. When a pitch is reachable on more than
// one string within the window (happens at the window's string-overlap
// points), prefer whichever string is closest to the previous note's string,
// so the line still reads as smooth left-to-right motion rather than
// jumping around within the position.
function fbSeqAssignFretting(anchor, semitoneOffsets) {
  const windowStart = anchor.fret;
  const windowEnd = windowStart + FB_SEQ_WINDOW_WIDTH - 1;
  const positions = [];
  let prevString = anchor.stringIdx;
  for (const offset of semitoneOffsets) {
    const targetMidi = anchor.midi + offset;
    let best = null;
    for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
      const fret = targetMidi - FB_STRING_OPEN_MIDI[stringIdx];
      if (fret < windowStart || fret > windowEnd) continue;
      const cost = Math.abs(stringIdx - prevString);
      if (!best || cost < best.cost) best = { stringIdx, fret, midi: targetMidi, cost };
    }
    if (!best) continue; // shouldn't happen — the window is sized to cover every offset the UI can produce
    positions.push({ stringIdx: best.stringIdx, fret: best.fret, midi: best.midi });
    prevString = best.stringIdx;
  }
  return positions;
}

function fbRenderSeqOptions() {
  const s = fbState.seq;
  document.getElementById('fb-seq-options').innerHTML = `
    <span>Key:</span>
    <select onchange="fbState.seq.keyRoot=parseInt(this.value); fbPrefsSave(); fbSeqBuild()">
      ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.keyRoot === i ? 'selected' : ''}>${n}</option>`).join('')}
    </select>
    <span style="margin-left:12px">Scale:</span>
    <select onchange="fbState.seq.scale=this.value; fbPrefsSave(); fbSeqBuild()">
      ${FB_SEQ_SCALE_KEYS.map(k => `<option value="${k}" ${s.scale === k ? 'selected' : ''}>${FB_EAR_SCALES[k].label}</option>`).join('')}
    </select>
    <span style="margin-left:12px">Pattern:</span>
    <select onchange="fbState.seq.pattern=this.value; fbPrefsSave(); fbSeqBuild()">
      ${Object.keys(FB_SEQ_PATTERNS).map(k => `<option value="${k}" ${s.pattern === k ? 'selected' : ''}>${FB_SEQ_PATTERNS[k].label}</option>`).join('')}
    </select>
    <span style="margin-left:12px">Direction:</span>
    <select onchange="fbState.seq.direction=this.value; fbPrefsSave(); fbSeqBuild()">
      <option value="asc"  ${s.direction === 'asc'  ? 'selected' : ''}>Ascending</option>
      <option value="desc" ${s.direction === 'desc' ? 'selected' : ''}>Descending</option>
      <option value="both" ${s.direction === 'both' ? 'selected' : ''}>Both</option>
    </select>
    <span style="margin-left:12px">Start near fret:</span>
    <input type="number" min="0" max="12" value="${s.startFret}" style="width:56px"
      onchange="fbState.seq.startFret=Math.max(0, Math.min(12, parseInt(this.value) || 0)); fbPrefsSave(); fbSeqBuild()">
  `;
}

// Renders a set of fretted positions on the shared linear fretboard SVG.
// opts.highlightIdx marks one position in the "quiz" color; opts.clickable +
// opts.onClick wires click handlers on every position; opts.revealAll prints
// each position's degree/order label as text.
function fbRenderShapeDegreeBoard(containerEl, positions, opts = {}) {
  const frets = positions.map(p => p.fret);
  const startFret = Math.max(0, Math.min(...frets) - 1);
  const numFrets = Math.max(5, Math.max(...frets) - startFret + 1);
  const b = fbBuildBoard(numFrets, startFret);

  positions.forEach((p, idx) => {
    const cx = fbMarkerX(b, p.fret - startFret);
    const cy = b.yString(p.stringIdx);
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', 11);
    circ.setAttribute('class', opts.highlightIdx === idx ? 'fb-quiz-dot' : 'fb-shape-dot');
    b.svg.appendChild(circ);
    if (opts.clickable) {
      circ.classList.add('clickable');
      circ.addEventListener('click', () => opts.onClick(p, circ));
    }
    if (opts.revealAll) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'fb-shape-degree-label');
      t.textContent = p.degree;
      b.svg.appendChild(t);
    }
  });

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  containerEl.appendChild(wrap);
}

// Rebuilds fbState.seq.sequence from the current options and re-renders
// whichever subtab panel is visible (called on every option change and on
// page init — both subtabs' panels exist in the DOM at once, so both get a
// fresh render).
function fbSeqBuild() {
  const s = fbState.seq;
  const offsets = fbSeqBuildSemitoneOffsets(s.scale, s.pattern, s.direction);
  const anchor = fbSeqAnchorPosition(s.keyRoot, s.startFret, Math.max(...offsets));
  const positions = fbSeqAssignFretting(anchor, offsets);
  s.sequence = positions.map((p, i) => ({
    stringIdx: p.stringIdx, fret: p.fret, midi: p.midi,
    noteName: FB_NOTE_NAMES[((p.midi % 12) + 12) % 12], octave: fbOctaveOf(p.midi),
    order: i + 1,
  }));
  s.idx = 0;
  s._holdCount = 0;
  s._wrongNote = null;
  s._wrongHoldCount = 0;
  s._lastReading = null;
  fbRenderSeqReference();
  fbRenderSeqVerify();
}

function fbRenderSeqReference() {
  const s = fbState.seq;
  const listEl = document.getElementById('fb-seq-reference-list');
  if (!listEl) return;
  listEl.textContent = s.sequence.map(p => `${p.noteName}${p.octave}`).join('  ');
  const boardPositions = s.sequence.map(p => ({ stringIdx: p.stringIdx, fret: p.fret, degree: String(p.order) }));
  fbRenderShapeDegreeBoard(document.getElementById('fb-seq-reference-board'), boardPositions, { revealAll: true });
}

function fbRenderSeqVerify() {
  const s = fbState.seq;
  const statsEl = document.getElementById('fb-seq-verify-stats');
  if (!statsEl) return;
  statsEl.innerHTML = `<span class="fb-stat-ok">Sequences completed <b>${s.completed}</b></span>`;
  const step = s.sequence[s.idx];
  document.getElementById('fb-seq-verify-target').textContent =
    step ? `${step.noteName}${step.octave}  (note ${step.order}/${s.sequence.length})` : '';
  document.getElementById('fb-seq-hint-cb').checked = s.showPositionHint;
  const boardEl = document.getElementById('fb-seq-verify-board');
  if (s.showPositionHint) {
    const boardPositions = s.sequence.map(p => ({ stringIdx: p.stringIdx, fret: p.fret, degree: String(p.order) }));
    fbRenderShapeDegreeBoard(boardEl, boardPositions, { highlightIdx: s.idx });
  } else {
    boardEl.innerHTML = '';
  }
}

function fbSeqSetMode(mode) {
  if (fbMic.listening && fbMic.owner === 'seq' && mode !== 'verify') fbSeqStop();
  fbState.seq.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-seq-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.seqmode === mode));
  document.getElementById('fb-seq-reference-panel').style.display = mode === 'reference' ? '' : 'none';
  document.getElementById('fb-seq-verify-panel').style.display = mode === 'verify' ? '' : 'none';
  fbRenderSeqReference();
  fbRenderSeqVerify();
  fbRenderControlAction();
}

function fbSeqNewSequence() {
  fbState.seq.keyRoot = Math.floor(Math.random() * 12);
  fbPrefsSave();
  fbSeqBuild();
}

const FB_SEQ_MATCH_CENTS_TOLERANCE = 15;
const FB_SEQ_MATCH_HOLD_FRAMES = 12;
const FB_SEQ_WRONG_HOLD_FRAMES = 10;
const FB_SEQ_WRONG_MSG_COOLDOWN_MS = 700;

function fbRenderSeqMeter(r, held) {
  const meter = document.getElementById('fb-seq-verify-meter');
  meter.innerHTML = `
    <div class="fb-pitch-detected${r.isMatch ? ' match' : ''}${held ? ' held' : ''}">${r.noteName}<span class="fb-pitch-octave">${fbOctaveOf(r.midi)}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents} cents</div>
  `;
}

async function fbSeqStart() {
  try {
    await fbMicStart('seq', fbSeqOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-seq-verify-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('seq');
}

function fbSeqStop() {
  fbMicStop();
  fbSyncMicButtons('seq');
  document.getElementById('fb-seq-verify-meter').innerHTML = '';
}

function fbSeqOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.seq;
  const meter = document.getElementById('fb-seq-verify-meter');
  const now = performance.now();
  const step = s.sequence[s.idx];
  if (!step) return;

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderSeqMeter(s._lastReading, true);
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">listening…</div>`;
    }
    s._holdCount = 0;
    return;
  }

  const { noteName, cents, midi } = fbFreqToNote(freq);
  const isMatch = midi === step.midi && Math.abs(cents) <= FB_SEQ_MATCH_CENTS_TOLERANCE;
  s._lastReading = { noteName, cents, midi, freq, isMatch, ts: now };
  fbRenderSeqMeter(s._lastReading, false);

  if (isMatch) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_SEQ_MATCH_HOLD_FRAMES) fbSeqOnStepMatch();
    return;
  }
  s._holdCount = 0;
  if (noteName === s._wrongNote) s._wrongHoldCount++;
  else { s._wrongNote = noteName; s._wrongHoldCount = 1; }
  if (s._wrongHoldCount === FB_SEQ_WRONG_HOLD_FRAMES && now - s._lastWrongMsgAt > FB_SEQ_WRONG_MSG_COOLDOWN_MS) {
    s._lastWrongMsgAt = now;
    const fb = document.getElementById('fb-seq-verify-feedback');
    fb.textContent = `Not quite — heard ${noteName}${fbOctaveOf(midi)}, need ${step.noteName}${step.octave}. Keep trying…`;
    fb.className = 'fb-feedback err';
  }
}

function fbSeqOnStepMatch() {
  const s = fbState.seq;
  s.idx++;
  s._holdCount = 0;
  s._wrongHoldCount = 0;
  s._wrongNote = null;
  fbRenderSeqVerify();
  const fb = document.getElementById('fb-seq-verify-feedback');
  if (s.idx >= s.sequence.length) {
    s.completed++;
    fb.textContent = `Sequence complete! (${s.completed} total)`;
    fb.className = 'fb-feedback ok';
    setTimeout(fbSeqNewSequence, 1200);
  } else {
    fb.textContent = '';
    fb.className = 'fb-feedback';
  }
}

// ── Scale / mode switches ──────────────────────────────────────────────────

function fbEarSetScale(scale) {
  fbState.ear.scale = scale;
  fbPrefsSave();
  // Both submode panels exist in the DOM at once, so both need a fresh
  // question now.
  fbEarTwoNext();
  fbEarThreeNext();
}

function fbEarSetMode(mode) {
  fbState.ear.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-ear-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.earmode === mode));
  document.getElementById('fb-ear-two-panel').style.display = mode === 'two' ? '' : 'none';
  document.getElementById('fb-ear-three-panel').style.display = mode === 'three' ? '' : 'none';
}

function fbRenderEarStats(subMode) {
  const s = fbState.ear[subMode];
  // Per-interval weaknesses: show the 3 weakest intervals once we have enough data
  const weakList = Object.entries(fbState.ear.stats)
    .filter(([, v]) => v.presented >= 3)
    .sort(([, a], [, b]) => (a.correct / a.presented) - (b.correct / b.presented))
    .slice(0, 3)
    .map(([name, v]) => {
      const pct = Math.round(100 * v.correct / v.presented);
      const col = pct < 60 ? 'var(--danger)' : pct < 80 ? 'var(--warn)' : 'var(--primary)';
      return `<span style="color:${col}">${name} ${pct}%</span>`;
    });
  const weakLine = weakList.length
    ? `<span style="flex-basis:100%;font-size:11px;color:var(--text-faint)">Weak: ${weakList.join(' · ')}</span>`
    : '';
  document.getElementById(`fb-ear-${subMode}-stats`).innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
    ${weakLine}
  `;
}

// Cancels any pending auto-advance timer for a submode — needed whenever a
// fresh question is generated some other way (manual Next, changing the
// scale) so the old timer doesn't also fire later and skip a question.
function fbEarClearTimeout(subMode) {
  const s = fbState.ear[subMode];
  if (s.timeoutId) { clearTimeout(s.timeoutId); s.timeoutId = null; }
}

function fbEarSetAutoAdvance(checked) {
  fbState.ear.autoAdvance = checked;
  fbPrefsSave();
  // A timer scheduled before this toggle flipped off would otherwise still
  // fire later and silently skip whatever question the player is looking at.
  if (!checked) { fbEarClearTimeout('two'); fbEarClearTimeout('three'); }
}

function fbEarManualNext(subMode) {
  fbEarClearTimeout(subMode);
  if (subMode === 'two') fbEarTwoNext(); else fbEarThreeNext();
  fbEarPlayCurrent(subMode);
}

// fbState.ear.direction controls whether questions play low-to-high,
// high-to-low, or (default) a random mix of both every time.
function fbEarPickOrder(ascOrder, descOrder) {
  const dir = fbState.ear.direction;
  if (dir === 'asc') return ascOrder;
  if (dir === 'desc') return descOrder;
  return Math.random() < 0.5 ? descOrder : ascOrder;
}

// Weighted pair selection: all pairs have at least 10% chance even if perfect,
// and weak intervals are up-weighted by (1 – accuracy). Falls back to uniform
// random when no stats exist or practiceMode is 'all'.
function fbEarPickPair(degrees) {
  const pairs = [];
  for (let a = 0; a < degrees.length; a++) {
    for (let b = a + 1; b < degrees.length; b++) {
      pairs.push([a, b]);
    }
  }
  if (fbState.ear.practiceMode !== 'weak') {
    return pairs[Math.floor(Math.random() * pairs.length)];
  }
  // Weighted selection
  const weights = pairs.map(([a, b]) => {
    const name = fbEarIntervalName(degrees[b] - degrees[a]);
    const st = fbState.ear.stats[name];
    const acc = st && st.presented > 0 ? st.correct / st.presented : 0.5;
    return Math.max(0.1, 1 - acc);  // floor at 0.1 so perfect intervals still appear
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let k = 0; k < pairs.length; k++) {
    r -= weights[k];
    if (r <= 0) return pairs[k];
  }
  return pairs[pairs.length - 1];
}

function fbEarTwoNext() {
  const s = fbState.ear.two;
  fbEarClearTimeout('two');
  s.answered = false;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const [i, j] = fbEarPickPair(degrees);
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  // i/j stay low-to-high (for the diagram and interval math); `order` is the
  // actual playback/reveal direction, which is independent — an interval
  // sounds the same size whether it's played ascending or descending.
  const order = fbEarPickOrder([i, j], [j, i]);
  s.current = { i, j, order, rootMidi, notes: order.map(idx => rootMidi + degrees[idx]), interval: degrees[j] - degrees[i] };

  fbRenderEarStats('two');
  document.getElementById('fb-ear-two-prompt').textContent = 'Listen — what interval spans the two notes?';
  document.getElementById('fb-ear-two-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarTwoAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbEarRenderDiagramFor('two', null);
}

function fbEarTwoAnswer(name, btnEl) {
  const s = fbState.ear.two;
  if (s.answered) return;
  s.answered = true;
  s.total++;
  const target = fbEarIntervalName(s.current.interval);
  const correct = name === target;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');
  // Per-interval accuracy tracking
  const st = fbState.ear.stats[target] || (fbState.ear.stats[target] = { presented: 0, correct: 0 });
  st.presented++;
  if (correct) st.correct++;
  fbEarSaveStats();

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const hint = FB_EAR_INTERVAL_HINTS[target] ? ` — like "${FB_EAR_INTERVAL_HINTS[target]}"` : '';
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = correct ? `Correct — ${target} (${noteDesc})${hint}` : `${target} (${noteDesc}) — you said ${name}${hint}`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderEarStats('two');
  fbEarRenderDiagramFor('two', { dots: [s.current.i, s.current.j], arcs: [{ i: s.current.i, j: s.current.j }] });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarTwoNext, correct ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// 3-note drill: asks the two *adjacent* intervals (1st-2nd, 2nd-3rd) rather
// than the outer 1st-3rd span, so the middle note is a real quiz target
// instead of just a passing tone — one question, answered in two steps.
function fbEarThreeNext() {
  const s = fbState.ear.three;
  fbEarClearTimeout('three');
  s.answered = false;
  s.step = 1;
  s.step1Correct = null;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  let idxs;
  do {
    idxs = [Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length)];
  } while (new Set(idxs).size < 3);
  idxs.sort((a, b) => a - b);
  const [i, mid, j] = idxs;
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  const order = fbEarPickOrder([i, mid, j], [j, mid, i]);
  const [interval1, interval2] = fbEarAdjacentIntervals(degrees, order);
  s.current = { i, mid, j, order, rootMidi, interval1, interval2, notes: order.map(idx => rootMidi + degrees[idx]) };

  fbRenderEarStats('three');
  fbEarRenderThreeStep();
  fbEarRenderDiagramFor('three', null);
}

function fbEarRenderThreeStep() {
  const s = fbState.ear.three;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const stepLabel = s.step === 1 ? '1st and 2nd' : '2nd and 3rd';
  document.getElementById('fb-ear-three-prompt').textContent = `Listen — what interval spans the ${stepLabel} notes?`;
  document.getElementById('fb-ear-three-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarThreeAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbEarThreeAnswer(name, btnEl) {
  const s = fbState.ear.three;
  if (s.answered) return;
  const target = s.step === 1 ? s.current.interval1 : s.current.interval2;
  const correct = name === fbEarIntervalName(target);
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  if (s.step === 1) {
    s.step1Correct = correct;
    const targetName = fbEarIntervalName(target);
    const hint1 = FB_EAR_INTERVAL_HINTS[targetName] ? ` — like "${FB_EAR_INTERVAL_HINTS[targetName]}"` : '';
    const fb = document.getElementById('fb-ear-three-feedback');
    fb.textContent = correct ? `Correct — ${targetName}${hint1}` : `${targetName} — you said ${name}${hint1}`;
    fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
    setTimeout(() => { s.step = 2; fbEarRenderThreeStep(); }, 900);
    return;
  }

  s.answered = true;
  s.total++;
  const overallCorrect = s.step1Correct && correct;
  if (overallCorrect) { s.correct++; s.streak++; } else { s.streak = 0; }

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const int1 = fbEarIntervalName(s.current.interval1), int2 = fbEarIntervalName(s.current.interval2);
  const hint2 = FB_EAR_INTERVAL_HINTS[int2] ? ` — like "${FB_EAR_INTERVAL_HINTS[int2]}"` : '';
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = overallCorrect
    ? `Correct — ${int1} then ${int2} (${noteDesc})${hint2}`
    : `${int1} then ${int2} (${noteDesc}) — you said ${name}${hint2}`;
  fb.className = 'fb-feedback ' + (overallCorrect ? 'ok' : 'err');
  fbRenderEarStats('three');
  fbEarRenderDiagramFor('three', {
    dots: [s.current.i, s.current.mid, s.current.j],
    arcs: [{ i: s.current.i, j: s.current.mid }, { i: s.current.mid, j: s.current.j }],
  });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarThreeNext, overallCorrect ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// ── Shared mic manager (used by both Pitch Match and Tuner) ──

const fbMic = {
  stream: null, audioCtx: null, analyser: null, rafId: null,
  deviceId: '', userSelectedDevice: false, listening: false, onFrame: null, owner: null,
};

// ── Shared master volume (0-1) — scales every gain this app generates ──
// Many audio interfaces (Focusrite Scarlett etc.) drive their line/headphone
// output from a physical hardware knob and don't expose a software volume
// control at all — the OS volume keys/slider silently do nothing for that
// output. This is the one loudness control guaranteed to work regardless,
// since it's applied before any audio ever leaves the app.
const FB_MASTER_VOLUME_KEY = 'fb_master_volume';
let fbMasterVolume = 1;

function fbMasterVolumeLoad() {
  const saved = parseFloat(localStorage.getItem(FB_MASTER_VOLUME_KEY));
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1) fbMasterVolume = saved;
}

function fbMasterVolumeChange(value) {
  fbMasterVolume = Math.max(0, Math.min(1, parseFloat(value) || 0));
  localStorage.setItem(FB_MASTER_VOLUME_KEY, String(fbMasterVolume));
  document.querySelectorAll('.fb-master-volume-slider').forEach(el => { el.value = fbMasterVolume; });
  document.dispatchEvent(new CustomEvent('fb-master-volume-change', {
    detail: { raw: fbMasterVolume, gain: fbMasterGain() },
  }));
}

// Human loudness perception is roughly logarithmic, not linear — a slider
// wired straight to linear gain makes the top half of its travel feel like
// it does almost nothing (moving 1.0 → 0.5 is only about -6dB) and squeezes
// all the noticeable change into a sliver near the bottom. Squaring the
// slider's 0-1 position before applying it as gain (a standard "audio taper"
// approximation) spreads perceptible change more evenly across the travel.
// fbMasterVolume itself stays the raw slider position (what's persisted and
// displayed); this is what actually multiplies into every gain calculation.
function fbMasterGain() {
  return fbMasterVolume * fbMasterVolume;
}

// ── Per-sound-category default volume — a second, independent knob on top
// of the master fader above. fbMasterGain() scales *everything* at once (for
// audio interfaces with no other software volume control); these let you
// fix one specific generated sound (the metronome, say) being too quiet by
// default without turning up every other sound along with it. Each category
// is a 0-1.5 multiplier on that sound's own baked-in peak amplitude, default
// 1 (i.e. "use the baked-in default, unchanged") — same on-top-of-master
// relationship fbMasterGain() has with a sound's own peak, just one layer
// further out. Rendered in Preferences (fbRenderSoundVolumePrefs below);
// persisted client-side same as fbMasterVolume, since it's a playback
// preference, not a server-backed setting.
const FB_SOUND_VOLUME_KEY = 'fb_sound_volumes';
const FB_SOUND_VOLUME_DEFAULT = 1;
// Raised from 1.5: the underlying click/beep peaks used to already sit at
// (near) digital full scale by default, so this slider had almost no real
// headroom before clipping regardless of its max — see the notes on
// stScheduleClick (speed-trainer.js) and ptBeep (practice-timer.js). Now
// that those peaks were pulled down, 2.0 has real room to be audible.
const FB_SOUND_VOLUME_MAX = 2;
// Every generated sound effect that already multiplies fbMasterGain() into
// its own gain calculation gets an entry here — add a new one whenever a new
// synthesized sound is added elsewhere, so it doesn't silently stay stuck at
// its hardcoded default forever.
const FB_SOUND_CATEGORIES = [
  { id: 'metronome', label: '节拍器 Metronome', hint: 'Speed Trainer 的节拍点击声' },
  { id: 'timerAlert', label: '计时器提醒音 Timer alert', hint: '练习计时器倒数结束时的三声提示音' },
  { id: 'practiceTones', label: '练耳 / 和弦试听 Practice tones', hint: 'Fretboard 的 Ear Training 音程播放 + Chord Match 的和弦进行试听' },
  { id: 'progressionChords', label: '级数进行试听 Progression playback', hint: 'Progressions 页面的和弦进行试听' },
  { id: 'countIn', label: '预备拍 Count-in', hint: 'Song Loop 播放前，补齐弱起小节/预备小节用的鼓棒声' },
];
let fbSoundVolumes = {};

function fbSoundVolumesLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_SOUND_VOLUME_KEY)) || {}; } catch (_) { saved = {}; }
  fbSoundVolumes = {};
  FB_SOUND_CATEGORIES.forEach(({ id }) => {
    const v = saved[id];
    fbSoundVolumes[id] = (Number.isFinite(v) && v >= 0 && v <= FB_SOUND_VOLUME_MAX) ? v : FB_SOUND_VOLUME_DEFAULT;
  });
}
function fbSoundVolumesSave() {
  localStorage.setItem(FB_SOUND_VOLUME_KEY, JSON.stringify(fbSoundVolumes));
}
// What a sound category's own gain calculation should multiply in, alongside
// fbMasterGain(). Falls back to the neutral default for an unrecognized id
// (shouldn't happen) rather than throwing, since this runs inline in every
// note/click's gain math.
function fbSoundGain(categoryId) {
  const v = fbSoundVolumes[categoryId];
  return Number.isFinite(v) ? v : FB_SOUND_VOLUME_DEFAULT;
}
function fbSetSoundVolume(categoryId, value) {
  const v = Math.max(0, Math.min(FB_SOUND_VOLUME_MAX, parseFloat(value)));
  fbSoundVolumes[categoryId] = Number.isFinite(v) ? v : FB_SOUND_VOLUME_DEFAULT;
  fbSoundVolumesSave();
}

// Rendered into Preferences (#fb-sound-volume-prefs) — see updateTransportForPage-
// style page-show hook in app.js's showPage('prefs') branch.
function fbRenderSoundVolumePrefs() {
  const el = document.getElementById('fb-sound-volume-prefs');
  if (!el) return;
  fbSoundVolumesLoad();
  const rows = FB_SOUND_CATEGORIES.map(({ id, label, hint }) => `
    <div class="field fb-sound-vol-row">
      <label title="${htmlEsc(hint)}">${htmlEsc(label)}</label>
      <input type="range" min="0" max="${FB_SOUND_VOLUME_MAX}" step="0.05" value="${fbSoundGain(id)}"
        oninput="fbSetSoundVolume('${id}', this.value); this.nextElementSibling.textContent = Math.round(this.value*100)+'%'">
      <span class="fb-sound-vol-pct">${Math.round(fbSoundGain(id) * 100)}%</span>
      <button type="button" class="btn btn-ghost btn-sm" title="恢复默认 100%"
        onclick="fbSetSoundVolume('${id}', 1); fbRenderSoundVolumePrefs()">重置</button>
    </div>
  `).join('');
  el.innerHTML = `
    <div class="prefs-form fb-sound-vol-form">
      <h3 class="fb-sound-vol-title">声音音量 · Sound volume</h3>
      <p class="fb-sound-vol-desc">在上面的总音量之外，单独调整每种合成音效的默认大小（100% = 默认值）。</p>
      ${rows}
    </div>
  `;
}

// ── Shared output-device selection (which speaker/interface plays back any
// audio the app generates — Ear Training and Speed Trainer's metronome so
// far, each with its own AudioContext) ──
// AudioContext.setSinkId() is a newer, Chromium-only API; everywhere else this
// silently no-ops and audio just keeps playing through the system default.
const FB_SETSINKID_SUPPORTED = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
const fbOutput = { deviceId: '', userSelectedDevice: false };
// Every AudioContext any feature creates registers itself here, so a single
// output-device change applies to all of them at once instead of just
// whichever one happened to exist when fbOutputDeviceChange last ran.
const fbRegisteredAudioContexts = new Set();

function fbRegisterAudioContext(ctx) {
  fbRegisteredAudioContexts.add(ctx);
  fbApplySinkId(ctx);
}

async function fbApplySinkId(ctx) {
  if (!ctx || !FB_SETSINKID_SUPPORTED || !fbOutput.deviceId) return;
  try { await ctx.setSinkId(fbOutput.deviceId); } catch (_) { /* device gone, or not permitted */ }
}

// HTMLMediaElement.setSinkId() is the same Audio Output Devices API, applied
// to a <audio>/<video> element instead of a Web Audio AudioContext — needed
// for anything that plays back real audio files (Song Loop's <audio id="sl-
// player">) rather than synthesizing tones through an AudioContext. Checked
// for support separately since in principle a browser could implement one
// without the other, even though in practice they track together.
const FB_MEDIA_SETSINKID_SUPPORTED = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const fbRegisteredMediaElements = new Set();

function fbRegisterMediaElement(el) {
  fbRegisteredMediaElements.add(el);
  fbApplySinkIdToMedia(el);
}

async function fbApplySinkIdToMedia(el) {
  if (!el || !FB_MEDIA_SETSINKID_SUPPORTED || !fbOutput.deviceId) return;
  try { await el.setSinkId(fbOutput.deviceId); } catch (_) { /* device gone, or not permitted */ }
}

function fbApplySinkIdToAll() {
  fbRegisteredAudioContexts.forEach(fbApplySinkId);
  fbRegisteredMediaElements.forEach(fbApplySinkIdToMedia);
}

// Output device labels only become readable after mic permission has been
// granted somewhere in the app (same browser rule as input labels) — called
// after that happens, and whenever an options panel with an output selector renders.
async function fbRefreshOutputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    if (!outputs.length) return;
    if (!fbOutput.userSelectedDevice) {
      const preferred = outputs.find(d => /scarlett|focusrite/i.test(d.label));
      if (preferred && preferred.deviceId !== fbOutput.deviceId) {
        fbOutput.deviceId = preferred.deviceId;
        fbApplySinkIdToAll();
      }
    }
    document.querySelectorAll('.fb-output-select').forEach(sel => {
      sel.innerHTML = outputs.map(d =>
        `<option value="${d.deviceId}" ${d.deviceId === fbOutput.deviceId ? 'selected' : ''}>${d.label || 'Speaker'}</option>`
      ).join('');
    });
  } catch (_) { /* enumeration not available */ }
}

async function fbOutputDeviceChange(deviceId) {
  fbOutput.userSelectedDevice = true;
  fbOutput.deviceId = deviceId;
  document.querySelectorAll('.fb-output-select').forEach(sel => { sel.value = deviceId; });
  fbApplySinkIdToAll();
}

async function fbMicStart(owner, onFrame, fftSize = 2048) {
  if (fbMic.listening) fbMicStop();
  const constraints = { audio: fbMic.deviceId ? { deviceId: { exact: fbMic.deviceId } } : true };
  fbMic.stream = await navigator.mediaDevices.getUserMedia(constraints); // throws if denied — caller handles it
  await fbMicAutoSelectAndRefreshDevices();
  fbMic.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fbMic.analyser = fbMic.audioCtx.createAnalyser();
  fbMic.analyser.fftSize = fftSize;
  fbMic.analyser.smoothingTimeConstant = 0.3;
  fbMic.audioCtx.createMediaStreamSource(fbMic.stream).connect(fbMic.analyser);
  fbMic.onFrame = onFrame;
  fbMic.owner = owner;
  fbMic.listening = true;
  fbMicTick();
}

function fbMicStop() {
  if (fbMic.rafId) cancelAnimationFrame(fbMic.rafId);
  fbMic.rafId = null;
  if (fbMic.stream) fbMic.stream.getTracks().forEach(t => t.stop());
  if (fbMic.audioCtx) fbMic.audioCtx.close();
  fbMic.stream = null; fbMic.audioCtx = null; fbMic.analyser = null;
  fbMic.listening = false; fbMic.onFrame = null; fbMic.owner = null;
}

function fbMicTick() {
  if (!fbMic.listening) return;
  // each consumer pulls whatever it needs (time-domain for autocorrelation,
  // frequency-domain for chroma) — avoids paying for both on every frame
  if (fbMic.onFrame) fbMic.onFrame(fbMic.analyser, fbMic.audioCtx.sampleRate);
  fbMic.rafId = requestAnimationFrame(fbMicTick);
}

// After permission is granted, device labels become readable. Auto-pick an
// audio interface (Focusrite/Scarlett etc.) over the default mic unless the
// user has explicitly chosen a device themselves.
async function fbMicAutoSelectAndRefreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    if (!inputs.length) return;
    if (!fbMic.userSelectedDevice) {
      const preferred = inputs.find(d => /scarlett|focusrite/i.test(d.label));
      if (preferred && preferred.deviceId !== fbMic.deviceId) {
        fbMic.deviceId = preferred.deviceId;
        if (fbMic.stream) fbMic.stream.getTracks().forEach(t => t.stop());
        fbMic.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferred.deviceId } } });
      }
    }
    document.querySelectorAll('.fb-device-select').forEach(sel => {
      sel.innerHTML = inputs.map(d =>
        `<option value="${d.deviceId}" ${d.deviceId === fbMic.deviceId ? 'selected' : ''}>${d.label || 'Microphone'}</option>`
      ).join('');
    });
    // Granting mic permission is also what unlocks readable output-device
    // labels, so this is the natural point to refresh those too.
    await fbRefreshOutputDevices();
  } catch (_) { /* enumeration not available */ }
}

async function fbMicDeviceChange(deviceId) {
  fbMic.userSelectedDevice = true;
  fbMic.deviceId = deviceId;
  document.querySelectorAll('.fb-device-select').forEach(sel => { sel.value = deviceId; });
  if (fbMic.listening) {
    const owner = fbMic.owner, cb = fbMic.onFrame, fftSize = fbMic.analyser.fftSize;
    fbMicStop();
    try { await fbMicStart(owner, cb, fftSize); fbSyncMicButtons(owner); } catch (_) {}
  }
}

// The four mic drills (Pitch / Tuner / Chord / Bend) no longer own an inline
// start/stop pair — their Start Listening / Stop toggle lives in the app-wide
// transport bar (fixed at the bottom, defined in app.js). Their start/stop
// functions still call fbSyncMicButtons() after toggling, so we keep the name
// and just push the listening state to that shared bar.
function fbSyncMicButtons() {
  if (typeof setTransportState === 'function') setTransportState(fbMic.listening ? 'listening' : 'stopped');
}

// Start/stop handlers for each mic drill. Functions are hoisted, so referencing
// them here (only ever called lazily) is safe despite definition order.
function fbMicDrillHandlers(mode) {
  switch (mode) {
    case 'pitch': return { start: fbPitchStart,   stop: fbPitchStop };
    case 'tuner': return { start: fbTunerStart,   stop: fbTunerStop };
    case 'chord': return { start: fbChordStart,   stop: fbChordStop };
    case 'bend':  return { start: fbBendMicStart, stop: fbBendMicStop };
    case 'seq':   return fbState.seq.mode === 'verify' ? { start: fbSeqStart, stop: fbSeqStop } : null;
    default:      return null;
  }
}

// Registers whichever mic drill is on screen as the app's active transport (so
// its Start Listening / Stop shows in the bottom bar), or clears the bar on
// non-mic modes and other pages. Called on page- and sub-mode switches.
const FB_MIC_DRILL_LABELS = { pitch: 'Pitch Match', tuner: 'Tuner', chord: 'Chord Match', bend: 'Bend & Vibrato', seq: 'Scale Sequences' };
function fbRenderControlAction() {
  if (typeof registerTransport !== 'function') return; // app.js not loaded (e.g. unit tests)
  // Chord Match is a separate page from Fretboard now, but still drives the
  // same mic-drill transport pattern — its mode is implied by which page is
  // active, not read from fbState.activeMode (that only ever varies across
  // Fretboard's own remaining tabs).
  const onChordMatch = document.getElementById('page-chordmatch')?.classList.contains('active');
  const onFretboard = document.getElementById('page-fretboard')?.classList.contains('active');
  const mode = onChordMatch ? 'chord' : (onFretboard ? fbState.activeMode : null);
  const handlers = mode ? fbMicDrillHandlers(mode) : null;
  if (!handlers) { clearTransport(); return; }
  registerTransport({
    kind: 'listen', label: FB_MIC_DRILL_LABELS[mode],
    play: handlers.start, stop: handlers.stop,
  });
  // reflect the live listening state (e.g. re-registered mid-session on a device change)
  setTransportState(fbMic.listening && fbMic.owner === mode ? 'listening' : 'stopped');
}

// ── Pitch Match drill (mic-based ear training) ──

const FB_MATCH_CENTS_TOLERANCE = 15;
const FB_MATCH_HOLD_FRAMES = 12;  // ~0.2s at 60fps — avoids false triggers on transients
const FB_WRONG_HOLD_FRAMES = 10;  // ~0.17s of a stable wrong note before we say something
const FB_WRONG_MSG_COOLDOWN_MS = 700;
const FB_METER_HOLD_MS = 1200; // how long a reading lingers after the note decays into silence
const FB_PITCH_STATS_KEY = 'fb_pitch_note_stats';

function fbRenderPitchMeter(r, held) {
  const meter = document.getElementById('fb-pitch-meter');
  meter.innerHTML = `
    <div class="fb-pitch-detected${r.isMatch ? ' match' : ''}${held ? ' held' : ''}">${r.noteName}<span class="fb-pitch-octave">${fbOctaveOf(r.midi)}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents} cents</div>
  `;
}

// Tracks time the tab spends hidden (switched away) so it can be excluded
// from reaction-time measurements — otherwise tabbing away mid-question
// inflates that note's recorded "time to find it".
document.addEventListener('visibilitychange', () => {
  [fbState.pitch, fbState.chord].forEach(s => {
    if (document.hidden) {
      s._hiddenSince = performance.now();
    } else if (s._hiddenSince != null) {
      s._hiddenMs = (s._hiddenMs || 0) + (performance.now() - s._hiddenSince);
      s._hiddenSince = null;
    }
  });
});

function fbPitchLoadStats() {
  try { fbState.pitch.stats = JSON.parse(localStorage.getItem(FB_PITCH_STATS_KEY)) || {}; }
  catch (_) { fbState.pitch.stats = {}; }
}
function fbPitchSaveStats() {
  localStorage.setItem(FB_PITCH_STATS_KEY, JSON.stringify(fbState.pitch.stats));
}

function fbRenderPitchOptions() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-options').innerHTML = `
    <span>Strings:</span>
    ${FB_STRING_NAMES.map((n, i) => `
      <label><input type="checkbox" ${s.strings[i] ? 'checked' : ''} onchange="fbPitchToggleString(${i})"> ${n}${i===0?'(low)':i===5?'(high)':''}</label>
    `).join('')}
    <span style="margin-left:12px">Practice:</span>
    <select onchange="fbState.pitch.practiceMode=this.value; fbPrefsSave()">
      <option value="all" ${s.practiceMode==='all'?'selected':''}>All notes</option>
      <option value="weak" ${s.practiceMode==='weak'?'selected':''}>Focus on weak notes</option>
    </select>
    <label style="margin-left:12px"><input type="checkbox" ${s.showBoard ? 'checked' : ''}
      onchange="fbState.pitch.showBoard=this.checked; fbPrefsSave(); fbRenderPitchBoard()"> Show fretboard diagram</label>
    <label style="margin-left:12px"><input type="checkbox" ${s.naturalsOnly ? 'checked' : ''}
      onchange="fbState.pitch.naturalsOnly=this.checked; fbPrefsSave()"> Naturals only (A-G, no #/b)</label>
  `;
}

// Marks every position where the current target note occurs on the enabled
// strings (unlike the Note Names drill, which marks one specific spot — here
// the target is a note *name*, playable at several positions, so all of them
// light up). Off by default: most people practicing pitch matching by ear
// don't want the answer already drawn on the neck.
function fbRenderPitchBoard() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-board');
  if (!el) return;
  if (!s.showBoard || !s.target) { el.innerHTML = ''; return; }

  const b = fbBuildBoard(12, 0);
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    if (!s.strings[stringIdx]) continue;
    for (let fret = 0; fret <= 12; fret++) {
      if (fbNoteAt(stringIdx, fret) !== s.target) continue;
      const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', fbMarkerX(b, fret));
      circ.setAttribute('cy', b.yString(stringIdx));
      circ.setAttribute('r', fret === 0 ? 10 : 11);
      circ.setAttribute('class', fret === 0 ? 'fb-open-marker' : 'fb-quiz-dot');
      b.svg.appendChild(circ);
    }
  }
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  el.appendChild(wrap);
}

function fbPitchToggleString(i) {
  const s = fbState.pitch;
  s.strings[i] = !s.strings[i];
  if (!s.strings.some(Boolean)) s.strings[i] = true; // keep at least one
  fbPrefsSave();
}

function fbPitchResetStats() {
  fbState.pitch.stats = {};
  fbPitchSaveStats();
  fbRenderPitchStatsTable();
}

// All open+fret(0..12) MIDI notes on one string.
function fbStringMidis(stringIdx) {
  const base = FB_STRING_OPEN_MIDI[stringIdx];
  const arr = [];
  for (let fret = 0; fret <= 12; fret++) arr.push(base + fret);
  return arr;
}

// Which absolute MIDI notes count as "correct" for a target note name, given
// the selected string filter. With all 6 strings selected (default) this
// spans several octaves — effectively unrestricted. Narrowing to one or two
// strings pins down which octave(s) are accepted, since we can't tell from
// audio alone which physical string was actually played (a given pitch can
// exist on several strings at once) — restricting strings instead restricts
// which octave is accepted as "found on that string".
function fbPitchAllowedMidis(noteName) {
  const s = fbState.pitch;
  const idx = FB_NOTE_NAMES.indexOf(noteName);
  const midis = new Set();
  for (let i = 0; i < 6; i++) {
    if (!s.strings[i]) continue;
    fbStringMidis(i).forEach(m => { if (((m % 12) + 12) % 12 === idx) midis.add(m); });
  }
  return midis;
}

// A-G only, no sharps — used when fbState.pitch.naturalsOnly is checked.
const FB_NATURAL_NOTE_NAMES = FB_NOTE_NAMES.filter(n => !n.includes('#'));

function fbPitchPickTarget() {
  const s = fbState.pitch;
  const pool = s.naturalsOnly ? FB_NATURAL_NOTE_NAMES : FB_NOTE_NAMES;
  if (s.practiceMode !== 'weak') return pool[Math.floor(Math.random() * pool.length)];
  const weights = pool.map(n => {
    const st = s.stats[n];
    if (!st || !st.presented) return 3; // unseen notes get decent priority too
    const acc = st.matched / st.presented;
    const avgMs = st.matched ? st.totalMs / st.matched : 4000;
    return Math.max(0.2, (1 - acc) * 4 + avgMs / 1500 + (st.wrongHits || 0) * 0.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function fbRenderPitchStats() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderPitchStatsTable() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-stats-table');
  if (!el) return;
  const rows = FB_NOTE_NAMES.map(n => {
    const st = s.stats[n];
    const presented = st?.presented || 0;
    const matched = st?.matched || 0;
    const acc = presented ? Math.round((matched / presented) * 100) : null;
    const avg = matched ? (st.totalMs / matched / 1000).toFixed(1) : null;
    return { n, presented, acc, avg, wrong: st?.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span style="color:#aaa;font-size:12px">No attempts yet — start listening and play some notes.</span>';
    return;
  }
  el.innerHTML = fbStatsTableHead('Per-note accuracy', 'fbPitchResetStats') + `
    <table class="fb-stats-table">
      <tr><th>Note</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.n}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbPitchNewNote() {
  const s = fbState.pitch;
  s.target = fbPitchPickTarget();
  s.matched = false;
  s._holdCount = 0;
  s._wrongNote = null;
  s._wrongHoldCount = 0;
  s._lastReading = null;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[s.target] || (s.stats[s.target] = { presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbPitchSaveStats();

  document.getElementById('fb-pitch-target').textContent = s.target;
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  fbRenderPitchBoard();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

async function fbPitchStart() {
  try {
    await fbMicStart('pitch', fbPitchOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-pitch-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('pitch');
}

function fbPitchStop() {
  fbMicStop();
  fbSyncMicButtons('pitch');
  document.getElementById('fb-pitch-meter').innerHTML = '';
}

function fbPitchOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.pitch;
  const meter = document.getElementById('fb-pitch-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // A plucked string decays below the silence threshold well before you've
    // had time to read the meter — hold the last reading for a bit instead
    // of snapping straight back to "listening…".
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderPitchMeter(s._lastReading, true);
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">listening…</div>`;
    }
    s._holdCount = 0;
    return;
  }

  const { noteName, cents, midi } = fbFreqToNote(freq);
  const allowed = fbPitchAllowedMidis(s.target);
  const isMatch = noteName === s.target && allowed.has(midi) && Math.abs(cents) <= FB_MATCH_CENTS_TOLERANCE;
  s._lastReading = { noteName, cents, midi, freq, isMatch, ts: now };
  fbRenderPitchMeter(s._lastReading, false);
  if (s.matched) return;

  if (isMatch) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_MATCH_HOLD_FRAMES) fbPitchOnMatch();
    return;
  }
  s._holdCount = 0;
  if (noteName === s._wrongNote) s._wrongHoldCount++;
  else { s._wrongNote = noteName; s._wrongHoldCount = 1; }
  if (s._wrongHoldCount === FB_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_WRONG_MSG_COOLDOWN_MS) {
    fbPitchOnWrong(noteName, midi);
  }
}

function fbPitchOnWrong(noteName, midi) {
  const s = fbState.pitch;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target];
  if (st) { st.wrongHits++; fbPitchSaveStats(); }
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Not quite — heard ${noteName}${fbOctaveOf(midi)}, target is ${s.target}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbPitchOnMatch() {
  const s = fbState.pitch;
  s.matched = true;
  // exclude time the tab spent in the background (switched away, etc.) so a
  // distracted pause doesn't get counted as "slow to find the note"
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target];
  st.matched++; st.totalMs += elapsedMs;
  fbPitchSaveStats();
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Matched ${s.target} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbPitchNewNote, 900);
}

// ── Tuner (auto-detects nearest string from pitch, shows sharp/flat + in-tune) ──

const FB_TUNER_TOLERANCE_CENTS = 5;
const FB_TUNER_HOLD_FRAMES = 15; // ~0.25s sustained in-tune before marking a string done

// Tuner has no mode-specific options of its own — input/output device
// pickers now live in the shared fb-device-bar above the mode tabs.

function fbRenderTunerStrings() {
  const s = fbState.tuner;
  document.getElementById('fb-tuner-strings').innerHTML = FB_STRING_NAMES.map((n, i) => `
    <div class="fb-tuner-chip${s.tuned[i] ? ' done' : ''}${s.activeString === i ? ' active' : ''}">${n}${i===0?' (6)':i===5?' (1)':''}</div>
  `).join('');
}

async function fbTunerStart() {
  try {
    await fbMicStart('tuner', fbTunerOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-tuner-hint');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('tuner');
}

function fbTunerStop() {
  fbMicStop();
  fbSyncMicButtons('tuner');
  document.getElementById('fb-tuner-meter').innerHTML = '';
  fbState.tuner.activeString = -1;
  fbRenderTunerStrings();
}

function fbTunerReset() {
  fbState.tuner.tuned = [false, false, false, false, false, false];
  fbRenderTunerStrings();
}

function fbRenderTunerMeter(r) {
  const meter = document.getElementById('fb-tuner-meter');
  const inTune = Math.abs(r.cents) <= FB_TUNER_TOLERANCE_CENTS;
  const dir = inTune ? 'In tune ✓' : (r.cents < 0 ? 'Too low — tune UP ⬆' : 'Too high — tune DOWN ⬇');
  meter.innerHTML = `
    <div class="fb-pitch-detected${inTune ? ' match' : ''}${r.held ? ' held' : ''}">${FB_STRING_NAMES[r.string]} string<span class="fb-pitch-octave">${r.via}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents.toFixed(0)} cents &nbsp;·&nbsp; ${dir}</div>
  `;
}

function fbTunerOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.tuner;
  const meter = document.getElementById('fb-tuner-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // hold the last reading briefly instead of vanishing the instant the note decays
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">play a string…</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  // Match against every string's open pitch AND its 12th-fret (octave-up) pitch,
  // and take whichever reference is closest — so open-string or 12th-fret
  // harmonic playing both work for tuning.
  let best = null;
  for (let i = 0; i < 6; i++) {
    [0, 12].forEach(offset => {
      const refFreq = fbFreqFromMidi(FB_STRING_OPEN_MIDI[i] + offset);
      const cents = 1200 * Math.log2(freq / refFreq);
      if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { string: i, cents, via: offset === 0 ? 'open' : '12th-fret' };
    });
  }

  if (!best || Math.abs(best.cents) > 60) {
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">${freq.toFixed(1)} Hz</div><div class="fb-pitch-hz">no clear string match — play one string at a time</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  s.activeString = best.string;
  s._lastReading = { string: best.string, cents: best.cents, via: best.via, freq, ts: now };
  fbRenderTunerMeter(s._lastReading);

  const inTune = Math.abs(best.cents) <= FB_TUNER_TOLERANCE_CENTS;
  if (inTune) {
    s._holdCount = (s._holdString === best.string) ? s._holdCount + 1 : 1;
    s._holdString = best.string;
    if (s._holdCount >= FB_TUNER_HOLD_FRAMES) s.tuned[best.string] = true;
  } else {
    s._holdCount = 0; s._holdString = -1;
  }
  fbRenderTunerStrings();
}

// ── Chord Match drill (mic-based chord sight-reading) ──
//
// Chords are polyphonic, so monophonic autocorrelation doesn't apply here.
// Instead this uses a chroma / pitch-class profile (PCP): FFT the signal,
// fold spectral energy from every bin into one of 12 pitch-class buckets
// (ignoring octave), then compare that 12-value "which notes are ringing"
// vector against a template for the target chord via cosine similarity.
// This only checks pitch content, not voicing — any shape/inversion that
// contains the right notes will match, which is what "sight-reading a
// chord symbol" should reward. It's inherently less precise than single-note
// detection (strum noise, muted strings, room noise all leak in), so the
// match threshold is deliberately conservative.

// interval sets in semitones from the root
const FB_CHORD_QUALITIES = {
  '':     [0, 4, 7],      // major
  'm':    [0, 3, 7],      // minor
  'maj7': [0, 4, 7, 11],  // major 7
  '7':    [0, 4, 7, 10],  // dominant 7
  'm7':   [0, 3, 7, 10],  // minor 7
  'dim7': [0, 3, 6, 9],   // fully diminished 7
  'm7b5': [0, 3, 6, 10],  // half-diminished 7 (minor 7 flat 5)
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  '6':     [0, 4, 7, 9],   // major 6
  'm6':    [0, 3, 7, 9],   // minor 6
  'add9':  [0, 4, 7, 2],   // major triad + 9 (no 7th)
  'madd9': [0, 3, 7, 2],   // minor triad + 9 (no 7th)
  '9':     [0, 4, 7, 10, 2], // dominant 9
  'm9':    [0, 3, 7, 10, 2], // minor 9
  'maj9':  [0, 4, 7, 11, 2], // major 9
  'dim':   [0, 3, 6],        // diminished triad
  'aug':   [0, 4, 8],        // augmented triad
  '7sus4': [0, 5, 7, 10],    // dominant 7 sus4
  '6/9':   [0, 4, 7, 9, 2],  // major 6/9
  'mmaj7': [0, 3, 7, 11],    // minor-major 7
  '7b9':   [0, 4, 7, 10, 1], // altered dominant, flat 9
  '7#9':   [0, 4, 7, 10, 3], // altered dominant, sharp 9 ("Hendrix chord")
};
const FB_CHORD_QUALITY_LABELS = {
  '': 'Major', 'm': 'Minor', 'maj7': 'Maj7', '7': 'Dominant 7', 'm7': 'Minor 7',
  'dim7': 'Diminished 7', 'm7b5': 'Half-dim 7 (m7♭5)', 'sus2': 'Sus2', 'sus4': 'Sus4',
  '6': 'Major 6', 'm6': 'Minor 6', 'add9': 'Add9', 'madd9': 'Minor add9',
  '9': 'Dominant 9', 'm9': 'Minor 9', 'maj9': 'Major 9',
  'dim': 'Diminished', 'aug': 'Augmented', '7sus4': '7sus4', '6/9': 'Major 6/9',
  'mmaj7': 'Minor-Major 7', '7b9': 'Dominant 7♭9', '7#9': 'Dominant 7♯9',
};
// scale-degree formula for each quality, in the same order as FB_CHORD_QUALITIES[quality]
const FB_CHORD_DEGREE_LABELS = {
  '':     ['1', '3', '5'],
  'm':    ['1', 'b3', '5'],
  'maj7': ['1', '3', '5', '7'],
  '7':    ['1', '3', '5', 'b7'],
  'm7':   ['1', 'b3', '5', 'b7'],
  'dim7': ['1', 'b3', 'b5', 'bb7'],
  'm7b5': ['1', 'b3', 'b5', 'b7'],
  'sus2': ['1', '2', '5'],
  'sus4': ['1', '4', '5'],
  '6':     ['1', '3', '5', '6'],
  'm6':    ['1', 'b3', '5', '6'],
  'add9':  ['1', '3', '5', '9'],
  'madd9': ['1', 'b3', '5', '9'],
  '9':     ['1', '3', '5', 'b7', '9'],
  'm9':    ['1', 'b3', '5', 'b7', '9'],
  'maj9':  ['1', '3', '5', '7', '9'],
  'dim':   ['1', 'b3', 'b5'],
  'aug':   ['1', '3', '#5'],
  '7sus4': ['1', '4', '5', 'b7'],
  '6/9':   ['1', '3', '5', '6', '9'],
  'mmaj7': ['1', 'b3', '5', '7'],
  '7b9':   ['1', '3', '5', 'b7', 'b9'],
  '7#9':   ['1', '3', '5', 'b7', '#9'],
};
function fbChordFormula(quality) {
  return FB_CHORD_QUALITIES[quality].map((iv, idx) => FB_CHORD_DEGREE_LABELS[quality][idx]).join('  ');
}
// Two ways to spell a chord symbol: plain/standard, or classic jazz notation
// (as used by iReal Pro and jazz lead sheets: "-" for minor, "Δ7" for major7,
// "°7" for diminished7, "ø7" for half-diminished). Purely a display choice —
// the internal `quality` key (used for matching/stats) never changes.
const FB_CHORD_NOTATION_STYLES = {
  standard: { label: 'Standard (Cm, Cmaj7, Cm7b5)',
    suffixes: { '': '', m: 'm', maj7: 'maj7', '7': '7', m7: 'm7', dim7: 'dim7', m7b5: 'm7b5', sus2: 'sus2', sus4: 'sus4',
                '6': '6', m6: 'm6', add9: 'add9', madd9: 'm(add9)', '9': '9', m9: 'm9', maj9: 'maj9',
                dim: 'dim', aug: 'aug', '7sus4': '7sus4', '6/9': '6/9', mmaj7: 'm(maj7)', '7b9': '7b9', '7#9': '7#9' } },
  jazz: { label: 'Jazz / iReal Pro (C-, CΔ7, Cø7)',
    suffixes: { '': '', m: '-', maj7: 'Δ7', '7': '7', m7: '-7', dim7: '°7', m7b5: 'ø7', sus2: 'sus2', sus4: 'sus4',
                '6': '6', m6: '-6', add9: 'add9', madd9: '-(add9)', '9': '9', m9: '-9', maj9: 'Δ9',
                dim: '°', aug: '+', '7sus4': '7sus4', '6/9': '6/9', mmaj7: '-Δ7', '7b9': '7♭9', '7#9': '7♯9' } },
};
function fbChordDisplaySymbol(root, quality) {
  const style = FB_CHORD_NOTATION_STYLES[fbState.chord.notationStyle] || FB_CHORD_NOTATION_STYLES.standard;
  return FB_NOTE_NAMES[root] + style.suffixes[quality];
}

// Per-string scale-degree label for a shape (e.g. the classic "1 5 1 3 5 1"
// used to memorize the E-shape major barre chord). Computed from the shape's
// own string offsets, independent of which actual root/fret it's barred at.
function fbShapeDegreeLabels(shape, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const degreeLabels = FB_CHORD_DEGREE_LABELS[quality];
  const intervalToLabel = {};
  intervals.forEach((iv, idx) => { intervalToLabel[iv] = degreeLabels[idx]; });
  const rootBase = FB_STRING_OPEN[shape.rootString] + shape.rootFret;
  return shape.frets.map((v, i) => {
    if (v === 'x') return null;
    const offset = ((FB_STRING_OPEN[i] + v - rootBase) % 12 + 12) % 12;
    return intervalToLabel[offset] || '?';
  });
}
// Two-tier selection: the group checkbox is a bulk toggle for every quality
// inside it (all-on/all-off), but each quality underneath can still be
// switched individually — group checkbox shows an indeterminate dash when
// the group is only partly selected.
const FB_CHORD_GROUPS = {
  triad:   { label: 'Triads', qualities: ['', 'm', 'dim', 'aug'] },
  seventh: { label: '7th Chords', qualities: ['maj7', '7', 'm7', 'dim7', 'm7b5', 'mmaj7'] },
  sus:     { label: 'Sus Chords', qualities: ['sus2', 'sus4', '7sus4'] },
  sixth:   { label: '6th Chords', qualities: ['6', 'm6', '6/9'] },
  ninth:   { label: '9th / add9 Chords (pop, R&B, neo-soul)', qualities: ['add9', 'madd9', '9', 'm9', 'maj9'] },
  altered: { label: 'Altered Dominants (jazz/blues)', qualities: ['7b9', '7#9'] },
};
const FB_CHORD_MATCH_SIM = 0.82;
const FB_CHORD_WRONG_SIM = 0.68;
const FB_CHORD_MATCH_HOLD_FRAMES = 15;   // ~0.25s sustained — chords need a beat to ring out
const FB_CHORD_WRONG_HOLD_FRAMES = 15;
const FB_CHORD_WRONG_MSG_COOLDOWN_MS = 900;
const FB_CHORD_STATS_KEY = 'fb_chord_stats';
const FB_CHORD_MIN_HZ = 70, FB_CHORD_MAX_HZ = 1200, FB_CHORD_NOISE_FLOOR_DB = -70;

// Movable barre-chord voicings for Learn Mode, keyed by shape family then
// quality. These are the standard E/A/D "CAGED" families — the three shapes
// guitarists actually use as movable barre chords (unlike the C/A/G/E/D
// open-position set, C and G aren't practical barre shapes past the nut).
// Each pattern is { frets, rootFret }: rootFret is which fret (within the
// pattern's own numbering) carries the root note — usually 0, but dim7/m7b5
// shapes below need it >0 because the lowest fretted note in the barre isn't
// always the root.
//
// Major/minor/7th/maj7/sus2/sus4 patterns are derived directly from the
// well-known open chord of that name (e.g. E-shape 'm7' is literally open
// Em7: 0,2,0,0,0,0). dim7 and m7b5 aren't open-chord derivatives — they're
// sourced from published movable fingerings and verified here against the
// chord's own interval formula before use:
//   - dim7 E-shape from Gdim7 "3x232x" (guitarcommand.com / fachords.com)
//   - dim7 A-shape from Cdim7 "x3424x" (fachords.com)
//   - dim7 D-shape derived analytically (E/A "root-below-barre" pattern
//     extended to the D-string family), verified against the formula
//   - m7b5 E-shape from Am7b5 "5x554x" (guitarcommand.com)
//   - m7b5 A-shape from Bm7b5 "x2323x" (fachords.com)
//   - m7b5 D-shape from Em7b5 "xx2333" (fachords.com)
// 6/m6/add9/madd9/9/m9/maj9 shapes below are derived the same way as the
// sus2/sus4 shapes above: real open-position chords (E6, Em6, E9, Em9,
// Emaj9, Eadd9, Em(add9) and their A-shape equivalents) verified against
// each quality's own interval formula (see verify_shapes.js reasoning —
// pitch-class of every fretted string minus root pitch-class must cover
// the formula's interval set). No D-shape voicing is included for
// add9/madd9/9/m9/maj9 — the only fingerings that hit every required tone
// need an awkward 5-fret reach on the D-string family, so those are
// intentionally left out rather than shipping an impractical shape.
// dim/aug/7sus4/6-9/mmaj7 shapes are likewise sourced from real open chords
// (Edim/Adim/Ddim, Eaug/Aaug/Daug, E7sus4/A7sus4/D7sus4, E6-9/A6-9,
// Em(maj7)/Am(maj7)/Dm(maj7)) and verified the same way against each
// quality's interval formula.
const FB_MOVABLE_SHAPES = {
  E: { rootString: 0, patterns: {
    '':     { frets: [0, 2, 2, 1, 0, 0], rootFret: 0 },
    'm':    { frets: [0, 2, 2, 0, 0, 0], rootFret: 0 },
    '7':    { frets: [0, 2, 0, 1, 0, 0], rootFret: 0 },
    'm7':   { frets: [0, 2, 0, 0, 0, 0], rootFret: 0 },
    'maj7': { frets: [0, 2, 1, 1, 0, 0], rootFret: 0 },
    'dim7': { frets: [1, 'x', 0, 1, 0, 'x'], rootFret: 1 },
    'm7b5': { frets: [1, 'x', 1, 1, 0, 'x'], rootFret: 1 },
    'sus2': { frets: [0, 2, 4, 4, 0, 0], rootFret: 0 },
    'sus4': { frets: [0, 2, 2, 2, 0, 0], rootFret: 0 },
    '6':     { frets: [0, 2, 2, 1, 2, 0], rootFret: 0 },
    'm6':    { frets: [0, 2, 2, 0, 2, 0], rootFret: 0 },
    'add9':  { frets: [0, 2, 2, 1, 0, 2], rootFret: 0 },
    'madd9': { frets: [0, 2, 2, 0, 0, 2], rootFret: 0 },
    '9':     { frets: [0, 2, 0, 1, 0, 2], rootFret: 0 },
    'm9':    { frets: [0, 2, 0, 0, 0, 2], rootFret: 0 },
    'maj9':  { frets: [0, 2, 1, 1, 0, 2], rootFret: 0 },
    'dim':   { frets: [1, 'x', 'x', 1, 0, 'x'], rootFret: 1 },
    'aug':   { frets: [0, 3, 2, 1, 1, 0], rootFret: 0 },
    '7sus4': { frets: [0, 2, 0, 2, 0, 0], rootFret: 0 },
    '6/9':   { frets: [0, 'x', 2, 1, 2, 2], rootFret: 0 },
    'mmaj7': { frets: [0, 2, 1, 0, 0, 0], rootFret: 0 },
  }},
  A: { rootString: 1, patterns: {
    '':     { frets: ['x', 0, 2, 2, 2, 0], rootFret: 0 },
    'm':    { frets: ['x', 0, 2, 2, 1, 0], rootFret: 0 },
    '7':    { frets: ['x', 0, 2, 0, 2, 0], rootFret: 0 },
    'm7':   { frets: ['x', 0, 2, 0, 1, 0], rootFret: 0 },
    'maj7': { frets: ['x', 0, 2, 1, 2, 0], rootFret: 0 },
    'dim7': { frets: ['x', 1, 2, 0, 2, 'x'], rootFret: 1 },
    'm7b5': { frets: ['x', 0, 1, 0, 1, 'x'], rootFret: 0 },
    'sus2': { frets: ['x', 0, 2, 2, 0, 0], rootFret: 0 },
    'sus4': { frets: ['x', 0, 2, 2, 3, 0], rootFret: 0 },
    '6':     { frets: ['x', 0, 2, 2, 2, 2], rootFret: 0 },
    'm6':    { frets: ['x', 0, 2, 2, 1, 2], rootFret: 0 },
    'add9':  { frets: ['x', 0, 2, 4, 2, 'x'], rootFret: 0 },
    'madd9': { frets: ['x', 0, 2, 4, 1, 'x'], rootFret: 0 },
    '9':     { frets: ['x', 0, 2, 4, 2, 3], rootFret: 0 },
    'm9':    { frets: ['x', 0, 2, 4, 1, 3], rootFret: 0 },
    'maj9':  { frets: ['x', 0, 2, 4, 2, 4], rootFret: 0 },
    'dim':   { frets: ['x', 1, 2, 'x', 2, 'x'], rootFret: 1 },
    'aug':   { frets: ['x', 0, 3, 2, 2, 1], rootFret: 0 },
    '7sus4': { frets: ['x', 0, 2, 0, 3, 0], rootFret: 0 },
    '6/9':   { frets: ['x', 0, 'x', 4, 2, 2], rootFret: 0 },
    'mmaj7': { frets: ['x', 0, 2, 1, 1, 0], rootFret: 0 },
  }},
  D: { rootString: 2, patterns: {
    '':     { frets: ['x', 'x', 0, 2, 3, 2], rootFret: 0 },
    'm':    { frets: ['x', 'x', 0, 2, 3, 1], rootFret: 0 },
    '7':    { frets: ['x', 'x', 0, 2, 1, 2], rootFret: 0 },
    'm7':   { frets: ['x', 'x', 0, 2, 1, 1], rootFret: 0 },
    'maj7': { frets: ['x', 'x', 0, 2, 2, 2], rootFret: 0 },
    'dim7': { frets: ['x', 'x', 0, 1, 0, 1], rootFret: 0 },
    'm7b5': { frets: ['x', 'x', 0, 1, 1, 1], rootFret: 0 },
    'sus2': { frets: ['x', 'x', 0, 2, 3, 0], rootFret: 0 },
    'sus4': { frets: ['x', 'x', 0, 2, 3, 3], rootFret: 0 },
    '6':     { frets: ['x', 'x', 0, 2, 0, 2], rootFret: 0 },
    'm6':    { frets: ['x', 'x', 0, 2, 0, 1], rootFret: 0 },
    'dim':   { frets: ['x', 'x', 0, 1, 'x', 1], rootFret: 0 },
    'aug':   { frets: ['x', 'x', 0, 3, 3, 2], rootFret: 0 },
    '7sus4': { frets: ['x', 'x', 0, 2, 1, 3], rootFret: 0 },
    'mmaj7': { frets: ['x', 'x', 0, 2, 2, 1], rootFret: 0 },
    // No D-shape 6/9 — only 4 strings are available on this family (E/A
    // already muted), not enough to fit root+3rd+6th+9th without dropping
    // a tone that matters; same reasoning as the missing D-shape 9/m9/maj9.
  }},
};

// E-shape sus2 spans 5 frets and is rarely playable; skip it to match the
// reference sheet which also excludes it.
const FB_SKIP_E_SHAPE = new Set(['sus2']);
// E-shape 7th chords have a practical no-barre variant (mute A and high-e).
const FB_NOBARRE_QUALITIES = new Set(['7', 'm7', 'maj7']);
// Shell chords: root + 3rd + 7th (no 5th).  Fret offsets relative to barre.
// Verified: E root str0 open=4 → Dstr@0=b7, Gstr@1=maj3; Astr@0=b7 (for D-shape root)...
const FB_SHELL_PATTERNS = {
  E: { '7': [0,'x',0,1,'x','x'], 'm7': [0,'x',0,0,'x','x'], 'maj7': [0,'x',1,1,'x','x'] },
  A: { '7': ['x',0,'x',0,2,'x'], 'm7': ['x',0,'x',0,1,'x'], 'maj7': ['x',0,'x',1,2,'x'] },
  D: { '7': ['x','x',0,'x',1,2], 'm7': ['x','x',0,'x',1,1], 'maj7': ['x','x',0,'x',2,2] },
};
// 4-note "shell + 9" voicings: root-3rd(or b3)-7th(or maj7)-9th, 5th dropped,
// on 4 adjacent strings (outer strings muted). This is the classic movable
// R&B/funk/jazz 9-chord shape (e.g. the common "x-10-9-10-10-x" G9 grip) —
// a distinct fingering family from FB_MOVABLE_SHAPES/FB_SHELL_PATTERNS above,
// not a CAGED-derived barre shape. Every note verified by interval math
// against FB_CHORD_QUALITIES before being added here.
// 7b9/7#9 (altered dominants) are the same 4-note "shell+9" shape family,
// just with the top note nudged one fret to flat/sharpen the 9th. A-shape
// '7#9' at fret 7 (root E) is literally the famous "Hendrix chord" grip
// (x-7-6-7-8-x). No D-shape — same reach problem as the plain 9-chords.
const FB_SHELL9_PATTERNS = {
  E: {
    '9':   { frets: [1, 0, 1, 0, 'x', 'x'], rootFret: 1 },
    m9:    { frets: [2, 0, 2, 1, 'x', 'x'], rootFret: 2 },
    maj9:  { frets: [1, 0, 2, 0, 'x', 'x'], rootFret: 1 },
    '7b9': { frets: [2, 1, 2, 0, 'x', 'x'], rootFret: 2 },
    '7#9': { frets: [1, 0, 1, 1, 'x', 'x'], rootFret: 1 },
  },
  A: {
    '9':   { frets: ['x', 1, 0, 1, 1, 'x'], rootFret: 1 },
    m9:    { frets: ['x', 2, 0, 2, 2, 'x'], rootFret: 2 },
    maj9:  { frets: ['x', 1, 0, 2, 1, 'x'], rootFret: 1 },
    '7b9': { frets: ['x', 1, 0, 1, 0, 'x'], rootFret: 1 },
    '7#9': { frets: ['x', 1, 0, 1, 2, 'x'], rootFret: 1 },
  },
};
const FB_SHELL9_QUALITIES = new Set(['9', 'm9', 'maj9', '7b9', '7#9']);

function fbRenderChordShapeDiagrams(chord) {
  const el = document.getElementById('fb-chord-diagrams');
  el.innerHTML = '';
  ['E', 'A', 'D'].forEach(letter => {
    // Skip impractical E-shape voicings
    if (letter === 'E' && FB_SKIP_E_SHAPE.has(chord.quality)) return;

    const family = FB_MOVABLE_SHAPES[letter];
    const pattern = family.patterns[chord.quality];
    const card = document.createElement('div');
    card.className = 'fb-shape-card';
    const title = document.createElement('div');
    title.className = 'fb-shape-card-title';
    title.textContent = `${letter}-shape`;
    card.appendChild(title);

    if (!pattern) {
      const empty = document.createElement('div');
      empty.className = 'fb-shape-card-empty';
      empty.textContent = `No standard ${letter}-shape voicing for this chord type.`;
      card.appendChild(empty);
    } else {
      const shape = { frets: pattern.frets, rootString: family.rootString, rootFret: pattern.rootFret };
      const barreFret = fbBarreFretForShape(chord.root, shape);
      const degreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shape, chord.quality) : null;
      const boardWrap = document.createElement('div');
      card.appendChild(boardWrap);
      fbRenderShapeBox(boardWrap, shape, barreFret, degreeLabels);
    }
    el.appendChild(card);

    // For E-shape 7th chords, append the no-barre variant right after.
    // Mute string index 1 (A) and index 5 (high-e) so no barre is required.
    if (letter === 'E' && FB_NOBARRE_QUALITIES.has(chord.quality) && pattern) {
      const nobarreFrets = pattern.frets.map((v, i) => (i === 1 || i === 5) ? 'x' : v);
      const nobarreShape = { frets: nobarreFrets, rootString: family.rootString, rootFret: pattern.rootFret };
      const nbBarreFret = fbBarreFretForShape(chord.root, nobarreShape);
      const nbDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(nobarreShape, chord.quality) : null;
      const nbCard = document.createElement('div');
      nbCard.className = 'fb-shape-card';
      const nbTitle = document.createElement('div');
      nbTitle.className = 'fb-shape-card-title';
      nbTitle.textContent = 'E-shape（免横按）';
      nbCard.appendChild(nbTitle);
      const nbWrap = document.createElement('div');
      nbCard.appendChild(nbWrap);
      fbRenderShapeBox(nbWrap, nobarreShape, nbBarreFret, nbDegreeLabels, true);
      el.appendChild(nbCard);
    }
  });

  // Shell chords (root + 3rd + 7th, no 5th) for 7th chord qualities — added
  // after all standard/nobarre cards to match the reference sheet layout.
  if (FB_NOBARRE_QUALITIES.has(chord.quality)) {
    ['E', 'A', 'D'].forEach(letter => {
      const shellFrets = FB_SHELL_PATTERNS[letter] && FB_SHELL_PATTERNS[letter][chord.quality];
      if (!shellFrets) return;
      const family = FB_MOVABLE_SHAPES[letter];
      const shShape = { frets: shellFrets, rootString: family.rootString, rootFret: 0 };
      const shBarreFret = fbBarreFretForShape(chord.root, shShape);
      const shDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shShape, chord.quality) : null;
      const shCard = document.createElement('div');
      shCard.className = 'fb-shape-card';
      const shTitle = document.createElement('div');
      shTitle.className = 'fb-shape-card-title';
      shTitle.textContent = `${letter}-shape（壳）`;
      shCard.appendChild(shTitle);
      const shWrap = document.createElement('div');
      shCard.appendChild(shWrap);
      fbRenderShapeBox(shWrap, shShape, shBarreFret, shDegreeLabels, true);
      el.appendChild(shCard);
    });
  }

  // Shell+9 chords (root + 3rd/b3 + 7th/maj7 + 9th, no 5th) for 9/m9/maj9 —
  // a different fingering family from the CAGED-derived E/A/D shapes above
  // (see FB_SHELL9_PATTERNS comment). Root can only sit on the E or A string;
  // a D-string-root version isn't practical (same reach issue that already
  // excludes D-shape from the plain 9/m9/maj9 barre voicings above).
  if (FB_SHELL9_QUALITIES.has(chord.quality)) {
    ['E', 'A'].forEach(letter => {
      const pattern = FB_SHELL9_PATTERNS[letter] && FB_SHELL9_PATTERNS[letter][chord.quality];
      if (!pattern) return;
      const family = FB_MOVABLE_SHAPES[letter];
      const sh9Shape = { frets: pattern.frets, rootString: family.rootString, rootFret: pattern.rootFret };
      const sh9BarreFret = fbBarreFretForShape(chord.root, sh9Shape);
      const sh9DegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(sh9Shape, chord.quality) : null;
      const sh9Card = document.createElement('div');
      sh9Card.className = 'fb-shape-card';
      const sh9Title = document.createElement('div');
      sh9Title.className = 'fb-shape-card-title';
      sh9Title.textContent = `${letter}-shape（壳+9）`;
      sh9Card.appendChild(sh9Title);
      const sh9Wrap = document.createElement('div');
      sh9Card.appendChild(sh9Wrap);
      fbRenderShapeBox(sh9Wrap, sh9Shape, sh9BarreFret, sh9DegreeLabels, true);
      el.appendChild(sh9Card);
    });
  }
}

function fbChordLoadStats() {
  try { fbState.chord.stats = JSON.parse(localStorage.getItem(FB_CHORD_STATS_KEY)) || {}; }
  catch (_) { fbState.chord.stats = {}; }
}
function fbChordSaveStats() {
  localStorage.setItem(FB_CHORD_STATS_KEY, JSON.stringify(fbState.chord.stats));
}

function fbChordSymbol(root, quality) {
  return FB_NOTE_NAMES[root] + quality;
}

function fbChordGroupState(g) {
  const quals = FB_CHORD_GROUPS[g].qualities;
  const checkedCount = quals.filter(q => fbState.chord.qualities[q]).length;
  if (checkedCount === 0) return 'none';
  if (checkedCount === quals.length) return 'all';
  return 'partial';
}

function fbRenderChordOptions() {
  const s = fbState.chord;
  const q = s.qualities;
  document.getElementById('fb-chord-options').innerHTML = `
    <span>Notation:</span>
    <select onchange="fbState.chord.notationStyle=this.value; fbPrefsSave(); fbChordRefreshLabels()">
      ${Object.keys(FB_CHORD_NOTATION_STYLES).map(k => `<option value="${k}" ${s.notationStyle===k?'selected':''}>${FB_CHORD_NOTATION_STYLES[k].label}</option>`).join('')}
    </select>
    <span style="margin-left:12px">Chord source:</span>
    <select onchange="fbChordSetSource(this.value)">
      <option value="random"      ${s.source==='random'     ?'selected':''}>Random</option>
      <option value="fixed_root"  ${s.source==='fixed_root' ?'selected':''}>Fixed root — same root, random quality</option>
      <option value="progression" ${s.source==='progression'?'selected':''}>Progressions (I-V-vi-IV, ii-V-I, etc.)</option>
    </select>
    ${s.source === 'fixed_root' ? `
    <label style="margin-left:8px">Root:
      <select onchange="fbState.chord.fixedRoot=parseInt(this.value); fbPrefsSave(); fbChordNewChord()">
        ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.fixedRoot===i?'selected':''}>${n}</option>`).join('')}
      </select>
    </label>` : ''}
    ${s.source === 'random' ? `
    <label style="margin-left:8px">Practice:
      <select onchange="fbState.chord.practiceMode=this.value; fbPrefsSave(); fbChordNewChord()">
        <option value="all"  ${s.practiceMode==='all' ?'selected':''}>All</option>
        <option value="weak" ${s.practiceMode==='weak'?'selected':''}>Focus on weak</option>
      </select>
    </label>` : ''}
    ${s.source === 'progression' ? `
    <label style="margin-left:8px">Pattern:
      <select onchange="fbState.chord.progression.categoryFilter=this.value; fbState.chord.progression.chords=null; fbPrefsSave()">
        <option value="all"        ${s.progression.categoryFilter==='all'       ?'selected':''}>All</option>
        <option value="functional" ${s.progression.categoryFilter==='functional'?'selected':''}>Functional (T-S-D-T)</option>
        <option value="circle5"    ${s.progression.categoryFilter==='circle5'   ?'selected':''}>Circle of fifths</option>
        <option value="stepwise"   ${s.progression.categoryFilter==='stepwise'  ?'selected':''}>Stepwise descent/ascent</option>
        <option value="blues"      ${s.progression.categoryFilter==='blues'     ?'selected':''}>12-bar blues</option>
      </select>
    </label>
    <label style="margin-left:8px">Repeat each progression:
      <input type="number" min="1" max="8" value="${s.progression.repeatCount}" style="width:48px"
        onchange="fbState.chord.progression.repeatCount=Math.max(1, parseInt(this.value)||1); fbPrefsSave()"> ×
    </label>
    <label style="margin-left:8px"><input type="checkbox" ${s.progression.lockKey ? 'checked' : ''}
      onchange="fbState.chord.progression.lockKey=this.checked; fbState.chord.progression.chords=null; fbPrefsSave(); fbRenderChordOptions()"> Lock key</label>
    ${s.progression.lockKey ? `
    <select onchange="fbState.chord.progression.lockedKeyRoot=parseInt(this.value); fbState.chord.progression.chords=null; fbPrefsSave()">
      ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.progression.lockedKeyRoot===i?'selected':''}>${n}</option>`).join('')}
    </select>` : ''}` : ''}
    <div class="fb-chord-type-groups">
      ${Object.keys(FB_CHORD_GROUPS).map(g => `
        <div class="fb-chord-type-group">
          <label class="fb-chord-group-label"><input type="checkbox" class="fb-chord-group-cb" data-group="${g}" onchange="fbChordToggleGroup('${g}')"> ${FB_CHORD_GROUPS[g].label}</label>
          <span class="fb-chord-type-children">
            ${FB_CHORD_GROUPS[g].qualities.map(qk => `
              <label><input type="checkbox" ${q[qk] ? 'checked' : ''} onchange="fbChordToggleQuality('${qk}')"> ${FB_CHORD_QUALITY_LABELS[qk]}</label>
            `).join('')}
          </span>
        </div>
      `).join('')}
      <div class="fb-chord-type-group">
        <label><input type="checkbox" ${s.showFormula ? 'checked' : ''} onchange="fbState.chord.showFormula=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord formula (e.g. 1 b3 5 b7)</label>
        <label><input type="checkbox" ${s.showChordDiagram ? 'checked' : ''} onchange="fbState.chord.showChordDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord shape diagrams (E/A/D-shape)</label>
        <label><input type="checkbox" ${s.showDegreesOnDiagram ? 'checked' : ''} onchange="fbState.chord.showDegreesOnDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show degree labels on shape diagrams</label>
        <label style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap">
          📐 Diagram size:
          <input type="range" min="100" max="300" step="10" value="${s.diagramSize || 200}"
            oninput="fbState.chord.diagramSize=parseInt(this.value); fbPrefsSave(); fbApplyDiagramSize(); fbChordRefreshLabels(); document.getElementById('fb-diagram-size-val').textContent=this.value+'px'">
          <span id="fb-diagram-size-val">${s.diagramSize || 200}px</span>
        </label>
      </div>
    </div>
  `;
  // indeterminate is JS-only, can't be expressed as an HTML attribute
  document.querySelectorAll('.fb-chord-group-cb').forEach(cb => {
    const st = fbChordGroupState(cb.dataset.group);
    cb.checked = st === 'all';
    cb.indeterminate = st === 'partial';
  });
}

function fbChordToggleGroup(g) {
  const turnOn = fbChordGroupState(g) !== 'all'; // not fully on yet → select all; already all on → clear
  FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = turnOn; });
  if (!Object.values(fbState.chord.qualities).some(Boolean)) FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = true; });
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordToggleQuality(qk) {
  const qs = fbState.chord.qualities;
  qs[qk] = !qs[qk];
  if (!Object.values(qs).some(Boolean)) qs[qk] = true; // keep at least one
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordSetSource(source) {
  fbState.chord.source = source;
  fbState.chord.progression.chords = null;
  fbPrefsSave();
  fbRenderChordOptions();  // re-render to show/hide root picker
  fbChordNewChord();
}

function fbChordResetStats() {
  fbState.chord.stats = {};
  fbChordSaveStats();
  fbRenderChordStatsTable();
}

// 12-value weight vector for a chord: root strongest, third/fifth present,
// everything else a small non-zero baseline so an otherwise-clean chroma
// isn't penalized to zero by string noise / open-string bleed.
function fbChordTemplate(root, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const template = new Array(12).fill(0.12);
  intervals.forEach((iv, idx) => {
    const pc = (root + iv) % 12;
    template[pc] = idx === 0 ? 1.0 : 0.75;
  });
  return template;
}

function fbCosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 12; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Cosine similarity alone under-discriminates triads vs. their 7th-chord
// extensions: a plain triad already covers 3 of a 7th chord's 4 tones, which
// is enough overlap to clear the similarity threshold even though the 7th
// itself never sounded. This gate requires every interval in the chord to
// actually have energy present, so a missing tone (e.g. no minor 7th when
// you only played the triad) can't pass as that 7th chord.
const FB_CHORD_MIN_TONE_PRESENCE = 0.3;
function fbChordCoverageOk(chroma, root, quality) {
  return FB_CHORD_QUALITIES[quality].every(iv => chroma[(root + iv) % 12] >= FB_CHORD_MIN_TONE_PRESENCE);
}

function fbChordEnabledPool() {
  const qs = fbState.chord.qualities;
  const pool = [];
  for (const q of Object.keys(FB_CHORD_QUALITIES)) {
    if (!qs[q]) continue;
    for (let root = 0; root < 12; root++) pool.push({ root, quality: q, symbol: fbChordSymbol(root, q) });
  }
  return pool;
}

// ── Chord progression mode: instead of a uniformly random chord every time,
// walk through a real chord-progression "lick" (I-V-vi-IV, ii-V-I, etc.) in
// a randomly chosen key, then pick a new progression/key once it's done.
// Each diatonic degree lists candidate qualities in preference order (plain
// triad first, then its 7th-chord extension) — whichever is actually
// enabled in the user's quality checkboxes gets used, so this respects the
// existing quality filter rather than fighting it.
const FB_MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const FB_MINOR_SCALE_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
const FB_MAJOR_DEGREE_QUALITIES = [
  ['', 'maj7', '6', 'maj9', 'add9'],  // I
  ['m', 'm7', 'm9'],                  // ii
  ['m', 'm7', 'm9'],                  // iii
  ['', 'maj7', '6', 'maj9', 'add9'],  // IV
  ['', '7', '9'],                     // V
  ['m', 'm7', 'm6', 'm9'],            // vi
  ['m7b5', 'dim7'],                   // vii°
];
const FB_MINOR_DEGREE_QUALITIES = [
  ['m', 'm7', 'm6', 'm9'],            // i
  ['m7b5', 'dim7'],                   // ii°
  ['', 'maj7', 'maj9'],                // III
  ['m', 'm7', 'm9'],                  // iv
  ['m', 'm7', 'm9'],                  // v
  ['', 'maj7', '6', 'maj9'],           // VI
  ['', '7', '9'],                     // VII
];
// category is a rough tag for the *dominant generative mechanism* behind
// each progression's root motion — not a rigorous classification (several
// progressions could fit more than one bucket), just enough to let you
// filter down to "only give me circle-of-fifths ones" etc. to drill one
// pattern at a time. See docs/chord-progressions-guide.md for the theory.
const FB_CHORD_PROGRESSIONS = [
  { name: 'I – V – vi – IV (pop)', keyType: 'major', degrees: [0, 4, 5, 3], category: 'functional' },
  { name: 'I – vi – IV – V (50s / doo-wop)', keyType: 'major', degrees: [0, 5, 3, 4], category: 'functional' },
  { name: 'ii – V – I (jazz)', keyType: 'major', degrees: [1, 4, 0], category: 'circle5' },
  { name: 'I – IV – V – IV', keyType: 'major', degrees: [0, 3, 4, 3], category: 'functional' },
  { name: 'vi – IV – I – V', keyType: 'major', degrees: [5, 3, 0, 4], category: 'functional' },
  { name: 'I – vi – ii – V (turnaround)', keyType: 'major', degrees: [0, 5, 1, 4], category: 'circle5' },
  { name: 'iii – vi – ii – V (jazz turnaround)', keyType: 'major', degrees: [2, 5, 1, 4], category: 'circle5' },
  { name: '12-bar blues (changes)', keyType: 'major', degrees: [0, 3, 0, 4, 3, 0], category: 'blues' },
  { name: 'I – iii – IV – V', keyType: 'major', degrees: [0, 2, 3, 4], category: 'functional' },
  { name: 'I – V – IV – V', keyType: 'major', degrees: [0, 4, 3, 4], category: 'functional' },
  { name: 'vi – ii – V – I (circle of fifths)', keyType: 'major', degrees: [5, 1, 4, 0], category: 'circle5' },
  { name: 'I – ii – iii – IV (ascending)', keyType: 'major', degrees: [0, 1, 2, 3], category: 'stepwise' },
  { name: 'IV – iii – ii – I (stepwise descent)', keyType: 'major', degrees: [3, 2, 1, 0], category: 'stepwise' },
  { name: 'i – VI – III – VII (minor pop)', keyType: 'minor', degrees: [0, 5, 2, 6], category: 'functional' },
  { name: 'i – iv – v (minor)', keyType: 'minor', degrees: [0, 3, 4], category: 'functional' },
  { name: 'i – VII – VI – VII', keyType: 'minor', degrees: [0, 6, 5, 6], category: 'functional' },
  { name: 'i – iv – VII – III (minor rock)', keyType: 'minor', degrees: [0, 3, 6, 2], category: 'circle5' },
  { name: 'i – VII – VI – v (Andalusian-ish)', keyType: 'minor', degrees: [0, 6, 5, 4], category: 'stepwise' },
  { name: 'ii – V – I – vi (R&B / neo-soul loop)', keyType: 'major', degrees: [1, 4, 0, 5], category: 'circle5' },
  { name: 'I – IV – I – V (gospel / R&B vamp)', keyType: 'major', degrees: [0, 3, 0, 4], category: 'functional' },
  { name: 'i – iv – v – i (minor R&B vamp)', keyType: 'minor', degrees: [0, 3, 4, 0], category: 'functional' },
];

// The first enabled quality among a degree's candidates, or null if the user
// has disabled every quality that degree could plausibly use.
function fbChordBestQualityFor(degreeIdx, keyType) {
  const candidates = (keyType === 'minor' ? FB_MINOR_DEGREE_QUALITIES : FB_MAJOR_DEGREE_QUALITIES)[degreeIdx];
  // NB: '' (major triad) is a valid quality but JS-falsy — can't use `|| null` here.
  const found = candidates.find(q => fbState.chord.qualities[q]);
  return found !== undefined ? found : null;
}

// A progression only qualifies if every degree it uses resolves to some
// enabled quality — otherwise we'd be asking the user to strum a chord type
// they've explicitly turned off.
function fbChordEligibleProgressions() {
  const catFilter = fbState.chord.progression.categoryFilter;
  return FB_CHORD_PROGRESSIONS.filter(p =>
    (catFilter === 'all' || p.category === catFilter) &&
    // NB: fbChordBestQualityFor can validly return '' (major triad) — check
    // against null explicitly rather than truthiness.
    p.degrees.every(d => fbChordBestQualityFor(d, p.keyType) !== null)
  );
}

// Builds the concrete { root, quality, symbol } list for one pass through a
// progression in a given key, then — about 30% of the time — drops in a
// secondary dominant (V7 of the following chord) before some middle chord,
// just for a bit of harmonic variety. Only happens if '7' is enabled.
function fbChordBuildProgressionChords(prog, keyRoot) {
  const offsets = prog.keyType === 'minor' ? FB_MINOR_SCALE_OFFSETS : FB_MAJOR_SCALE_OFFSETS;
  const chords = prog.degrees.map(d => {
    const root = (keyRoot + offsets[d]) % 12;
    const quality = fbChordBestQualityFor(d, prog.keyType);
    return { root, quality, symbol: fbChordSymbol(root, quality) };
  });
  if (fbState.chord.qualities['7'] && chords.length > 2 && Math.random() < 0.3) {
    const insertAt = 1 + Math.floor(Math.random() * (chords.length - 1)); // never before the very first chord
    const target = chords[insertAt];
    const secDom = { root: (target.root + 7) % 12, quality: '7' };
    chords.splice(insertAt, 0, { ...secDom, symbol: fbChordSymbol(secDom.root, secDom.quality) });
  }
  return chords;
}

function fbChordPickTargetRandom() {
  const pool = fbChordEnabledPool();
  if (fbState.chord.practiceMode !== 'weak') {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Weighted by (1 – accuracy); chords with no stats yet get weight 0.5
  // so new chords still appear.  Floor at 0.1 so even perfect chords
  // aren't completely excluded.
  const weights = pool.map(c => {
    const st = fbState.chord.stats[c.symbol];
    const acc = st && st.presented > 0 ? st.matched / st.presented : 0.5;
    return Math.max(0.1, 1 - acc);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let k = 0; k < pool.length; k++) {
    r -= weights[k];
    if (r <= 0) return pool[k];
  }
  return pool[pool.length - 1];
}

function fbChordPickTargetFixedRoot() {
  const s = fbState.chord;
  const root = s.fixedRoot;
  const enabledQ = Object.keys(FB_CHORD_QUALITIES).filter(q => s.qualities[q]);
  if (!enabledQ.length) return fbChordPickTargetRandom();
  // Avoid repeating the same quality consecutively
  const prevQ = s.target ? s.target.quality : null;
  const pool  = enabledQ.length > 1 ? enabledQ.filter(q => q !== prevQ) : enabledQ;
  const quality = pool[Math.floor(Math.random() * pool.length)];
  return { root, quality, symbol: fbChordSymbol(root, quality) };
}

function fbChordPickTargetProgression() {
  const s = fbState.chord;
  const p = s.progression;
  if (!p.chords || p.stepIdx >= p.chords.length) {
    if (p.chords && p.repeatsLeft > 0) {
      // Loop the same progression/key again instead of jumping to a new one
      // every single pass — rebuilt (not reused) so the ~30% secondary-dominant
      // insert can still vary between repeats.
      p.repeatsLeft--;
      p.chords = fbChordBuildProgressionChords(p.def, p.keyRoot);
      p.stepIdx = 0;
    } else {
      const eligible = fbChordEligibleProgressions();
      if (!eligible.length) return fbChordPickTargetRandom(); // no progression fits the enabled qualities — fall back
      p.def = eligible[Math.floor(Math.random() * eligible.length)];
      p.keyRoot = p.lockKey ? p.lockedKeyRoot : Math.floor(Math.random() * 12);
      p.chords = fbChordBuildProgressionChords(p.def, p.keyRoot);
      p.stepIdx = 0;
      p.repeatsLeft = Math.max(0, p.repeatCount - 1);
    }
  }
  return p.chords[p.stepIdx++];
}

function fbChordPickTarget() {
  if (fbState.chord.source === 'fixed_root') return fbChordPickTargetFixedRoot();
  if (fbState.chord.source === 'progression') return fbChordPickTargetProgression();
  return fbChordPickTargetRandom();
}

function fbRenderChordStats() {
  const s = fbState.chord;
  document.getElementById('fb-chord-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderChordStatsTable() {
  const s = fbState.chord;
  const el = document.getElementById('fb-chord-stats-table');
  if (!el) return;
  const rows = Object.keys(s.stats).map(sym => {
    const st = s.stats[sym];
    const acc = st.presented ? Math.round((st.matched / st.presented) * 100) : null;
    const avg = st.matched ? (st.totalMs / st.matched / 1000).toFixed(1) : null;
    // older saved stats (pre-notation-style) don't carry root/quality — fall back to the raw key
    const label = (st.root != null && st.quality != null) ? fbChordDisplaySymbol(st.root, st.quality) : sym;
    return { label, presented: st.presented, acc, avg, wrong: st.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span style="color:#aaa;font-size:12px">No attempts yet — start listening and strum some chords.</span>';
    return;
  }
  el.innerHTML = fbStatsTableHead('Per-chord accuracy', 'fbChordResetStats') + `
    <table class="fb-stats-table">
      <tr><th>Chord</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.label}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbRenderChroma(chroma, target) {
  const el = document.getElementById('fb-chord-chroma');
  const chordTones = target ? new Set(FB_CHORD_QUALITIES[target.quality].map(iv => (target.root + iv) % 12)) : new Set();
  el.innerHTML = FB_NOTE_NAMES.map((n, i) => {
    const isTone = chordTones.has(i);
    const val = Math.max(0, Math.min(1, chroma[i] || 0));
    const hit = isTone && val > 0.5;
    return `
      <div class="fb-chroma-col${isTone ? ' chord-tone' : ''}${hit ? ' hit' : ''}">
        <div class="fb-chroma-bar" style="height:${Math.round(val * 100)}%"></div>
        <div class="fb-chroma-label">${n}</div>
      </div>
    `;
  }).join('');
}

function fbChordNewChord() {
  const s = fbState.chord;
  const t = fbChordPickTarget();
  s.target = t;
  s.matched = false;
  s._holdCount = 0;
  s._wrongSymbol = null;
  s._wrongHoldCount = 0;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[t.symbol] || (s.stats[t.symbol] = { root: t.root, quality: t.quality, presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbChordSaveStats();

  fbRenderChordStats();
  fbRenderChordStatsTable();
  fbRenderChroma(new Array(12).fill(0), t);
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbChordRefreshLabels();
}

// Re-renders whatever's currently on screen (target symbol/formula, chord
// shape diagrams if enabled) to reflect a settings change, without
// generating a new chord.
function fbChordRenderProgressionInfo() {
  const el = document.getElementById('fb-chord-progression-info');
  const previewBtn = document.getElementById('fb-chord-preview-btn');
  if (!el) return;
  const s = fbState.chord;
  const p = s.progression;
  const active = s.source === 'progression' && p.def && p.chords;
  if (previewBtn) previewBtn.style.display = active ? '' : 'none';
  if (!active) { el.textContent = ''; return; }
  const currentLoop = p.repeatCount - p.repeatsLeft;
  const loopSuffix = p.repeatCount > 1 ? ` (loop ${currentLoop}/${p.repeatCount})` : '';
  el.textContent = `Progression: ${p.def.name} in ${FB_NOTE_NAMES[p.keyRoot]} — chord ${p.stepIdx}/${p.chords.length}${loopSuffix}`;
}

// Lets you hear the *current* progression instance (same key, same chords,
// including any secondary-dominant insert) before attempting it yourself —
// so a fumbled attempt doesn't end up teaching you the wrong sound by
// accident. Reuses Ear Training's shared AudioContext/output routing/volume,
// just strums each chord's own tones as a block instead of playing a melody.
let fbChordPreviewPlayingUntil = 0;
function fbChordPreviewProgression() {
  const s = fbState.chord;
  const p = s.progression;
  if (s.source !== 'progression' || !p.chords || !p.chords.length) return;
  const now = Date.now();
  if (now < fbChordPreviewPlayingUntil) return; // debounce — a preview is already playing

  const ctx = fbEarGetAudioCtx();
  const chordDur = 0.9, gap = 0.15;
  let t = ctx.currentTime + 0.05;
  p.chords.forEach(chord => {
    const rootMidi = 48 + chord.root; // low-mid register, consistent regardless of key
    FB_CHORD_QUALITIES[chord.quality].forEach(iv => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = fbFreqFromMidi(rootMidi + iv);
      const gain = ctx.createGain();
      const peak = 0.22 * fbMasterGain() * fbSoundGain('practiceTones');
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.02);
      gain.gain.setValueAtTime(peak, t + chordDur - 0.1);
      gain.gain.linearRampToValueAtTime(0, t + chordDur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + chordDur + 0.02);
    });
    t += chordDur + gap;
  });
  fbChordPreviewPlayingUntil = now + Math.ceil((t - ctx.currentTime) * 1000);
}

function fbChordRefreshLabels() {
  const s = fbState.chord;
  fbChordRenderProgressionInfo();
  if (s.target) {
    document.getElementById('fb-chord-target').textContent = fbChordDisplaySymbol(s.target.root, s.target.quality);
    const formulaEl = document.getElementById('fb-chord-formula');
    if (formulaEl) formulaEl.textContent = s.showFormula ? fbChordFormula(s.target.quality) : '';
    const diagramsEl = document.getElementById('fb-chord-diagrams');
    if (diagramsEl) {
      if (s.showChordDiagram) fbRenderChordShapeDiagrams(s.target);
      else diagramsEl.innerHTML = '';
    }
  }
  fbRenderChordStatsTable();
}

async function fbChordStart() {
  try {
    // 32768 gives ~1.5Hz/bin at 48kHz — needed because the tightest semitone
    // gap on guitar (E2→F2, ~4.9Hz) is *smaller* than a bin at 8192, which
    // would smear a low bass note's energy into the wrong pitch class.
    await fbMicStart('chord', fbChordOnFrame, 32768);
  } catch (e) {
    const fb = document.getElementById('fb-chord-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('chord');
}

function fbChordStop() {
  fbMicStop();
  fbSyncMicButtons('chord');
  fbRenderChroma(new Array(12).fill(0), fbState.chord.target);
}

function fbComputeChroma(analyser, sampleRate) {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const binHz = sampleRate / analyser.fftSize;
  const minBin = Math.max(1, Math.floor(FB_CHORD_MIN_HZ / binHz));
  const maxBin = Math.min(freqData.length - 1, Math.ceil(FB_CHORD_MAX_HZ / binHz));
  const chroma = new Array(12).fill(0);
  for (let i = minBin; i <= maxBin; i++) {
    const db = freqData[i];
    if (db < FB_CHORD_NOISE_FLOOR_DB) continue;
    const amp = Math.pow(10, db / 20);
    const midi = 69 + 12 * Math.log2((i * binHz) / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += amp;
  }
  const max = Math.max(...chroma, 1e-9);
  return chroma.map(v => v / max);
}

function fbChordOnFrame(analyser, sampleRate) {
  const s = fbState.chord;
  const chroma = fbComputeChroma(analyser, sampleRate);
  const totalEnergy = chroma.reduce((a, b) => a + b, 0);

  if (totalEnergy < 0.5) { // effectively silent — nothing meaningful ringing
    fbRenderChroma(new Array(12).fill(0), s.target);
    s._holdCount = 0;
    return;
  }

  const targetTemplate = fbChordTemplate(s.target.root, s.target.quality);
  const sim = fbCosineSim(chroma, targetTemplate);
  const covered = fbChordCoverageOk(chroma, s.target.root, s.target.quality);
  fbRenderChroma(chroma, s.target);

  const simEl = document.getElementById('fb-chord-feedback');
  if (!s.matched && !(sim >= FB_CHORD_MATCH_SIM && covered)) {
    simEl.textContent = `Similarity to ${fbChordDisplaySymbol(s.target.root, s.target.quality)}: ${Math.round(sim * 100)}%`;
    simEl.className = 'fb-feedback';
  }
  if (s.matched) return;

  if (sim >= FB_CHORD_MATCH_SIM && covered) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_CHORD_MATCH_HOLD_FRAMES) fbChordOnMatch();
    return;
  }
  s._holdCount = 0;

  // find the closest-matching *other* known chord to give useful wrong feedback
  // (only consider chords whose tones are actually all present, not just correlated)
  let best = null;
  fbChordEnabledPool().forEach(c => {
    if (c.symbol === s.target.symbol) return;
    if (!fbChordCoverageOk(chroma, c.root, c.quality)) return;
    const csim = fbCosineSim(chroma, fbChordTemplate(c.root, c.quality));
    if (!best || csim > best.sim) best = { symbol: c.symbol, root: c.root, quality: c.quality, sim: csim };
  });
  if (best && best.sim >= FB_CHORD_WRONG_SIM) {
    if (best.symbol === s._wrongSymbol) s._wrongHoldCount++;
    else { s._wrongSymbol = best.symbol; s._wrongHoldCount = 1; }
    if (s._wrongHoldCount === FB_CHORD_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_CHORD_WRONG_MSG_COOLDOWN_MS) {
      fbChordOnWrong(best);
    }
  } else {
    s._wrongSymbol = null; s._wrongHoldCount = 0;
  }
}

function fbChordOnWrong(heard) {
  const s = fbState.chord;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target.symbol];
  if (st) { st.wrongHits++; fbChordSaveStats(); }
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Not quite — that sounds like ${fbChordDisplaySymbol(heard.root, heard.quality)}, target is ${fbChordDisplaySymbol(s.target.root, s.target.quality)}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbChordOnMatch() {
  const s = fbState.chord;
  s.matched = true;
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target.symbol];
  st.matched++; st.totalMs += elapsedMs;
  fbChordSaveStats();
  fbRenderChordStats();
  fbRenderChordStatsTable();
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Matched ${fbChordDisplaySymbol(s.target.root, s.target.quality)} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbChordNewChord, 1100);
}

// Autocorrelation-based pitch detector (standard ACF2+ technique):
// trims low-amplitude edges, autocorrelates, finds the first strong peak
// after the initial downslope, then refines it via parabolic interpolation.
function fbAutoCorrelate(buf, sampleRate, rmsThreshold = 0.01) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < rmsThreshold) return -1; // too quiet / silence

  // Trim leading/trailing near-silence so autocorrelation focuses on signal.
  // Fallback to the full buffer when the signal is consistently quiet (e.g. a
  // decaying bent string whose amplitude is below 0.2 throughout) rather than
  // returning -1 and discarding a valid but soft note.
  const THRES = 0.2;
  let start = 0;
  while (start < SIZE / 2 && Math.abs(buf[start]) < THRES) start++;
  let end = SIZE - 1;
  while (end > SIZE / 2 && Math.abs(buf[end]) < THRES) end--;
  const trimmed = (end > start) ? buf.slice(start, end) : buf;
  const n = trimmed.length;
  if (n < 2) return -1;

  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxPos = -1, maxVal = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = maxPos + 1 < n ? c[maxPos + 1] : c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const refinedLag = a ? maxPos - b / (2 * a) : maxPos;
  if (refinedLag <= 0) return -1;
  return sampleRate / refinedLag;
}

function fbFreqToNote(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const noteName = FB_NOTE_NAMES[((midi % 12) + 12) % 12];
  return { noteName, cents, midi };
}

// ── Bend & Vibrato ──

// Bend exercises: G (3), B (4), high-E (5) strings, frets 5-17.
// Frets 1-4 are skipped (high tension near nut, awkward to bend);
// frets 5-17 covers all five pentatonic box positions in any key.
const FB_BEND_STRINGS   = [3, 4, 5];  // G=3, B=4, high-E=5
const FB_BEND_FRET_MIN  = 5;
const FB_BEND_FRET_MAX  = 17;

const FB_BEND_STABLE_FRAMES   = 3;    // frames of stable pitch to lock baseline (3 @ 60fps ≈ 50ms)
const FB_BEND_HOLD_MS         = 700;  // must sit in the target zone this long (real time, not frames) → success
const FB_BEND_ZONE_GRACE_MS   = 150;  // brief in/out noise near the edge of the zone doesn't reset the hold timer
const FB_BEND_TOLERANCE       = 30;   // cents around target → success (was 25 — wider zone reduces false negatives)
const FB_BEND_NEXT_DELAY_MS   = 2000; // ms before auto-advancing to the next exercise after success
const FB_BEND_HISTORY_MS      = 5000; // rolling graph window
const FB_BEND_SILENCE_HOLD_MS = 600;  // keep last reading for this long during decay

// Detects a fresh pick (re-attack) via the amplitude envelope, independent of
// pitch tracking — a real bend is one continuous string ring with gradually
// rising pitch, while plucking the target fret directly to "check" the pitch
// produces a new sharp attack transient. Used to reject that shortcut: once
// baseFreq is locked, any new attack means "this isn't a bend, it's a re-pick."
const FB_BEND_ATTACK_RATIO        = 1.8;  // new RMS this many× the rolling baseline counts as a fresh pick
const FB_BEND_ATTACK_MIN_RMS      = 0.01; // ignore near-silence/noise floor
const FB_BEND_ATTACK_REFRACTORY_MS = 150; // don't re-trigger on the same attack's own transient

const FB_VIBRATO_HISTORY_MS    = 4000;
const FB_VIBRATO_SUCCESS_MS    = 3000;
const FB_VIBRATO_MIN_DEPTH     = 25;   // cents peak amplitude
const FB_VIBRATO_SUCCESS_FR    = 180;  // 3 s × ~60 fps

const FB_VIBRATO_TARGET_RANGES = { 3: [2, 4.5], 5: [3.5, 6.5], 7: [5.5, 9] };

const FB_STRING_DISPLAY = ['low E', 'A', 'D', 'G', 'B', 'high E'];

// Every standard bend amount, drawn on the graph *every* time regardless of
// the current target — keeps the graph's layout fixed across questions
// (only the highlighted/green one changes) instead of the axis rescaling
// and every line shifting position each time you get a new exercise.
const FB_BEND_REFERENCE_CENTS = [
  { cents: 50,  label: '¼ step' },
  { cents: 100, label: '½ step' },
  { cents: 200, label: '1 step' },
  { cents: 300, label: '1½ steps' },
];
const FB_BEND_GRAPH_MAX_CENTS = 350; // fixed scale — covers the widest reference (300¢) plus headroom

function fbBendNoteLabel(midi) {
  return FB_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function fbBendIntervalCents(interval) {
  if (interval === 'quarter') return 50;
  return interval === 'half' ? 100 : interval === 'full' ? 200 : 300;
}

function fbBendIntervalLabel(interval) {
  if (interval === 'quarter') return '¼ step';
  return interval === 'half' ? '½ step' : interval === 'full' ? '1 full step' : '1½ steps';
}

function fbBendPickExercise() {
  const s = fbState.bend;
  // Pick a random enabled string (fall back to B if none selected)
  const enabledStrings = FB_BEND_STRINGS.filter(i => s.strings[i]);
  const string = (enabledStrings.length ? enabledStrings : [4])[
    Math.floor(Math.random() * (enabledStrings.length || 1))
  ];
  // Pick a random fret in the common-bending range
  const fret = FB_BEND_FRET_MIN + Math.floor(Math.random() * (FB_BEND_FRET_MAX - FB_BEND_FRET_MIN + 1));
  return { string, fret };
}

function fbBendPickInterval() {
  const s = fbState.bend;
  const enabled = Object.keys(s.intervals).filter(k => s.intervals[k]);
  return (enabled.length ? enabled : ['full'])[Math.floor(Math.random() * (enabled.length || 1))];
}

function fbBendToggleString(idx, checked) {
  fbState.bend.strings[idx] = checked;
  // Keep at least one string enabled
  if (!Object.values(fbState.bend.strings).some(Boolean)) fbState.bend.strings[idx] = true;
  fbPrefsSave();
}

function fbBendToggleInterval(key, checked) {
  fbState.bend.intervals[key] = checked;
  // Keep at least one interval enabled
  if (!Object.values(fbState.bend.intervals).some(Boolean)) fbState.bend.intervals[key] = true;
  fbPrefsSave();
}

// ── Render helpers ──

function fbBendRenderOptions() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-chord-type-groups">
      <div class="fb-chord-type-group">
        <label class="fb-chord-group-label">String:</label>
        <span class="fb-chord-type-children">
          <label><input type="checkbox" ${s.strings[3]?'checked':''} onchange="fbBendToggleString(3,this.checked)"> G</label>
          <label><input type="checkbox" ${s.strings[4]?'checked':''} onchange="fbBendToggleString(4,this.checked)"> B <small style="color:#888">(most common)</small></label>
          <label><input type="checkbox" ${s.strings[5]?'checked':''} onchange="fbBendToggleString(5,this.checked)"> high E</label>
        </span>
      </div>
      <div class="fb-chord-type-group">
        <label class="fb-chord-group-label">Interval:</label>
        <span class="fb-chord-type-children">
          <label><input type="checkbox" ${s.intervals.quarter?'checked':''} onchange="fbBendToggleInterval('quarter',this.checked)"> ¼ step <small style="color:#888">(blues touch)</small></label>
          <label><input type="checkbox" ${s.intervals.half?'checked':''} onchange="fbBendToggleInterval('half',this.checked)"> ½ step</label>
          <label><input type="checkbox" ${s.intervals.full?'checked':''} onchange="fbBendToggleInterval('full',this.checked)"> 1 full step <small style="color:#888">(most common)</small></label>
          <label><input type="checkbox" ${s.intervals.full_half?'checked':''} onchange="fbBendToggleInterval('full_half',this.checked)"> 1½ steps</label>
        </span>
      </div>
    </div>`;
}

function fbVibratoRenderOptions() {
  const v = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-options">
      <label>Target speed:
        <select onchange="fbState.vibrato.targetHz=parseInt(this.value); fbPrefsSave()">
          <option value="3" ${v.targetHz===3?'selected':''}>Slow (~3 Hz)</option>
          <option value="5" ${v.targetHz===5?'selected':''}>Medium (~5 Hz)</option>
          <option value="7" ${v.targetHz===7?'selected':''}>Fast (~7 Hz)</option>
        </select>
      </label>
    </div>`;
}

function fbBendRenderPrompt() {
  const s = fbState.bend;
  const c = s.current;
  if (!c) return;
  const el = document.getElementById('fb-bend-prompt');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-bend-exercise-row">
      <span class="fb-bend-location">${FB_STRING_DISPLAY[c.string]} string &nbsp;·&nbsp; fret ${c.fret}</span>
      <span class="fb-bend-arrow">→</span>
      <span class="fb-bend-intlabel">bend <strong>${c.intLabel}</strong></span>
    </div>
    <div class="fb-bend-notes-row">${c.startLabel} &nbsp;→&nbsp; <span class="fb-bend-target-note">${c.targetLabel}</span></div>`;
}

function fbBendRenderGraph() {
  const canvas = document.getElementById('fb-bend-canvas');
  if (!canvas) return;
  const s = fbState.bend;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const targetCents = s.current ? s.current.targetCents : 200;
  const maxCents    = FB_BEND_GRAPH_MAX_CENTS;
  const PAD_T = 20, PAD_B = 16, PAD_L = 0, PAD_R = 0;
  const innerH = H - PAD_T - PAD_B;

  // cents → canvas y (0¢ at bottom, maxCents at top)
  const cy = c => PAD_T + innerH - Math.max(0, Math.min(innerH, (Math.max(0, c) / maxCents) * innerH));

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // Fixed reference gridlines for every standard bend amount — always drawn,
  // regardless of which one is this question's target, so the graph's
  // layout never shifts between questions. Only the current target's line
  // gets the green highlight + tolerance band.
  FB_BEND_REFERENCE_CENTS.forEach(({ cents, label }) => {
    const isTarget = cents === targetCents;
    const y = cy(cents);
    if (isTarget) {
      const yz1 = cy(cents + FB_BEND_TOLERANCE);
      const yz2 = cy(cents - FB_BEND_TOLERANCE);
      ctx.fillStyle = 'rgba(74,124,74,0.15)';
      ctx.fillRect(0, yz1, W, yz2 - yz1);
      ctx.save();
      ctx.strokeStyle = '#4a7c4a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#4a7c4a';
      ctx.font = 'bold 11px sans-serif';
    } else {
      ctx.save();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#bbb';
      ctx.font = '10px sans-serif';
    }
    ctx.textBaseline = 'bottom';
    const targetSuffix = isTarget && s.current ? `  ${s.current.targetLabel}` : '';
    ctx.fillText(`${cents}¢ ${label}${targetSuffix}`, 6, y - 1);
  });

  // Baseline
  const yb = cy(0);
  ctx.strokeStyle = '#6a8caa';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(W, yb); ctx.stroke();
  ctx.fillStyle = '#6a8caa';
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`0¢  ${s.current ? s.current.startLabel : ''}`, 6, yb + 2);

  // ── Idle-phase: show live pitch vs. expected start note ──
  if (!s.baseFreq) {
    // Draw a horizontal "0¢ reference" line so the user knows where to aim
    const y0 = cy(0);
    ctx.strokeStyle = '#6a8caa';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    ctx.fillStyle = '#6a8caa';
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(s.current ? `0¢  ${s.current.startLabel} ← pluck here` : '0¢  pluck to begin', 6, y0 + 2);

    if (s._lastFreq && s.current) {
      // Show how far the current pitch is from the expected starting note
      const centsFromStart = 1200 * Math.log2(s._lastFreq / fbFreqFromMidi(s.current.midi));
      const px = W - 12;
      const py = cy(Math.max(-50, Math.min(300, centsFromStart)));
      const near = Math.abs(centsFromStart) < 80;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = near ? '#4a7c4a' : '#aaa';
      ctx.fill();
      ctx.fillStyle = near ? '#4a7c4a' : '#888';
      ctx.font = 'bold 12px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText((centsFromStart >= 0 ? '+' : '') + Math.round(centsFromStart) + '¢', px - 8, py);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('pluck and hold the string…', W / 2, H / 2);
      ctx.textAlign = 'left';
    }
    return;
  }

  if (!s._history || s._history.length < 2) return;

  // Pitch trace
  const now = performance.now();
  const succeeded = s.phase === 'success';
  ctx.strokeStyle = succeeded ? '#27ae60' : '#b8843a';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of s._history) {
    const x = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - ts) / FB_BEND_HISTORY_MS);
    const y = cy(Math.max(-20, Math.min(maxCents, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = s._history[s._history.length - 1];
  if (last) {
    const inZone = succeeded || Math.abs(last.cents - targetCents) <= FB_BEND_TOLERANCE;
    ctx.fillStyle = inZone ? '#27ae60' : '#b8843a';
    const dx = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - last.ts) / FB_BEND_HISTORY_MS);
    const dy = cy(Math.max(-20, Math.min(maxCents, last.cents)));
    ctx.beginPath();
    ctx.arc(Math.min(W - 4, Math.max(4, dx)), dy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Cents readout in top-right
    ctx.fillStyle = inZone ? '#27ae60' : '#2a2a2a';
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText((last.cents >= 0 ? '+' : '') + last.cents + '¢', W - 8, 4);
    ctx.textAlign = 'left';
  }

  // Success: countdown bar at the bottom of the canvas
  if (succeeded && s._nextAt) {
    const remaining = Math.max(0, s._nextAt - now);
    const frac = remaining / FB_BEND_NEXT_DELAY_MS;
    // Background track
    ctx.fillStyle = '#e0f0e0';
    ctx.fillRect(0, H - 6, W, 6);
    // Shrinking fill
    ctx.fillStyle = '#4a7c4a';
    ctx.fillRect(0, H - 6, W * frac, 6);
  }
}

function fbBendRenderStats() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-stats');
  if (!el) return;
  const acc = s.total ? Math.round(s.correct / s.total * 100) + '%' : '—';
  el.innerHTML = `<span class="fb-stat-item">${s.correct}/${s.total}</span>
    <span class="fb-stat-item">streak ${s.streak}</span>
    <span class="fb-stat-item">acc ${acc}</span>`;
}

function fbBendFb(msg, cls) {
  const el = document.getElementById('fb-bend-feedback');
  if (el) { el.textContent = msg; el.className = 'fb-feedback ' + (cls || ''); }
}

// ── Lifecycle ──

function fbBendInit() {
  fbBendSetSubMode(fbState.bend.subMode, false);
}

function fbBendSetSubMode(mode, save = true) {
  fbState.bend.subMode = mode;
  if (save) fbPrefsSave();
  document.querySelectorAll('#fb-bend .fb-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.bendmode === mode));
  document.getElementById('fb-bend-bend-panel').style.display    = mode === 'bend'    ? '' : 'none';
  document.getElementById('fb-bend-vibrato-panel').style.display  = mode === 'vibrato' ? '' : 'none';
  if (fbMic.listening && fbMic.owner === 'bend') fbBendMicStop();
  fbBendRenderOptions();
  fbVibratoRenderOptions();
  if (mode === 'bend')    fbBendNext();
  if (mode === 'vibrato') fbVibratoNext();
}

function fbBendNext() {
  const s = fbState.bend;
  s.phase = 'idle';
  s.baseFreq = null;
  s._stableFr = 0;
  s._holdSinceMs = 0;
  s._lastInZoneAt = 0;
  s._lastFreq = null;
  s._nextAt = null;
  s._history = [];
  s._lastFreqTs = null;
  s._smoothedCents = null;
  s._ampHistory = [];
  s._lastAttackAt = 0;
  // Cooldown: block baseline detection for 500 ms so a still-ringing string
  // from the previous exercise doesn't immediately lock as the new baseline.
  s._readyAt = performance.now() + 500;
  const ex = fbBendPickExercise();
  const midi = FB_STRING_OPEN_MIDI[ex.string] + ex.fret;
  const interval    = fbBendPickInterval();
  const targetCents = fbBendIntervalCents(interval);
  const targetMidi  = midi + Math.round(targetCents / 100);
  s.current = {
    string: ex.string, fret: ex.fret,
    midi,              // expected starting MIDI note — used to validate the baseline
    startLabel: fbBendNoteLabel(midi),
    targetLabel: fbBendNoteLabel(targetMidi),
    targetCents, intLabel: fbBendIntervalLabel(interval),
  };
  fbBendRenderPrompt();
  fbBendRenderGraph();
  fbBendRenderStats();
  fbBendFb(fbMic.owner === 'bend' ? 'Pluck the string…' : '', '');
}

async function fbBendMicStart() {
  try {
    await fbMicStart('bend', fbBendOnFrame);
  } catch (e) {
    fbBendFb('Mic error: ' + e.message, 'err');
    return;
  }
  if (fbState.bend.subMode === 'bend') {
    // Reset detection state so each listening session starts fresh
    fbState.bend.phase    = 'pluck';
    fbState.bend.baseFreq = null;
    fbState.bend._stableFr = 0;
    fbState.bend._lastFreq = null;
    fbState.bend._holdSinceMs = 0;
    fbState.bend._lastInZoneAt = 0;
    fbState.bend._history  = [];
    fbState.bend._lastFreqTs = null;
    fbState.bend._smoothedCents = null;
    fbState.bend._ampHistory = [];
    fbState.bend._lastAttackAt = 0;
    fbBendFb('Pluck the string — then bend…', '');
    fbBendRenderGraph();
  } else {
    fbState.vibrato.phase = 'pluck';
    document.getElementById('fb-vibrato-feedback').textContent = 'Pluck any note and apply vibrato…';
    document.getElementById('fb-vibrato-feedback').className = 'fb-feedback';
  }
  fbSyncMicButtons('bend');
}

function fbBendMicStop() {
  fbMicStop();
  fbState.bend.phase = 'idle';
  fbState.vibrato.phase = 'idle';
  fbBendRenderGraph();
  fbSyncMicButtons('bend');
}

// ── onFrame dispatcher ──

function fbBendOnFrame(analyser, sampleRate) {
  if (fbState.bend.subMode === 'vibrato') {
    fbVibratoOnFrame(analyser, sampleRate);
  } else {
    fbBendBendOnFrame(analyser, sampleRate);
  }
}

// ── Bending onFrame ──

function fbBendBendOnFrame(analyser, sampleRate) {
  const s = fbState.bend;
  const now = performance.now();

  // Auto-advance after success
  if (s._nextAt && now >= s._nextAt) {
    s._nextAt = null;
    fbBendNext();
    return;
  }

  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);

  // Re-pick (fresh attack) detection, from the amplitude envelope — tracked
  // independently of pitch so it catches a pick even during the split-second
  // before autocorrelate locks onto its frequency. A real bend is one
  // continuous ring with the pitch gradually rising; a "let me pluck the
  // target fret to check" shortcut instead produces a brand-new attack
  // transient partway through — that's exactly what this rejects.
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / buf.length);
  const ampBaseline = s._ampHistory.length > 5
    ? s._ampHistory.reduce((a, b) => a + b, 0) / s._ampHistory.length : 0;
  s._ampHistory.push(rms);
  if (s._ampHistory.length > 20) s._ampHistory.shift();
  const isAttack = rms > FB_BEND_ATTACK_MIN_RMS && rms > ampBaseline * FB_BEND_ATTACK_RATIO
    && now - s._lastAttackAt > FB_BEND_ATTACK_REFRACTORY_MS;
  if (isAttack) s._lastAttackAt = now;

  if (s.baseFreq && s.phase === 'bending' && isAttack) {
    s.baseFreq       = null;
    s.phase          = 'idle';
    s._history       = [];
    s._holdSinceMs   = 0;
    s._lastInZoneAt  = 0;
    s._smoothedCents = null;
    s._stableFr      = 0;
    s._lastFreq      = null;
    // Brief cooldown so this same pick's own ring-out doesn't immediately
    // re-lock as the new baseline before it's decayed away.
    s._readyAt = now + 300;
    fbBendFb('检测到重新拨弦——要连续推上去，不能松手重弹目标音。请重新弹起始音', 'err');
    return;
  }

  // Use a lower RMS threshold (0.003 vs default 0.01) so decaying notes
  // during bending are still detected rather than discarded as silence.
  const freq = fbAutoCorrelate(buf, sampleRate, 0.003);
  const hasSignal = freq > 60 && freq < 2000;

  if (hasSignal) {
    s._lastFreqTs = now;

    if (!s.baseFreq) {
      // ── Phase 1: lock baseline ──
      // During the cooldown window (just after fbBendNext), ignore all incoming
      // signal so a still-ringing previous note can't contaminate the baseline.
      if (s._readyAt && now < s._readyAt) {
        s._stableFr = 0;
        s._lastFreq  = null;
        return;
      }
      // Accumulate N frames with < 25¢ pitch drift to confirm the note is stable.
      if (s._lastFreq) {
        const delta = Math.abs(1200 * Math.log2(freq / s._lastFreq));
        if (delta < 25) s._stableFr++;
        else            s._stableFr = 0;
      } else {
        s._stableFr = 1;
      }
      s._lastFreq = freq;
      if (s._stableFr >= FB_BEND_STABLE_FRAMES) {
        // Validate: detected note must be within ±100¢ (1 semitone) of the
        // exercise's expected starting note.  This catches completely wrong
        // frets while still allowing for slightly out-of-tune strings.
        const lockedMidi = 69 + 12 * Math.log2(s._lastFreq / 440);
        const centsOff   = Math.abs((lockedMidi - s.current.midi) * 100);
        if (centsOff > 100) {
          fbBendFb(
            `Wrong note — play ${s.current.startLabel} (${FB_STRING_DISPLAY[s.current.string]} string, fret ${s.current.fret})`,
            'err'
          );
          s._stableFr = 0;
          s._lastFreq  = null;
          return;
        }
        s.baseFreq      = s._lastFreq;
        s.phase         = 'bending';
        s._history      = [];
        s._holdSinceMs  = 0;
        s._lastInZoneAt = 0;
        s._lastFreq     = null;
        s._stableFr     = 0;
        s._smoothedCents = 0;
        fbBendFb('Got it — now bend up!', '');
      }
    } else {
      // ── Phase 2: measure & smooth ──
      const rawCents = 1200 * Math.log2(freq / s.baseFreq);
      // EMA smoothing (α=0.4): keeps the curve fluid while tracking the bend.
      // Lower α → smoother but more lag; 0.4 gives ~80 ms lag at 60 fps.
      s._smoothedCents = (s._smoothedCents === null)
        ? rawCents
        : 0.6 * s._smoothedCents + 0.4 * rawCents;
      s._recordCents(now);
    }
  } else if (s.baseFreq && s._lastFreqTs !== null) {
    // ── Silence window ──
    // A decaying bent note goes quiet before the bend position is released.
    // Keep the smoothed value alive for up to SILENCE_HOLD_MS so the hold
    // counter can still accumulate during the quieter tail of the note.
    const sinceMs = now - s._lastFreqTs;
    if (sinceMs < FB_BEND_SILENCE_HOLD_MS && s._smoothedCents !== null) {
      s._recordCents(now);  // freeze last smoothed value — bend still held
    }
  } else if (!s.baseFreq) {
    // ── Idle + silence ──
    // No signal while waiting for the starting note. Clear _lastFreq so the
    // idle-phase pitch dot doesn't stick on the previous reading.
    s._lastFreq = null;
  }

  fbBendRenderGraph(); // always render — idle phase shows reference grid + live pitch
}

// Shared helper: push current smoothedCents into history, trim window,
// and advance the hold timer / check success.  Called from both the
// active-signal and silence-hold branches so both count toward success.
// Success requires sitting in the target zone for FB_BEND_HOLD_MS of real
// time (not an instant match) — a brief pass-through no longer counts.
fbState.bend._recordCents = function(now) {
  const s = fbState.bend;
  const cents = Math.round(s._smoothedCents);
  s._history.push({ cents, ts: now });
  const cutoff = now - FB_BEND_HISTORY_MS;
  while (s._history.length > 0 && s._history[0].ts < cutoff) s._history.shift();

  // In success state: keep history alive so the graph stays live (shows the
  // pitch dropping back as the string releases), but don't re-trigger success.
  if (s.phase === 'success') return;

  // Quarter-bend overshoot: if you push past 100¢ you've gone too far
  const isQuarter = s.current.targetCents <= 60;
  if (isQuarter && cents > 100) {
    s._holdSinceMs = 0;
    fbBendFb('太多了！停在 ¼ 音（30–70¢），不要推到半音', 'err');
    return;
  }

  const inZone = Math.abs(cents - s.current.targetCents) <= FB_BEND_TOLERANCE;
  if (inZone) {
    if (!s._holdSinceMs) s._holdSinceMs = now;
    s._lastInZoneAt = now;
    if (now - s._holdSinceMs >= FB_BEND_HOLD_MS) {
      s.phase = 'success';
      s.correct++; s.total++; s.streak++;
      fbBendRenderStats();
      s._nextAt = now + FB_BEND_NEXT_DELAY_MS;
      fbBendFb('✓ 推准了！按 Next → 继续', 'ok');
    }
  } else if (s._holdSinceMs && now - s._lastInZoneAt > FB_BEND_ZONE_GRACE_MS) {
    // Been out of the zone for more than a brief blip — reset, don't count
    // this partial hold. (A single noisy frame right at the edge doesn't
    // reset it immediately, matching the old frame-decay's intent.)
    s._holdSinceMs = 0;
    fbBendFb(isQuarter ? '推一点点，停在两音之间…' : 'Got it — now bend up!', '');
  }
};

// ── Vibrato ──

function fbVibratoNext() {
  const v = fbState.vibrato;
  v.phase = 'idle';
  v.baseFreq = null;
  v._history = [];
  v._stableFr = 0;
  v._lastFreq = null;
  v._successFr = 0;
  v._startTime = null;
  v.speed = null;
  v.depth = null;
  const fb = document.getElementById('fb-vibrato-feedback');
  if (fb) { fb.textContent = fbMic.owner === 'bend' ? 'Pluck any note and apply vibrato…' : ''; fb.className = 'fb-feedback'; }
  fbVibratoRenderWaveform();
  fbVibratoRenderReadout(null, null);
  fbVibratoRenderProgress(0);
  fbVibratoRenderStats();
}

function fbVibratoOnFrame(analyser, sampleRate) {
  const v = fbState.vibrato;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  if (!(freq > 60 && freq < 2000)) return;

  if (v.phase === 'pluck') {
    if (!v._lastFreq) { v._lastFreq = freq; return; }
    const delta = Math.abs(1200 * Math.log2(freq / v._lastFreq));
    v._lastFreq = freq;
    if (delta < 40) {
      v._stableFr++;
      if (v._stableFr >= FB_BEND_STABLE_FRAMES) {
        v.baseFreq = freq;
        v.phase = 'sustain';
        v._history = [];
        v._successFr = 0;
        v._startTime = performance.now();
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = 'Now apply vibrato!'; fb.className = 'fb-feedback'; }
      }
    } else {
      v._stableFr = 0;
    }
    return;
  }

  if (v.phase === 'sustain' || v.phase === 'success') {
    const now  = performance.now();
    const cents = Math.round(1200 * Math.log2(freq / v.baseFreq));
    v._history.push({ cents, ts: now });
    // Trim to window
    const cutoff = now - FB_VIBRATO_HISTORY_MS;
    while (v._history.length > 0 && v._history[0].ts < cutoff) v._history.shift();

    fbVibratoRenderWaveform();

    const { speed, depth } = fbVibratoAnalyze(v._history);
    v.speed = speed;
    v.depth = depth;
    fbVibratoRenderReadout(speed, depth);

    if (v.phase === 'success') return;  // stay in success until next()

    const [lo, hi] = FB_VIBRATO_TARGET_RANGES[v.targetHz] || FB_VIBRATO_TARGET_RANGES[5];
    const ok = speed >= lo && speed <= hi && depth >= FB_VIBRATO_MIN_DEPTH;
    if (ok) {
      v._successFr++;
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
      if (v._successFr >= FB_VIBRATO_SUCCESS_FR) {
        v.phase = 'success';
        v.correct++; v.total++;
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = '✓ Great vibrato!'; fb.className = 'fb-feedback ok'; }
        fbVibratoRenderStats();
        setTimeout(() => { if (fbMic.listening && fbMic.owner === 'bend') fbVibratoNext(); }, 2000);
      }
    } else {
      v._successFr = Math.max(0, v._successFr - 1);
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
    }
  }
}

function fbVibratoAnalyze(history) {
  if (history.length < 8) return { speed: 0, depth: 0 };
  const vals    = history.map(h => h.cents);
  const mean    = vals.reduce((a, b) => a + b, 0) / vals.length;
  const centered = vals.map(v => v - mean);
  const depth   = Math.round((Math.max(...centered) - Math.min(...centered)) / 2);
  let crossings = 0;
  for (let i = 1; i < centered.length; i++) {
    if (centered[i - 1] * centered[i] < 0) crossings++;
  }
  const durSec = (history[history.length - 1].ts - history[0].ts) / 1000;
  const speed  = durSec > 0.3 ? Math.round(crossings / 2 / durSec * 10) / 10 : 0;
  return { speed, depth };
}

function fbVibratoRenderWaveform() {
  const canvas = document.getElementById('fb-vibrato-canvas');
  if (!canvas) return;
  const v   = fbState.vibrato;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CENTS_RANGE = 150;  // ±150¢ displayed
  const cy2 = c => H / 2 - (c / CENTS_RANGE) * (H / 2 - 4);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // ±50¢ green zone
  const y50 = cy2(50), y50n = cy2(-50);
  ctx.fillStyle = 'rgba(74,124,74,0.1)';
  ctx.fillRect(0, y50, W, y50n - y50);

  // Dashed center
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  if (v._history.length < 2) return;

  const now = performance.now();
  ctx.strokeStyle = '#4a7c4a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of v._history) {
    const x = W - (now - ts) / FB_VIBRATO_HISTORY_MS * W;
    const y = cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = v._history[v._history.length - 1];
  if (last) {
    ctx.fillStyle = '#b8843a';
    ctx.beginPath();
    ctx.arc(W - 2, cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, last.cents))), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fbVibratoRenderReadout(speed, depth) {
  const el = document.getElementById('fb-vibrato-readout');
  if (!el) return;
  if (speed !== null) {
    el.innerHTML = `<span class="fb-vib-stat">Speed: <strong>${speed} Hz</strong></span>
      &nbsp;·&nbsp; <span class="fb-vib-stat">Depth: <strong>±${depth}¢</strong></span>`;
  } else {
    el.innerHTML = '<span style="color:#aaa">listening…</span>';
  }
}

function fbVibratoRenderProgress(frac) {
  const el = document.getElementById('fb-vibrato-progress');
  if (!el) return;
  const pct  = Math.round(Math.min(1, frac) * 100);
  const secs = (frac * FB_VIBRATO_SUCCESS_MS / 1000).toFixed(1);
  el.innerHTML = `<div class="fb-vibrato-prog-bar"><div class="fb-vibrato-prog-fill" style="width:${pct}%"></div></div>
    <span class="fb-vibrato-prog-label">${secs} / ${FB_VIBRATO_SUCCESS_MS / 1000}s</span>`;
}

function fbVibratoRenderStats() {
  const v  = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-stats');
  if (!el) return;
  el.innerHTML = `<span class="fb-stat-item">${v.correct}/${v.total} sessions completed</span>`;
}

// ── Guard action buttons against rapid double-click ──
// Answer functions (fbEarTwoAnswer, etc.) already have an
// internal `locked`/`answered` flag — only the bare "Next" and "Play"
// functions need wrapping here.
fbBendNext                = guarded(fbBendNext);
fbEarManualNext           = guarded(fbEarManualNext);
fbEarPlayCurrent          = guarded(fbEarPlayCurrent);
fbEarPlayScaffold         = guarded(fbEarPlayScaffold);
fbPitchNewNote            = guarded(fbPitchNewNote);
fbChordNewChord           = guarded(fbChordNewChord);
fbSeqNewSequence          = guarded(fbSeqNewSequence);

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    guarded,
    fbState,
    FB_NOTE_NAMES, FB_STRING_NAMES, FB_STRING_OPEN,
    FB_CHORD_QUALITIES, FB_CHORD_QUALITY_LABELS, FB_CHORD_DEGREE_LABELS,
    fbNoteAt, fbFreqFromMidi, fbOctaveOf,
    fbBarreFretForShape, fbBarreFretFor,
    fbStringMidis, fbPitchAllowedMidis,
    fbChordFormula, fbChordDisplaySymbol,
    fbFreqToNote, fbAutoCorrelate,
    FB_CAGED_SHAPES, fbShapeDegreeLabels,
    FB_EAR_SCALES, fbEarIntervalName, fbEarPossibleIntervals, fbEarAdjacentIntervals, fbEarPickOrder,
    FB_EAR_RANGE_BASE, FB_EAR_INTERVAL_HINTS,
    FB_CHORD_PROGRESSIONS, fbChordBestQualityFor, fbChordEligibleProgressions, fbChordBuildProgressionChords,
    fbBendIntervalCents, fbBendNoteLabel,
    fbVibratoAnalyze,
    fbChordPickTargetFixedRoot,
    FB_NATURAL_NOTE_NAMES, fbPitchPickTarget,
    fbChordPickTargetProgression, fbChordPreviewProgression,
    FB_SEQ_SCALE_KEYS, FB_SEQ_PATTERNS, fbSeqScaleSteps, fbSeqBuildAscending, fbSeqBuildSemitoneOffsets,
    fbSeqAnchorPosition, fbSeqAssignFretting,
    FB_SOUND_CATEGORIES, FB_SOUND_VOLUME_DEFAULT, FB_SOUND_VOLUME_MAX,
    fbSoundVolumesLoad, fbSoundVolumesSave, fbSoundGain, fbSetSoundVolume,
    fbRegisterMediaElement, fbApplySinkIdToMedia, fbOutput,
  };
}
