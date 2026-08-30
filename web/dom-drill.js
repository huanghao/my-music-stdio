// ── Dom Drill: timed flashcard quiz for instant 属⇄主 recall ──
// Three reflexes, all key-agnostic (this is about the V7→x relationship
// itself, not about any one key — the key-conditioned version is Key
// Drill's job):
//   1. see a target chord ("Dm")    → name its dominant 7th ("A7")     (V/x)
//   2. see a dominant 7th ("A7")    → name the root it resolves to ("D")
//   3. see a dominant 7th ("G7→C")  → name its 3rd + ♭7th ("B / F") — the
//      guide tones, the tritone whose half-step resolution (B→C, F→E) IS
//      what "resolving" means physically
//
// The whole drill is one step on the circle of fifths: a chord's dominant
// sits ONE STEP CLOCKWISE from it (D → A), and resolution (A7 → D) is one
// step back COUNTERCLOCKWISE. The page keeps a small circle-of-fifths
// reference visible under the question card for exactly this reason — the
// drill and the circle are the same skill, and seeing the pair highlighted
// on the circle after each answer is what builds the "逆时针一格 = 解决"
// intuition instead of a lookup table.
//
// Mechanics deliberately mirror key-drill.js (same kd-* CSS classes, same
// adaptive time-limit ratchet philosophy) — the question CONTENT differs
// (no key context, dominant-7th targets, root-only answers for the
// resolution direction), the quiz loop doesn't. Standalone: needs no
// fretboard/chord-id globals, so tests can require() it directly.

// Per-pitch-class spelling chosen by pop/rock commonness (guitar-friendly
// sharp keys get sharps, flat-side roots get flats) — NOT key-dependent,
// since this drill has no key context. pc6 reads F# (F#7 → B is a far more
// common sight than Gb7 → Cb).
const DD_NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// How often each target root should come up, roughly proportional to how
// often songs tonicize that root in pop/rock (C/G/D/A/E dominate; the
// sharp/flat-side roots mostly show up as secondary-dominant targets).
const DD_ROOT_WEIGHTS = { 0: 10, 1: 1, 2: 9, 3: 2, 4: 8, 5: 6, 6: 2, 7: 10, 8: 1, 9: 9, 10: 3, 11: 2 };

// A minor target is almost as common as a major one (V/ii, V/vi, V/iii are
// the everyday secondary dominants), but not quite — major gets the edge.
const DD_MINOR_TARGET_PROB = 0.35;

const DD_TIME_LIMIT_DEFAULT = 5000;
const DD_TIME_LIMIT_MIN = 2000;
const DD_TIME_LIMIT_MAX = 6000;
const DD_TIME_STEP = 200;
const DD_FEEDBACK_DELAY_MS = 900;

// The dominant-7th root of a target: a perfect fifth UP (+7 semitones),
// i.e. one step clockwise on the circle of fifths. Inverse for resolution:
// a dominant 7th resolves a perfect fifth DOWN / fourth up (+5 semitones),
// one step counterclockwise.
function ddDominantPcOf(targetPc) { return (targetPc + 7) % 12; }
function ddResolvePcOf(dominantPc) { return (dominantPc + 5) % 12; }

function ddPickWeightedRoot(weights, rng = Math.random) {
  const pcs = Object.keys(weights).map(Number);
  const total = pcs.reduce((sum, pc) => sum + (weights[pc] || 1), 0);
  let roll = rng() * total;
  for (const pc of pcs) {
    roll -= weights[pc] || 1;
    if (roll < 0) return pc;
  }
  return pcs[pcs.length - 1];
}

function ddShuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One multiple-choice question, built around a weighted-random TARGET root
// (stats are keyed by it regardless of direction — "how fast do I recall
// D's dominant" and "how fast do I place A7→D" are the same memory).
//
// Distractors are the actual ways this recall goes wrong, not random roots:
//  - the direction flip (the single most common error): asked for Dm's
//    dominant, answering G7 because "D is the dominant of G"; asked where
//    A7 resolves, answering E because "E7 resolves to A".
//  - the prompt's own root re-dressed (D7 for target D) — a pure
//    same-letter reach.
//  - a whole step off the correct root (the V/V-adjacent confusion).
function ddBuildQuestion(direction, rng = Math.random) {
  const targetPc = ddPickWeightedRoot(DD_ROOT_WEIGHTS, rng);
  const domPc = ddDominantPcOf(targetPc);
  if (direction === 'targetToDom') {
    const quality = rng() < DD_MINOR_TARGET_PROB ? 'm' : '';
    const correct = DD_NOTE_NAMES[domPc] + '7';
    const distractorPcs = [ddResolvePcOf(targetPc), targetPc, (targetPc + 2) % 12]; // G7-flip, D7-same-root, E7-whole-step (for t=D)
    return {
      targetPc,
      direction,
      prompt: DD_NOTE_NAMES[targetPc] + quality,
      promptLabel: '它的属七和弦（V7）是？',
      correctAnswer: correct,
      choices: ddShuffle([correct, ...distractorPcs.map(pc => DD_NOTE_NAMES[pc] + '7')], rng),
      explanation: `${DD_NOTE_NAMES[targetPc]}${quality} 的属和弦是 ${correct}——五度圈上顺时针走一格`,
    };
  }
  if (direction === 'guideTones') {
    // The dominant's 3rd + ♭7th (its tritone, the "guide tones") and where
    // they want to land: 3 → target's 1 (up a half step — it IS the target's
    // leading tone), ♭7 → target's 3 (down a half step). The prompt shows the
    // resolution target, so this question trains the guide-tone recall itself;
    // the explanation then reinforces the resolution mapping every time.
    const quality = rng() < DD_MINOR_TARGET_PROB ? 'm' : '';
    const domName = DD_NOTE_NAMES[domPc];
    const thirdPc = (domPc + 4) % 12;
    const seventhPc = (domPc + 10) % 12;
    const thirdName = ddSpellTone(domName, thirdPc, 2);      // letter a diatonic 3rd up
    const seventhName = ddSpellTone(domName, seventhPc, 6);  // letter a diatonic 7th up
    const correct = `${thirdName} / ${seventhName}`;
    // Distractors are the real confusions: which-is-which (swapped), maj7
    // instead of dominant 7 (F# for G7), and m7 quality (Bb for G7).
    const choices = ddShuffle([
      correct,
      `${seventhName} / ${thirdName}`,
      `${thirdName} / ${ddSpellTone(domName, (domPc + 11) % 12, 6)}`,
      `${ddSpellTone(domName, (domPc + 3) % 12, 2)} / ${seventhName}`,
    ], rng);
    const targetName = DD_NOTE_NAMES[targetPc];
    const targetThird = ddSpellTone(targetName, (targetPc + (quality === 'm' ? 3 : 4)) % 12, 2);
    return {
      targetPc,
      direction,
      prompt: `${domName}7 → ${targetName}${quality}`,
      promptLabel: '这个属和弦的 3 音和 ♭7 音是？',
      correctAnswer: correct,
      choices,
      explanation: `${domName}7：3音 ${thirdName} → ${targetName}（目标的1音，从下方半音蹭上去），` +
        `♭7音 ${seventhName} → ${targetThird}（目标的3音，从上方半音落下来）——3+♭7 就是属七的三全音，解决后落成目标的 1+3 骨架`,
    };
  }
  const correct = DD_NOTE_NAMES[targetPc];
  // Distractor roots: the direction flip (E for prompt A7 — "V of A is E7"
  // reversed), the prompt's own root (A for A7), and a whole step below the
  // target (C for A7→D).
  const flipPc = (domPc + 7) % 12;
  const uniqueDistractors = [...new Set([flipPc, domPc, (targetPc + 10) % 12])].filter(pc => pc !== targetPc).slice(0, 3);
  return {
    targetPc,
    direction,
    prompt: DD_NOTE_NAMES[domPc] + '7',
    promptLabel: '它要解决到哪个根音？',
    correctAnswer: correct,
    choices: ddShuffle([correct, ...uniqueDistractors.map(pc => DD_NOTE_NAMES[pc])], rng),
    explanation: `${DD_NOTE_NAMES[domPc]}7 → ${correct}（${correct} 或 ${correct}m 都常见——属和弦解决不限定目标大小调）——五度圈上逆时针走一格`,
  };
}

