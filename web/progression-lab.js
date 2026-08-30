// ── Progressions page: roman-numeral progression lab ──
// Ported from the standalone prototype (web/roman-numeral-progression-lab.html,
// now retired — this is the only copy). Everything here is prefixed `pl`
// since this file shares a global scope with app.js/fretboard.js/etc. via
// plain <script> tags (no modules) — unprefixed names like `state` or
// `getCtx` would collide with existing globals (app.js already has a
// top-level `const state`).

const PL_NOTE_INDEX = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,
  G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
const PL_NOTE_NAMES_FLAT = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const PL_KEY_OPTIONS = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

function plFreqFromMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

let plAudioCtx = null;
function plGetCtx() {
  if (!plAudioCtx) plAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (plAudioCtx.state === 'suspended') plAudioCtx.resume();
  return plAudioCtx;
}

function plPlayNote(ctx, midi, atTime, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = plFreqFromMidi(midi);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 2800;
  filter.Q.value = 0.7;
  const peak = 0.16 * fbMasterGain() * (typeof fbSoundGain === 'function' ? fbSoundGain('progressionChords') : 1);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(peak, atTime + 0.02);
  gain.gain.setValueAtTime(peak, atTime + dur - 0.08);
  gain.gain.linearRampToValueAtTime(0, atTime + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + dur + 0.02);
}

// ── 和弦性质：音程集合（沿用 fretboard.js 的 FB_CHORD_QUALITIES 编码，
// 外加本页需要的 9sus4；两份表各自独立维护，没有共享模块）──
const PL_QUALITIES = {
  '':      [0, 4, 7],
  'm':     [0, 3, 7],
  'dim':   [0, 3, 6],
  'aug':   [0, 4, 8],
  'sus2':  [0, 2, 7],
  'sus4':  [0, 5, 7],
  '7':     [0, 4, 7, 10],
  'maj7':  [0, 4, 7, 11],
  'm7':    [0, 3, 7, 10],
  'dim7':  [0, 3, 6, 9],
  'm7b5':  [0, 3, 6, 10],
  '6':     [0, 4, 7, 9],
  'm6':    [0, 3, 7, 9],
  'add9':  [0, 4, 7, 2],
  'madd9': [0, 3, 7, 2],
  '9':     [0, 4, 7, 10, 2],
  'm9':    [0, 3, 7, 10, 2],
  'maj9':  [0, 4, 7, 11, 2],
  '7sus4': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  '6/9':   [0, 4, 7, 9, 2],
  'mmaj7': [0, 3, 7, 11],
  '7b9':   [0, 4, 7, 10, 1],
  '7#9':   [0, 4, 7, 10, 3],
};
const PL_QUALITY_LABELS = {
  '': '', m: 'm', dim: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4',
  '7': '7', maj7: 'maj7', m7: 'm7', dim7: 'dim7', 'm7b5': 'm7♭5',
  '6': '6', m6: 'm6', add9: 'add9', madd9: 'm(add9)', '9': '9', m9: 'm9', maj9: 'maj9',
  '7sus4': '7sus4', '9sus4': '9sus4', '6/9': '6/9', mmaj7: 'm(maj7)', '7b9': '7♭9', '7#9': '7♯9',
};

// ── 级数解析器 ──
// Roman-numeral degree -> semitone offset in a generic major-scale reference
// frame. This same table does double duty: it locates a *primary* chord's
// root within the current key (no slash), AND it locates an *applied* chord's
// root relative to its slash target (X/Y = X's own major-scale offset, added
// on top of Y's diatonic root) — that reuse is what makes "V7/ii", "subV7/ii"
// etc. fall out of one formula instead of needing special-cased math per case.
const PL_MAJOR_SCALE_OFFSETS = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const PL_NUMERAL_LIST = ['VII','vii','VI','vi','IV','iv','III','iii','II','ii','V','v','I','i'];
const PL_DEGREE_MAP = { I:1, II:2, III:3, IV:4, V:5, VI:6, VII:7 };

