// ── Key Drill: timed flashcard quiz for instant 调-级数-和弦 recall ──
// Goal: react to "in G, what's the V chord?" (or the reverse) as fast as a
// multiplication table, for the handful of keys pop/rock music actually
// uses. Reuses the roman-numeral engine already built for Song Loop's 级数
// track (slRomanToChord, from song-loop.js) and the degree/quality
// reference table from the Progressions page (PL_LOOKUP_DEGREES, from
// progression-lab.js) — same conventions, no second copy of "what chord
// does degree N default to". Loaded after both in index.html.

// How often each practice key should come up, roughly proportional to how
// often it shows up in real pop/rock songs (Spotify's ~30M-song key
// analysis: G/C/D/A together account for over a third of songs; Em/Am/Bm
// are the most common minor keys, being the relative minors of G/C/D;
// F/Bb/Dm/Gm are comparatively rare in this genre range). Every key in
// SL_KEY_OPTIONS has an entry; kdPickWeightedKey falls back to weight 1 for
// anything missing here so a future SL_KEY_OPTIONS addition doesn't crash.
const KD_KEY_WEIGHTS = {
  'G 大调': 10, 'C 大调': 9, 'D 大调': 8, 'A 大调': 7, 'E 大调': 5,
  'Em 小调': 4, 'Am 小调': 4, 'Bm 小调': 4,
  'F 大调': 3, 'Bb 大调': 2,
  'Dm 小调': 1, 'Gm 小调': 1,
};

// Raised from an original 4000/1200 default/floor — those made the ratchet
// (tightens every correct answer, only partially loosens on a miss; see
// kdNextTimeLimit) squeeze down to an unreadable pace well before a chord/
// degree pair was actually memorized. 2000ms is still a real drill, not a
// leisurely quiz.
const KD_TIME_LIMIT_DEFAULT = 5000;
const KD_TIME_LIMIT_MIN = 2000;
const KD_TIME_LIMIT_MAX = 6000;
const KD_TIME_STEP = 200;
const KD_CHOICE_COUNT = 4;
const KD_FEEDBACK_DELAY_MS = 900;

// Weighted random pick — `rng` defaults to Math.random but is injectable so
// tests can drive it deterministically.
function kdPickWeightedKey(keys, weights, rng = Math.random) {
  const total = keys.reduce((sum, k) => sum + (weights[k] || 1), 0);
  let roll = rng() * total;
  for (const k of keys) {
    roll -= weights[k] || 1;
    if (roll < 0) return k;
  }
  return keys[keys.length - 1];
}

const PL_NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// slRomanToChord (via progression-lab.js's plChordSymbol) always spells
// accidentals as flats (PL_NOTE_NAMES_FLAT), regardless of key — correct
// for F/Bb major and Dm/Gm minor, but wrong for sharp-signature keys: D
// major's iii should read "F#m", not the enharmonically-equivalent "Gbm"
// that engine produces. Respelling here (rather than in the shared engine)
// keeps this fix scoped to what this drill displays — Song Loop's 级数
// track and the Progressions page are unaffected. Every other practice key
// either has no accidentals in its diatonic set (C major, Am minor) or
// already reads correctly with flats, so isn't listed.
const KD_SHARP_KEYS = new Set(['G 大调', 'D 大调', 'A 大调', 'E 大调', 'Em 小调', 'Bm 小调']);

function kdRespell(chordSymbol, keyStr) {
  if (!KD_SHARP_KEYS.has(keyStr)) return chordSymbol;
  const m = chordSymbol.match(/^([A-G]b?)(.*)$/);
  if (!m) return chordSymbol;
  const idx = PL_NOTE_NAMES_FLAT.indexOf(m[1]);
  return idx === -1 ? chordSymbol : PL_NOTE_NAMES_SHARP[idx] + m[2];
}

