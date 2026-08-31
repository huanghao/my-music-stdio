// key-drill.js is a plain browser <script>; its DOM work all lives inside
// initKeyDrillPage()/kdRenderQuestion()/etc, which these tests never call —
// only the pure quiz-logic functions are exercised here.
const test = require('node:test');
const assert = require('node:assert/strict');

// key-drill.js calls slRomanToChord/PL_LOOKUP_DEGREES as bare globals (real
// page load: song-loop.js/progression-lab.js/key-drill.js share one global
// scope via plain <script> tags) — mirror song-loop.test.js's precedent of
// copying the real modules onto `global` rather than hand-rolling stand-ins.
global.document = global.document || { addEventListener() {} };
global.HTMLMediaElement = global.HTMLMediaElement || function HTMLMediaElement() {};
global.HTMLMediaElement.prototype.setSinkId = global.HTMLMediaElement.prototype.setSinkId || function () {};
Object.assign(global, require('../../web/progression-lab.js'));
require('./load-fretboard.js');
Object.assign(global, require('../../web/song-loop.js'));
const kd = require('../../web/key-drill.js');

// Deterministic sequence-based rng for tests that need one: returns each
// value in `seq` in order, repeating the last one if called more times.
function seqRng(seq) {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

test('kdPickWeightedKey always returns roll=0 to the first key', () => {
  const keys = ['G 大调', 'C 大调', 'F#/Gb 大调'];
  const weights = { 'G 大调': 10, 'C 大调': 1 }; // 'F#/Gb 大调' falls back to weight 1
  assert.equal(kd.kdPickWeightedKey(keys, weights, seqRng([0])), 'G 大调');
});

test('kdPickWeightedKey picks proportionally to weight, not uniformly', () => {
  const keys = ['G 大调', 'C 大调'];
  const weights = { 'G 大调': 3, 'C 大调': 1 }; // total=4
  assert.equal(kd.kdPickWeightedKey(keys, weights, seqRng([0])), 'G 大调');   // roll=0
  assert.equal(kd.kdPickWeightedKey(keys, weights, seqRng([0.7])), 'G 大调'); // roll=2.8 < 3
  assert.equal(kd.kdPickWeightedKey(keys, weights, seqRng([0.9])), 'C 大调'); // roll=3.6 >= 3
});

test('kdPickWeightedKey falls back to weight 1 for a key missing from the weight table', () => {
  const keys = ['Unlisted 大调'];
  assert.equal(kd.kdPickWeightedKey(keys, {}, seqRng([0.99])), 'Unlisted 大调');
});

test('kdDiatonicChords returns the 7 diatonic triads of a major key in degree order', () => {
  const chords = kd.kdDiatonicChords('C 大调');
  assert.deepEqual(chords.map(c => c.chord), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(chords.map(c => c.roman), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
});

test('kdDiatonicChords returns the 7 diatonic triads of a natural-minor key', () => {
  const chords = kd.kdDiatonicChords('Am 小调');
  assert.deepEqual(chords.map(c => c.chord), ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
});

test('kdDiatonicChords respells sharp-key accidentals as sharps, not the engine\'s default flats', () => {
  // D major's iii/vii° are F#m/C#dim in every real chord chart — the
  // underlying slRomanToChord/plChordSymbol engine only knows flat
  // spelling (Gbm/Dbdim), so kdDiatonicChords must respell for keys that
  // conventionally use sharps.
  assert.deepEqual(kd.kdDiatonicChords('D 大调').map(c => c.chord), ['D', 'Em', 'F#m', 'G', 'A', 'Bm', 'C#dim']);
  assert.deepEqual(kd.kdDiatonicChords('G 大调').map(c => c.chord), ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
});

test('kdDiatonicChords leaves flat-key spelling untouched (already correct)', () => {
  assert.deepEqual(kd.kdDiatonicChords('F 大调').map(c => c.chord), ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'Edim']);
  assert.deepEqual(kd.kdDiatonicChords('Bb 大调').map(c => c.chord), ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim']);
});

test('kdRespell only respells the practice keys with a sharp key signature', () => {
  assert.equal(kd.kdRespell('Gbm', 'D 大调'), 'F#m');
  assert.equal(kd.kdRespell('Dbdim', 'A 大调'), 'C#dim');
  assert.equal(kd.kdRespell('Bb', 'F 大调'), 'Bb'); // flat key — left alone
  assert.equal(kd.kdRespell('C', 'C 大调'), 'C');   // no accidental — no-op
});

test('kdShuffle is a pure permutation — same elements, order driven by rng', () => {
  const arr = [1, 2, 3, 4];
  const shuffled = kd.kdShuffle(arr, seqRng([0, 0, 0]));
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4]);
  assert.deepEqual(arr, [1, 2, 3, 4]); // original untouched
});

test('kdBuildQuestion chordToDegree: prompts with the chord, answer is the roman numeral', () => {
  // rng sequence: [0]=correctIndex picks degree 0 (I), then distractor picks, then shuffle picks
  const q = kd.kdBuildQuestion('C 大调', 'chordToDegree', seqRng([0]));
  assert.equal(q.prompt, 'C');
  assert.equal(q.correctAnswer, 'I');
  assert.equal(q.choices.length, 4);
  assert.ok(q.choices.includes('I'));
});

test('kdBuildQuestion degreeToChord: prompts with the roman numeral, answer is the chord', () => {
  const q = kd.kdBuildQuestion('G 大调', 'degreeToChord', seqRng([0]));
  assert.equal(q.prompt, 'I');
  assert.equal(q.correctAnswer, 'G');
});

test('kdBuildQuestion never includes the correct answer twice among distractors', () => {
  const q = kd.kdBuildQuestion('D 大调', 'degreeToChord', seqRng([0.5, 0.1, 0.2, 0.3, 0.9]));
  const occurrences = q.choices.filter(c => c === q.correctAnswer).length;
  assert.equal(occurrences, 1);
  assert.equal(new Set(q.choices).size, q.choices.length); // all distinct
});

test('kdNextTimeLimit tightens by KD_TIME_STEP on correct, loosens by 2x on wrong, clamped to [MIN, MAX]', () => {
  assert.equal(kd.kdNextTimeLimit(4000, true), 4000 - kd.KD_TIME_STEP);
  assert.equal(kd.kdNextTimeLimit(4000, false), 4000 + kd.KD_TIME_STEP * 2);
  assert.equal(kd.kdNextTimeLimit(kd.KD_TIME_LIMIT_MIN, true), kd.KD_TIME_LIMIT_MIN); // floor
  assert.equal(kd.kdNextTimeLimit(kd.KD_TIME_LIMIT_MAX, false), kd.KD_TIME_LIMIT_MAX); // ceiling
});

test('kdRecordAnswer accumulates per-key correct/total without mutating the input', () => {
  const stats = { 'G 大调': { correct: 2, total: 3 } };
  const next = kd.kdRecordAnswer(stats, 'G 大调', true);
  assert.deepEqual(next['G 大调'], { correct: 3, total: 4 });
  assert.deepEqual(stats['G 大调'], { correct: 2, total: 3 }); // original untouched
});

test('kdRecordAnswer starts a new key at {correct:0,total:0} before applying the answer', () => {
  const next = kd.kdRecordAnswer({}, 'C 大调', false);
  assert.deepEqual(next['C 大调'], { correct: 0, total: 1 });
});
