// fretboard.js is a plain browser <script>, so give it just enough of a DOM
// stub to load (it registers a visibilitychange listener at module scope).
global.document = { addEventListener() {} };

// FB_MEDIA_SETSINKID_SUPPORTED is computed once at module load from
// `'setSinkId' in HTMLMediaElement.prototype` — stub the class (with the
// method actually present) before requiring fretboard.js so the media-
// element output-routing tests below exercise the real code path instead of
// permanently short-circuiting on "unsupported browser".
global.HTMLMediaElement = function HTMLMediaElement() {};
global.HTMLMediaElement.prototype.setSinkId = function () {};

// fbSoundVolumesLoad/Save (per-sound-category volume prefs) round-trip
// through localStorage — stub it like song-loop.test.js does.
let _store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem(k, v) { _store[k] = v; },
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fb = require('../../web/fretboard.js');

test('fbNoteAt returns the note name at a given string/fret', () => {
  assert.equal(fb.fbNoteAt(0, 0), 'E'); // low E open
  assert.equal(fb.fbNoteAt(0, 12), 'E'); // octave up
  assert.equal(fb.fbNoteAt(1, 0), 'A'); // A string open
  assert.equal(fb.fbNoteAt(5, 0), 'E'); // high E open
});

test('fbFreqFromMidi / fbOctaveOf follow standard MIDI tuning', () => {
  assert.equal(fb.fbFreqFromMidi(69), 440); // A4
  assert.equal(fb.fbOctaveOf(69), 4);
  assert.equal(fb.fbOctaveOf(60), 4); // middle C
  assert.equal(fb.fbOctaveOf(40), 2); // low E (6th string open)
});

test('fbBarreFretFor computes correct CAGED barre position', () => {
  // E-shape barred at fret 3 (root string = low E, open) gives a G chord.
  assert.equal(fb.fbBarreFretFor('G', 'E'), 3);
  // A-shape barred at fret 3 (root string = A, open) gives a C chord.
  assert.equal(fb.fbBarreFretFor('C', 'A'), 3);
  // Barring at fret 0 should reproduce the shape's own open-position root.
  assert.equal(fb.fbBarreFretFor('E', 'E'), 0);
  assert.equal(fb.fbBarreFretFor('A', 'A'), 0);
});

test('fbStringMidis lists 13 consecutive semitones (open string through fret 12)', () => {
  const midis = fb.fbStringMidis(0); // low E string, open MIDI 40
  assert.equal(midis.length, 13);
  assert.equal(midis[0], 40);
  assert.equal(midis[12], 52);
});

test('fbPitchAllowedMidis restricts matches to the selected strings', () => {
  const s = fb.fbState.pitch;
  const originalStrings = s.strings.slice();
  try {
    s.strings = [true, true, true, true, true, true];
    const allStrings = fb.fbPitchAllowedMidis('E');
    assert.ok(allStrings.has(40)); // low E open
    assert.ok(allStrings.has(64)); // high E open

    s.strings = [true, false, false, false, false, false];
    const lowOnly = fb.fbPitchAllowedMidis('E');
    assert.ok(lowOnly.has(40));
    assert.ok(!lowOnly.has(64));
  } finally {
    s.strings = originalStrings;
  }
});

test('fbChordFormula returns scale degrees matching each quality\'s interval count', () => {
  assert.equal(fb.fbChordFormula(''), '1  3  5');
  assert.equal(fb.fbChordFormula('m'), '1  b3  5');
  assert.equal(fb.fbChordFormula('maj7'), '1  3  5  7');
  assert.equal(fb.fbChordFormula('dim7'), '1  b3  b5  bb7');
});

test('fbChordDisplaySymbol respects the selected notation style', () => {
  const s = fb.fbState.chord;
  const original = s.notationStyle;
  try {
    s.notationStyle = 'standard';
    assert.equal(fb.fbChordDisplaySymbol(0, 'm'), 'Cm');
    assert.equal(fb.fbChordDisplaySymbol(0, 'm7b5'), 'Cm7b5');

    s.notationStyle = 'jazz';
    assert.equal(fb.fbChordDisplaySymbol(0, 'm'), 'C-');
    assert.equal(fb.fbChordDisplaySymbol(0, 'maj7'), 'CΔ7');
    assert.equal(fb.fbChordDisplaySymbol(0, 'm7b5'), 'Cø7');
  } finally {
    s.notationStyle = original;
  }
});

test('fbChordFormula covers the new pop/R&B qualities (6, m6, add9, madd9, 9, m9, maj9)', () => {
  assert.equal(fb.fbChordFormula('6'), '1  3  5  6');
  assert.equal(fb.fbChordFormula('m6'), '1  b3  5  6');
  assert.equal(fb.fbChordFormula('add9'), '1  3  5  9');
  assert.equal(fb.fbChordFormula('madd9'), '1  b3  5  9');
  assert.equal(fb.fbChordFormula('9'), '1  3  5  b7  9');
  assert.equal(fb.fbChordFormula('m9'), '1  b3  5  b7  9');
  assert.equal(fb.fbChordFormula('maj9'), '1  3  5  7  9');
});

