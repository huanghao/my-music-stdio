// dom-drill.js is standalone (no fretboard/chord-id globals needed), so it
// can be require()'d directly in Node tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const dd = require('../../web/dom-drill.js');

test('ddDominantPcOf / ddResolvePcOf: V/x and its resolution are fifths-circle neighbors', () => {
  // Dm's dominant is A7 (D=2 -> A=9); A7 resolves to D (9 -> 2).
  assert.equal(dd.ddDominantPcOf(2), 9);
  assert.equal(dd.ddResolvePcOf(9), 2);
  // They are exact inverses for every pitch class.
  for (let pc = 0; pc < 12; pc++) {
    assert.equal(dd.ddResolvePcOf(dd.ddDominantPcOf(pc)), pc);
  }
});

test('ddBuildQuestion targetToDom: prompt is the target, correct answer is its dominant 7th', () => {
  const q = dd.ddBuildQuestion('targetToDom', () => 0.01);
  assert.equal(q.direction, 'targetToDom');
  assert.ok(q.prompt.length > 0);
  assert.equal(q.choices.length, 4);
  assert.ok(q.choices.includes(q.correctAnswer));
  // correct answer must be the dominant 7th of the prompt's target
  assert.equal(q.correctAnswer, dd.DD_NOTE_NAMES[dd.ddDominantPcOf(q.targetPc)] + '7');
  assert.equal(new Set(q.choices).size, q.choices.length, 'choices must be unique');
});

test('ddBuildQuestion domToTarget: prompt is a dominant 7th, correct answer is the resolution root', () => {
  const q = dd.ddBuildQuestion('domToTarget', () => 0.01);
  assert.equal(q.direction, 'domToTarget');
  assert.ok(q.prompt.endsWith('7'));
  assert.equal(q.choices.length, 4);
  assert.ok(q.choices.includes(q.correctAnswer));
  assert.equal(q.correctAnswer, dd.DD_NOTE_NAMES[dd.ddResolvePcOf(dd.DD_NOTE_NAMES.indexOf(q.prompt.slice(0, -1)))]);
  assert.equal(new Set(q.choices).size, q.choices.length, 'choices must be unique');
});

test('ddBuildQuestion domToTarget: choices are bare roots, not chords (no major/minor ambiguity)', () => {
  for (let i = 0; i < 50; i++) {
    const q = dd.ddBuildQuestion('domToTarget');
    q.choices.forEach(c => assert.ok(!c.endsWith('7') && !c.endsWith('m'), `choice "${c}" should be a bare root`));
  }
});

test('ddBuildQuestion: the direction-flip distractor is always present (the error this drill targets)', () => {
  // targetToDom: answering "what the target is the dominant OF" instead of
  // its own dominant — G7 for target D.
  const q1 = dd.ddBuildQuestion('targetToDom');
  assert.ok(q1.choices.includes(dd.DD_NOTE_NAMES[dd.ddResolvePcOf(q1.targetPc)] + '7'));
  // domToTarget: answering the dominant OF the prompt — E for prompt A7.
  const q2 = dd.ddBuildQuestion('domToTarget');
  const domPc = dd.DD_NOTE_NAMES.indexOf(q2.prompt.slice(0, -1));
  assert.ok(q2.choices.includes(dd.DD_NOTE_NAMES[dd.ddDominantPcOf(domPc)]));
});

test('ddNextTimeLimit: ratchets tighter on correct, loosens 2x on miss, clamped', () => {
  assert.equal(dd.ddNextTimeLimit(5000, true), 4800);
  assert.equal(dd.ddNextTimeLimit(5000, false), 5400);
  assert.equal(dd.ddNextTimeLimit(2000, true), 2000); // floor
  assert.equal(dd.ddNextTimeLimit(6000, false), 6000); // ceiling
});

test('ddCircleLayout: position k holds pc (7k)%12 — clockwise in fifths', () => {
  const layout = dd.ddCircleLayout();
  assert.equal(layout.length, 12);
  assert.equal(layout[0].pc, 0);  // C at top
  assert.equal(layout[1].pc, 7);  // G one step clockwise
  assert.equal(layout[11].pc, 5); // F closing the circle
  // Every pitch class appears exactly once.
  assert.equal(new Set(layout.map(n => n.pc)).size, 12);
});

// rng helper: serve a fixed sequence of values, then repeat the last one.
function seqRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('ddSpellTone: spells guide tones diatonically, not by pc-table lookup', () => {
  assert.equal(dd.ddSpellTone('G', 11, 2), 'B');   // G7's 3rd
  assert.equal(dd.ddSpellTone('G', 5, 6), 'F');    // G7's ♭7
  assert.equal(dd.ddSpellTone('C', 10, 6), 'Bb');  // C7's ♭7 — not A#
  assert.equal(dd.ddSpellTone('F', 9, 2), 'A');    // F7's 3rd
  assert.equal(dd.ddSpellTone('F#', 10, 2), 'A#'); // F#7's 3rd — not Bb
  assert.equal(dd.ddSpellTone('C#', 5, 2), 'E#');  // C#7's 3rd — not F
});

test('ddBuildQuestion guideTones: correct answer is the dominant\'s 3rd + ♭7th, spelled diatonically', () => {
  // rng: target pick → pc 0 (C, first weighted entry), quality → major (0.9)
  const q = dd.ddBuildQuestion('guideTones', seqRng([0.01, 0.9, 0.5]));
  assert.equal(q.targetPc, 0);
  assert.equal(q.prompt, 'G7 → C');
  assert.equal(q.correctAnswer, 'B / F');
  assert.equal(q.choices.length, 4);
  assert.equal(new Set(q.choices).size, 4, 'choices must be unique');
  assert.ok(q.choices.includes('F / B'), 'swapped-order distractor');
  assert.ok(q.explanation.includes('B → C'), 'explanation spells the 3 → 1 resolution');
  assert.ok(q.explanation.includes('F → E'), 'explanation spells the ♭7 → 3 resolution');
});

test('ddBuildQuestion guideTones: minor target resolves ♭7 to the minor 3rd', () => {
  // quality rng 0.01 < DD_MINOR_TARGET_PROB → minor
  const q = dd.ddBuildQuestion('guideTones', seqRng([0.01, 0.01, 0.5]));
  assert.equal(q.prompt, 'G7 → Cm');
  assert.ok(q.explanation.includes('F → Eb'), '♭7 lands on Eb, not E, for a minor target');
});

test('ddBuildQuestion guideTones: sharp-side dominants spell with sharps', () => {
  // Force target B (pc 11) so the dominant is F#7: roll past all weights up
  // to B's — cumulative weight before pc 11 is 10+1+9+2+8+6+2+10+1+9+3 = 61
  // of 62, so rng ~0.99 lands on B.
  const q = dd.ddBuildQuestion('guideTones', seqRng([0.999, 0.9, 0.5]));
  assert.equal(q.targetPc, 11);
  assert.equal(q.prompt, 'F#7 → B');
  assert.equal(q.correctAnswer, 'A# / E');
});