// ── Guide-tone spelling ──
// Guide-tone questions must spell 3rds/7ths DIATONICALLY (F#7's 3rd is A#,
// not Bb; C7's ♭7 is Bb, not A#), which the flat pc lookup table can't do.
// Spell by walking letter names from the root's letter: the 3rd of anything
// rooted on G is some kind of B, the 7th some kind of F — the accidental is
// whatever closes the gap to the target pitch class.
const DD_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const DD_LETTER_PCS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function ddSpellTone(rootName, tonePc, diatonicSteps) {
  const toneLetter = DD_LETTERS[(DD_LETTERS.indexOf(rootName[0]) + diatonicSteps) % 7];
  const diff = (tonePc - DD_LETTER_PCS[toneLetter] + 12) % 12;
  const acc = { 0: '', 1: '#', 11: 'b', 2: '##', 10: 'bb' }[diff];
  return toneLetter + acc;
}

// Adaptive reaction-time ceiling — same ratchet as Key Drill (tightens on
// correct, loosens 2x on a miss), copied rather than imported so this page
// stays standalone.
function ddNextTimeLimit(current, wasCorrect) {
  const next = wasCorrect ? current - DD_TIME_STEP : current + DD_TIME_STEP * 2;
  return Math.max(DD_TIME_LIMIT_MIN, Math.min(DD_TIME_LIMIT_MAX, next));
}

function ddRecordAnswer(stats, targetPc, wasCorrect) {
  const prev = stats[targetPc] || { correct: 0, total: 0 };
  return {
    ...stats,
    [targetPc]: { correct: prev.correct + (wasCorrect ? 1 : 0), total: prev.total + 1 },
  };
}

// Circle-of-fifths layout: position k (0 = top, going clockwise) holds
// pitch class (7k) % 12. Returned as data so the renderer and the answer
// highlighter never re-derive the mapping.
function ddCircleLayout() {
  return Array.from({ length: 12 }, (_, k) => ({ k, pc: (7 * k) % 12 }));
}

// ── Page state + DOM wiring ──

const ddState = {
  inited: false, // guards initDomDrillPage()'s listener attachment — see initSpeedPage's comment for why
  direction: 'mixed', // 'mixed' | 'targetToDom' | 'domToTarget'
  showCircle: true,
  timeLimitMs: DD_TIME_LIMIT_DEFAULT,
  stats: {}, // long-term per-target-root {correct,total}, persisted
  sessionCorrect: 0, sessionTotal: 0, streak: 0,
  current: null, answered: false, timerId: null,
};

const DD_PREFS_KEY = 'dd_prefs';
const DD_STATS_KEY = 'dd_stats';

function ddPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DD_PREFS_KEY)) || {}; } catch (_) {}
  if (['mixed', 'targetToDom', 'domToTarget', 'guideTones'].includes(saved.direction)) ddState.direction = saved.direction;
  if (typeof saved.showCircle === 'boolean') ddState.showCircle = saved.showCircle;
  if (Number.isFinite(saved.timeLimitMs)) {
    ddState.timeLimitMs = Math.max(DD_TIME_LIMIT_MIN, Math.min(DD_TIME_LIMIT_MAX, saved.timeLimitMs));
  }
}

function ddPrefsSave() {
  localStorage.setItem(DD_PREFS_KEY, JSON.stringify({
    direction: ddState.direction, showCircle: ddState.showCircle, timeLimitMs: ddState.timeLimitMs,
  }));
}

function ddStatsLoad() {
  try { ddState.stats = JSON.parse(localStorage.getItem(DD_STATS_KEY)) || {}; } catch (_) { ddState.stats = {}; }
}

function ddStatsSave() { localStorage.setItem(DD_STATS_KEY, JSON.stringify(ddState.stats)); }

function ddRenderOptions() {
  document.getElementById('dd-direction').value = ddState.direction;
  document.getElementById('dd-show-circle').checked = ddState.showCircle;
  document.getElementById('dd-circle-wrap').classList.toggle('hidden', !ddState.showCircle);
}

function ddUpdateStatsRow() {
  document.getElementById('dd-session-stat').textContent = `${ddState.sessionCorrect} / ${ddState.sessionTotal}`;
  document.getElementById('dd-streak').textContent = ddState.streak;
  document.getElementById('dd-time-limit').textContent = Math.round(ddState.timeLimitMs / 1000) + 's';
}