test('fbChordDisplaySymbol renders the new qualities in both notation styles', () => {
  const s = fb.fbState.chord;
  const original = s.notationStyle;
  try {
    s.notationStyle = 'standard';
    assert.equal(fb.fbChordDisplaySymbol(0, 'add9'), 'Cadd9');
    assert.equal(fb.fbChordDisplaySymbol(0, 'madd9'), 'Cm(add9)');
    assert.equal(fb.fbChordDisplaySymbol(0, 'maj9'), 'Cmaj9');

    s.notationStyle = 'jazz';
    assert.equal(fb.fbChordDisplaySymbol(0, 'm6'), 'C-6');
    assert.equal(fb.fbChordDisplaySymbol(0, 'maj9'), 'CΔ9');
  } finally {
    s.notationStyle = original;
  }
});

function sineWave(freq, sampleRate, n, amplitude = 0.8) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return buf;
}

test('fbAutoCorrelate detects the fundamental frequency of a pure sine wave', () => {
  const sampleRate = 44100;
  // Standard guitar string frequencies (low E through high E).
  for (const freq of [82.41, 110.0, 146.83, 196.0, 246.94, 329.63]) {
    const buf = sineWave(freq, sampleRate, 2048);
    const detected = fb.fbAutoCorrelate(buf, sampleRate);
    assert.ok(detected > 0, `expected a positive frequency for ${freq} Hz`);
    assert.ok(
      Math.abs(detected - freq) / freq < 0.02,
      `detected ${detected} Hz too far from target ${freq} Hz`
    );
  }
});

test('fbAutoCorrelate returns -1 for silence', () => {
  const buf = new Float32Array(2048); // all zeros
  assert.equal(fb.fbAutoCorrelate(buf, 44100), -1);
});

test('fbFreqToNote converts a frequency to note name, MIDI number, and cents', () => {
  const a4 = fb.fbFreqToNote(440);
  assert.equal(a4.noteName, 'A');
  assert.equal(a4.midi, 69);
  assert.equal(a4.cents, 0);

  const sharp = fb.fbFreqToNote(440 * Math.pow(2, 10 / 1200)); // 10 cents sharp of A4
  assert.equal(sharp.midi, 69);
  assert.equal(sharp.cents, 10);
});

test('fbShapeDegreeLabels: every CAGED major shape reduces to root/3rd/5th only', () => {
  for (const letter of ['C', 'A', 'G', 'E', 'D']) {
    const labels = fb.fbShapeDegreeLabels(fb.FB_CAGED_SHAPES[letter], '').filter(Boolean);
    assert.deepEqual([...new Set(labels)].sort(), ['1', '3', '5']);
  }
});

test('fbEarPossibleIntervals: minor pentatonic (1 b3 4 5 b7 1\') yields M2 m3 M3 P4 P5 M6 m7 P8', () => {
  const names = fb.fbEarPossibleIntervals(fb.FB_EAR_SCALES.minor.degrees);
  assert.deepEqual(names, ['M2', 'm3', 'M3', 'P4', 'P5', 'M6', 'm7', 'P8']);
});

test('fbEarPossibleIntervals: blues scale additionally reaches m2 and the tritone (b5)', () => {
  const names = fb.fbEarPossibleIntervals(fb.FB_EAR_SCALES.blues.degrees);
  assert.deepEqual(names, ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'M6', 'm7', 'P8']);
});

test('fbEarIntervalName maps semitone counts to interval names', () => {
  assert.equal(fb.fbEarIntervalName(3), 'm3');
  assert.equal(fb.fbEarIntervalName(7), 'P5');
  assert.equal(fb.fbEarIntervalName(12), 'P8');
});

test('fbEarPossibleIntervals: major/natural-minor/harmonic-minor cover the expected interval sets', () => {
  assert.deepEqual(fb.fbEarPossibleIntervals(fb.FB_EAR_SCALES.major.degrees),
    ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']);
  // Natural minor never reaches a major 7th (b7 to root is the closest, a
  // minor 7th) — that's exactly the gap harmonic minor's raised 7th fills.
  assert.deepEqual(fb.fbEarPossibleIntervals(fb.FB_EAR_SCALES.naturalMinor.degrees),
    ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'P8']);
  assert.deepEqual(fb.fbEarPossibleIntervals(fb.FB_EAR_SCALES.harmonicMinor.degrees),
    ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']);
});

test('fbChordBestQualityFor picks the triad when 7ths are disabled, and null when nothing fits', () => {
  const qs = fb.fbState.chord.qualities;
  const original = { ...qs };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true;
    assert.equal(fb.fbChordBestQualityFor(0, 'major'), ''); // I major triad
    assert.equal(fb.fbChordBestQualityFor(1, 'major'), 'm'); // ii minor triad
    assert.equal(fb.fbChordBestQualityFor(6, 'major'), null); // vii° needs m7b5/dim7, both off

    qs.maj7 = true;
    assert.equal(fb.fbChordBestQualityFor(0, 'major'), ''); // triad still preferred over maj7
  } finally {
    Object.keys(original).forEach(k => { qs[k] = original[k]; });
  }
});