// The 7 diatonic triads of `keyStr`, in degree order — {roman, chord}
// pairs, chord resolved via slRomanToChord (so it always matches whatever
// the Song Loop 级数 track would produce for the same key) and then
// respelled to the key's conventional accidentals.
function kdDiatonicChords(keyStr) {
  const mode = typeof keyStr === 'string' && keyStr.includes('小调') ? 'naturalMinor' : 'major';
  return PL_LOOKUP_DEGREES[mode].map(([roman]) => ({ roman, chord: kdRespell(slRomanToChord(roman, keyStr), keyStr) }));
}

function kdShuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One multiple-choice question. `direction` is 'chordToDegree' (prompt =
// chord, answer = roman numeral) or 'degreeToChord' (prompt = roman
// numeral, answer = chord). Distractors are the other diatonic degrees of
// the SAME key — forces recalling *this key's* mapping, not just picking a
// plausible-looking chord/numeral in the abstract.
function kdBuildQuestion(keyStr, direction, rng = Math.random, choiceCount = KD_CHOICE_COUNT) {
  const chords = kdDiatonicChords(keyStr);
  const correctIndex = Math.floor(rng() * chords.length);
  const correct = chords[correctIndex];
  const pool = chords.filter((_, i) => i !== correctIndex);
  const distractors = [];
  while (distractors.length < Math.min(choiceCount - 1, pool.length)) {
    const idx = Math.floor(rng() * pool.length);
    distractors.push(pool.splice(idx, 1)[0]);
  }
  const field = direction === 'chordToDegree' ? 'roman' : 'chord';
  return {
    key: keyStr,
    direction,
    prompt: direction === 'chordToDegree' ? correct.chord : correct.roman,
    correctAnswer: correct[field],
    choices: kdShuffle([correct, ...distractors], rng).map(c => c[field]),
  };
}

// Adaptive reaction-time ceiling: tightens a bit after a correct answer,
// loosens more (2x step) after a wrong/timeout one — same "only get faster
// once you're actually clean" philosophy as Speed Trainer's BPM ramp,
// applied to a response-time budget instead of tempo.
function kdNextTimeLimit(current, wasCorrect) {
  const next = wasCorrect ? current - KD_TIME_STEP : current + KD_TIME_STEP * 2;
  return Math.max(KD_TIME_LIMIT_MIN, Math.min(KD_TIME_LIMIT_MAX, next));
}

// Pure stats update — returns a new object (caller owns persistence).
function kdRecordAnswer(stats, keyStr, wasCorrect) {
  const prev = stats[keyStr] || { correct: 0, total: 0 };
  return {
    ...stats,
    [keyStr]: { correct: prev.correct + (wasCorrect ? 1 : 0), total: prev.total + 1 },
  };
}

// ── Page state + DOM wiring ──

const kdState = {
  inited: false, // guards initKeyDrillPage()'s listener attachment — see initSpeedPage's comment for why
  direction: 'mixed', // 'mixed' | 'chordToDegree' | 'degreeToChord'
  focusKey: '', // '' = weighted-random across all keys; otherwise practice just this one
  timeLimitMs: KD_TIME_LIMIT_DEFAULT,
  stats: {}, // long-term per-key {correct,total}, persisted
  sessionCorrect: 0, sessionTotal: 0, streak: 0,
  current: null, answered: false, timerId: null,
};

const KD_PREFS_KEY = 'kd_prefs';
const KD_STATS_KEY = 'kd_stats';

function kdPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KD_PREFS_KEY)) || {}; } catch (_) {}
  if (['mixed', 'chordToDegree', 'degreeToChord'].includes(saved.direction)) kdState.direction = saved.direction;
  if (typeof saved.focusKey === 'string' && (saved.focusKey === '' || KD_KEY_WEIGHTS[saved.focusKey])) {
    kdState.focusKey = saved.focusKey;
  }
  if (Number.isFinite(saved.timeLimitMs)) {
    kdState.timeLimitMs = Math.max(KD_TIME_LIMIT_MIN, Math.min(KD_TIME_LIMIT_MAX, saved.timeLimitMs));
  }
}