// Longest-match-first list of recognized quality suffixes. `'7'` is handled
// separately below because its meaning (dominant vs minor7) depends on the
// case of the numeral it's attached to, not on the suffix text alone.
const PL_QUALITY_ALIASES = [
  ['6/9','6/9'], ['7sus4','7sus4'], ['9sus4','9sus4'], ['madd9','madd9'], ['mmaj7','mmaj7'],
  ['maj9','maj9'], ['maj7','maj7'], ['add9','add9'], ['m7b5','m7b5'], ['dim7','dim7'],
  ['7b9','7b9'], ['7#9','7#9'], ['7b5','m7b5'], ['7-5','m7b5'], ['-7','m7'], ['m9','m9'], ['m6','m6'], ['m7','m7'], ['9','9'], ['6','6'],
  ['sus4','sus4'], ['sus2','sus2'], ['dim','dim'], ['aug','aug'],
  ['°7','dim7'], ['ø7','m7b5'], ['°','dim'], ['ø','m7b5'], ['+','aug'],
];

function plResolveQuality(qtoken, isUpper, degree, isSubV) {
  if (qtoken === '') {
    if (isSubV) return '7'; // bare "subV" implies a dominant 7th by definition
    if (degree === 7 && !isUpper) return 'dim'; // bare "vii" defaults to the diatonic diminished triad
    return isUpper ? '' : 'm';
  }
  const lowered = qtoken.toLowerCase();
  if (lowered === '7') return isUpper ? '7' : 'm7';
  for (const [alias, quality] of PL_QUALITY_ALIASES) {
    if (lowered === alias.toLowerCase()) return quality;
  }
  return null;
}

// Parses the numeral (+ optional leading accidental) at the start of `s`.
// Returns { degree, accidental, isUpper, rest } or null if nothing matched.
function plMatchNumeral(s) {
  let accidental = 0;
  let rest = s;
  if (rest[0] === 'b' || rest[0] === '♭') { accidental = -1; rest = rest.slice(1); }
  else if (rest[0] === '#' || rest[0] === '♯') { accidental = 1; rest = rest.slice(1); }
  const numeral = PL_NUMERAL_LIST.find(n => rest.startsWith(n));
  if (!numeral) return null;
  return {
    degree: PL_DEGREE_MAP[numeral.toUpperCase()],
    accidental,
    isUpper: numeral === numeral.toUpperCase(),
    rest: rest.slice(numeral.length),
  };
}

// Parses one space-separated token (e.g. "V7/ii", "subV7", "iiø7/ii",
// "I*2") into { rootPc, quality, weight } where rootPc is 0-11 relative to
// the current key's tonic and weight is an explicit beat count (or null if
// the token should split the bar's remaining beats evenly with its
// bar-mates — see plDistributeBeats). Returns { error } if it doesn't parse.
function plParseToken(raw) {
  let token = raw;
  let weight = null;
  const weightMatch = token.match(/\*(\d+(?:\.\d+)?)$/);
  if (weightMatch) {
    weight = parseFloat(weightMatch[1]);
    token = token.slice(0, -weightMatch[0].length);
  }
  let isSubV = false;
  let numeralInfo;
  if (/^subv/i.test(token)) {
    isSubV = true;
    // subV is sugar for "bII" (tritone below/above the primary V) — reusing
    // the general slash-application formula below rather than a bespoke
    // one, so it can't silently drift out of sync with the bII math.
    numeralInfo = { degree: 2, accidental: -1, isUpper: true, rest: token.slice(4) };
  } else {
    numeralInfo = plMatchNumeral(token);
    if (!numeralInfo) return { error: `无法识别的级数："${raw}"` };
  }
  const { degree, accidental, isUpper, rest } = numeralInfo;

  let qualityToken = rest;
  let targetToken = null;
  const slashIdx = rest.indexOf('/');
  if (slashIdx !== -1) {
    qualityToken = rest.slice(0, slashIdx);
    targetToken = rest.slice(slashIdx + 1);
  }

  const quality = plResolveQuality(qualityToken, isUpper, degree, isSubV);
  if (quality === null) return { error: `无法识别的和弦性质："${qualityToken}"（在 "${raw}" 里）` };

  const ownMajorOffset = PL_MAJOR_SCALE_OFFSETS[degree] + accidental;
  let rootPc;
  if (targetToken) {
    const t = plMatchNumeral(targetToken);
    if (!t || t.rest !== '') return { error: `无法识别目标级数："${targetToken}"（在 "${raw}" 里）` };
    const targetOffset = PL_MAJOR_SCALE_OFFSETS[t.degree] + t.accidental;
    rootPc = ((targetOffset + ownMajorOffset) % 12 + 12) % 12;
  } else {
    rootPc = ((ownMajorOffset) % 12 + 12) % 12;
  }
  return { rootPc, quality, weight };
}

