// chord-id.js is a plain browser <script> sharing the fb-*.js modules' global
// scope for FB_CHORD_QUALITIES/FB_NOTE_NAMES/FB_STRING_OPEN/guarded() — same
// bridging trick tests/js/song-loop.test.js uses for its own cross-file deps.
global.document = { addEventListener() {} };
global.HTMLMediaElement = function HTMLMediaElement() {};
global.HTMLMediaElement.prototype.setSinkId = function () {};

const test = require('node:test');
const assert = require('node:assert/strict');

require('./load-fretboard.js');
const cid = require('../../web/chord-id.js');

test('fbCidPitchClasses reads pitch classes and the lowest sounding string', () => {
  // x32010 = C major (A string 3rd fret=C, D open, G open muted-2nd-fret=B, B string 1st fret=C, high e open=E)
  const { pcSet, bassPc } = cid.fbCidPitchClasses(['x', 3, 2, 0, 1, 0]);
  assert.equal(bassPc, 0); // A-string 3rd fret = C = pitch class 0
  assert.deepEqual([...pcSet].sort((a, b) => a - b), [0, 4, 7]); // C, E, G
});

test('fbCidCandidates: a full open C major shape matches C major with nothing omitted', () => {
  const { pcSet } = cid.fbCidPitchClasses(['x', 3, 2, 0, 1, 0]);
  const candidates = cid.fbCidCandidates(pcSet);
  const top = candidates[0];
  assert.equal(top.rootPc, 0); // C
  assert.equal(top.quality, '');
  assert.equal(top.missing.length, 0);
});

test('fbCidCandidates: root+5th only ("power chord") matches major/minor/sus2/sus4 all with one note omitted', () => {
  const pcSet = new Set([0, 7]); // C, G
  const candidates = cid.fbCidCandidates(pcSet).filter(c => c.rootPc === 0);
  const qualities = candidates.filter(c => c.notesTotal === 3).map(c => c.quality).sort();
  assert.deepEqual(qualities, ['', 'm', 'sus2', 'sus4'].sort());
});

test('fbCidComputeAmbiguity flags the power-chord case and stays silent once a quality is forced', () => {
  const pcSet = new Set([0, 7]);
  const candidates = cid.fbCidCandidates(pcSet);
  const amb1 = cid.fbCidComputeAmbiguity(pcSet, 0, candidates, { forceQuality: null, forceRootPc: null, bassClarifyChoice: null });
  assert.equal(amb1.qualityAmbiguous, 0);
  const amb2 = cid.fbCidComputeAmbiguity(pcSet, 0, candidates, { forceQuality: '', forceRootPc: 0, bassClarifyChoice: 'yes' });
  assert.equal(amb2.qualityAmbiguous, null);
});

test('fbCidComputeAmbiguity flags too-few-notes and bass-mismatch cases', () => {
  const single = new Set([0]);
  const amb = cid.fbCidComputeAmbiguity(single, 0, [], { forceQuality: null, forceRootPc: null, bassClarifyChoice: null });
  assert.equal(amb.tooFew, true);

  // Am triad (A,C,E) voiced with C in the bass -> best candidate's root (A) != bassPc (C)
  const pcSet = new Set([9, 0, 4]); // A, C, E
  const candidates = cid.fbCidCandidates(pcSet);
  const amb2 = cid.fbCidComputeAmbiguity(pcSet, 0, candidates, { forceQuality: null, forceRootPc: null, bassClarifyChoice: null });
  assert.equal(amb2.bassAmbiguous, 0);
});

test('fbCidChordsOfLine flattens measures in beat order, skipping empty and continuation slots', () => {
  const line = {
    measures: [
      [{ rootPc: 0, span: 2 }, 'occupied', null, null],
      [{ rootPc: 7, span: 4 }, 'occupied', 'occupied', 'occupied'],
    ],
  };
  assert.deepEqual(cid.fbCidChordsOfLine(line).map(c => c.rootPc), [0, 7]);
});