test('fbChordEligibleProgressions excludes progressions needing a disabled quality', () => {
  const qs = fb.fbState.chord.qualities;
  const original = { ...qs };
  try {
    // Only major triads enabled (no minor at all) — anything using a minor
    // scale-degree chord (ii, iii, vi, or any minor-key progression) drops out.
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true;
    const names = fb.fbChordEligibleProgressions().map(p => p.name);
    assert.ok(names.includes('I – IV – V – IV')); // all-major-triad degrees only
    assert.ok(!names.includes('I – V – vi – IV (pop)')); // needs vi (minor)
    assert.ok(!names.some(p => p.startsWith('i '))); // minor-key progressions all start on i

    qs.m = true; // now minor triads are back
    const names2 = fb.fbChordEligibleProgressions().map(p => p.name);
    assert.ok(names2.includes('I – V – vi – IV (pop)'));

    // Nothing but half-diminished/diminished — no progression in the library
    // resolves purely from vii°/ii° degrees, so the eligible list is empty.
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs.m7b5 = true; qs.dim7 = true;
    assert.deepEqual(fb.fbChordEligibleProgressions(), []);
  } finally {
    Object.keys(original).forEach(k => { qs[k] = original[k]; });
  }
});

test('fbChordEligibleProgressions respects categoryFilter, and every progression has exactly one recognized category', () => {
  const validCategories = ['functional', 'circle5', 'stepwise', 'blues'];
  fb.FB_CHORD_PROGRESSIONS.forEach(p => {
    assert.ok(validCategories.includes(p.category), `${p.name} has an unrecognized category: ${p.category}`);
  });

  const qs = fb.fbState.chord.qualities;
  const originalQs = { ...qs };
  const originalFilter = fb.fbState.chord.progression.categoryFilter;
  try {
    Object.keys(qs).forEach(k => { qs[k] = true; }); // every quality enabled — filtering is purely by category now

    fb.fbState.chord.progression.categoryFilter = 'stepwise';
    const stepwise = fb.fbChordEligibleProgressions();
    assert.ok(stepwise.length > 0);
    assert.ok(stepwise.every(p => p.category === 'stepwise'));
    assert.ok(stepwise.some(p => p.name === 'IV – iii – ii – I (stepwise descent)'));

    fb.fbState.chord.progression.categoryFilter = 'all';
    assert.equal(fb.fbChordEligibleProgressions().length, fb.FB_CHORD_PROGRESSIONS.length);
  } finally {
    Object.keys(originalQs).forEach(k => { qs[k] = originalQs[k]; });
    fb.fbState.chord.progression.categoryFilter = originalFilter;
  }
});

test('fbChordBuildProgressionChords resolves the new stepwise-descent progression (IV-iii-ii-I) in B to E-Dsharpm-Csharpm-B', () => {
  const qs = fb.fbState.chord.qualities;
  const original = { ...qs };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true;
    const prog = fb.FB_CHORD_PROGRESSIONS.find(p => p.name === 'IV – iii – ii – I (stepwise descent)');
    const chords = fb.fbChordBuildProgressionChords(prog, 11); // key of B (pc 11)
    assert.deepEqual(chords.map(c => c.symbol), ['E', 'D#m', 'C#m', 'B']);
  } finally {
    Object.keys(original).forEach(k => { qs[k] = original[k]; });
  }
});

test('fbChordBuildProgressionChords resolves I-V-vi-IV in G to G-D-Em-C', () => {
  const qs = fb.fbState.chord.qualities;
  const original = { ...qs };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true;
    const prog = fb.FB_CHORD_PROGRESSIONS.find(p => p.name === 'I – V – vi – IV (pop)');
    const chords = fb.fbChordBuildProgressionChords(prog, 7); // key of G (pc 7)
    assert.deepEqual(chords.map(c => c.symbol), ['G', 'D', 'Em', 'C']);
  } finally {
    Object.keys(original).forEach(k => { qs[k] = original[k]; });
  }
});

test('fbChordBuildProgressionChords resolves the R&B ii-V-I-vi loop in C to Dm-G-C-Am', () => {
  const qs = fb.fbState.chord.qualities;
  const original = { ...qs };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true;
    const prog = fb.FB_CHORD_PROGRESSIONS.find(p => p.name === 'ii – V – I – vi (R&B / neo-soul loop)');
    const chords = fb.fbChordBuildProgressionChords(prog, 0); // key of C (pc 0)
    assert.deepEqual(chords.map(c => c.symbol), ['Dm', 'G', 'C', 'Am']);
  } finally {
    Object.keys(original).forEach(k => { qs[k] = original[k]; });
  }
});