// Splits one bar's chords into { rootPc, quality, beats }, evenly dividing
// the bar's remaining beats (after subtracting any explicit `*N` weights)
// among the chords that didn't specify one. A bar with a single unweighted
// chord therefore gets the whole bar — no special-casing needed, it falls
// out of this formula for free. The 0.25-beat floor applies uniformly to
// both explicit weights and auto-computed shares, so e.g. `I*0` can't
// produce a zero-duration chord (which would schedule Web Audio automation
// events out of chronological order).
function plDistributeBeats(barChords, beatsPerBar) {
  const explicitSum = barChords.reduce((sum, c) => sum + (c.weight != null ? c.weight : 0), 0);
  const unweighted = barChords.filter(c => c.weight == null);
  const remaining = Math.max(0, beatsPerBar - explicitSum);
  const share = unweighted.length ? remaining / unweighted.length : 0;
  return barChords.map(c => ({
    rootPc: c.rootPc,
    quality: c.quality,
    beats: Math.max(0.25, c.weight != null ? c.weight : share),
  }));
}

// Parses a full progression string — bars separated by `|`, chords within a
// bar separated by whitespace, each chord optionally suffixed `*N` — into a
// flat list of { rootPc, quality, beats, barIndex }. Returns { error } from
// the first token that fails to parse.
function plParseProgression(text, beatsPerBar) {
  const barTexts = text.split('|').map(s => s.trim()).filter(Boolean);
  if (barTexts.length === 0) return { error: '空输入' };
  const chords = [];
  for (let barIndex = 0; barIndex < barTexts.length; barIndex++) {
    const tokens = barTexts[barIndex].split(/\s+/).filter(Boolean);
    const barChords = [];
    for (const tok of tokens) {
      const parsed = plParseToken(tok);
      if (parsed.error) return { error: parsed.error };
      barChords.push(parsed);
    }
    plDistributeBeats(barChords, beatsPerBar).forEach(c => chords.push({ ...c, barIndex }));
  }
  if (chords.length === 0) return { error: '空输入' };
  return { chords };
}

function plChordSymbol(rootPc, quality, tonicPc) {
  const absPc = (tonicPc + rootPc) % 12;
  return PL_NOTE_NAMES_FLAT[absPc] + PL_QUALITY_LABELS[quality];
}

// Same root/quality resolution as plChordSymbol, but for the Jam page's
// backing-track engine (src/gen_accompaniment_midi.py QUALITY_INTERVALS)
// instead of on-screen display — so it appends the raw quality *token*
// (e.g. "m7b5", "madd9") rather than the prettified label (e.g. "m7♭5",
// "m(add9)"), which the backend's chord parser can't read.
function plJamChordName(rootPc, quality, tonicPc) {
  const absPc = (tonicPc + rootPc) % 12;
  return PL_NOTE_NAMES_FLAT[absPc] + quality;
}