function kdPrefsSave() {
  localStorage.setItem(KD_PREFS_KEY, JSON.stringify({
    direction: kdState.direction, focusKey: kdState.focusKey, timeLimitMs: kdState.timeLimitMs,
  }));
}

function kdStatsLoad() {
  try { kdState.stats = JSON.parse(localStorage.getItem(KD_STATS_KEY)) || {}; } catch (_) { kdState.stats = {}; }
}

function kdStatsSave() { localStorage.setItem(KD_STATS_KEY, JSON.stringify(kdState.stats)); }

function kdRenderOptions() {
  document.getElementById('kd-direction').value = kdState.direction;
  const keyEl = document.getElementById('kd-focus-key');
  if (!keyEl.dataset.populated) {
    keyEl.innerHTML = '<option value="">全部（按常用度加权随机）</option>' +
      SL_KEY_OPTIONS.map(k => `<option value="${htmlEsc(k)}">${htmlEsc(k)}</option>`).join('');
    keyEl.dataset.populated = '1';
  }
  keyEl.value = kdState.focusKey;
}

function kdUpdateStatsRow() {
  document.getElementById('kd-session-stat').textContent = `${kdState.sessionCorrect} / ${kdState.sessionTotal}`;
  document.getElementById('kd-streak').textContent = kdState.streak;
  document.getElementById('kd-time-limit').textContent = (kdState.timeLimitMs / 1000).toFixed(1) + 's';
}

function kdRenderKeyStats() {
  const el = document.getElementById('kd-keystats');
  const keys = SL_KEY_OPTIONS.slice().sort((a, b) => (KD_KEY_WEIGHTS[b] || 1) - (KD_KEY_WEIGHTS[a] || 1));
  el.innerHTML = keys.map((k) => {
    const s = kdState.stats[k] || { correct: 0, total: 0 };
    const pct = s.total ? Math.round((s.correct / s.total) * 100) : null;
    return `<div class="kd-keystat-row"><span class="kd-keystat-name">${htmlEsc(k)}</span>` +
      `<span class="kd-keystat-val">${s.total ? `${s.correct}/${s.total}（${pct}%）` : '—'}</span></div>`;
  }).join('');
}

function kdRenderQuestion() {
  const q = kdState.current;
  document.getElementById('kd-key-label').textContent = q.key;
  document.getElementById('kd-prompt').textContent = q.prompt;
  const feedback = document.getElementById('kd-feedback');
  feedback.textContent = '';
  feedback.className = 'kd-feedback';
  const choicesEl = document.getElementById('kd-choices');
  choicesEl.innerHTML = q.choices.map((c, i) =>
    `<button type="button" class="kd-choice-btn" data-idx="${i}">${htmlEsc(c)}</button>`
  ).join('');
  choicesEl.querySelectorAll('.kd-choice-btn').forEach((btn) => {
    btn.addEventListener('click', () => kdAnswer(btn, btn.textContent));
  });
  document.getElementById('kd-continue-btn').style.display = 'none';
  const fill = document.getElementById('kd-timer-fill');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  void fill.offsetWidth; // force reflow so the transition below animates from 100%, not skips straight to 0%
  fill.style.transition = `width ${kdState.timeLimitMs}ms linear`;
  fill.style.width = '0%';
}

function kdStartTimer() {
  kdState.timerId = setTimeout(() => kdAnswer(null, null), kdState.timeLimitMs);
}

function kdNextQuestion() {
  clearTimeout(kdState.timerId);
  const key = kdState.focusKey || kdPickWeightedKey(SL_KEY_OPTIONS, KD_KEY_WEIGHTS);
  const direction = kdState.direction === 'mixed'
    ? (Math.random() < 0.5 ? 'chordToDegree' : 'degreeToChord')
    : kdState.direction;
  kdState.current = kdBuildQuestion(key, direction);
  kdState.answered = false;
  kdRenderQuestion();
  kdStartTimer();
}