test('fbChordPickTargetProgression repeats the same progression/key for repeatCount passes before picking a new one', () => {
  const qs = fb.fbState.chord.qualities;
  const originalQs = { ...qs };
  const p = fb.fbState.chord.progression;
  const originalP = { ...p };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true; // enough for every major/minor-key progression in the library
    fb.fbState.chord.source = 'progression';
    p.chords = null; p.repeatsLeft = 0; p.repeatCount = 2; p.lockKey = false;

    const prog = fb.fbChordPickTargetProgression();
    const def = p.def, keyRoot = p.keyRoot;
    const len = p.chords.length;

    // Walk through the rest of pass 1
    for (let i = 1; i < len; i++) fb.fbChordPickTargetProgression();
    // Start of pass 2 (the repeat) — same def/key, not a freshly picked one
    fb.fbChordPickTargetProgression();
    assert.equal(p.def, def);
    assert.equal(p.keyRoot, keyRoot);

    // Finish pass 2; the next pick must move on to a new progression/key selection
    for (let i = 1; i < len; i++) fb.fbChordPickTargetProgression();
    fb.fbChordPickTargetProgression();
    assert.equal(p.repeatsLeft, p.repeatCount - 1); // fresh pick reset the repeat counter
  } finally {
    Object.keys(originalQs).forEach(k => { qs[k] = originalQs[k]; });
    Object.assign(p, originalP);
    fb.fbState.chord.source = 'random';
  }
});

test('fbChordPickTargetProgression respects lockKey — every new progression stays in the same key', () => {
  const qs = fb.fbState.chord.qualities;
  const originalQs = { ...qs };
  const p = fb.fbState.chord.progression;
  const originalP = { ...p };
  try {
    Object.keys(qs).forEach(k => { qs[k] = false; });
    qs[''] = true; qs.m = true;
    fb.fbState.chord.source = 'progression';
    p.chords = null; p.repeatsLeft = 0; p.repeatCount = 1; // no repeats — every pass triggers a fresh progression pick
    p.lockKey = true; p.lockedKeyRoot = 3; // Eb/D#

    for (let i = 0; i < 20; i++) {
      fb.fbChordPickTargetProgression();
      assert.equal(p.keyRoot, 3);
    }
  } finally {
    Object.keys(originalQs).forEach(k => { qs[k] = originalQs[k]; });
    Object.assign(p, originalP);
    fb.fbState.chord.source = 'random';
  }
});

test('FB_EAR_RANGE_BASE tiers are distinct and low < mid < high', () => {
  const { low, mid, high } = fb.FB_EAR_RANGE_BASE;
  assert.ok(low < mid && mid < high);
});

test('FB_EAR_INTERVAL_HINTS covers every interval any scale can actually quiz on', () => {
  const allIntervals = new Set();
  Object.values(fb.FB_EAR_SCALES).forEach(({ degrees }) => {
    fb.fbEarPossibleIntervals(degrees).forEach(name => allIntervals.add(name));
  });
  allIntervals.forEach(name => {
    assert.ok(fb.FB_EAR_INTERVAL_HINTS[name], `missing anchor-song hint for ${name}`);
  });
});

test('fbEarPickOrder respects fbState.ear.direction (asc/desc forced, both random)', () => {
  const original = fb.fbState.ear.direction;
  try {
    fb.fbState.ear.direction = 'asc';
    for (let i = 0; i < 10; i++) assert.deepEqual(fb.fbEarPickOrder([1, 2], [2, 1]), [1, 2]);

    fb.fbState.ear.direction = 'desc';
    for (let i = 0; i < 10; i++) assert.deepEqual(fb.fbEarPickOrder([1, 2], [2, 1]), [2, 1]);

    fb.fbState.ear.direction = 'both';
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(JSON.stringify(fb.fbEarPickOrder([1, 2], [2, 1])));
    assert.equal(seen.size, 2); // both orders should show up over 50 tries
  } finally {
    fb.fbState.ear.direction = original;
  }
});

test('fbEarAdjacentIntervals reads the two consecutive intervals in playback order, either direction', () => {
  const degrees = fb.FB_EAR_SCALES.minor.degrees; // [0, 3, 5, 7, 10, 12]
  // ascending 1 -> b3 -> 4  (indices 0, 1, 2): m3 then M2
  assert.deepEqual(fb.fbEarAdjacentIntervals(degrees, [0, 1, 2]), [3, 2]);
  // descending 4 -> b3 -> 1  (indices 2, 1, 0): same two intervals, reversed order
  assert.deepEqual(fb.fbEarAdjacentIntervals(degrees, [2, 1, 0]), [2, 3]);
});

// ── Bend & Vibrato ────────────────────────────────────────────────────────

test('fbBendIntervalCents: quarter=50, half=100, full=200, full_half=300', () => {
  assert.equal(fb.fbBendIntervalCents('quarter'),   50);
  assert.equal(fb.fbBendIntervalCents('half'),      100);
  assert.equal(fb.fbBendIntervalCents('full'),      200);
  assert.equal(fb.fbBendIntervalCents('full_half'), 300);
});

