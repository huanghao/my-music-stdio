// ── Fretboard trainer — core shared infrastructure: guarded(), note/CAGED data, fbState ──
// Split out of web/fretboard.js (pure code move, no logic changes).

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
  iv: {
    rootString: 0, rootFret: 3,   // stringIdx 0 = low E .. 5 = high e (FB_STRING_OPEN convention)
    degrees: { 4: true, 7: true, 11: true },   // semitone offset from root -> shown; root (0) is always shown
    scrollX: 0,                   // user-controlled horizontal pan of the board — never auto-moved (see fbIvRenderBoard)
    // Floating-panel chrome (page-independent — see fbIvInit/fbIvOpen/fbIvClose):
    open: false, pos: null, width: 520, height: 460,
  },
};

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    guarded, FB_NOTE_NAMES, FB_STRING_NAMES, FB_STRING_OPEN, fbNoteAt, FB_STRING_OPEN_MIDI,
    fbFreqFromMidi, fbOctaveOf, FB_CAGED_SHAPES, FB_SHAPE_ORDER, fbBarreFretForShape, fbBarreFretFor,
    fbState,
  };
}
