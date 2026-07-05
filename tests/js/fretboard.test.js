// fretboard.js is a plain browser <script>, so give it just enough of a DOM
// stub to load (it registers a visibilitychange listener at module scope).
global.document = { addEventListener() {} };

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

test('fbDegreeChordName: full diatonic set of G major matches G-Am-Bm-C-D-Em-F#dim', () => {
  const G = 7;
  const expected = ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim'];
  const actual = expected.map((_, i) => fb.fbDegreeChordName(G, i));
  assert.deepEqual(actual, expected);
});

test('fbShapeDegreeLabels: every CAGED major shape reduces to root/3rd/5th only', () => {
  for (const letter of ['C', 'A', 'G', 'E', 'D']) {
    const labels = fb.fbShapeDegreeLabels(fb.FB_CAGED_SHAPES[letter], '').filter(Boolean);
    assert.deepEqual([...new Set(labels)].sort(), ['1', '3', '5']);
  }
});

test('fbShapePositionsForShape: G major via the E-shape barred at fret 3 (1-5-1-3-5-1)', () => {
  const positions = fb.fbShapePositionsForShape(fb.FB_CAGED_SHAPES.E, 3);
  assert.deepEqual(positions, [
    { stringIdx: 0, fret: 3, degree: '1' },
    { stringIdx: 1, fret: 5, degree: '5' },
    { stringIdx: 2, fret: 5, degree: '1' },
    { stringIdx: 3, fret: 4, degree: '3' },
    { stringIdx: 4, fret: 3, degree: '5' },
    { stringIdx: 5, fret: 3, degree: '1' },
  ]);
});

test('fbShapeDegreeSetup only draws from shapes enabled in fbState.shapeDegree.shapes', () => {
  const s = fb.fbState.shapeDegree;
  const original = s.shapes.slice();
  try {
    s.shapes = [true, true, false, false, false]; // only C (1) and A (2)
    for (let i = 0; i < 50; i++) {
      const { shapeLetter } = fb.fbShapeDegreeSetup();
      assert.ok(['C', 'A'].includes(shapeLetter));
    }
  } finally {
    s.shapes = original;
  }
});

test('fbShapePositionsForShape: skips muted strings (A-shape barre has no low-E note)', () => {
  const positions = fb.fbShapePositionsForShape(fb.FB_CAGED_SHAPES.A, 3);
  assert.equal(positions.length, 5);
  assert.ok(!positions.some(p => p.stringIdx === 0));
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
