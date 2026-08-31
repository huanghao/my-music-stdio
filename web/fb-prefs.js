// ── Fretboard trainer — practice preferences (fbPrefsLoad/fbPrefsSave) ──
// Split out of web/fretboard.js (pure code move, no logic changes).

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
  if (saved.iv) {
    if (Number.isInteger(saved.iv.rootString) && saved.iv.rootString >= 0 && saved.iv.rootString < 6) fbState.iv.rootString = saved.iv.rootString;
    if (Number.isInteger(saved.iv.rootFret) && saved.iv.rootFret >= 0 && saved.iv.rootFret <= FB_IV_MAX_FRET) fbState.iv.rootFret = saved.iv.rootFret;
    if (saved.iv.degrees && typeof saved.iv.degrees === 'object') {
      const degrees = {};
      FB_IV_DEGREES.forEach(d => { degrees[d.offset] = !!saved.iv.degrees[d.offset]; });
      fbState.iv.degrees = degrees;
    }
    if (typeof saved.iv.open === 'boolean') fbState.iv.open = saved.iv.open;
    if (Number.isFinite(saved.iv.scrollX) && saved.iv.scrollX >= 0) fbState.iv.scrollX = saved.iv.scrollX;
    if (saved.iv.pos && Number.isFinite(saved.iv.pos.x) && Number.isFinite(saved.iv.pos.y)) fbState.iv.pos = saved.iv.pos;
    if (Number.isFinite(saved.iv.width)) fbState.iv.width = saved.iv.width;
    if (Number.isFinite(saved.iv.height)) fbState.iv.height = saved.iv.height;
  }
  // 'chord' deliberately excluded — Chord Match moved off the Fretboard tab
  // strip onto its own page, so a stale saved 'chord' (from before that
  // change) must fall through to the default 'pitch' rather than restore a
  // mode fbShowMode can no longer find a tab/panel for. 'iv' is excluded for
  // the same reason — Interval Shapes moved off the tab strip entirely, onto
  // its own page-independent floating panel (see fbIvInit).
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
    iv: { rootString: fbState.iv.rootString, rootFret: fbState.iv.rootFret, degrees: fbState.iv.degrees,
          scrollX: fbState.iv.scrollX,
          open: fbState.iv.open, pos: fbState.iv.pos, width: fbState.iv.width, height: fbState.iv.height },
    activeMode: fbState.activeMode,
  }));
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_PREFS_KEY, fbPrefsLoad, fbPrefsSave,
  };
}