function ddRenderRootStats() {
  const el = document.getElementById('dd-rootstats');
  const order = ddCircleLayout().map(n => n.pc); // circle order, not pc order — reads as the fifths walk
  el.innerHTML = order.map(pc => {
    const s = ddState.stats[pc] || { correct: 0, total: 0 };
    const pct = s.total ? Math.round((s.correct / s.total) * 100) : null;
    return `<div class="kd-keystat-row"><span class="kd-keystat-name">${DD_NOTE_NAMES[pc]}</span>` +
      `<span class="kd-keystat-val">${s.total ? `${s.correct}/${s.total}（${pct}%）` : '—'}</span></div>`;
  }).join('');
}

// The circle reference, (re)drawn on init. Twelve labels around a ring in
// fifths order; answer highlighting just toggles classes on the nodes.
function ddRenderCircle() {
  const el = document.getElementById('dd-circle');
  if (!el) return;
  const NS = 'http://www.w3.org/2000/svg';
  el.innerHTML = '';
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', 120); ring.setAttribute('cy', 120); ring.setAttribute('r', 78);
  ring.setAttribute('class', 'dd-circle-ring');
  el.appendChild(ring);
  ddCircleLayout().forEach(({ k, pc }) => {
    const angle = (-90 + k * 30) * Math.PI / 180;
    const x = 120 + 95 * Math.cos(angle);
    const y = 120 + 95 * Math.sin(angle);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'dd-circle-node');
    g.dataset.pc = pc;
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 13);
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', x); text.setAttribute('y', y + 1);
    text.textContent = DD_NOTE_NAMES[pc];
    g.appendChild(dot); g.appendChild(text);
    el.appendChild(g);
  });
}

// After an answer, light up the prompt and the correct answer on the
// circle — they're always adjacent nodes, and seeing WHICH direction the
// step went (clockwise = 找属, counterclockwise = 解决) is the point.
function ddHighlightCircle() {
  const q = ddState.current;
  const el = document.getElementById('dd-circle');
  if (!el || !q) return;
  el.querySelectorAll('.dd-circle-node').forEach(g => g.classList.remove('dd-circle-prompt', 'dd-circle-answer'));
  const promptPc = q.direction === 'targetToDom' ? q.targetPc : ddDominantPcOf(q.targetPc);
  const answerPc = q.direction === 'targetToDom' ? ddDominantPcOf(q.targetPc) : q.targetPc;
  el.querySelectorAll('.dd-circle-node').forEach(g => {
    const pc = Number(g.dataset.pc);
    if (pc === promptPc) g.classList.add('dd-circle-prompt');
    if (pc === answerPc) g.classList.add('dd-circle-answer');
  });
}

function ddRenderQuestion() {
  const q = ddState.current;
  document.getElementById('dd-dir-label').textContent = q.promptLabel;
  document.getElementById('dd-prompt').textContent = q.prompt;
  const feedback = document.getElementById('dd-feedback');
  feedback.textContent = '';
  feedback.className = 'kd-feedback';
  const choicesEl = document.getElementById('dd-choices');
  choicesEl.innerHTML = q.choices.map((c, i) =>
    `<button type="button" class="kd-choice-btn" data-idx="${i}">${htmlEsc(c)}</button>`
  ).join('');
  choicesEl.querySelectorAll('.kd-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => ddAnswer(btn, btn.textContent));
  });
  document.getElementById('dd-continue-btn').classList.add('hidden');
  document.getElementById('dd-circle')?.querySelectorAll('.dd-circle-node')
    .forEach(g => g.classList.remove('dd-circle-prompt', 'dd-circle-answer'));
  const fill = document.getElementById('dd-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  void fill.offsetWidth; // force reflow so the transition below animates from 100%, not skips straight to 0%
  fill.style.transition = `width ${ddState.timeLimitMs}ms linear`;
  fill.style.width = '0%';
}

function ddStartTimer() {
  ddState.timerId = setTimeout(() => ddAnswer(null, null), ddState.timeLimitMs);
}

function ddNextQuestion() {
  clearTimeout(ddState.timerId);
  const direction = ddState.direction === 'mixed'
    ? ['targetToDom', 'domToTarget', 'guideTones'][Math.floor(Math.random() * 3)]
    : ddState.direction;
  ddState.current = ddBuildQuestion(direction);
  ddState.answered = false;
  ddRenderQuestion();
  ddStartTimer();
}