test('fbBendNoteLabel: MIDI note number → note name + octave string', () => {
  assert.equal(fb.fbBendNoteLabel(69), 'A4');   // A4 = 440 Hz
  assert.equal(fb.fbBendNoteLabel(60), 'C4');   // middle C
  assert.equal(fb.fbBendNoteLabel(71), 'B4');
  assert.equal(fb.fbBendNoteLabel(72), 'C5');   // octave boundary
  assert.equal(fb.fbBendNoteLabel(59), 'B3');   // B string open (MIDI 59)
  assert.equal(fb.fbBendNoteLabel(64), 'E4');   // high E open (MIDI 64)
});

test('fbVibratoAnalyze: returns zeros for empty or too-short history', () => {
  assert.deepEqual(fb.fbVibratoAnalyze([]), { speed: 0, depth: 0 });
  // 7 entries < minimum 8
  const tiny = Array.from({ length: 7 }, (_, i) => ({ cents: i, ts: i * 10 }));
  assert.deepEqual(fb.fbVibratoAnalyze(tiny), { speed: 0, depth: 0 });
});

test('fbVibratoAnalyze: sinusoidal history → correct speed (Hz) and depth (¢)', () => {
  // 5 Hz vibrato, ±50¢ depth, 1 second at 10 ms per frame.
  // Phase offset π/6 ensures zero-crossings don't land on exact integer frames
  // (which would produce Math.round() → 0, making 0*x=0 miss the crossing).
  const HZ = 5, DEPTH = 50, FRAMES = 100, MS_PER_FRAME = 10;
  const PHASE = Math.PI / 6;
  const history = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = i * MS_PER_FRAME / 1000;
    history.push({ cents: Math.round(DEPTH * Math.sin(2 * Math.PI * HZ * t + PHASE)), ts: i * MS_PER_FRAME });
  }
  const { speed, depth } = fb.fbVibratoAnalyze(history);
  assert.ok(Math.abs(speed - HZ) <= 1, `speed ${speed} Hz not within 1 Hz of target ${HZ} Hz`);
  assert.ok(Math.abs(depth - DEPTH) <= 10, `depth ${depth}¢ not within 10¢ of target ${DEPTH}¢`);
});

test('fbAutoCorrelate: quiet consistent signal detected with lowered rmsThreshold', () => {
  const sampleRate = 44100;
  const freq = 220; // A3
  // Amplitude 0.04 → RMS ≈ 0.028.  Below default rmsThreshold (0.01)? No —
  // 0.028 > 0.01, so actually this passes the default.  Use amplitude 0.012
  // so RMS ≈ 0.008 which is below 0.01 but above 0.003.
  const amp = 0.012;
  const buf = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);

  // Default threshold (0.01) should reject it
  assert.equal(fb.fbAutoCorrelate(buf, sampleRate, 0.01), -1,
    'default threshold should reject RMS ≈ 0.008 signal');

  // Lower threshold (0.003) should detect the pitch
  const detected = fb.fbAutoCorrelate(buf, sampleRate, 0.003);
  assert.ok(detected > 0, `expected positive frequency, got ${detected}`);
  assert.ok(Math.abs(detected - freq) / freq < 0.05,
    `detected ${detected.toFixed(1)} Hz, expected ~${freq} Hz`);
});

// ── Fixed-root chord mode ─────────────────────────────────────────────────

test('fbChordPickTargetFixedRoot: always returns the configured root', () => {
  // Set fixed root to A (pitch class 9)
  fb.fbState.chord.fixedRoot = 9;
  fb.fbState.chord.target = null;
  // Enable a few qualities
  Object.keys(fb.fbState.chord.qualities).forEach(q => { fb.fbState.chord.qualities[q] = false; });
  fb.fbState.chord.qualities[''] = true;
  fb.fbState.chord.qualities['m'] = true;
  fb.fbState.chord.qualities['7'] = true;

  for (let i = 0; i < 30; i++) {
    const result = fb.fbChordPickTargetFixedRoot();
    assert.equal(result.root, 9, `iteration ${i}: expected root=9, got root=${result.root}`);
    assert.ok(result.quality !== undefined, 'result must have a quality');
    assert.ok(result.symbol.startsWith('A'), `symbol ${result.symbol} should start with A`);
  }
});

test('fbChordPickTargetFixedRoot: does not repeat the previous quality when alternatives exist', () => {
  fb.fbState.chord.fixedRoot = 0; // C
  Object.keys(fb.fbState.chord.qualities).forEach(q => { fb.fbState.chord.qualities[q] = false; });
  fb.fbState.chord.qualities[''] = true;  // C major
  fb.fbState.chord.qualities['m'] = true; // C minor

  // Previous quality was major — next must be minor
  fb.fbState.chord.target = { root: 0, quality: '', symbol: 'C' };
  const result = fb.fbChordPickTargetFixedRoot();
  assert.equal(result.quality, 'm',
    `with prev=major, expected minor, got ${result.quality}`);
});