// Renders resolved chords grouped by bar (e.g. "Dm7 G7 | Cmaj7"), with each
// chord's beat count shown when it's not a whole number (so *N overrides
// and uneven splits are visible, not just implied).
function plFormatResolved(chords, tonicPc) {
  const bars = [];
  chords.forEach(ch => {
    if (!bars[ch.barIndex]) bars[ch.barIndex] = [];
    const symbol = plChordSymbol(ch.rootPc, ch.quality, tonicPc);
    const beatsLabel = Number.isInteger(ch.beats) ? '' : `(${ch.beats.toFixed(2)}拍)`;
    bars[ch.barIndex].push(symbol + beatsLabel);
  });
  return bars.map(b => b.join(' ')).join('  |  ');
}

// ── 播放：each chord's duration in beats comes from the parser (bar
// grouping + optional *N weight, see plDistributeBeats); BPM converts that
// to seconds ──
function plBeatSec() { return 60 / plState.bpm; }

// Resolves `absPc` (0-11) to whichever octave lands closest to `refMidi` —
// real nearest-voice-leading distance, not a fixed octave per pitch class.
// Without this, root motion that crosses a pitch-class wrap point (e.g.
// C#->B: index 1 -> index 11) produces a spurious ~octave leap in the wrong
// direction even when the intended motion is a single stepwise half/whole
// step down (a descending chain like IV-iii-ii-I in B major reads as "a
// major 7th up" on its last chord instead of "a half step down").
function plNearestMidi(absPc, refMidi) {
  const k = Math.round((refMidi - absPc) / 12);
  return absPc + k * 12;
}

function plScheduleChords(chords, tonicPc, startAt) {
  const ctx = plGetCtx();
  const sec = plBeatSec();
  let t = startAt;
  let prevRootMidi = null;
  chords.forEach(ch => {
    const dur = ch.beats * sec;
    const absPc = (tonicPc + ch.rootPc) % 12;
    // First chord anchors to a fixed middle register; every chord after
    // that resolves to the octave of its pitch class closest to the
    // previous chord's root (see plNearestMidi) instead of a fixed octave.
    const rootMidi = prevRootMidi == null ? absPc + 4 * 12 : plNearestMidi(absPc, prevRootMidi);
    prevRootMidi = rootMidi;
    const notes = [rootMidi - 12, ...PL_QUALITIES[ch.quality].map(iv => rootMidi + iv)];
    notes.forEach(n => plPlayNote(ctx, n, t, dur));
    t += dur;
  });
  return t;
}

// ── 级数速查表：跟调无关的抽象记法（回答"小调二级默认是什么和弦"这类问题，
// 死记的是级数本身的默认七和弦性质，不是某个具体调里的音名）──
const PL_LOOKUP_DEGREES = {
  major: [
    ['I', 'Imaj7'], ['ii', 'iim7'], ['iii', 'iiim7'], ['IV', 'IVmaj7'],
    ['V', 'V7'], ['vi', 'vim7'], ['vii°', 'vii7b5'],
  ],
  naturalMinor: [
    ['i', 'im7'], ['ii°', 'ii7b5'], ['♭III', '♭IIImaj7'], ['iv', 'ivm7'],
    ['v', 'vm7'], ['♭VI', '♭VImaj7'], ['♭VII', '♭VII7'],
  ],
};

function plRenderLookupTable() {
  const el = document.getElementById('pl-lookup-table');
  if (!el) return;
  const rows = PL_LOOKUP_DEGREES[plState.lookupMode]
    .map(([roman, seventh]) => `<tr><td>${plEscapeHtml(roman)}</td><td>${plEscapeHtml(seventh)}</td></tr>`)
    .join('');
  const note = plState.lookupMode === 'naturalMinor'
    ? '小调想要真正的属和弦推力（V→i），第 5 级要升半音变成和声小调的 V7，这里只列自然小调本身算出来的。'
    : '';
  el.innerHTML = `
    <table>
      <tr><th>级数</th><th>七和弦</th></tr>
      ${rows}
    </table>
    ${note ? `<div class="pl-lookup-note">${plEscapeHtml(note)}</div>` : ''}
  `;
}