test('fbCidCanPlaceSpan checks room in a 4-beat measure, and ignoreFrom exempts a chip\'s own current cells', () => {
  const measure = [{ rootPc: 0, span: 2 }, 'occupied', null, null];
  assert.equal(cid.fbCidCanPlaceSpan(measure, 2, 2, null), true); // the two empty trailing beats
  assert.equal(cid.fbCidCanPlaceSpan(measure, 1, 2, null), false); // beat 1 is occupied by the first chord
  assert.equal(cid.fbCidCanPlaceSpan(measure, 0, 3, null), false); // would run past the occupied beat
  assert.equal(cid.fbCidCanPlaceSpan(measure, 0, 4, null), false); // wouldn't fit in 4 beats total once occupied
  assert.equal(cid.fbCidCanPlaceSpan(measure, 0, 2, { si: 0, span: 2 }), true); // resizing/dropping back onto itself
  assert.equal(cid.fbCidCanPlaceSpan(measure, 0, 5, null), false); // longer than a measure, full stop
});

test('fbCidLegacyChordsToMeasures migrates old bar/break lines to measures, splitting beats the way each bar used to imply', () => {
  const chords = [
    { rootPc: 0, quality: '' }, { rootPc: 5, quality: '' }, { rootPc: 7, quality: '' }, { rootPc: 0, quality: '' },
  ].map(c => ({ candidates: [c], chosenIdx: 0, locked: true, input: ['x', 'x', 'x', 'x', 'x', 'x'] }));
  // breaks: [false, true, true] -> bars of length [2, 1, 1]
  const measures = cid.fbCidLegacyChordsToMeasures(chords, [false, true, true]);
  assert.equal(measures.length, 3);
  assert.deepEqual(measures[0].map(c => c && c !== 'occupied' ? c.span : c), [2, 'occupied', 2, 'occupied']); // 2-chord bar -> half each
  assert.deepEqual(measures[1].map(c => c && c !== 'occupied' ? c.span : c), [4, 'occupied', 'occupied', 'occupied']); // 1-chord bar -> whole measure
  assert.deepEqual(measures[2].map(c => c && c !== 'occupied' ? c.span : c), [4, 'occupied', 'occupied', 'occupied']);
});

test('fbCidInferKey picks C major for a I-IV-V-I progression', () => {
  const chords = [{ rootPc: 0, quality: '' }, { rootPc: 5, quality: '' }, { rootPc: 7, quality: '' }, { rootPc: 0, quality: '' }];
  const key = cid.fbCidInferKey(chords);
  assert.equal(key.tonicPc, 0);
  assert.equal(key.isMinor, false);
});

test('fbCidInferKey picks A natural minor for i-iv-v-i', () => {
  const chords = [{ rootPc: 9, quality: 'm' }, { rootPc: 2, quality: 'm' }, { rootPc: 4, quality: 'm' }, { rootPc: 9, quality: 'm' }];
  const key = cid.fbCidInferKey(chords);
  assert.equal(key.tonicPc, 9);
  assert.equal(key.isMinor, true);
});

test('fbCidRomanForChord labels diatonic degrees, borrowed chords, and secondary dominants in C', () => {
  assert.equal(cid.fbCidRomanForChord(0, '', 0).label, 'I');
  assert.equal(cid.fbCidRomanForChord(9, 'm', 0).label, 'vi');
  assert.equal(cid.fbCidRomanForChord(11, 'dim', 0).label, 'vii°');
  assert.equal(cid.fbCidRomanForChord(7, '7', 0).label, 'V7');

  const bIII = cid.fbCidRomanForChord(3, '', 0); // Eb major, borrowed from parallel minor
  assert.equal(bIII.label, 'bIII');
  assert.equal(bIII.functionGroup, null);

  const secondary = cid.fbCidRomanForChord(9, '7', 0); // A7 -> V7/ii (resolves to Dm)
  assert.equal(secondary.label, 'V7/ii');
  assert.equal(secondary.secondaryOf, 'ii');
});

test('fbCidDetectCadences finds V-I, IV-I and ii-V-I', () => {
  const seq = [[2, 'm'], [7, '7'], [0, '']]; // ii V7 I
  const roman = seq.map(([r, q]) => cid.fbCidRomanForChord(r, q, 0));
  const cadences = cid.fbCidDetectCadences(roman);
  const types = cadences.map(c => c.type);
  assert.ok(types.includes('ii-V-I'));
  assert.ok(types.includes('正格终止 V→I'));
});

test('fbCidSuggestAlts offers same-function alternates, capped at one line per group present', () => {
  // I (C) and vi (Am) both present -> one T-group suggestion
  const roman = [cid.fbCidRomanForChord(0, '', 0), cid.fbCidRomanForChord(9, 'm', 0)];
  const suggestions = cid.fbCidSuggestAlts(roman);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].fn, 'T');
});