test('FB_NATURAL_NOTE_NAMES is exactly A-G, no sharps', () => {
  assert.deepEqual(fb.FB_NATURAL_NOTE_NAMES, ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
});

test('fbPitchPickTarget only returns naturals when fbState.pitch.naturalsOnly is set (all-notes mode)', () => {
  const s = fb.fbState.pitch;
  const original = { naturalsOnly: s.naturalsOnly, practiceMode: s.practiceMode };
  try {
    s.naturalsOnly = true;
    s.practiceMode = 'all';
    for (let i = 0; i < 50; i++) {
      const note = fb.fbPitchPickTarget();
      assert.ok(!note.includes('#'), `expected a natural note, got ${note}`);
    }
  } finally {
    s.naturalsOnly = original.naturalsOnly;
    s.practiceMode = original.practiceMode;
  }
});

test('fbPitchPickTarget only returns naturals when fbState.pitch.naturalsOnly is set (weak-notes mode)', () => {
  const s = fb.fbState.pitch;
  const original = { naturalsOnly: s.naturalsOnly, practiceMode: s.practiceMode, stats: s.stats };
  try {
    s.naturalsOnly = true;
    s.practiceMode = 'weak';
    s.stats = {}; // no stats yet — every candidate gets the same "unseen" weight
    for (let i = 0; i < 50; i++) {
      const note = fb.fbPitchPickTarget();
      assert.ok(!note.includes('#'), `expected a natural note, got ${note}`);
    }
  } finally {
    s.naturalsOnly = original.naturalsOnly;
    s.practiceMode = original.practiceMode;
    s.stats = original.stats;
  }
});

test('fbChordPreviewProgression is a no-op (no AudioContext touched) outside progression mode or with no chords built yet', () => {
  const s = fb.fbState.chord;
  const original = { source: s.source, chords: s.progression.chords };
  try {
    s.source = 'random';
    assert.doesNotThrow(() => fb.fbChordPreviewProgression()); // not in progression mode — should bail before touching audio/DOM

    s.source = 'progression';
    s.progression.chords = null;
    assert.doesNotThrow(() => fb.fbChordPreviewProgression()); // progression mode but nothing built yet — should also bail
  } finally {
    s.source = original.source;
    s.progression.chords = original.chords;
  }
});

test('fbSeqBuildAscending: diatonic 3rds in C major produce the classic 1-3,2-4,3-5... sawtooth', () => {
  const notes = fb.fbSeqBuildAscending('major', 'thirds');
  // Semitone offsets from the tonic, not yet transposed to a key or fretted.
  assert.deepEqual(notes, [0, 4, 2, 5, 4, 7, 5, 9, 7, 11, 9, 12, 11, 14]);
});

test('fbSeqBuildAscending: triad arpeggios in natural minor stack in scale-step 3rds (0,2,4 offsets per group)', () => {
  const notes = fb.fbSeqBuildAscending('naturalMinor', 'triad');
  assert.equal(notes.length, 21); // 7 groups x 3 notes
  // First group (i minor triad): steps 0,2,4 -> semitone offsets 0,3,7
  assert.deepEqual(notes.slice(0, 3), [0, 3, 7]);
});

test('fbSeqBuildSemitoneOffsets: desc reverses the ascending pass; both concatenates asc+desc', () => {
  const asc = fb.fbSeqBuildSemitoneOffsets('major', 'sixths', 'asc');
  const desc = fb.fbSeqBuildSemitoneOffsets('major', 'sixths', 'desc');
  const both = fb.fbSeqBuildSemitoneOffsets('major', 'sixths', 'both');
  assert.deepEqual(desc, asc.slice().reverse());
  assert.deepEqual(both, asc.concat(desc));
});

test('fbSeqAnchorPosition finds the closest fret to startFret with the requested pitch class, restricted to strings with enough headroom for maxOffset', () => {
  // maxOffset=14 (one octave of 3rds) leaves strings E/A/D eligible (open
  // pitch + 14 <= high-e open + window - 1 = 68); closest C to fret 0 among
  // those is the A string at fret 3 (MIDI 48).
  const anchor = fb.fbSeqAnchorPosition(0, 0, 14); // C, near fret 0
  assert.equal(((anchor.midi % 12) + 12) % 12, 0); // pitch class is C
  assert.equal(anchor.stringIdx, 1); // A string
  assert.equal(anchor.fret, 3);
  assert.equal(anchor.midi, 48);
});

test('fbSeqAnchorPosition falls back to only the low strings when maxOffset is wide (7th arpeggios, both directions)', () => {
  // maxOffset=21 (major, seventh, both) only leaves E (40) and A (45)
  // strings with enough headroom (open + 21 <= 68). Search only moves up
  // the neck from startFret=10: A string hits C at fret 15 (dist 5), E
  // string hits C at fret 20 (dist 10) — A string wins.
  const anchor = fb.fbSeqAnchorPosition(0, 10, 21);
  assert.equal(anchor.stringIdx, 1);
  assert.equal(anchor.fret, 15);
  assert.equal(((anchor.midi % 12) + 12) % 12, 0);
});

test('fbSeqAssignFretting produces the correct absolute pitches for C major diatonic 3rds, confined to one 5-fret position', () => {
  const offsets = fb.fbSeqBuildSemitoneOffsets('major', 'thirds', 'asc');
  const anchor = fb.fbSeqAnchorPosition(0, 0, Math.max(...offsets));
  const positions = fb.fbSeqAssignFretting(anchor, offsets);
  assert.equal(positions.length, offsets.length);
  assert.deepEqual(positions.map(p => p.midi), [48, 52, 50, 53, 52, 55, 53, 57, 55, 59, 57, 60, 59, 62]);
  // The whole point of the position-based fretting: every note must fall
  // within the same 5-fret span — no mid-sequence position shifts.
  const frets = positions.map(p => p.fret);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 4);
  // Every position must land exactly on its target string's open-pitch + fret.
  positions.forEach(p => {
    assert.ok(p.fret >= 0);
    assert.equal(fb.fbStringMidis(p.stringIdx)[0] + p.fret, p.midi);
  });
});