function plSetLookupMode(mode) {
  plState.lookupMode = mode;
  document.querySelectorAll('.pl-lookup-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  plRenderLookupTable();
}

// ── State + persistence (per project convention: every page option must
// survive a reload). localStorage access is wrapped in try/catch as a
// defensive habit consistent with the rest of the app's *PrefsLoad/Save
// helpers, even though this page is always served over http(s), not
// file://, so the opaque-origin failure mode doesn't actually apply here. ──
const PL_PREFS_KEY = 'pl_prefs';
let plState = { key: 'C', bpm: 70, beatsPerBar: 4, lookupMode: 'major', cards: [], inited: false };
let plNextId = 1;

function plPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PL_PREFS_KEY)) || {}; } catch (_) {}
  if (typeof saved.key === 'string' && PL_KEY_OPTIONS.includes(saved.key)) plState.key = saved.key;
  if (Number.isFinite(saved.bpm) && saved.bpm >= 20 && saved.bpm <= 300) plState.bpm = saved.bpm;
  if (Number.isFinite(saved.beatsPerBar) && saved.beatsPerBar >= 1 && saved.beatsPerBar <= 12) plState.beatsPerBar = saved.beatsPerBar;
  if (Array.isArray(saved.cards)) {
    plState.cards = saved.cards.filter(c => c && typeof c.text === 'string').map(c => ({ ...c, id: plNextId++, editing: false }));
  }
}
function plPrefsSave() {
  try {
    localStorage.setItem(PL_PREFS_KEY, JSON.stringify({
      key: plState.key,
      bpm: plState.bpm,
      beatsPerBar: plState.beatsPerBar,
      cards: plState.cards.map(c => ({ text: c.text })),
    }));
  } catch (_) { /* storage unavailable — state still works this session */ }
}

function plRenderKeySelect() {
  const sel = document.getElementById('pl-key-select');
  sel.innerHTML = PL_KEY_OPTIONS.map(k => `<option value="${k}"${k === plState.key ? ' selected' : ''}>${k} 调</option>`).join('');
  document.getElementById('pl-bpm-input').value = plState.bpm;
  document.getElementById('pl-beats-per-bar-input').value = plState.beatsPerBar;
}
function plOnKeyChange() {
  plState.key = document.getElementById('pl-key-select').value;
  plPrefsSave();
  plRenderCards(); // the lookup table is now key-independent (abstract notation) — no re-render needed here
}
function plOnBpmChange() {
  const v = parseInt(document.getElementById('pl-bpm-input').value, 10);
  if (Number.isFinite(v) && v >= 20 && v <= 300) plState.bpm = v;
  else document.getElementById('pl-bpm-input').value = plState.bpm;
  plPrefsSave();
}
function plOnBeatsPerBarChange() {
  const v = parseInt(document.getElementById('pl-beats-per-bar-input').value, 10);
  if (Number.isFinite(v) && v >= 1 && v <= 12) plState.beatsPerBar = v;
  else document.getElementById('pl-beats-per-bar-input').value = plState.beatsPerBar;
  plPrefsSave();
  plRenderCards();
}

function plToggleHelp() {
  document.getElementById('pl-help-panel').classList.toggle('open');
}

function plAddFromInput() {
  const input = document.getElementById('pl-roman-input');
  const text = input.value.trim();
  if (!text) return;
  plState.cards.push({ id: plNextId++, text, selected: false, editing: false });
  input.value = '';
  plPrefsSave();
  plRenderCards();
}
function plAddPreset(text) {
  plState.cards.push({ id: plNextId++, text, selected: false, editing: false });
  plPrefsSave();
  plRenderCards();
}
function plRemoveCard(id) {
  plState.cards = plState.cards.filter(c => c.id !== id);
  plPrefsSave();
  plRenderCards();
}
function plToggleSelect(id, checked) {
  const c = plState.cards.find(c => c.id === id);
  if (c) c.selected = checked;
  plRenderCompareBar();
}
function plClearAll() {
  if (plState.cards.length && !confirm('清空全部已生成的示例？')) return;
  plState.cards = [];
  plPrefsSave();
  plRenderCards();
}