// `chosenText` is null for a timeout (no button clicked).
function ddAnswer(btnEl, chosenText) {
  if (ddState.answered) return; // internal answered flag — matches the app's other quiz drills, no debounce wrapper needed
  ddState.answered = true;
  clearTimeout(ddState.timerId);
  const q = ddState.current;
  const wasCorrect = chosenText === q.correctAnswer;

  ddState.sessionTotal++;
  if (wasCorrect) { ddState.sessionCorrect++; ddState.streak++; } else { ddState.streak = 0; }
  ddState.stats = ddRecordAnswer(ddState.stats, q.targetPc, wasCorrect);
  ddStatsSave();
  ddState.timeLimitMs = ddNextTimeLimit(ddState.timeLimitMs, wasCorrect);
  ddPrefsSave();

  document.getElementById('dd-timer-fill').style.transition = 'none';
  document.querySelectorAll('#dd-choices .kd-choice-btn').forEach((btn) => {
    btn.disabled = true;
    if (btn.textContent === q.correctAnswer) btn.classList.add('kd-choice-correct');
    else if (btn === btnEl) btn.classList.add('kd-choice-wrong');
  });
  const feedback = document.getElementById('dd-feedback');
  feedback.innerHTML = (wasCorrect ? '✓ ' : chosenText == null ? '超时——' : '✗ ') + htmlEsc(q.explanation);
  feedback.className = 'kd-feedback ' + (wasCorrect ? 'kd-feedback-correct' : 'kd-feedback-wrong');
  ddHighlightCircle();

  ddUpdateStatsRow();
  ddRenderRootStats();
  // Correct answers don't need review time — keep the fast auto-advance so a
  // clean streak stays snappy. A wrong/timed-out answer is the whole point of
  // the drill (that's the thing you're supposed to remember), so it waits
  // for an explicit "继续" click/keypress instead of auto-advancing after a
  // fixed short delay — otherwise the correct answer flashes by unread and
  // never actually sinks in before the next question replaces it.
  if (wasCorrect) {
    setTimeout(ddNextQuestion, DD_FEEDBACK_DELAY_MS);
  } else {
    document.getElementById('dd-continue-btn').classList.remove('hidden');
  }
}

function ddOnOptionsChanged() {
  ddState.direction = document.getElementById('dd-direction').value;
  ddState.showCircle = document.getElementById('dd-show-circle').checked;
  document.getElementById('dd-circle-wrap').classList.toggle('hidden', !ddState.showCircle);
  ddPrefsSave();
  ddNextQuestion();
}

function initDomDrillPage() {
  ddPrefsLoad();
  ddStatsLoad();
  ddRenderOptions();
  ddUpdateStatsRow();
  ddRenderRootStats();
  ddRenderCircle();
  if (!ddState.inited) {
    ddState.inited = true;
    document.getElementById('dd-direction').addEventListener('change', ddOnOptionsChanged);
    document.getElementById('dd-show-circle').addEventListener('change', ddOnOptionsChanged);
    document.getElementById('dd-continue-btn').addEventListener('click', ddNextQuestion);
    // Space/Enter as a shortcut for the 继续 button — only acts while it's
    // actually visible (i.e. we're paused on a wrong/timed-out answer), so
    // this can't accidentally skip a question mid-countdown.
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const btn = document.getElementById('dd-continue-btn');
      if (btn && !btn.classList.contains('hidden') && document.getElementById('page-domdrill').classList.contains('active')) {
        e.preventDefault();
        ddNextQuestion();
      }
    });
  }
  if (!ddState.current) ddNextQuestion();
}

// The 继续 button is a "Next →"-type side-effect button — double-clicking it
// would skip the question that was just rendered (including its countdown).
if (typeof guarded === 'function') ddNextQuestion = guarded(ddNextQuestion);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DD_NOTE_NAMES, DD_ROOT_WEIGHTS, DD_MINOR_TARGET_PROB,
    ddDominantPcOf, ddResolvePcOf, ddPickWeightedRoot, ddShuffle,
    ddBuildQuestion, ddNextTimeLimit, ddRecordAnswer, ddCircleLayout, ddState,
    ddSpellTone,
  };
}