// `chosenText` is null for a timeout (no button clicked).
function kdAnswer(btnEl, chosenText) {
  if (kdState.answered) return; // internal answered flag — matches the app's other quiz drills, no debounce wrapper needed
  kdState.answered = true;
  clearTimeout(kdState.timerId);
  const q = kdState.current;
  const wasCorrect = chosenText === q.correctAnswer;

  kdState.sessionTotal++;
  if (wasCorrect) { kdState.sessionCorrect++; kdState.streak++; } else { kdState.streak = 0; }
  kdState.stats = kdRecordAnswer(kdState.stats, q.key, wasCorrect);
  kdStatsSave();
  kdState.timeLimitMs = kdNextTimeLimit(kdState.timeLimitMs, wasCorrect);
  kdPrefsSave();

  document.getElementById('kd-timer-fill').style.transition = 'none';
  document.querySelectorAll('#kd-choices .kd-choice-btn').forEach((btn) => {
    btn.disabled = true;
    if (btn.textContent === q.correctAnswer) btn.classList.add('kd-choice-correct');
    else if (btn === btnEl) btn.classList.add('kd-choice-wrong');
  });
  const feedback = document.getElementById('kd-feedback');
  feedback.textContent = wasCorrect ? '✓ 正确'
    : chosenText == null ? `超时——正确答案：${q.correctAnswer}`
    : `✗ 正确答案：${q.correctAnswer}`;
  feedback.className = 'kd-feedback ' + (wasCorrect ? 'kd-feedback-correct' : 'kd-feedback-wrong');

  kdUpdateStatsRow();
  kdRenderKeyStats();
  // Correct answers don't need review time — keep the fast auto-advance so a
  // clean streak stays snappy. A wrong/timed-out answer is the whole point of
  // the drill (that's the thing you're supposed to remember), so it waits
  // for an explicit "继续" click/keypress instead of auto-advancing after a
  // fixed short delay — otherwise the correct answer flashes by unread and
  // never actually sinks in before the next question replaces it.
  if (wasCorrect) {
    setTimeout(kdNextQuestion, KD_FEEDBACK_DELAY_MS);
  } else {
    document.getElementById('kd-continue-btn').style.display = '';
  }
}

function kdOnOptionsChanged() {
  kdState.direction = document.getElementById('kd-direction').value;
  kdState.focusKey = document.getElementById('kd-focus-key').value;
  kdPrefsSave();
  kdNextQuestion();
}

function initKeyDrillPage() {
  kdPrefsLoad();
  kdStatsLoad();
  kdRenderOptions();
  kdUpdateStatsRow();
  kdRenderKeyStats();
  if (!kdState.inited) {
    kdState.inited = true;
    document.getElementById('kd-direction').addEventListener('change', kdOnOptionsChanged);
    document.getElementById('kd-focus-key').addEventListener('change', kdOnOptionsChanged);
    document.getElementById('kd-continue-btn').addEventListener('click', kdNextQuestion);
    // Space/Enter as a shortcut for the 继续 button — only acts while it's
    // actually visible (i.e. we're paused on a wrong/timed-out answer), so
    // this can't accidentally skip a question mid-countdown.
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const btn = document.getElementById('kd-continue-btn');
      if (btn && btn.style.display !== 'none' && document.getElementById('page-keydrill').classList.contains('active')) {
        e.preventDefault();
        kdNextQuestion();
      }
    });
  }
  if (!kdState.current) kdNextQuestion();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    KD_KEY_WEIGHTS, KD_TIME_LIMIT_MIN, KD_TIME_LIMIT_MAX, KD_TIME_STEP,
    kdPickWeightedKey, kdDiatonicChords, kdShuffle, kdBuildQuestion,
    kdNextTimeLimit, kdRecordAnswer, kdRespell, kdState,
  };
}