// ── Inline editing: click a card's roman-numeral text to turn it into a
// text input; Enter/blur saves, Escape cancels. Only one card edits at a
// time (starting a new edit implicitly saves/closes whatever was open,
// since plRenderCards() re-renders from plState.cards on every change).
function plStartEdit(id) {
  plState.cards.forEach(c => { c.editing = (c.id === id); });
  plRenderCards();
  const input = document.querySelector(`.pl-prog-card[data-id="${id}"] .pl-roman-input`);
  if (input) { input.focus(); input.select(); }
}
function plSaveEdit(id, value) {
  const c = plState.cards.find(c => c.id === id);
  if (!c) return;
  const text = value.trim();
  if (text) c.text = text;
  c.editing = false;
  plPrefsSave();
  plRenderCards();
}
function plCancelEdit(id) {
  const c = plState.cards.find(c => c.id === id);
  if (c) c.editing = false;
  plRenderCards();
}

// Both playback entry points share one "audio in flight" lock, sized to the
// actual duration about to play (BPM and bar weights are user-editable, so
// playback length is unbounded — a fixed debounce window would eventually
// undershoot and let a repeat click start an overlapping second copy of the
// same progression). Any playback blocks any other playback until it's done.
let plPlayBlockedUntil = 0;
function plTotalBeats(chords) { return chords.reduce((sum, ch) => sum + ch.beats, 0); }

function plPlayCard(id) {
  if (Date.now() < plPlayBlockedUntil) return;
  const c = plState.cards.find(c => c.id === id);
  if (!c) return;
  const result = plParseProgression(c.text, plState.beatsPerBar);
  if (result.error) return;
  const ctx = plGetCtx();
  plPlayBlockedUntil = Date.now() + plTotalBeats(result.chords) * plBeatSec() * 1000 + 150;
  plScheduleChords(result.chords, PL_NOTE_INDEX[plState.key], ctx.currentTime + 0.05);
}
function plPlaySelected() {
  if (Date.now() < plPlayBlockedUntil) return;
  const selected = plState.cards.filter(c => c.selected);
  if (!selected.length) return;
  const parsed = selected.map(c => plParseProgression(c.text, plState.beatsPerBar)).filter(r => !r.error);
  if (!parsed.length) return;
  const gapSec = 0.4 * plBeatSec();
  const totalSec = parsed.reduce((sum, r) => sum + plTotalBeats(r.chords) * plBeatSec() + gapSec, 0);
  plPlayBlockedUntil = Date.now() + totalSec * 1000 + 150;
  const ctx = plGetCtx();
  let t = ctx.currentTime + 0.05;
  const tonicPc = PL_NOTE_INDEX[plState.key];
  parsed.forEach(r => { t = plScheduleChords(r.chords, tonicPc, t) + gapSec; });
}

// Sends one card's progression to the Jam page as its chord chart, carrying
// over this page's key/BPM too (Jam's own style choice — which drives the
// drum/bass groove — is left untouched, since it's an arrangement pick that
// has nothing to do with which harmony you're feeding it).
function plSendToJam(id) {
  const c = plState.cards.find(c => c.id === id);
  if (!c) return;
  const result = plParseProgression(c.text, plState.beatsPerBar);
  if (result.error) return;
  const tonicPc = PL_NOTE_INDEX[plState.key];
  const bars = [];
  result.chords.forEach(ch => {
    if (!bars[ch.barIndex]) bars[ch.barIndex] = { chords: [] };
    bars[ch.barIndex].chords.push({ name: plJamChordName(ch.rootPc, ch.quality, tonicPc), beats: ch.beats });
  });
  state.jam.bars = bars;
  state.jam.key = plState.key;
  state.jam.bpm = plState.bpm;
  const bpmEl = document.getElementById('jam-bpm');
  const keyEl = document.getElementById('jam-key');
  if (bpmEl) bpmEl.value = plState.bpm;
  if (keyEl) keyEl.value = plState.key;
  renderJamChart();
  saveLastSelection();
  showPage('jam');
}