test('fbSoundGain defaults every known category to 1 before anything is loaded/set', () => {
  _store = {};
  fb.fbSoundVolumesLoad();
  fb.FB_SOUND_CATEGORIES.forEach(({ id }) => assert.equal(fb.fbSoundGain(id), 1));
});

test('fbSetSoundVolume clamps to [0, FB_SOUND_VOLUME_MAX] and round-trips through localStorage', () => {
  _store = {};
  fb.fbSoundVolumesLoad();
  fb.fbSetSoundVolume('metronome', 1.2);
  assert.equal(fb.fbSoundGain('metronome'), 1.2);
  fb.fbSetSoundVolume('metronome', 99); // above max
  assert.equal(fb.fbSoundGain('metronome'), fb.FB_SOUND_VOLUME_MAX);
  fb.fbSetSoundVolume('metronome', -5); // below min
  assert.equal(fb.fbSoundGain('metronome'), 0);
  // Other categories are untouched by setting one of them
  assert.equal(fb.fbSoundGain('timerAlert'), 1);

  fb.fbSoundVolumesLoad(); // simulate a fresh page load reading the same storage back
  assert.equal(fb.fbSoundGain('metronome'), 0);
});

test('fbSoundVolumesLoad falls back to the default for corrupted/out-of-range/missing storage', () => {
  global.localStorage.setItem('fb_sound_volumes', 'not json');
  fb.fbSoundVolumesLoad();
  fb.FB_SOUND_CATEGORIES.forEach(({ id }) => assert.equal(fb.fbSoundGain(id), 1));

  global.localStorage.setItem('fb_sound_volumes', JSON.stringify({ metronome: 999, timerAlert: -1, practiceTones: 'loud' }));
  fb.fbSoundVolumesLoad();
  assert.equal(fb.fbSoundGain('metronome'), 1);
  assert.equal(fb.fbSoundGain('timerAlert'), 1);
  assert.equal(fb.fbSoundGain('practiceTones'), 1);
  assert.equal(fb.fbSoundGain('progressionChords'), 1); // absent from storage entirely
});

test('fbRegisterMediaElement routes a media element (Song Loop\'s <audio>) through the selected output device', async () => {
  const originalDeviceId = fb.fbOutput.deviceId;
  try {
    fb.fbOutput.deviceId = 'device-123';
    let calledWith = null;
    const fakeAudioEl = { setSinkId: async (id) => { calledWith = id; } };

    fb.fbRegisterMediaElement(fakeAudioEl);
    await Promise.resolve(); // fbApplySinkIdToMedia's setSinkId call is async
    assert.equal(calledWith, 'device-123');
  } finally {
    fb.fbOutput.deviceId = originalDeviceId;
  }
});

test('fbApplySinkIdToMedia resets to the OS default when deviceId is \'\', and swallows setSinkId rejections', async () => {
  const originalDeviceId = fb.fbOutput.deviceId;
  try {
    fb.fbOutput.deviceId = '';
    let calledWith = null;
    await fb.fbApplySinkIdToMedia({ setSinkId: async (id) => { calledWith = id; } });
    // '' is applied (not skipped) — it's how an unplugged auto-selected
    // interface falls back to the OS default output.
    assert.equal(calledWith, '');

    fb.fbOutput.deviceId = 'device-456';
    await assert.doesNotReject(fb.fbApplySinkIdToMedia({
      setSinkId: async () => { throw new Error('device gone'); },
    }));
  } finally {
    fb.fbOutput.deviceId = originalDeviceId;
  }
});

// ── Device auto-detection heuristic ──
// No persistence by design (what's plugged in changes session to session) —
// fbPickPreferredDevice re-detects the best device on startup/devicechange.

const d = (deviceId, label) => ({ deviceId, label });

test('fbPickPreferredDevice prefers a known audio interface over built-in and generic USB', () => {
  const inputs = [
    d('default', 'Default - MacBook Pro Microphone'),
    d('builtin', 'MacBook Pro Microphone'),
    d('usbmic', 'USB Microphone'),
    d('scarlett', 'Scarlett 2i2 USB'),
  ];
  assert.equal(fb.fbPickPreferredDevice(inputs, 'input').deviceId, 'scarlett');
  // UMC / UR-style interfaces match too, not just Focusrite
  assert.equal(fb.fbPickPreferredDevice([d('a', 'MacBook Pro Microphone'), d('b', 'UMC22')], 'input').deviceId, 'b');
  assert.equal(fb.fbPickPreferredDevice([d('a', 'Built-in Microphone'), d('b', 'Steinberg UR22C')], 'input').deviceId, 'b');
});