test('fbCidRepresentativeChord: locked slot uses chosenIdx, unlocked slot falls back to the top-ranked candidate', () => {
  const locked = { candidates: [{ rootPc: 0, quality: '' }, { rootPc: 0, quality: 'm' }], chosenIdx: 1, locked: true };
  assert.deepEqual(cid.fbCidRepresentativeChord(locked), { rootPc: 0, quality: 'm' });

  const unlocked = { candidates: [{ rootPc: 0, quality: '' }, { rootPc: 0, quality: 'm' }], chosenIdx: null, locked: false };
  assert.deepEqual(cid.fbCidRepresentativeChord(unlocked), { rootPc: 0, quality: '' });

  assert.equal(cid.fbCidRepresentativeChord({ candidates: [], chosenIdx: null, locked: false }), null);
});

test('fbCidResolveProgression: an unresolved power-chord slot is filled in from the key + the rest of the progression, and never overrides a locked slot', () => {
  // C - [E power chord, undecided] - G, entered without picking a candidate
  // for the middle slot. In the key of C, "Em" (diatonic iii) should win
  // over "E major" (chromatic) purely from context.
  const cCandidates = cid.fbCidCandidates(new Set([0, 4, 7]));
  const ePowerCandidates = cid.fbCidCandidates(new Set([4, 11])).filter(c => c.rootPc === 4 && c.notesTotal === 3);
  const gCandidates = cid.fbCidCandidates(new Set([7, 11, 2]));

  const chords = [
    { candidates: cCandidates, chosenIdx: 0, locked: true },
    { candidates: ePowerCandidates, chosenIdx: null, locked: false },
    { candidates: gCandidates, chosenIdx: 0, locked: true },
  ];
  const { key } = cid.fbCidResolveProgression(chords, 'auto', 0, false);
  assert.equal(key.tonicPc, 0);
  assert.equal(key.isMinor, false);

  const middle = cid.fbCidRepresentativeChord(chords[1]);
  assert.equal(middle.rootPc, 4);
  assert.equal(middle.quality, 'm'); // Em, not E major/sus2/sus4
  assert.equal(chords[1].locked, false); // still unresolved — just filled in, not pinned

  // locking it to E major and re-resolving must not be overridden
  chords[1].chosenIdx = ePowerCandidates.findIndex(c => c.quality === '');
  chords[1].locked = true;
  cid.fbCidResolveProgression(chords, 'auto', 0, false);
  assert.equal(cid.fbCidRepresentativeChord(chords[1]).quality, '');
});

test('fbCidResolveProgression picks Am over C6 for an A-C-E shape in the key of C — a candidate\'s root landing on the tonic must not out-vote a candidate that actually fits the scale degree', () => {
  // A,C,E played with no clarify: matches both Am (root A, diatonic vi) and
  // C6 (root C, only 3/4 of its tones present) — C6's root happens to equal
  // the key's tonic, which must not by itself outweigh Am actually being
  // the diatonic (and fuller-coverage) reading.
  const amCandidates = cid.fbCidCandidates(new Set([9, 0, 4]));
  const chords = [
    { candidates: cid.fbCidCandidates(new Set([0, 4, 7])), chosenIdx: 0, locked: true }, // C, locked
    { candidates: amCandidates, chosenIdx: null, locked: false },
    { candidates: cid.fbCidCandidates(new Set([7, 11, 2])), chosenIdx: 0, locked: true }, // G, locked
  ];
  cid.fbCidResolveProgression(chords, 'auto', 0, false);
  const middle = cid.fbCidRepresentativeChord(chords[1]);
  assert.equal(middle.rootPc, 9);
  assert.equal(middle.quality, 'm'); // Am, not C6
});

test('fbCidScoreChordInKey scores a single chord\'s diatonic fit without the whole-progression tonic tie-break', () => {
  // C in the key of C: root on tonic (offset 0, in table) + quality matches -> 2+1
  assert.equal(cid.fbCidScoreChordInKey(0, '', 0, false), 3);
  // A minor in the key of C: root on vi (offset 9, in table) + quality matches -> 2+1,
  // same as C6 (root 0, quality '6' also reads as the major-family default at offset 0)
  // so neither one gets an extra, unearned boost just because its root equals the tonic.
  assert.equal(cid.fbCidScoreChordInKey(9, 'm', 0, false), 3);
  assert.equal(cid.fbCidScoreChordInKey(0, '6', 0, false), 3);
});