function plRenderCompareBar() {
  const selectedCount = plState.cards.filter(c => c.selected).length;
  document.getElementById('pl-sel-count').textContent = selectedCount;
  document.getElementById('pl-play-selected-btn').disabled = selectedCount === 0;
}

function plRenderCards() {
  const area = document.getElementById('pl-cards-area');
  const emptyMsg = document.getElementById('pl-empty-msg');
  const listMeta = document.getElementById('pl-list-meta');
  emptyMsg.classList.toggle('hidden', plState.cards.length > 0);
  listMeta.textContent = plState.cards.length ? `共 ${plState.cards.length} 条示例 · 当前调：${plState.key}` : '';
  const tonicPc = PL_NOTE_INDEX[plState.key];
  area.innerHTML = plState.cards.map((c, idx) => {
    if (c.editing) {
      return `
        <div class="pl-prog-card" data-id="${c.id}">
          <div class="pl-num">#${idx + 1}</div>
          <div class="pl-ctrl">
            <button class="btn btn-ghost btn-sm danger" onclick="plRemoveCard(${c.id})">×</button>
          </div>
          <div class="pl-content">
            <input type="text" class="pl-roman-input" value="${plEscapeHtml(c.text)}"
                   onkeydown="if(event.key==='Enter') plSaveEdit(${c.id}, this.value); if(event.key==='Escape') plCancelEdit(${c.id});"
                   onblur="plSaveEdit(${c.id}, this.value)">
          </div>
        </div>`;
    }
    const result = plParseProgression(c.text, plState.beatsPerBar);
    const resolvedHtml = result.error
      ? `<span class="pl-err">⚠ ${plEscapeHtml(result.error)}</span>`
      : plEscapeHtml(plFormatResolved(result.chords, tonicPc));
    return `
      <div class="pl-prog-card" data-id="${c.id}">
        <div class="pl-num">#${idx + 1}</div>
        <input type="checkbox" ${c.selected ? 'checked' : ''} onchange="plToggleSelect(${c.id}, this.checked)" title="加入连播对比">
        <div class="pl-ctrl">
          <button class="btn btn-ghost btn-sm" onclick="plPlayCard(${c.id})" ${result.error ? 'disabled' : ''}>▶</button>
          <button class="btn btn-ghost btn-sm" onclick="plSendToJam(${c.id})" ${result.error ? 'disabled' : ''} title="发送到 Jam 页面编曲">→ Jam</button>
          <button class="btn btn-ghost btn-sm danger" onclick="plRemoveCard(${c.id})">×</button>
        </div>
        <div class="pl-content">
          <div class="pl-roman" onclick="plStartEdit(${c.id})" title="点击编辑">${plEscapeHtml(c.text)}</div>
          <div class="pl-resolved">${resolvedHtml}</div>
        </div>
      </div>`;
  }).join('');
  plRenderCompareBar();
}

function plEscapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ── 资料库：全部取自 docs/chromatic-harmony-and-substitutions.md 的例子，
// 每一条都已经用本工具的解析器验证过能正确还原原文里的和弦拼写 ──
const PL_PRESETS = [
  { group: '基础功能进行', items: [
    ['I - IV - V - I（一小节一个和弦）', 'I | IV | V | I |'],
    ['I - V - vi - IV', 'I | V | vi | IV |'],
    ['vi - IV - I - V', 'vi | IV | I | V |'],
  ]},
  { group: 'ii-V-I', items: [
    ['ii7 - V7 半小节各半，Imaj7 独占一小节', 'ii7 V7 | Imaj7 |'],
  ]},
  { group: '五度圈链 / turnaround', items: [
    ['iii-vi-ii-V 挤一小节，I 独占一小节', 'iii vi ii V | I |'],
    ['IV-V-iii-vi-ii-V-I（4536251）', 'IV | V | iii vi ii V | I |'],
  ]},
  { group: '附属和弦', items: [
    ['单个次属：I-V7/ii-ii-V-I', 'I | V7/ii | ii V | I |'],
    ['属和弦链：I-iiø7/ii-V7/ii-ii-V-I', 'I | iiø7/ii V7/ii | ii V | I |'],
  ]},
  { group: '三全音代理', items: [
    ['ii7-V7-Imaj7（正常）', 'ii7 V7 | Imaj7 |'],
    ['ii7-subV7-Imaj7（代理）', 'ii7 subV7 | Imaj7 |'],
  ]},
  { group: '借用和弦', items: [
    ['I-iv-I（借用小调下属）', 'Imaj7 iv | Imaj7 |'],
    ['I-V-♭VI-♭VII', 'Imaj7 V7 | bVI bVII |'],
    ['I-♭VII-IV-I', 'Imaj7 | bVII IV | Imaj7 |'],
    ['vi-♭III-IV', 'vi bIII | IV |'],
    ['I-ii°-iii（经过和弦）', 'I | ii° iii |'],
  ]},
  { group: '替代 V 的手法', items: [
    ['V7 快速解决（1拍）vs Imaj7 落地（3拍）', 'V7*1 Imaj7*3 |'],
    ['V9sus4 悬停一整小节再解决', 'V9sus4 | Imaj7 |'],
    ['I-ivm6-I（后门进行）', 'Imaj7 ivm6 | Imaj7 |'],
    ['I-ivm7-♭VII7-I（完整后门）', 'Imaj7 | ivm7 bVII7 | Imaj7 |'],
  ]},
  { group: '假终止 vs 刹车和弦', items: [
    ['I-V7-vi（假终止）', 'Imaj7 V7 | vi7 |'],
    ['I-V7-♭VI（刹车和弦）', 'Imaj7 V7 | bVI |'],
  ]},
  { group: '小调收尾 m7 vs m6', items: [
    ['V7/iii 快速 → iii7（收在 m7）', 'V7/iii*1 iii7*3 |'],
    ['V7/iii 快速 → iiim6（收在 m6）', 'V7/iii*1 iiim6*3 |'],
  ]},
];

function plRenderPresets() {
  const area = document.getElementById('pl-preset-area');
  area.innerHTML = PL_PRESETS.map(g => `
    <div class="pl-preset-group">
      <div class="pl-group-label">${plEscapeHtml(g.group)}</div>
      ${g.items.map(([label, text]) =>
        `<button class="pl-preset-item" onclick="plAddPreset('${text.replace(/'/g, "\\'")}')" title="${plEscapeHtml(text)}">${plEscapeHtml(label)}</button>`
      ).join('')}
    </div>
  `).join('');
}

// Guards against re-attaching (there's nothing to re-attach here — every
// control is wired via inline onclick/onchange in static HTML — but the
// flag still guards prefsLoad()/first-render from running twice if the
// page is revisited without a full reload) and does the first render.
function initProgressionLabPage() {
  if (!plState.inited) {
    plState.inited = true;
    plPrefsLoad();
  }
  plRenderKeySelect();
  plRenderPresets();
  plRenderCards();
  plRenderLookupTable();
}

// Same guarded-export pattern song-loop.js uses at its own bottom — this
// file is otherwise a plain browser <script> with no module system. Exists
// so song-loop.js's 级数 track (a consumer of this file's roman-numeral
// grammar, see its own comment on slRomanEngineAvailable) can be unit-tested
// against the real parser/formatter instead of a hand-rolled stand-in.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PL_NOTE_INDEX, PL_NOTE_NAMES_FLAT, PL_MAJOR_SCALE_OFFSETS, plParseToken, plChordSymbol, plJamChordName, plResolveQuality, PL_LOOKUP_DEGREES };
}