test('fbPickPreferredDevice input: generic USB mic beats built-in, built-in beats bluetooth', () => {
  const builtin = d('builtin', 'MacBook Pro Microphone');
  const usbmic = d('usb', 'Yeti Stereo Microphone');
  const airpods = d('bt', "AirPods Pro");
  assert.equal(fb.fbPickPreferredDevice([builtin, usbmic], 'input').deviceId, 'usb');
  // Built-in explicitly wins over a bluetooth headset, so connecting AirPods
  // can't silently make the OS default the practice mic
  assert.equal(fb.fbPickPreferredDevice([builtin, airpods], 'input').deviceId, 'builtin');
  // Bluetooth alone -> no actionable pick (null = OS default)
  assert.equal(fb.fbPickPreferredDevice([airpods], 'input'), null);
});

test('fbPickPreferredDevice output: only clearly-better gear overrides the OS default', () => {
  const speakers = d('spk', 'MacBook Pro Speakers');
  const iface = d('scarlett', 'Focusrite Scarlett 2i2');
  const airpods = d('bt', 'AirPods Pro');
  assert.equal(fb.fbPickPreferredDevice([speakers, iface], 'output').deviceId, 'scarlett');
  // Headphones are left to the OS default (which already follows them)
  assert.equal(fb.fbPickPreferredDevice([speakers, airpods], 'output'), null);
  assert.equal(fb.fbPickPreferredDevice([speakers], 'output'), null);
});

test('fbPickPreferredDevice ignores label-less pre-permission entries', () => {
  // Before mic permission is granted, enumerateDevices hides ids and labels
  assert.equal(fb.fbPickPreferredDevice([d('', ''), d('', '')], 'input'), null);
});

test('fbPickPreferredDevice never auto-picks virtual loopback cables (BlackHole/"qianyan")', () => {
  // "qianyan" is a renamed BlackHole virtual device (manufacturer Existential
  // Audio) — selecting it means playing into the void
  const qianyan = d('virt', 'qianyan');
  const blackhole = d('bh', 'BlackHole 2ch');
  const builtin = d('builtin', 'MacBook Pro Microphone');
  const speakers = d('spk', 'MacBook Pro Speakers');
  assert.equal(fb.fbPickPreferredDevice([qianyan, builtin], 'input').deviceId, 'builtin');
  assert.equal(fb.fbPickPreferredDevice([blackhole, speakers], 'output'), null);
  // Only virtual devices present -> null (OS default), not the void
  assert.equal(fb.fbPickPreferredDevice([qianyan], 'input'), null);
});

test('fbPickPreferredDevice never picks Zoom\'s virtual meeting driver either', () => {
  const zoom = d('zoom', 'ZoomAudioDevice');
  const builtin = d('builtin', 'MacBook Pro Microphone');
  assert.equal(fb.fbPickPreferredDevice([zoom, builtin], 'input').deviceId, 'builtin');
  assert.equal(fb.fbPickPreferredDevice([zoom], 'output'), null);
});

test('fbDedupDevices collapses the "Default - X" alias into the real device', () => {
  const devices = [
    d('default', 'Default - MacBook Pro Speakers'),
    d('real-spk', 'MacBook Pro Speakers'),
    d('iface', 'Scarlett 2i2 USB'),
  ];
  const out = fb.fbDedupDevices(devices);
  assert.deepEqual(out.map(x => x.deviceId), ['real-spk', 'iface']);
  // An alias matching no real device is kept (better than an empty list)
  const orphan = fb.fbDedupDevices([d('default', 'Default - Something Else')]);
  assert.equal(orphan.length, 1);
});

test('FB_VIRTUAL_RE matches meeting/virtual drivers but NOT real hardware from the same vendors', () => {
  // Zoom's virtual driver is one word; Zoom Corporation also makes real
  // guitar-friendly interfaces (H4n/H6/LiveTrak) that must NOT be filtered
  assert.ok(fb.FB_VIRTUAL_RE.test('ZoomAudioDevice'));
  assert.ok(!fb.FB_VIRTUAL_RE.test('Zoom H4n'));
  assert.ok(!fb.FB_VIRTUAL_RE.test('ZOOM LiveTrak L-12'));
  // Hollyland LARK is a real wireless mic — a bare /lark/i would blacklist it
  assert.ok(!fb.FB_VIRTUAL_RE.test('Hollyland LARK M2'));
  // Other common virtual drivers
  for (const label of ['Krisp Microphone (Krisp)', 'NVIDIA Broadcast', 'VooV Meeting Audio Device', 'qianyan']) {
    assert.ok(fb.FB_VIRTUAL_RE.test(label), label);
  }
});
