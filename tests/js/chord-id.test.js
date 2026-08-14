// chord-id.js is a plain browser <script> sharing fretboard.js's global
// scope for FB_CHORD_QUALITIES/FB_NOTE_NAMES/FB_STRING_OPEN/guarded() — same
// bridging trick tests/js/song-loop.test.js uses for its own cross-file deps.
global.document = { addEventListener() {} };
global.HTMLMediaElement = function HTMLMediaElement() {};
global.HTMLMediaElement.prototype.setSinkId = function () {};

const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(global, require('../../web/fretboard.js'));
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

test('fbCidBarsFromChords groups by break flags; fbCidCanMergeAt blocks bars over 3 chords', () => {
  const chords = [{ rootPc: 0, quality: '' }, { rootPc: 5, quality: '' }, { rootPc: 7, quality: '' }, { rootPc: 0, quality: '' }];
  const bars = cid.fbCidBarsFromChords(chords, [false, true, true]);
  assert.deepEqual(bars.map(b => b.length), [2, 1, 1]);

  // merging chord index 2 into a bar that already holds 3 chords should be rejected
  const breaks = [false, false, true];
  assert.equal(cid.fbCidCanMergeAt(chords, breaks, 2), false);
  assert.equal(cid.fbCidCanMergeAt(chords, [true, false, true], 0), true);
});

test('fbCidBreaksAfterInsert splits the boundary the insertion point falls on, leaving other boundaries untouched', () => {
  // 4 chords A,B,C,D with breaks [b0,b1,b2] = A-B,B-C,C-D
  const breaks = [false, false, true]; // A~B~C same bar, C|D separate

  // insert before index 2 (between B and C) -> A~B|X|C|D: b0 (A-B) survives, the two new boundaries around X are forced true
  assert.deepEqual(cid.fbCidBreaksAfterInsert(breaks, 2), [false, true, true, true]);

  // insert at the very front -> X|A~B~C|D
  assert.deepEqual(cid.fbCidBreaksAfterInsert(breaks, 0), [true, false, false, true]);

  // insert at the very end (idx === chords.length) is just append, same as breaks.push(true)
  assert.deepEqual(cid.fbCidBreaksAfterInsert(breaks, 4), [false, false, true, true]);
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
