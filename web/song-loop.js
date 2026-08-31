// ── Song Loop: practice a section of a real recorded backing track — set a
// BPM (tap-tempo or manual), a key label, an A-B bar-range loop, and slow
// playback down without pitch shift. Layout/visual design ported from
// design_handoff_guitar_practice_tool (single-file HTML mockup with a fixed
// 32-bar demo and simulated timer-driven playback); this implementation
// keeps that visual design but drives it with a real decoded audio file
// (real waveform peaks, real seek/loop/speed) instead of the mockup's fake
// data. Audio is decoded client-side via decodeAudioData for playback, but
// a locally dropped/picked file is also uploaded to the server's materials
// library (POST /api/materials, same endpoint Licks' material picker uses)
// so it gets a stable URL and can be auto-persisted like any other track —
// see the "per-URL state" block below.
//
// Known deliberate gap vs. a "real" tool, kept because the ported design
// itself only supports a single constant BPM for the whole song (no per-
// section tempo changes) and no auto key/BPM detection — same limitation
// the original handoff's own README calls out for its "移调" pitch control
// (UI-only, not wired to real audio, pending a phase-vocoder/WSOLA engine).

const SL_STORAGE_KEY = 'sl_prefs';
const SL_ZOOM_MIN = 40;
const SL_ZOOM_MAX = 280;

const SL_KEY_OPTIONS = ['C 大调', 'G 大调', 'D 大调', 'A 大调', 'E 大调', 'F 大调', 'Bb 大调', 'Am 小调', 'Em 小调', 'Dm 小调', 'Bm 小调', 'Gm 小调'];
const SL_INTERVAL_NAMES = ['原调', '小二度', '大二度', '小三度', '大三度', '纯四度', '三全音'];

// Parses free-typed key text into the canonical "<Root> 大调" / "<Root>m 小调"
// form the rest of the page stores/persists. Root letter/case and accidental
// position are all order-insensitive ("#G", "g#", "G#" are the same root) so
// casual typing doesn't get rejected just for spelling order. Returns null
// for anything that isn't a recognizable note + optional mode word.
function slNormalizeKeyInput(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  if (!s) return null;
  const m = s.match(/^([#b]?)\s*([A-Ga-g])\s*([#b]?)(.*)$/);
  if (!m) return null;
  const [, pre, letter, post, restRaw] = m;
  if (pre && post) return null; // e.g. "#G#" — can't have two accidentals
  const accidental = pre || post || '';
  let rest = restRaw.trim().toLowerCase().replace(/\s+/g, '');
  if (rest === '') return `${letter.toUpperCase()}${accidental} 大调`; // no mode word -> default major
  // Longest-match-first so ambiguous prefixes ("maj"/"major" also start with
  // "m") resolve to the right mode instead of bare "m" greedily matching first.
  const MODE_WORDS = [
    ['minor', 'minor'], ['major', 'major'], ['小调', 'minor'], ['大调', 'major'],
    ['min', 'minor'], ['maj', 'major'], ['小', 'minor'], ['大', 'major'], ['m', 'minor'],
  ];
  let minor = false, major = false;
  while (rest) {
    const hit = MODE_WORDS.find(([w]) => rest.startsWith(w));
    if (!hit) return null; // leftover text isn't a recognized mode word
    if (hit[1] === 'minor') minor = true; else major = true;
    rest = rest.slice(hit[0].length);
  }
  if (minor && major) return null; // e.g. "m大调" — contradictory mode words
  const root = letter.toUpperCase() + accidental;
  return minor ? `${root}m 小调` : `${root} 大调`;
}

const slState = {
  inited: false, // guards initSongLoopPage() — see the comment there

  // Single global BPM for the whole song — matches the ported design's own
  // model (no per-section tempo changes, no drift correction). beatsPerBar
  // is fixed at 4 (the design always shows "4/4") but kept as a variable
  // rather than a literal, in case a future revision exposes it.
  bpm: 96, bpmManual: false, beatsPerBar: 4,
  key: SL_KEY_OPTIONS[1], keyManual: false, // default 'G 大调', matching the handoff's demo state
  pitch: 0, // semitones, -6..6 — UI-only, does not change actual playback pitch (see file header)

  loopFromBar: 5, loopToBar: 8, loopOn: false,
  bar1TimeSec: 0, // start time (sec) of the first FULL bar — see slFirstFullBarNumber()
  // startBarNumber: what the first displayed bar is called — a pure display
  // preference (0, 1, or anything else), independent of pickupBeats below.
  // pickupBeats: length (in beats, < beatsPerBar) of a leading pickup/anacrusis
  // bar before bar1TimeSec; 0 means there's no pickup bar at all.
  startBarNumber: 1, pickupBeats: 0,
  speed: 100, preservePitch: true,
  zoomPxPerBar: 140, // horizontal zoom of the bar grid; a viewing preference, not song-specific
  showChordDiagram: false, // whether the chord-fingering panel is visible; a viewing preference, not song-specific
  barTickStep: 4, // overview waveform's bar-number tick interval; a viewing preference, not song-specific
  // Count-in: a pre-roll of click sounds before playback starts from the very
  // beginning, completing bar 1 up to a full bar (see slCountInClickCount) —
  // a viewing/practice preference, not song-specific, like the flags above.
  countInEnabled: false,
  countInPending: false, // transient — true while the pre-roll clicks are playing but the real audio hasn't started yet
  countInAudioCtx: null, // transient — lazily created, see slCountInAudioCtx()

  duration: 0, channelData: null, peaks: null, // peaks: cached real per-bar waveform amplitude, recomputed on load/resize

  tapTimes: [],    // transient — tap-tempo BPM estimation only (last 6 taps within 2.5s, matches ported design)
  annotations: {}, // { [barNumber]: { chord, lyric, label, ...customTrackValues keyed by track id } }
  phraseStarts: [1], selectedPhraseStartBar: 1,
  // User-configurable text rows below 和弦/歌词 — rename/add/remove freely.
  // 'note' is the original fixed "简谱 / 备注" row, kept as the default first
  // track so existing songs' data (stored under annotations[bar].note) shows
  // up unchanged, with zero migration needed (see slNormalizeAnnotations).
  customTracks: [{ id: 'note', name: '简谱 / 备注' }],

  // Set once the current track has a stable materials-library URL: either
  // it was loaded via slLoadFromUrl (a Lick's backing track), or a locally
  // picked/dropped file finished uploading to /api/materials. Null only
  // while a local file's upload is still in flight (or failed). See the
  // per-URL state block below for what this unlocks.
  sourceUrl: null,

  // Epoch ms of the last time this track was opened in Song Loop — round-
  // trips through the same per-URL state blob as annotations/bpm/etc.
  // (see slCaptureFileStatePayload/slApplyFileStatePayload) purely so the
  // "从资料库选择" picker can sort by practice recency, not upload recency.
  lastOpenedAt: null,

  // NetEase Cloud Music song id last used to import lyrics for this track
  // (see the 网易云歌词 panel) — round-trips through the same per-URL state
  // blob so re-opening the track pre-fills the input and offers a direct
  // "在网易云打开" link instead of forcing the id to be looked up again.
  lyricSongId: '',

  els: {}, // DOM refs, populated in initSongLoopPage()
};

// ── persistence ──────────────────────────────────────────────────────────
// This is a rough starting point only — a last-used default that shows up
// before a track's own per-URL state (below) has loaded and overridden it.
// Every track-specific field (bpm/key/pitch/annotations/phrase markers/loop
// range/offset/speed) has its own per-URL persistence once the track has a
// materials-library URL — which, since local files now auto-upload on load,
// is effectively always once that upload succeeds.
function slPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SL_STORAGE_KEY)) || {}; } catch (_) {}
  if (Number.isFinite(saved.loopFromBar)) slState.loopFromBar = saved.loopFromBar;
  if (Number.isFinite(saved.loopToBar)) slState.loopToBar = saved.loopToBar;
  if (typeof saved.loopOn === 'boolean') slState.loopOn = saved.loopOn;
  if (Number.isFinite(saved.bar1TimeSec)) slState.bar1TimeSec = saved.bar1TimeSec;
  if (Number.isFinite(saved.speed)) slState.speed = saved.speed;
  if (typeof saved.preservePitch === 'boolean') slState.preservePitch = saved.preservePitch;
  if (Number.isFinite(saved.zoomPxPerBar)) slState.zoomPxPerBar = slClampZoom(saved.zoomPxPerBar);
  if (Number.isInteger(saved.barTickStep) && saved.barTickStep >= 1) slState.barTickStep = saved.barTickStep;
  if (typeof saved.showChordDiagram === 'boolean') slState.showChordDiagram = saved.showChordDiagram;
  if (typeof saved.countInEnabled === 'boolean') slState.countInEnabled = saved.countInEnabled;
}
function slPrefsSave() {
  localStorage.setItem(SL_STORAGE_KEY, JSON.stringify({
    loopFromBar: slState.loopFromBar, loopToBar: slState.loopToBar, loopOn: slState.loopOn,
    bar1TimeSec: slState.bar1TimeSec,
    speed: slState.speed, preservePitch: slState.preservePitch,
    zoomPxPerBar: slState.zoomPxPerBar,
    countInEnabled: slState.countInEnabled,
    barTickStep: slState.barTickStep,
    showChordDiagram: slState.showChordDiagram,
  }));
}

// ── per-URL state (any track with a materials-library URL) ─────────────────
// This now lives server-side, at PUT/GET /api/materials/<id>/state — see
// scheduleUrlStateSave/pushUrlState/applySavedUrlStateIfAny inside
// initSongLoopPage() (they need updateSidecarHint/els, so they can't live at
// module scope like the rest of this file's pure logic). The localStorage
// key below is kept only as a one-time migration source for tracks saved
// before this moved server-side — see slReadLegacyUrlState.
const SL_URL_STATE_PREFIX = 'sl_url_state_';

function slUrlStateKey(url) { return SL_URL_STATE_PREFIX + url; }

function slReadLegacyUrlState(url) {
  try { return JSON.parse(localStorage.getItem(slUrlStateKey(url))) || null; }
  catch (_) { return null; }
}

// Called alongside every user-edit persistence point (see
// slSaveCurrentFileState call sites below). A no-op until initSongLoopPage()
// has wired up slState.scheduleUrlStateSave (or the current track has no
// materials-library url yet — e.g. a local file's upload is still in flight
// or failed).
function slPersistUrlStateIfApplicable() {
  if (slState.sourceUrl && typeof slState.scheduleUrlStateSave === 'function') {
    slState.scheduleUrlStateSave();
  }
}

// ── local-file upload dedupe (name+size -> materials-library url) ──────────
// A locally picked/dropped file has no server identity of its own, so on
// first load it gets uploaded to /api/materials and the resulting url is
// cached here — keyed by name+size, not content hash, which is good enough
// for a personal practice tool (a same-name-same-size-but-different-content
// collision just means that reload won't be recognized as "new"). Re-opening
// the same file next time reuses the cached url instead of uploading again.
const SL_LOCAL_UPLOAD_MAP_KEY = 'sl_local_upload_map';

function slLocalUploadKey(name, size) { return `${name}::${size}`; }

function slLoadLocalUploadMap() {
  try { return JSON.parse(localStorage.getItem(SL_LOCAL_UPLOAD_MAP_KEY)) || {}; }
  catch (_) { return {}; }
}

function slSaveLocalUploadMapEntry(key, url) {
  const map = slLoadLocalUploadMap();
  map[key] = url;
  localStorage.setItem(SL_LOCAL_UPLOAD_MAP_KEY, JSON.stringify(map));
}

function slBaseName(fileName) {
  const name = typeof fileName === 'string' ? fileName.trim() : '';
  if (!name) return 'song-loop';
  return name.replace(/\.[^/.]+$/, '') || name;
}

function slSidecarFileName(fileName) {
  return `${slBaseName(fileName)}.songloop.json`;
}

// Re-keys every bar-indexed piece of state by `delta` — needed whenever
// startBarNumber or pickupBeats changes, since that changes what number
// every already-filled bar is called. Without this, changing the numbering
// scheme after you've already typed chords/lyrics/labels silently detaches
// that content from the physical bar it was on (it stays under the OLD
// number, which now points at a different bar or doesn't exist at all).
// A uniform shift by delta = slFirstFullBarNumber() new-minus-old is correct
// for every case (pickup toggled on/off, startBarNumber changed, or both) —
// see the plan doc for the derivation.
function slShiftBarKeyedState(delta) {
  if (!delta) return;
  const shifted = {};
  Object.entries(slState.annotations).forEach(([k, v]) => { shifted[parseInt(k, 10) + delta] = v; });
  slState.annotations = shifted;
  slState.phraseStarts = slState.phraseStarts.map(b => b + delta);
  if (Number.isInteger(slState.selectedPhraseStartBar)) slState.selectedPhraseStartBar += delta;
  slState.loopFromBar += delta;
  slState.loopToBar += delta;
}

function slNormalizePhraseStarts(arr) {
  const uniq = Array.from(new Set((Array.isArray(arr) ? arr : []).filter(n => Number.isInteger(n) && n >= slState.startBarNumber)));
  uniq.sort((a, b) => a - b);
  return uniq.length > 0 ? uniq : [slState.startBarNumber];
}

// Annotation fields with dedicated fixed rows (和弦/歌词/句首) — everything
// else on the annotation object is a dynamic custom-track value, keyed by
// that track's id (see slState.customTracks), so it can't be listed here.
const SL_FIXED_ANNOTATION_FIELDS = ['chord', 'lyric', 'label'];

function slNormalizeAnnotations(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([k, v]) => {
    const bar = parseInt(k, 10);
    if (!Number.isInteger(bar) || bar < slState.startBarNumber || !v || typeof v !== 'object') return;
    const entry = {
      chord: typeof v.chord === 'string' ? v.chord : '',
      lyric: typeof v.lyric === 'string' ? v.lyric : '',
      label: typeof v.label === 'string' ? v.label : '',
    };
    Object.entries(v).forEach(([field, val]) => {
      if (SL_FIXED_ANNOTATION_FIELDS.includes(field)) return;
      if (typeof val === 'string') entry[field] = val;
    });
    out[bar] = entry;
  });
  return out;
}

// A chord cell can hold "=5" instead of a literal chord, meaning "same as
// bar 5" — a spreadsheet-style formula living inside the existing free-text
// `chord` field, so it round-trips through every persistence path (server
// state, sidecar, slNormalizeAnnotations) with zero schema changes. Typing
// anything that doesn't match this pattern over a reference cell naturally
// detaches it back into a literal value — no separate "unlink" action needed.
const SL_CHORD_REF_RE = /^=\s*(-?\d+)\s*$/;

function slResolveChordRef(bar, annotations, visited = new Set()) {
  const raw = annotations[bar]?.chord ?? '';
  const m = typeof raw === 'string' && raw.match(SL_CHORD_REF_RE);
  if (!m) return { value: raw, isRef: false, broken: false };
  const target = parseInt(m[1], 10);
  if (visited.has(bar)) return { value: '', isRef: true, broken: true }; // circular reference
  visited.add(bar);
  const resolved = slResolveChordRef(target, annotations, visited);
  return { value: resolved.value, isRef: true, broken: resolved.broken };
}

// ── chord fingering diagram lookup ──────────────────────────────────────
// Chord-symbol parsing is already handled by slParseChordSymbol() above (the
// 级数/roman-numeral track's parser — same PL_QUALITIES-compatible quality
// vocabulary as SL_CHORD_SHAPE_TABLE's keys, so it's reused as-is rather than
// writing a second, subtly-different regex here).

// Open E-shape/A-shape fingerings — standard textbook forms, low string to
// high (E A D G B e) — barred (via fbBarreFretForShape, fb-core.js) to fit
// any root. Major deliberately isn't listed here (see slChordDiagramFor) —
// it reuses FB_CAGED_SHAPES.E/.A directly, but only a *function body* can
// reference that global safely: the fb-*.js modules and song-loop.js only share one
// scope on the real page (loaded as sibling <script> tags in page order), and
// in the Node test harness the equivalent — copying the fb-*.js modules' exports
// onto `global` — happens right before each test runs, not before this file
// is first required, so a top-level `const` here would see FB_CAGED_SHAPES
// as undefined.
const SL_CHORD_SHAPE_TABLE = {
  'm':    { E: { frets: [0, 2, 2, 0, 0, 0], rootString: 0, rootFret: 0 }, A: { frets: ['x', 0, 2, 2, 1, 0], rootString: 1, rootFret: 0 } },
  '7':    { E: { frets: [0, 2, 0, 1, 0, 0], rootString: 0, rootFret: 0 }, A: { frets: ['x', 0, 2, 0, 2, 0], rootString: 1, rootFret: 0 } },
  'maj7': { E: { frets: [0, 2, 1, 1, 0, 0], rootString: 0, rootFret: 0 }, A: { frets: ['x', 0, 2, 1, 2, 0], rootString: 1, rootFret: 0 } },
  'm7':   { E: { frets: [0, 2, 0, 0, 0, 0], rootString: 0, rootFret: 0 }, A: { frets: ['x', 0, 2, 0, 1, 0], rootString: 1, rootFret: 0 } },
};

// Picks whichever of the two candidate shapes needs the smaller barre fret
// (closer to an open position, easier to play). Returns null for qualities
// not covered (sus4/dim/aug/9/... — no diagram, not an error).
function slChordDiagramFor(root, quality) {
  const shapes = quality === '' ? { E: FB_CAGED_SHAPES.E, A: FB_CAGED_SHAPES.A } : SL_CHORD_SHAPE_TABLE[quality];
  if (!shapes) return null;
  const candidates = ['E', 'A'].map(letter => ({
    shape: shapes[letter], barreFret: fbBarreFretForShape(root, shapes[letter]),
  }));
  candidates.sort((a, b) => a.barreFret - b.barreFret);
  return candidates[0];
}

// ── 级数 (Roman numeral) track — a *derived* view of the 和弦 row, not a
// separate stored field: annotations[bar].chord stays the single source of
// truth (same trick the "=N" reference above relies on), so editing the
// roman cell just writes a concrete chord symbol back into that same field.
// That's what makes both directions of the sync free — sidecar/server
// persistence and slNormalizeAnnotations need zero schema changes.
//
// Reuses progression-lab.js's roman-numeral grammar (plParseToken/
// plChordSymbol/plResolveQuality/PL_MAJOR_SCALE_OFFSETS/PL_NOTE_INDEX) so
// secondary-dominant tokens like "V7/ii" keep working here for free — both
// pages share one global scope in the browser (see index.html's <script>
// load order), and by the time any of this actually runs (a user
// interaction) every script's top-level declarations have already executed,
// so the load order itself doesn't matter there. Node's unit tests load this
// file in isolation via require() though (see tests/js/song-loop.test.js),
// so every reference to a pl*/PL_* global is behind a `typeof` guard — same
// fallback-when-absent convention slPlaybackVolume() already uses for
// fbMasterGain() above.
function slRomanEngineAvailable() {
  return typeof PL_NOTE_INDEX !== 'undefined' && typeof PL_MAJOR_SCALE_OFFSETS !== 'undefined'
    && typeof plParseToken === 'function' && typeof plChordSymbol === 'function'
    && typeof plResolveQuality === 'function';
}

// Parses "<Root><Mode?> " from the free-typed key label ("G 大调", "F# 大调",
// "Bbm 小调", …) into a tonic pitch class. Chord quality/case in the roman
// conversion below is driven entirely by the chord's own quality, not by
// whether the key is major/minor, so the mode word itself isn't needed here.
function slKeyTonicPc(keyStr) {
  if (!slRomanEngineAvailable()) return null;
  const m = typeof keyStr === 'string' && keyStr.match(/^([A-G])([#b]?)m?\s/);
  return m ? PL_NOTE_INDEX[m[1] + m[2]] ?? null : null;
}

// Plain chord-symbol text ("Am7", "F#", "Bb/D", …) -> { rootPc, quality } or
// null if unrecognized. `quality` values are kept in the same vocabulary as
// PL_QUALITIES so anything parsed here can also round-trip back out through
// plChordSymbol. A slash bass note (if any) is ignored — the roman numeral
// reflects the chord's own root, not the inversion.
const SL_CHORD_QUALITY_ALIASES = {
  '': '', m: 'm', min: 'm', '-': 'm',
  dim: 'dim', '°': 'dim', aug: 'aug', '+': 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4',
  '7': '7', maj7: 'maj7', m7: 'm7', min7: 'm7', '-7': 'm7',
  dim7: 'dim7', '°7': 'dim7', m7b5: 'm7b5', 'm7-5': 'm7b5', 'ø7': 'm7b5', 'ø': 'm7b5',
  '6': '6', m6: 'm6', add9: 'add9', madd9: 'madd9',
  '9': '9', m9: 'm9', maj9: 'maj9',
  '7sus4': '7sus4', '7sus': '7sus4', '9sus4': '9sus4', '9sus': '9sus4',
  '6/9': '6/9', '69': '6/9', mmaj7: 'mmaj7', '7b9': '7b9', '7#9': '7#9',
};
function slParseChordSymbol(text) {
  if (!slRomanEngineAvailable() || typeof text !== 'string') return null;
  const s = text.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  if (!s) return null;
  const m = s.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;
  const [, letter, acc, restRaw] = m;
  const rootPc = PL_NOTE_INDEX[letter.toUpperCase() + acc];
  if (rootPc === undefined) return null;
  let rest = restRaw.trim();
  const slashIdx = rest.indexOf('/');
  if (slashIdx !== -1) rest = rest.slice(0, slashIdx).trim();
  // Capital-M shorthand ("CM7" = Cmaj7) checked before lowercasing — it would
  // otherwise collide with the lowercase 'm' (minor) key in the alias table.
  if (rest === 'M') return { rootPc, quality: '' };
  if (rest === 'M7') return { rootPc, quality: 'maj7' };
  const quality = SL_CHORD_QUALITY_ALIASES[rest.toLowerCase()];
  return quality === undefined ? null : { rootPc, quality };
}

const SL_ROMAN_DEGREE_LETTERS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII' };
// Qualities conventionally written with a lowercase numeral (minor / dim /
// half-dim color); everything else — major, dominant, sus, aug, and 6/9/add
// extensions of a major triad — gets an uppercase numeral.
const SL_ROMAN_LOWERCASE_QUALITIES = new Set(['m', 'dim', 'm7', 'dim7', 'm7b5', 'm6', 'madd9', 'm9', 'mmaj7']);

// chord text -> roman numeral, relative to `keyStr`'s tonic. Empty/
// unparseable chord text or an unparseable key both fall back to '' (a blank
// cell) rather than throwing — this runs on every keystroke in the chord row.
// A cell can hold more than one chord ("Em F#7" for a mid-bar change, see
// slSongChordList's comment) — each space-separated token is converted on
// its own and the results are rejoined with spaces, so e.g. "Em F#7" in the
// key of C becomes "vi V7". A token that doesn't parse as a chord is dropped
// silently (same lead-sheet-shorthand tolerance as slSongChordList).
function slChordToRoman(chordText, keyStr) {
  if (!chordText) return '';
  if (/\s/.test(chordText.trim())) {
    return chordText.trim().split(/\s+/).map(tok => slChordToRomanOne(tok, keyStr)).filter(Boolean).join(' ');
  }
  return slChordToRomanOne(chordText, keyStr);
}

function slChordToRomanOne(chordText, keyStr) {
  if (!chordText) return '';
  const tonicPc = slKeyTonicPc(keyStr);
  const parsed = slParseChordSymbol(chordText);
  if (tonicPc == null || !parsed) return '';
  const { rootPc, quality } = parsed;
  const relOffset = ((rootPc - tonicPc) % 12 + 12) % 12;
  // Prefer an exact diatonic match (accidental 0), then a flat spelling
  // (covers the common borrowed chords bII/bIII/bVI/bVII), then sharp as a
  // last resort — see PL_MAJOR_SCALE_OFFSETS' own comment for why one table
  // works for both primary-chord roots and slash-chord targets.
  let degree = null, accidental = 0;
  for (const acc of [0, -1, 1]) {
    for (let d = 1; d <= 7; d++) {
      if (((PL_MAJOR_SCALE_OFFSETS[d] + acc) % 12 + 12) % 12 === relOffset) { degree = d; accidental = acc; break; }
    }
    if (degree != null) break;
  }
  if (degree == null) return '';
  const isUpper = !SL_ROMAN_LOWERCASE_QUALITIES.has(quality);
  const bareDefaultQuality = plResolveQuality('', isUpper, degree, false);
  let suffix;
  if (quality === bareDefaultQuality) suffix = '';
  else if (quality === '7' && isUpper) suffix = '7';
  else if (quality === 'm7' && !isUpper) suffix = '7';
  else suffix = quality;
  const accidentalText = accidental === -1 ? 'b' : accidental === 1 ? '#' : '';
  const numeral = SL_ROMAN_DEGREE_LETTERS[degree];
  return accidentalText + (isUpper ? numeral : numeral.toLowerCase()) + suffix;
}

const SL_ROMAN_LETTER_TO_DEGREE = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
// Collapses a full roman-numeral string ("bIII7", "v7", "IVmaj7") down to
// just its scale-degree number, keeping only the leading accidental (b/# —
// that's part of *which* degree it is, not a quality suffix) and dropping
// case + everything after the numeral (7/maj7/m/dim/... — the 和弦 row above
// already spells the chord out in full, so this row is a quick-glance number
// only). Longest-numeral-first alternation so "VII"/"VI" aren't cut short by
// a "V" or "I" prefix match.
function slRomanDegreeDigit(romanText) {
  if (typeof romanText !== 'string' || !romanText) return '';
  if (/\s/.test(romanText.trim())) {
    return romanText.trim().split(/\s+/).map(slRomanDegreeDigitOne).filter(Boolean).join(' ');
  }
  return slRomanDegreeDigitOne(romanText);
}

function slRomanDegreeDigitOne(romanText) {
  if (typeof romanText !== 'string' || !romanText) return '';
  const m = romanText.match(/^([#b]?)(VII|VI|IV|V|III|II|I)/i);
  if (!m) return '';
  return m[1] + SL_ROMAN_LETTER_TO_DEGREE[m[2].toUpperCase()];
}

// roman numeral text -> chord symbol, relative to `keyStr`'s tonic. Returns
// '' for a blank input (clears the bar's chord), or null if the text isn't a
// recognized roman-numeral token — callers use null to mean "leave the
// underlying chord alone, this edit isn't committed yet".
function slRomanToChord(romanText, keyStr) {
  const s = typeof romanText === 'string' ? romanText.trim() : '';
  if (!s) return '';
  if (/\s/.test(s)) {
    const chords = s.split(/\s+/).map(tok => slRomanToChordOne(tok, keyStr));
    return chords.some(c => c === null) ? null : chords.join(' ');
  }
  return slRomanToChordOne(s, keyStr);
}

function slRomanToChordOne(s, keyStr) {
  const tonicPc = slKeyTonicPc(keyStr);
  if (tonicPc == null) return null;
  const parsed = plParseToken(s);
  if (parsed.error) return null;
  return plChordSymbol(parsed.rootPc, parsed.quality, tonicPc);
}

// Falls back to the single legacy "简谱 / 备注" track only when the field is
// completely absent (a save from before custom tracks existed) — an explicit
// empty array (the user removed every custom track) is left as-is.
function slNormalizeCustomTracks(raw) {
  if (!Array.isArray(raw)) return [{ id: 'note', name: '简谱 / 备注' }];
  const seen = new Set();
  return raw.filter(t => {
    if (!t || typeof t.id !== 'string' || !t.id || typeof t.name !== 'string') return false;
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  }).map(t => ({ id: t.id, name: t.name }));
}

// Preset section labels offered in the 句首 row's picker — common Chinese
// pop-song structure terms, plus a free-text "自定义…" escape hatch in the UI.
const SL_PHRASE_LABEL_PRESETS = ['前奏', '主歌', '预副歌', '副歌', '桥段', '间奏', 'Solo', '尾声'];

// One color per preset label, so the overview waveform's label dots (see
// renderWaveLabelMarkers) let you tell song sections apart at a glance
// without reading the text. Custom (non-preset) labels all share one color —
// distinguishing every unique custom string isn't worth the complexity here.
const SL_PHRASE_LABEL_COLORS = {
  '前奏': '#8a6fae', '主歌': '#3d7ea6', '预副歌': '#3d9a8b', '副歌': '#c9622d',
  '桥段': '#a8492f', '间奏': '#6b7a8f', 'Solo': '#b8860b', '尾声': '#5c5346',
};
const SL_PHRASE_LABEL_DEFAULT_COLOR = '#4a7c4a';
function slPhraseLabelColor(label) {
  return SL_PHRASE_LABEL_COLORS[label] || SL_PHRASE_LABEL_DEFAULT_COLOR;
}

// bar's position within the most recent *labeled* section at or before it
// (e.g. bar 11, with a "主歌" marker at bar 9, is the 3rd bar of that 主歌).
// null before any labeled section exists yet — unlabeled phrase markers
// (句首 markers with no name typed in) don't reset this, only labeled ones do.
// phraseStarts is assumed pre-sorted ascending (slNormalizePhraseStarts's contract).
function slBarRelativeToLabel(bar, phraseStarts, annotations) {
  let anchor = null;
  for (const p of phraseStarts) {
    if (p > bar) break;
    if (annotations[p]?.label) anchor = p;
  }
  return anchor == null ? null : bar - anchor + 1;
}

// Table-of-contents data for the 段落 markers: one entry per phraseStart,
// spanning up to (but not including) the next phraseStart, or the end of the
// song for the last one. Pure — no DOM — so the TOC panel and its tests share
// the same bar-range math instead of each re-deriving it.
// phraseStarts is assumed pre-sorted ascending (slNormalizePhraseStarts's contract).
function slPhraseSections(phraseStarts, annotations, startBarNumber, totalBars) {
  const lastBar = startBarNumber + totalBars - 1;
  return phraseStarts.map((bar, i) => {
    const nextBar = i + 1 < phraseStarts.length ? phraseStarts[i + 1] : lastBar + 1;
    const endBar = Math.max(bar, nextBar - 1);
    return { bar, label: annotations[bar]?.label || '', barCount: endBar - bar + 1 };
  });
}

// Every distinct chord used anywhere in the song, in order of first
// appearance, "=N" references resolved to their literal chord via
// slResolveChordRef. Pure — no DOM — so the fingering panel and its tests
// share this instead of each re-deriving the resolve+dedupe logic.
// A cell can hold more than one chord ("Em F#7" for a mid-bar change) —
// split on whitespace so each becomes its own entry. Tokens that don't parse
// as a chord symbol at all (lead-sheet shorthand like "%1" for "same as bar
// 1", stray text, …) are silently dropped rather than kept as "unsupported"
// — that label is reserved for text that *is* a real chord (slParseChordSymbol
// succeeds) but has no shape in SL_CHORD_SHAPE_TABLE.
function slSongChordList(annotations, startBarNumber, totalBars) {
  const seen = new Set();
  const chords = [];
  for (let bar = startBarNumber; bar < startBarNumber + totalBars; bar++) {
    const raw = slResolveChordRef(bar, annotations).value.trim();
    if (!raw) continue;
    raw.split(/\s+/).forEach((token) => {
      if (!token || seen.has(token) || !slParseChordSymbol(token)) return;
      seen.add(token);
      chords.push(token);
    });
  }
  return chords;
}

function slSaveCurrentFileState() { slPersistUrlStateIfApplicable(); }

function slCaptureFileStatePayload() {
  return {
    version: 1,
    bar1TimeSec: slState.bar1TimeSec,
    startBarNumber: slState.startBarNumber,
    pickupBeats: slState.pickupBeats,
    bpm: slState.bpm,
    bpmManual: slState.bpmManual,
    key: slState.key,
    keyManual: slState.keyManual,
    pitch: slState.pitch,
    loopFromBar: slState.loopFromBar,
    loopToBar: slState.loopToBar,
    loopOn: slState.loopOn,
    phraseStarts: slState.phraseStarts,
    selectedPhraseStartBar: slState.selectedPhraseStartBar,
    annotations: slState.annotations,
    customTracks: slState.customTracks,
    lastOpenedAt: slState.lastOpenedAt,
    lyricSongId: slState.lyricSongId,
    speed: slState.speed,
  };
}

function slApplyFileStatePayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (Number.isFinite(payload.bar1TimeSec)) slState.bar1TimeSec = payload.bar1TimeSec;
  // Applied before phraseStarts/annotations below — their normalizers use
  // slState.startBarNumber as the floor for what counts as a valid bar number.
  slState.startBarNumber = Number.isInteger(payload.startBarNumber) ? payload.startBarNumber : 1;
  slState.pickupBeats = Number.isInteger(payload.pickupBeats)
    ? Math.max(0, Math.min(slState.beatsPerBar - 1, payload.pickupBeats))
    : 0;
  if (Number.isFinite(payload.bpm)) slState.bpm = payload.bpm;
  if (typeof payload.bpmManual === 'boolean') slState.bpmManual = payload.bpmManual;
  if (typeof payload.key === 'string') slState.key = payload.key;
  if (typeof payload.keyManual === 'boolean') slState.keyManual = payload.keyManual;
  if (Number.isFinite(payload.pitch)) slState.pitch = payload.pitch;
  if (Number.isFinite(payload.loopFromBar)) slState.loopFromBar = payload.loopFromBar;
  if (Number.isFinite(payload.loopToBar)) slState.loopToBar = payload.loopToBar;
  if (typeof payload.loopOn === 'boolean') slState.loopOn = payload.loopOn;
  slState.phraseStarts = slNormalizePhraseStarts(payload.phraseStarts);
  slState.selectedPhraseStartBar = Number.isInteger(payload.selectedPhraseStartBar)
    ? payload.selectedPhraseStartBar
    : slState.phraseStarts[0];
  if (!slState.phraseStarts.includes(slState.selectedPhraseStartBar)) {
    slState.selectedPhraseStartBar = slState.phraseStarts[0];
  }
  slState.annotations = slNormalizeAnnotations(payload.annotations);
  slState.customTracks = slNormalizeCustomTracks(payload.customTracks);
  if (Number.isFinite(payload.lastOpenedAt)) slState.lastOpenedAt = payload.lastOpenedAt;
  slState.lyricSongId = typeof payload.lyricSongId === 'string' ? payload.lyricSongId : '';
  if (Number.isFinite(payload.speed)) slState.speed = payload.speed;
}

function slBuildSidecarDocument(sourceFileName) {
  return {
    kind: 'my-music-songloop-sidecar',
    version: 1,
    sourceFileName: typeof sourceFileName === 'string' ? sourceFileName : '',
    savedAt: new Date().toISOString(),
    state: slCaptureFileStatePayload(),
  };
}

function slExtractSidecarState(rawDoc) {
  if (!rawDoc || typeof rawDoc !== 'object') return null;
  if (rawDoc.state && typeof rawDoc.state === 'object') return rawDoc.state;
  return rawDoc;
}

function slParseSidecarText(text) {
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (_) { return null; }
  return slExtractSidecarState(parsed);
}

// ── bar/time math (pure — no DOM) — single constant BPM ──────────────────
// bar1TimeSec always anchors the first FULL bar (see slFirstFullBarNumber),
// not necessarily the first bar shown — a leading pickup bar (pickupBeats>0)
// sits just before it and takes the startBarNumber slot. With no pickup and
// startBarNumber=1 (the defaults), every formula below reduces exactly to
// the original 1-based-bars behavior, so existing saved songs need no migration.
function slSecPerBeat() { return 60 / slState.bpm; }
function slSecPerBar() { return slSecPerBeat() * slState.beatsPerBar; }

// How many count-in clicks precede playback from the very start (see
// slStartCountIn) — enough to complete bar 1 into a full bar. A pickup
// (弱起) bar already supplies some of its own beats at the very start of the
// recording, so the count-in only needs the REMAINING beats
// (beatsPerBar - pickupBeats); with no pickup, bar 1 is already a complete
// bar on its own, so the count-in is a whole extra bar tacked onto the front
// ("预备小节"), i.e. beatsPerBar clicks.
function slCountInClickCount() {
  return slState.pickupBeats > 0
    ? Math.max(0, slState.beatsPerBar - slState.pickupBeats)
    : slState.beatsPerBar;
}
function slCountInDurationSec() { return slCountInClickCount() * slSecPerBeat(); }
function slFirstFullBarNumber() {
  return slState.startBarNumber + (slState.pickupBeats > 0 ? 1 : 0);
}
function slTimeToBar(t) {
  if (slState.pickupBeats > 0 && t < slState.bar1TimeSec) return slState.startBarNumber;
  // +1e-6 epsilon: slBarToTime(bar) should map exactly back to `bar`, but
  // after a seek, audioEl.currentTime can read back a hair below the exact
  // target (float rounding / sample-rate quantization in the audio engine).
  // Without the epsilon, floor() then drops the result to bar-1 — visible
  // as "click bar 5, it highlights and plays from bar 4" right after seeking
  // while stopped (a live, advancing currentTime during playback naturally
  // moves past this boundary, which is why the bug didn't show up there).
  return Math.floor((t - slState.bar1TimeSec) / slSecPerBar() + 1e-6) + slFirstFullBarNumber();
}
function slBarToTime(bar) {
  if (slState.pickupBeats > 0 && bar === slState.startBarNumber) {
    return slState.bar1TimeSec - slState.pickupBeats * slSecPerBeat();
  }
  return slState.bar1TimeSec + (bar - slFirstFullBarNumber()) * slSecPerBar();
}
function slTotalBars() {
  const fullBars = Math.max(1, Math.ceil((slState.duration - slState.bar1TimeSec) / slSecPerBar()));
  return fullBars + (slState.pickupBeats > 0 ? 1 : 0);
}

// ── bar-grid zoom/scroll math (pure — no DOM) ─────────────────────────────
function slClampZoom(px) {
  return Math.max(SL_ZOOM_MIN, Math.min(SL_ZOOM_MAX, Math.round(px) || SL_ZOOM_MIN));
}
function slFitZoomPxPerBar(totalBars, containerWidth, labelWidth) {
  const bars = Math.max(1, totalBars);
  const available = Math.max(0, containerWidth - labelWidth);
  return slClampZoom(available / bars);
}
// Only recenter once the current bar's cell gets within marginRatio of either
// edge of the visible area — mirrors a DAW's "keep playhead roughly centered"
// follow behavior instead of scrollIntoView('nearest')'s edge-snap-every-bar.
function slShouldRecenter(cellLeft, cellRight, viewLeft, viewWidth, marginRatio = 0.15) {
  const margin = viewWidth * marginRatio;
  const viewRight = viewLeft + viewWidth;
  return cellLeft < viewLeft + margin || cellRight > viewRight - margin;
}
function slCenterScrollLeft(cellLeft, cellWidth, viewWidth) {
  return Math.max(0, cellLeft - viewWidth / 2 + cellWidth / 2);
}
// Maps the bar grid's current horizontal scroll position to a {leftPct,
// widthPct} box overlaid on the always-full-song overview waveform above it.
function slComputeViewportBox(scrollLeft, clientWidth, zoomPx, labelWidth, totalBars) {
  const bars = Math.max(1, totalBars);
  const contentWidth = Math.max(1, clientWidth - labelWidth);
  const barFrom = Math.max(0, scrollLeft / zoomPx);
  const barSpan = contentWidth / zoomPx;
  const leftPct = Math.min(100, (barFrom / bars) * 100);
  const widthPct = Math.max(0, Math.min(100 - leftPct, (barSpan / bars) * 100));
  return { leftPct, widthPct };
}

function slFmtTime(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

// Parses standard LRC text ("[mm:ss.xx]lyric line", possibly several time
// tags on one line for repeated lyrics) into { timeSec, text } entries
// sorted by time. Metadata-only lines (a timestamp with no lyric text after
// it — NetEase prefixes credits this way, e.g. "[00:00.000] 作词 : ...") are
// kept, since a credit line stuffed into the wrong bar is harmless and
// dropping it would silently disagree with what the LRC actually says;
// lines with no time tag at all (stray blank lines) are skipped.
function slParseLrc(text) {
  if (typeof text !== 'string') return [];
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const entries = [];
  text.split(/\r?\n/).forEach((line) => {
    const tags = [...line.matchAll(tagRe)];
    if (tags.length === 0) return;
    const content = line.replace(tagRe, '').trim();
    if (!content) return;
    tags.forEach((m) => {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
      entries.push({ timeSec: min * 60 + sec + frac, text: content });
    });
  });
  entries.sort((a, b) => a.timeSec - b.timeSec);
  return entries;
}

function slPitchLabelFor(n) {
  if (n === 0) return '原调（不移调）';
  const dir = n > 0 ? '升' : '降';
  const idx = Math.abs(n);
  const name = SL_INTERVAL_NAMES[idx] || (idx + '个半音');
  return dir + Math.abs(n) + '半音 · ' + name;
}

// ── shared master-volume integration — same singleton fbMasterGain() used
// by Fretboard/Speed Trainer, so the top-bar volume slider controls every
// page's audio consistently. ──────────────────────────────────────────────
function slPlaybackVolume() {
  return typeof fbMasterGain === 'function' ? fbMasterGain() : 1;
}
function slApplyPlaybackVolume() {
  if (slState.els.audioEl) {
    slState.els.audioEl.volume = Math.max(0, Math.min(1, slPlaybackVolume()));
  }
}

// ── Transport (app-wide floating panel) ───────────────────────────────────
// Registered via updateTransportForPage('songloop') in app.js with distinct
// pause/resume vs stop, like Vamp/Jam: Pause leaves currentTime where it is
// (slPlay resumes from there — same handler as initial play, since
// HTMLMediaElement.play() never touches position); Stop rewinds to the loop
// start (or track start when no loop is on), matching "stop" as most players
// mean it. slState.duration is 0 until a file finishes loading, so these are
// safe no-ops before then.

// ── Count-in (预备拍) — a pre-roll of drumstick-style clicks played through a
// dedicated Web Audio context *before* slPlay() ever calls audioEl.play(),
// only when starting fresh from the very beginning (see the currentTime
// check in slPlay). Cross-file references (fbRegisterAudioContext/
// fbMasterGain/fbSoundGain, all fb-audio.js) are unguarded here, same as
// setTransportState already is in slPause/slStop below — these only ever run
// from a real user interaction on the real page, by which point every
// <script> has finished loading. None of the actual scheduling below is
// unit-tested, same as speed-trainer.js's stScheduleClick/practice-timer.js's
// ptBeep aren't — see slCountInClickCount/slCountInDurationSec above for the
// pure, tested part.
let slCountInTimeoutId = null;

function slCancelCountIn() {
  if (slCountInTimeoutId != null) { clearTimeout(slCountInTimeoutId); slCountInTimeoutId = null; }
  slState.countInPending = false;
}

function slCountInAudioCtx() {
  if (!slState.countInAudioCtx) {
    slState.countInAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fbRegisterAudioContext(slState.countInAudioCtx);
  }
  if (slState.countInAudioCtx.state === 'suspended') slState.countInAudioCtx.resume();
  return slState.countInAudioCtx;
}

// A short filtered-noise burst — reads as a dry drumstick click, distinct
// from the pure-tone metronome click elsewhere in the app (Speed Trainer),
// matching what a count-in conventionally sounds like.
function slScheduleCountInClick(ctx, atTime) {
  const peak = 0.9 * fbMasterGain() * fbSoundGain('countIn');
  if (peak <= 0) return; // muted — skip node creation entirely (matches speed-trainer.js's own click)
  const dur = 0.035;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2500; // sharp/dry, not a boomy thud
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, atTime);
  gain.gain.exponentialRampToValueAtTime(0.001, atTime + dur);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(atTime);
  noise.stop(atTime + dur + 0.01);
}

// Schedules slCountInClickCount() clicks, evenly spaced one beat apart, then
// calls the real audioEl.play() exactly one beat after the last click — so
// the click pulse flows straight into the recording at a steady tempo,
// whether that's into the pickup bar's own beats or into bar 1 proper.
function slStartCountIn() {
  const el = slState.els.audioEl;
  const ctx = slCountInAudioCtx();
  const secPerBeat = slSecPerBeat();
  const clicks = slCountInClickCount();
  const startDelay = 0.05; // headroom so the very first click isn't scheduled at/before ctx.currentTime
  slState.countInPending = true;
  setTransportState('playing'); // audioEl.play() hasn't fired yet — its own 'play' listener won't flip this for us until the pre-roll ends
  for (let i = 0; i < clicks; i++) {
    slScheduleCountInClick(ctx, ctx.currentTime + startDelay + i * secPerBeat);
  }
  slCountInTimeoutId = setTimeout(() => {
    slCountInTimeoutId = null;
    slState.countInPending = false;
    el.play();
  }, (startDelay + clicks * secPerBeat) * 1000);
}

function slPlay() {
  if (!slState.duration || !slState.els.audioEl) return;
  if (slState.countInPending) return; // pre-roll already running — ignore repeat triggers (spacebar, double-click)
  const el = slState.els.audioEl;
  // "The very beginning" = currentTime ~0, not just "currently paused" — a
  // mid-song Pause/Resume (or Resume, which reuses this same function) must
  // never trigger a count-in. The small threshold (rather than === 0) is
  // slop for float/sample-rate quantization on a seek, same reasoning as
  // slTimeToBar's epsilon.
  if (slState.countInEnabled && el.paused && el.currentTime < 0.05) {
    slStartCountIn();
    return;
  }
  el.play();
}
function slPause() {
  if (!slState.els.audioEl) return;
  slCancelCountIn();
  slState.els.audioEl.pause();
  setTransportState('paused');
}
function slStop() {
  if (!slState.els.audioEl) return;
  slCancelCountIn();
  slState.els.audioEl.pause();
  slState.els.audioEl.currentTime = slState.loopOn ? slBarToTime(slState.loopFromBar) : 0;
  setTransportState('stopped');
}

// Entry point for Licks' "🎧 Practice with Song Loop" button — call after
// showPage('songloop') (which already calls initSongLoopPage(), so this one
// is just a safety net for callers that haven't shown the page yet).
// `label` is an optional clean display name (e.g. the Markdown link text) —
// without it, the displayed/sidecar filename falls back to whatever's in
// the URL itself, which for a materials-library URL is the timestamp-
// prefixed on-disk filename, not the original.
async function slLoadFromUrl(url, label) {
  initSongLoopPage();
  await slState.loadFileFromUrl(url, label);
}

// ── page init — all DOM access lives below this line, guarded so revisiting
// the page doesn't stack duplicate listeners (same pattern as Speed
// Trainer's initSpeedPage). ────────────────────────────────────────────────
// ── hoisted from initSongLoopPage (mechanical refactor — no behavior change) ──
// 以下函数原属于 initSongLoopPage 的嵌套函数，提升为模块级；DOM 访问只在调用时
// 发生（模块加载 / Node require 时无副作用）。它们引用的 els 和下面的状态变量
// 由 initSongLoopPage 赋值一次（slState.inited 重入守卫保证单例，语义不变）。
let els = null; // 在 initSongLoopPage 里赋值（同时镜像到 slState.els）；模块级是为了让下面提升上来的函数引用
let rowsByBar = new Map(); // rebuilt each renderBarGrid() call — bar -> [cells for that bar across rows]
let lastHighlightedBar = null;
// True while an input/select/textarea inside the bar grid has focus (typing
// a chord/lyric/track cell, picking a phrase label, renaming a track).
// During playback the currently-playing bar auto-recenters the grid every
// time it changes (scrollGridToBar below) — left unchecked, that scroll
// fires right out from under whatever the user is mid-click/mid-type on,
// which reads as "my focus keeps getting stolen by the playing bar".
let gridEditActive = false;
let fileLabel = { name: '', sampleRate: 0 };
let sidecarHandle = null; // FileSystemFileHandle from the first showSaveFilePicker save this track — reused so later saves overwrite silently instead of re-prompting
let loadGeneration = 0; // bumped on every loadFile() call, so a stale in-flight upload from a since-replaced track can detect it's obsolete and bail out
// Time-axis ticks along the bottom of the overview waveform. Picks the
// coarsest step from this list that still gives at least ~8 ticks across
// the track, so a 30s clip and a 6min song both get a readable, not
// overcrowded, ruler.
const SL_RULER_STEPS_SEC = [5, 10, 15, 30, 60, 120, 300, 600];
// ── per-URL state: debounced write to the server, read on load ──────────
// Writes: coalesce rapid edits (typing a lyric, dragging a slider) into
// one PUT after 600ms of quiet. url+payload are snapshotted at *schedule*
// time, not when the timer fires — otherwise switching tracks mid-debounce
// would write the new track's data under the old track's url.
let urlStateSaveTimer = null;
let loopGuardTimerId = null;

// ── the hoisted functions, in their original order ──────────────────────
function applyPrefsToUI() {
  els.speedSlider.value = slState.speed;
  els.speedNum.value = slState.speed;
  els.zoomSlider.value = slState.zoomPxPerBar;
  els.zoomNum.value = slState.zoomPxPerBar;
  els.barTickStepInput.value = slState.barTickStep;
  els.loopFromInput.value = slState.loopFromBar;
  els.loopToInput.value = slState.loopToBar;
  els.loopToggle.checked = slState.loopOn;
  els.keySelect.value = slState.key;
  els.bpmInput.value = slState.bpm;
  els.startBarNumInput.value = slState.startBarNumber;
  els.pickupBeatsInput.value = slState.pickupBeats;
  els.countInToggle.checked = slState.countInEnabled;
  els.chordDiagramToggle.checked = slState.showChordDiagram;
  updateSpeedBpmReadout();
  updateLoopPanelStyle();
  updatePitchLabel();
  updateKeyTag();
  updateBpmTag();
  updatePhrasePanelStyle();
  updatePhraseReadout();
  updateChordDiagramPanel();
  updateLyricNeteaseLink();
}

// Reflects slState.lyricSongId into both the input (so re-opening a track
// doesn't force looking the id up again) and the "在网易云打开" link.
function updateLyricNeteaseLink() {
  const id = slState.lyricSongId;
  els.lyricSongIdInput.value = id || '';
  if (id) {
    els.lyricNeteaseLink.href = `https://music.163.com/#/song?id=${encodeURIComponent(id)}`;
    els.lyricNeteaseLink.classList.remove('hidden');
  } else {
    els.lyricNeteaseLink.classList.add('hidden');
  }
}

function updatePitchLabel() { els.pitchLabel.textContent = slPitchLabelFor(slState.pitch); }
function updateKeyTag() {
  els.keySelect.classList.remove('invalid');
  els.keyTag.textContent = slState.keyManual ? '手动指定' : '默认';
}
function updateBpmTag() { els.bpmTag.textContent = slState.bpmManual ? '已手动校准' : '默认'; }
function updateLoopPanelStyle() {
  els.loopPanel.classList.toggle('gp-loop-on', slState.loopOn);
  els.loopHint.textContent = slState.loopOn ? '在区间内不断循环，直到关闭' : '关闭时正常播放全曲';
}

function updateTimeReadout() {
  els.timeReadout.textContent = slFmtTime(els.audioEl.currentTime) + ' / ' + slFmtTime(slState.duration);
}

function updateOffsetReadout() {
  const beats = (slState.bar1TimeSec / slSecPerBar()) * slState.beatsPerBar;
  const bars = beats / slState.beatsPerBar;
  const beatText = `${beats >= 0 ? '+' : ''}${Math.round(beats * 100) / 100}`;
  const barText = `${bars >= 0 ? '+' : ''}${Math.round(bars * 100) / 100}`;
  els.offsetReadout.textContent = beats === 0 ? '0 拍' : `${beatText} 拍 (${barText} 小节)`;
}

function updatePhrasePanelStyle() {
  els.phrasePanel.classList.toggle('gp-phrase-on', slState.selectedPhraseStartBar != null);
}

function updatePhraseReadout() {
  if (slState.selectedPhraseStartBar == null) {
    els.phraseReadout.textContent = '尚未选择段落';
    return;
  }
  const label = annotationFor(slState.selectedPhraseStartBar).label;
  els.phraseReadout.textContent = `当前段落：第 ${slState.selectedPhraseStartBar} 小节` + (label ? ` · ${label}` : '');
}

// Table of contents: lists every 段落 with its label and bar span so the
// whole song's structure is visible at a glance, and clicking a row jumps
// playback there the same way clicking a bar number does (seekToBar).
function renderTocList() {
  const sections = slPhraseSections(slState.phraseStarts, slState.annotations, slState.startBarNumber, slTotalBars());
  els.tocList.innerHTML = sections.map((s) => {
    const label = s.label || '未命名';
    const color = slPhraseLabelColor(s.label);
    const dotStyle = s.label ? `background:${color}` : 'background:rgba(43,38,33,.2)';
    return `<button type="button" class="gp-toc-item" data-bar="${s.bar}">` +
      `<span class="gp-toc-item-dot" style="${dotStyle}"></span>` +
      `<span class="gp-toc-item-label">${htmlEsc(label)}</span>` +
      `<span class="gp-toc-item-bars">第 ${s.bar} 小节起 · 共 ${s.barCount} 小节</span>` +
      `</button>`;
  }).join('') || '<div class="gp-toc-empty">还没有段落标记</div>';
}

function closeTocList() {
  els.tocList.hidden = true;
  document.removeEventListener('mousedown', onTocOutsideClick, true);
}

function onTocOutsideClick(e) {
  if (!els.tocList.contains(e.target) && e.target !== els.tocToggle) closeTocList();
}

function toggleTocList() {
  if (!els.tocList.hidden) { closeTocList(); return; }
  renderTocList();
  els.tocList.hidden = false;
  setTimeout(() => document.addEventListener('mousedown', onTocOutsideClick, true), 0);
}

function updateSidecarHint(msg) {
  if (!els.sidecarHint) return;
  els.sidecarHint.textContent = msg;
}

function normalizePhraseStarts() {
  slState.phraseStarts = slNormalizePhraseStarts(slState.phraseStarts);
  if (slState.selectedPhraseStartBar != null && !slState.phraseStarts.includes(slState.selectedPhraseStartBar)) {
    slState.selectedPhraseStartBar = slState.phraseStarts[slState.phraseStarts.length - 1];
  }
  if (slState.selectedPhraseStartBar == null) slState.selectedPhraseStartBar = slState.phraseStarts[0];
}

function isPhraseStart(bar) {
  return slState.phraseStarts.includes(bar);
}

function selectPhraseStart(bar) {
  if (!slState.phraseStarts.includes(bar)) return;
  slState.selectedPhraseStartBar = bar;
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderBarGrid();
  slSaveCurrentFileState();
}

function addPhraseStartAt(bar, label = '') {
  const roundedBar = Math.max(slState.startBarNumber, Math.round(bar));
  slState.phraseStarts.push(roundedBar);
  normalizePhraseStarts();
  annotationFor(roundedBar).label = label;
  slState.selectedPhraseStartBar = roundedBar;
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderBarGrid();
  slSaveCurrentFileState();
}

function setPhraseLabel(bar, label) {
  annotationFor(bar).label = label;
  renderBarGrid();
  slSaveCurrentFileState();
}

function removePhraseStartAt(bar) {
  slState.phraseStarts = slState.phraseStarts.filter(b => b !== bar);
  normalizePhraseStarts();
  if (slState.selectedPhraseStartBar === bar) {
    slState.selectedPhraseStartBar = slState.phraseStarts[0] ?? null;
  }
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderBarGrid();
  slSaveCurrentFileState();
}

function shiftSelectedPhraseStart(deltaBars) {
  if (slState.selectedPhraseStartBar == null) return;
  const next = Math.max(slState.startBarNumber, slState.selectedPhraseStartBar + deltaBars);
  slState.phraseStarts = slState.phraseStarts.map(b => (b === slState.selectedPhraseStartBar ? next : b));
  normalizePhraseStarts();
  slState.selectedPhraseStartBar = next;
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderBarGrid();
  slSaveCurrentFileState();
}

function removeSelectedPhraseStart() {
  if (slState.selectedPhraseStartBar == null) return;
  removePhraseStartAt(slState.selectedPhraseStartBar);
}

// ── custom tracks (renamable/removable text rows below 和弦/歌词) ────────
function addCustomTrack() {
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  slState.customTracks.push({ id, name: '新轨道' });
  renderBarGrid();
  slSaveCurrentFileState();
}

function renameCustomTrack(id, name) {
  const track = slState.customTracks.find(t => t.id === id);
  if (!track) return;
  track.name = name;
  renderBarGrid();
  slSaveCurrentFileState();
}

function removeCustomTrack(id) {
  const track = slState.customTracks.find(t => t.id === id);
  if (!track) return;
  if (!confirm(`删除轨道"${track.name}"？这会清掉这条轨道在所有小节里填的内容。`)) return;
  slState.customTracks = slState.customTracks.filter(t => t.id !== id);
  renderBarGrid();
  slSaveCurrentFileState();
}

function shiftBar1ByBeats(deltaBeats) {
  slState.bar1TimeSec += deltaBeats * (slSecPerBar() / slState.beatsPerBar);
  updateOffsetReadout();
  renderBarGrid();
  updateWaveOverlays();
  slSaveCurrentFileState();
}

function setBar1ToCurrentTime() {
  slState.bar1TimeSec = els.audioEl.currentTime;
  updateOffsetReadout();
  renderBarGrid();
  updateWaveOverlays();
  updateTimeReadout();
  updateBarGridHighlight();
  slSaveCurrentFileState();
}

// ── waveform: real per-segment peak amplitude, rendered as plain DOM bars
// (not canvas) — matches the ported design's own markup and sidesteps the
// devicePixelRatio class of bug a canvas-based waveform is prone to. ─────
function computePeaks(barCount) {
  const data = slState.channelData;
  const samplesPerBar = Math.max(1, Math.floor(data.length / barCount));
  const peaks = new Array(barCount);
  for (let i = 0; i < barCount; i++) {
    let peak = 0;
    const start = i * samplesPerBar, end = Math.min(start + samplesPerBar, data.length);
    for (let j = start; j < end; j++) { const v = Math.abs(data[j]); if (v > peak) peak = v; }
    peaks[i] = peak;
  }
  return peaks;
}

function renderWaveBars() {
  const count = 48;
  slState.peaks = computePeaks(count);
  els.waveBars.innerHTML = slState.peaks.map(p => {
    const h = Math.max(6, Math.round(p * 90));
    return `<div class="gp-wave-bar" style="height:${h}%"></div>`;
  }).join('');
  renderWaveRuler();
}

function renderWaveRuler() {
  if (slState.duration <= 0) { els.waveRuler.innerHTML = ''; return; }
  const target = slState.duration / 8;
  const step = SL_RULER_STEPS_SEC.find(s => s >= target) || SL_RULER_STEPS_SEC[SL_RULER_STEPS_SEC.length - 1];
  const ticks = [];
  for (let t = 0; t <= slState.duration; t += step) {
    const pct = (t / slState.duration) * 100;
    ticks.push(`<div class="gp-wave-tick" style="left:${pct}%">${slFmtTime(t)}</div>`);
  }
  els.waveRuler.innerHTML = ticks.join('');
}

// Small colored dots on the overview waveform marking which bars have a
// 段落/label — lets you see the song's section structure (and roughly
// which type, via color) without switching to the zoomed-in bar grid below.
function renderWaveLabelMarkers() {
  if (slState.duration <= 0) { els.waveLabels.innerHTML = ''; return; }
  els.waveLabels.innerHTML = slState.phraseStarts.map((bar) => {
    const label = annotationFor(bar).label;
    if (!label) return '';
    const pct = Math.min(100, Math.max(0, (slBarToTime(bar) / slState.duration) * 100));
    const color = slPhraseLabelColor(label);
    return `<div class="gp-wave-label-dot" style="left:${pct}%;background:${color}" title="第 ${bar} 小节 · ${htmlEsc(label)}"></div>`;
  }).join('');
}

// Bar-number ticks on the overview waveform, every slState.barTickStep
// bars (default 4 — most songs phrase in 4-bar lines, so 1/5/9/... lines
// the ticks up with where a new line usually starts). Depends on
// bpm/offset (via slBarToTime/slTotalBars), not just duration, so it's
// rendered from renderBarGrid() — the same place already re-run on every
// bpm/offset change — rather than alongside the duration-only
// renderWaveRuler().
function renderWaveBarTicks() {
  if (slState.duration <= 0) { els.waveBarTicks.innerHTML = ''; return; }
  const total = slTotalBars();
  const step = slState.barTickStep;
  const ticks = [];
  for (let bar = slState.startBarNumber; bar < slState.startBarNumber + total; bar += step) {
    const pct = Math.min(100, Math.max(0, (slBarToTime(bar) / slState.duration) * 100));
    ticks.push(`<div class="gp-wave-bar-tick" style="left:${pct}%">${bar}</div>`);
  }
  els.waveBarTicks.innerHTML = ticks.join('');
}

function updateWaveOverlays() {
  if (slState.duration <= 0) return;
  const total = slTotalBars();
  if (slState.loopOn) {
    const leftPct = ((slState.loopFromBar - slState.startBarNumber) / total) * 100;
    const widthPct = ((slState.loopToBar - slState.loopFromBar) / total) * 100;
    els.waveLoop.style.left = leftPct + '%';
    els.waveLoop.style.width = widthPct + '%';
    els.waveLoop.classList.remove('hidden');
  } else {
    els.waveLoop.classList.add('hidden');
  }
  const pct = Math.min(100, (els.audioEl.currentTime / slState.duration) * 100);
  els.wavePlayhead.style.left = pct + '%';
  els.wavePlayheadTime.textContent = slFmtTime(els.audioEl.currentTime);
  els.wavePlayheadTime.style.left = pct + '%';
  // Flip the label off the line near either edge so it can't clip against
  // .gp-wave's overflow:hidden (thresholds are rough label-width guesses,
  // not measured — good enough since the label is short and monospace).
  els.wavePlayheadTime.classList.toggle('gp-wave-playhead-time--left', pct < 6);
  els.wavePlayheadTime.classList.toggle('gp-wave-playhead-time--right', pct > 94);
}

// Shows, as a box on the always-full-song overview waveform, which slice
// of the (independently zoomable/scrollable) bar grid below is visible.
function updateWaveViewportBox() {
  if (slState.duration <= 0) { els.waveViewport.classList.add('hidden'); return; }
  const { leftPct, widthPct } = slComputeViewportBox(
    els.barGrid.scrollLeft, els.barGrid.clientWidth, slState.zoomPxPerBar, 92, slTotalBars()
  );
  if (widthPct >= 100) { els.waveViewport.classList.add('hidden'); return; }
  els.waveViewport.classList.remove('hidden');
  els.waveViewport.style.left = leftPct + '%';
  els.waveViewport.style.width = widthPct + '%';
}

// ── bar grid: click the bar number to seek; click elsewhere in the cell
// to edit the bar's chord/lyric metadata. That keeps seeking on the
// least ambiguous hit target and makes the rest of the row feel like an
// editing surface instead of a transport button. ───────────────────────
function annotationFor(bar) {
  return slState.annotations[bar] || (slState.annotations[bar] = { chord: '', lyric: '', label: '' });
}

function seekToBar(bar) {
  els.audioEl.currentTime = slBarToTime(bar);
  updateTimeReadout();
  updateWaveOverlays();
  updateBarGridHighlight();
}

// Updates every rendered chord input's displayed value/style in place —
// no DOM removal, so it's safe to call from a blur handler without risking
// the cell the user just clicked into next. Skips document.activeElement
// (the cell currently being edited keeps showing its raw "=N"/literal text).
function refreshChordDisplays() {
  els.barGrid.querySelectorAll('.gp-track-chord').forEach((input) => {
    if (input === document.activeElement) return;
    const bar = parseInt(input.dataset.bar, 10);
    const resolved = slResolveChordRef(bar, slState.annotations);
    input.value = resolved.value;
    input.classList.remove('gp-track-chord-ref', 'gp-track-chord-ref-broken');
    if (resolved.broken) input.classList.add('gp-track-chord-ref-broken');
    else if (resolved.isRef) input.classList.add('gp-track-chord-ref');
  });
  updateChordDiagramPanel();
}

// Shows a fingering diagram for every chord in the song at once — fixed,
// not tied to playback position, so it neither moves nor resizes as bars
// go by (that per-bar version used to reflow/jitter the layout below it
// every time the current chord's name or "unsupported" state changed
// height). Only covers major/minor/7/maj7/m7 (SL_CHORD_SHAPE_TABLE);
// anything else parses fine but has no shape, shown as "not supported".
function updateChordDiagramPanel() {
  const on = slState.showChordDiagram;
  els.chordDiagramBox.classList.toggle('hidden', !on);
  if (!on || slState.duration <= 0) { els.chordDiagramBox.innerHTML = ''; return; }
  const chords = slSongChordList(slState.annotations, slState.startBarNumber, slTotalBars());
  if (!chords.length) {
    els.chordDiagramBox.innerHTML = '<div class="gp-chord-diagram-empty">还没有填写和弦</div>';
    return;
  }
  els.chordDiagramBox.innerHTML = '';
  chords.forEach((chordText) => {
    const card = document.createElement('div');
    card.className = 'gp-chord-diagram-card';
    const title = document.createElement('div');
    title.className = 'gp-chord-diagram-card-title';
    title.textContent = chordText;
    card.appendChild(title);
    const diagramWrap = document.createElement('div');
    const parsed = slParseChordSymbol(chordText);
    const picked = parsed && slChordDiagramFor(parsed.rootPc, parsed.quality);
    if (picked) fbRenderShapeBox(diagramWrap, picked.shape, picked.barreFret);
    else diagramWrap.innerHTML = '<div class="gp-chord-diagram-empty">暂不支持</div>';
    card.appendChild(diagramWrap);
    els.chordDiagramBox.appendChild(card);
  });
}

// Mirrors refreshChordDisplays() for the 级数 row — called whenever a
// chord, a roman-numeral cell, or the key changes, so both tracks stay in
// sync without a full renderBarGrid() rebuild (which would lose focus).
function refreshRomanDisplays() {
  els.barGrid.querySelectorAll('.gp-track-roman').forEach((input) => {
    if (input === document.activeElement) return;
    const bar = parseInt(input.dataset.bar, 10);
    const resolved = slResolveChordRef(bar, slState.annotations);
    // Blurred: bare degree number only (quick glance — 和弦 row already
    // spells the chord out). Focused (see the row's own focus handler)
    // shows the full roman-numeral text, which is what's actually editable.
    input.value = slRomanDegreeDigit(slChordToRoman(resolved.value, slState.key));
    input.classList.remove('gp-track-roman-invalid');
  });
}

function renderBarGrid() {
  els.barGrid.innerHTML = '';
  rowsByBar = new Map();
  lastHighlightedBar = null;
  if (slState.duration <= 0) {
    els.barGridEmpty.classList.remove('hidden'); els.barFooter.textContent = '';
    renderWaveLabelMarkers();
    renderWaveBarTicks();
    return;
  }
  els.barGridEmpty.classList.add('hidden');

  const total = slTotalBars();
  els.barGrid.style.setProperty('--sl-bar-count', total);
  els.barGrid.style.setProperty('--sl-bar-width', slState.zoomPxPerBar + 'px');
  const board = document.createElement('div');
  board.className = 'gp-track-board';

  function addRowWithLabel(labelEl, cellFactory) {
    board.appendChild(labelEl);
    for (let bar = slState.startBarNumber; bar < slState.startBarNumber + total; bar++) {
      const cell = cellFactory(bar);
      const bucket = rowsByBar.get(bar) || [];
      bucket.push(cell);
      rowsByBar.set(bar, bucket);
      board.appendChild(cell);
    }
  }

  function addRow(labelText, rowClass, cellFactory) {
    const label = document.createElement('div');
    label.className = rowClass === 'ruler' ? 'gp-track-ruler-label' : 'gp-track-label';
    label.textContent = labelText;
    addRowWithLabel(label, cellFactory);
  }

  // Just bar number + click-to-seek — this row is the local x-axis for the
  // zoomed-in board below (the top overview waveform has its own, separate
  // coordinate space, see renderWaveRuler/renderWaveLabelMarkers). Label
  // text/editing lives only in the 句首 row below; a labeled bar only gets
  // a small color dot here, not a repeat of the badge.
  addRow('小节', 'ruler', (bar) => {
    const cell = document.createElement('div');
    cell.className = 'gp-track-cell gp-track-ruler-cell';
    const numEl = document.createElement('div');
    numEl.className = 'gp-bar-num';
    numEl.textContent = bar;
    numEl.title = '点击跳到这一小节';
    cell.appendChild(numEl);
    // Position within the most recent *labeled* 句首 section (e.g. bar 11
    // under a "主歌" marker at bar 9 shows "3" — the 3rd bar of that 主歌).
    const relNum = slBarRelativeToLabel(bar, slState.phraseStarts, slState.annotations);
    if (relNum != null) {
      const relEl = document.createElement('div');
      relEl.className = 'gp-bar-rel-num';
      relEl.textContent = '·' + relNum;
      relEl.title = '在当前段落标签内的相对小节数';
      cell.appendChild(relEl);
    }
    if (slState.pickupBeats > 0 && bar === slState.startBarNumber) {
      cell.classList.add('gp-bar-pickup');
      const pickupTag = document.createElement('div');
      pickupTag.className = 'gp-bar-pickup-tag';
      pickupTag.textContent = `弱起 · ${slState.pickupBeats}拍`;
      cell.appendChild(pickupTag);
    }
    const label = isPhraseStart(bar) && annotationFor(bar).label;
    if (label) {
      const dot = document.createElement('div');
      dot.className = 'gp-bar-label-dot';
      dot.style.background = slPhraseLabelColor(label);
      dot.title = label;
      cell.appendChild(dot);
    }
    cell.addEventListener('click', () => seekToBar(bar));
    return cell;
  });

  // Opens a label picker inline in `cell`: a small button panel — one
  // button per SL_PHRASE_LABEL_PRESETS entry, plus "自定义…" which swaps to
  // a text <input>. Deliberately NOT a native <select>: that turned out
  // unreliable here (real clicks on it bubbled to the ghost cell's own
  // click listener and re-triggered this whole function mid-interaction,
  // wiping the just-opened dropdown out from under the user). Plain
  // buttons keep the whole interaction inside DOM/CSS we fully control.
  // `onCommit` fires with the trimmed label once picked/typed; Escape or
  // clicking outside the panel cancels back to whatever was showing before.
  function openPhraseLabelPicker(cell, currentLabel, onCommit) {
    cell.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'gp-phrase-label-panel';

    function cleanup() {
      document.removeEventListener('mousedown', onOutsideClick, true);
    }
    function commit(value) {
      cleanup();
      onCommit(value);
    }
    function cancel() {
      cleanup();
      renderBarGrid();
    }
    function onOutsideClick(e) {
      if (!panel.contains(e.target)) cancel();
    }

    SL_PHRASE_LABEL_PRESETS.forEach(label => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gp-phrase-label-option';
      btn.textContent = label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); commit(label); });
      panel.appendChild(btn);
    });

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'gp-phrase-label-option gp-phrase-label-custom-btn';
    customBtn.textContent = '自定义…';
    customBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'gp-phrase-label-input';
      input.placeholder = '输入标签，回车确认';
      input.value = SL_PHRASE_LABEL_PRESETS.includes(currentLabel) ? '' : currentLabel;
      input.addEventListener('keydown', (e2) => {
        e2.stopPropagation();
        if (e2.key === 'Enter') {
          const val = input.value.trim();
          if (val) commit(val); else cancel();
        } else if (e2.key === 'Escape') cancel();
      });
      input.addEventListener('click', (e2) => e2.stopPropagation());
      panel.appendChild(input);
      input.focus();
    });
    panel.appendChild(customBtn);

    cell.appendChild(panel);
    // Deferred so the very click that opened this panel (still bubbling at
    // the moment appendChild runs) isn't immediately seen as "outside".
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
  }

  addRow('段落', 'phrase', (bar) => {
    const cell = document.createElement('div');
    cell.className = 'gp-track-cell gp-track-phrase-cell';
    if (isPhraseStart(bar)) {
      cell.title = '点文字改标签 · 点 × 取消标记';
      const label = annotationFor(bar).label;
      const badge = document.createElement('div');
      badge.className = 'gp-bar-phrase-badge-inline' + (slState.selectedPhraseStartBar === bar ? ' active' : '');
      const labelBtn = document.createElement('button');
      labelBtn.type = 'button';
      labelBtn.className = 'gp-bar-phrase-label-btn';
      labelBtn.textContent = label || '段落';
      labelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Select without the usual renderBarGrid() (selectPhraseStart does
        // that) — the picker below is about to take over this exact `cell`
        // node, so a full grid rebuild here would yank it out from under us.
        if (slState.phraseStarts.includes(bar)) {
          slState.selectedPhraseStartBar = bar;
          updatePhrasePanelStyle();
          updatePhraseReadout();
        }
        openPhraseLabelPicker(cell, label, (newLabel) => setPhraseLabel(bar, newLabel));
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'gp-bar-phrase-remove';
      remove.textContent = '×';
      remove.title = '取消这个标记';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removePhraseStartAt(bar);
      });
      badge.appendChild(labelBtn);
      badge.appendChild(remove);
      cell.appendChild(badge);
    } else {
      cell.title = '点击这一格添加段落标签';
      const ghost = document.createElement('div');
      ghost.className = 'gp-track-ghost';
      ghost.textContent = '点这里';
      cell.appendChild(ghost);
      cell.addEventListener('click', () => {
        openPhraseLabelPicker(cell, '', (newLabel) => addPhraseStartAt(bar, newLabel));
      });
    }
    return cell;
  });

  addRow('和弦', 'chord', (bar) => {
    const ann = annotationFor(bar);
    const cell = document.createElement('div');
    cell.className = 'gp-track-cell';
    const input = document.createElement('input');
    input.type = 'text';
    input.title = '直接打和弦；输入 "=5" 表示和第 5 小节一样';
    input.dataset.bar = bar;
    const resolved = slResolveChordRef(bar, slState.annotations);
    input.className = 'gp-track-field gp-track-chord'
      + (resolved.broken ? ' gp-track-chord-ref-broken' : resolved.isRef ? ' gp-track-chord-ref' : '');
    input.placeholder = '和弦';
    input.value = resolved.value; // shows the resolved chord until focused
    input.addEventListener('focus', () => { input.value = ann.chord; }); // reveal the raw "=N" (or literal) on edit
    input.addEventListener('input', () => { ann.chord = input.value; refreshRomanDisplays(); slSaveCurrentFileState(); });
    // In-place refresh (not renderBarGrid, which tears down and rebuilds
    // every cell) — a full rebuild here would risk detaching whatever cell
    // the user's next click already landed on if they click straight from
    // one chord cell into another, since blur fires before that click completes.
    input.addEventListener('blur', () => { refreshChordDisplays(); refreshRomanDisplays(); });
    cell.addEventListener('click', () => input.focus());
    cell.appendChild(input);
    return cell;
  });

  addRow('级数', 'roman', (bar) => {
    const ann = annotationFor(bar);
    const cell = document.createElement('div');
    cell.className = 'gp-track-cell';
    const input = document.createElement('input');
    input.type = 'text';
    input.title = '按当前"调"把和弦换算成级数记法（如 V7、ii7、bVII）；改这里会反向把上面的和弦重新算出来。未聚焦时只显示级数数字';
    input.dataset.bar = bar;
    input.className = 'gp-track-field gp-track-roman';
    input.placeholder = '级数';
    input.value = slRomanDegreeDigit(slChordToRoman(slResolveChordRef(bar, slState.annotations).value, slState.key));
    // Focused: reveal the full roman-numeral text (what's actually
    // editable/round-trips through slRomanToChord) — same reveal-raw-on-
    // focus pattern as the 和弦 row above.
    input.addEventListener('focus', () => {
      input.value = slChordToRoman(slResolveChordRef(bar, slState.annotations).value, slState.key);
    });
    input.addEventListener('input', () => {
      const chordText = slRomanToChord(input.value, slState.key);
      if (chordText === null) { input.classList.add('gp-track-roman-invalid'); return; }
      ann.chord = chordText;
      input.classList.remove('gp-track-roman-invalid');
      refreshChordDisplays();
      refreshRomanDisplays();
      slSaveCurrentFileState();
    });
    // Same in-place-refresh reasoning as the chord row's own blur handler
    // above — and this also self-heals an invalid in-progress edit back to
    // whatever roman numeral the (untouched) underlying chord resolves to.
    input.addEventListener('blur', () => { refreshChordDisplays(); refreshRomanDisplays(); });
    cell.addEventListener('click', () => input.focus());
    cell.appendChild(input);
    return cell;
  });

  addRow('歌词', 'lyric', (bar) => {
    const ann = annotationFor(bar);
    const cell = document.createElement('div');
    cell.className = 'gp-track-cell';
    const input = document.createElement('textarea');
    input.className = 'gp-track-field gp-track-lyric';
    input.placeholder = '歌词';
    input.value = ann.lyric;
    input.addEventListener('input', () => { ann.lyric = input.value; slSaveCurrentFileState(); });
    cell.addEventListener('click', () => input.focus());
    cell.appendChild(input);
    return cell;
  });

  // Opens an inline rename editor in place of `nameBtn`'s text — an <input>
  // that commits on Enter/blur (empty input cancels, matching the phrase
  // label picker's cancel-on-empty convention above).
  function openTrackRenameEditor(labelEl, track) {
    labelEl.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'gp-track-label-rename';
    input.value = track.name;
    let committed = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        committed = true;
        const val = input.value.trim();
        if (val) renameCustomTrack(track.id, val); else renderBarGrid();
      } else if (e.key === 'Escape') { committed = true; renderBarGrid(); }
    });
    input.addEventListener('blur', () => {
      if (committed) return;
      const val = input.value.trim();
      if (val) renameCustomTrack(track.id, val); else renderBarGrid();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    labelEl.appendChild(input);
    input.focus();
    input.select();
  }

  slState.customTracks.forEach((track) => {
    const label = document.createElement('div');
    label.className = 'gp-track-label gp-track-label-editable';
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'gp-track-label-name';
    nameBtn.textContent = track.name;
    nameBtn.title = '点击改名';
    nameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTrackRenameEditor(label, track);
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'gp-track-label-remove';
    removeBtn.textContent = '×';
    removeBtn.title = '删除这条轨道';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCustomTrack(track.id);
    });
    label.appendChild(nameBtn);
    label.appendChild(removeBtn);

    addRowWithLabel(label, (bar) => {
      const cell = document.createElement('div');
      cell.className = 'gp-track-cell';
      const input = document.createElement('textarea');
      input.className = 'gp-track-field gp-track-custom';
      input.placeholder = track.name;
      input.value = annotationFor(bar)[track.id] || '';
      input.addEventListener('input', () => { annotationFor(bar)[track.id] = input.value; slSaveCurrentFileState(); });
      cell.addEventListener('click', () => input.focus());
      cell.appendChild(input);
      return cell;
    });
  });

  const addTrackRow = document.createElement('div');
  addTrackRow.className = 'gp-track-add-row';
  const addTrackBtn = document.createElement('button');
  addTrackBtn.type = 'button';
  addTrackBtn.className = 'gp-tap-btn';
  addTrackBtn.textContent = '+ 添加轨道';
  addTrackBtn.addEventListener('click', addCustomTrack);
  addTrackRow.appendChild(addTrackBtn);
  board.appendChild(addTrackRow);

  els.barGrid.appendChild(board);
  els.barFooter.textContent = '共 ' + total + ' 小节 · 上排数字负责跳转，段落行可选/打字段落标签（点 × 取消），下方轨道可直接编辑、改名（点行名）、增减（+ 添加轨道 / 点 ×）';
  applyBarGridHighlightClasses();
  updateWaveViewportBox();
  renderWaveLabelMarkers();
  renderWaveBarTicks();
  updateChordDiagramPanel();
}

function applyBarGridHighlightClasses() {
  rowsByBar.forEach((cells, bar) => {
    cells.forEach((cell) => {
      cell.classList.toggle('gp-bar-in-loop', slState.loopOn && bar >= slState.loopFromBar && bar <= slState.loopToBar);
    });
  });
}

function updateBarGridHighlight() {
  const curBar = slTimeToBar(els.audioEl.currentTime);
  if (curBar === lastHighlightedBar) return;
  if (lastHighlightedBar != null && rowsByBar.has(lastHighlightedBar)) {
    rowsByBar.get(lastHighlightedBar).forEach(cell => cell.classList.remove('gp-bar-current'));
  }
  if (rowsByBar.has(curBar)) {
    const cells = rowsByBar.get(curBar);
    cells.forEach(cell => cell.classList.add('gp-bar-current'));
    if (!gridEditActive) scrollGridToBar(curBar, { behavior: 'smooth' });
  }
  lastHighlightedBar = curBar;
}

// Keeps the playhead's bar roughly centered instead of scrollIntoView's
// edge-snap (which, during continuous forward playback, looks like the
// grid staying pinned to the right edge). Only scrolls when the bar's
// cell actually nears an edge, so steady playback doesn't jitter-scroll
// every single bar.
function scrollGridToBar(bar, opts = {}) {
  const cells = rowsByBar.get(bar);
  if (!cells || !cells.length) return;
  const cell = cells[0];
  const container = els.barGrid;
  const cellLeft = cell.offsetLeft, cellRight = cellLeft + cell.offsetWidth;
  const viewLeft = container.scrollLeft, viewWidth = container.clientWidth;
  if (!slShouldRecenter(cellLeft, cellRight, viewLeft, viewWidth)) return;
  const target = slCenterScrollLeft(cellLeft, cell.offsetWidth, viewWidth);
  container.scrollTo({ left: target, behavior: opts.behavior || 'auto' });
}

// ── file loading ──────────────────────────────────────────────────────
function resetForNewTrack(label, sampleRate) {
  fileLabel = { name: label, sampleRate };
  sidecarHandle = null; // new track — don't silently overwrite the previous track's sidecar file
  slState.annotations = {};
  slState.startBarNumber = 1;
  slState.pickupBeats = 0;
  slState.phraseStarts = [1];
  slState.selectedPhraseStartBar = 1;
  slState.bpmManual = false;
  slState.keyManual = false;
  slState.bpm = 96;
  slState.key = SL_KEY_OPTIONS[1];
  slState.tapTimes = [];
  slState.bar1TimeSec = 0;

  els.dropzoneRow.classList.add('hidden');
  els.tapBtn.disabled = false;

  els.bpmInput.value = slState.bpm;
  els.keySelect.value = slState.key;
  normalizePhraseStarts();
  els.bpmInput.value = slState.bpm;
  els.keySelect.value = slState.key;
  els.loopFromInput.value = slState.loopFromBar;
  els.loopToInput.value = slState.loopToBar;
  els.loopToggle.checked = slState.loopOn;
  els.startBarNumInput.value = slState.startBarNumber;
  els.pickupBeatsInput.value = slState.pickupBeats;
  updateKeyTag();
  updateBpmTag();
  updateOffsetReadout();
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderWaveBars();
  updateWaveMeta();
  updateTimeReadout();
  updateWaveOverlays();
  renderBarGrid();
  updateSidecarHint(`将保存为 ${slSidecarFileName(fileLabel.name)}（同目录）`);
  slPrefsSave();
}

function updateWaveMeta() {
  els.waveMeta.textContent = fileLabel.name + ' · ' + slFmtTime(slState.duration) + ' · ' + (fileLabel.sampleRate / 1000).toFixed(1) + 'kHz';
}

function slSidecarDownloadBlob(doc, suggestedName) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveSidecarFile() {
  if (!fileLabel.name) {
    updateSidecarHint('先加载一个 mp3，再保存 sidecar。');
    return;
  }
  const suggestedName = slSidecarFileName(fileLabel.name);
  const doc = slBuildSidecarDocument(fileLabel.name);
  if (window.showSaveFilePicker) {
    try {
      // Only prompt for a location on the first save of this track; every
      // save after that reuses the same handle and just overwrites it —
      // no repeat picker, no extra confirmation.
      if (!sidecarHandle) {
        sidecarHandle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Song Loop sidecar', accept: { 'application/json': ['.json'] } }],
        });
      }
      const writable = await sidecarHandle.createWritable();
      await writable.write(JSON.stringify(doc, null, 2));
      await writable.close();
      updateSidecarHint(`已保存为 ${sidecarHandle.name}（${new Date().toLocaleTimeString('zh-CN', { hour12: false })}）`);
      slSaveCurrentFileState();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      sidecarHandle = null; // handle went stale (e.g. permission revoked) — next click reopens the picker
      updateSidecarHint('保存失败，请重试');
      return;
    }
  }
  slSidecarDownloadBlob(doc, suggestedName);
  updateSidecarHint(`已下载 ${suggestedName}`);
  slSaveCurrentFileState();
}

function applySidecarStateFromText(text, sourceName) {
  const state = slParseSidecarText(text);
  if (!state) {
    updateSidecarHint(`无法解析 ${sourceName || 'sidecar 文件'}`);
    return false;
  }
  slApplyFileStatePayload(state);
  applySpeed();
  normalizePhraseStarts();
  els.bpmInput.value = slState.bpm;
  els.keySelect.value = slState.key;
  els.loopFromInput.value = slState.loopFromBar;
  els.loopToInput.value = slState.loopToBar;
  els.loopToggle.checked = slState.loopOn;
  els.startBarNumInput.value = slState.startBarNumber;
  els.pickupBeatsInput.value = slState.pickupBeats;
  els.speedSlider.value = slState.speed;
  els.speedNum.value = slState.speed;
  updateSpeedBpmReadout();
  updateKeyTag();
  updateBpmTag();
  updateOffsetReadout();
  updatePhrasePanelStyle();
  updatePhraseReadout();
  updateLyricNeteaseLink();
  renderBarGrid();
  updateWaveOverlays();
  slSaveCurrentFileState();
  updateSidecarHint(`已载入 ${sourceName || 'sidecar 文件'}`);
  return true;
}

async function loadSidecarFromFile(file) {
  if (!file) return;
  const text = await file.text();
  applySidecarStateFromText(text, file.name);
}

async function pickAndLoadSidecar() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Song Loop sidecar', accept: { 'application/json': ['.json'] } }],
      });
      if (!handle) return;
      const file = await handle.getFile();
      await loadSidecarFromFile(file);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  els.sidecarInput.click();
}

async function loadFile(file) {
  loadGeneration++; // invalidates any in-flight upload from a track we're replacing
  slState.sourceUrl = null; // cleared until loadFileFromUrl / a successful local upload sets it
  const url = URL.createObjectURL(file);
  els.audioEl.src = url;
  const arrBuf = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const actx = new AudioCtx();
  const decoded = await actx.decodeAudioData(arrBuf.slice(0));
  slState.channelData = decoded.getChannelData(0);
  slState.duration = decoded.duration;
  const sampleRate = decoded.sampleRate;
  actx.close();
  resetForNewTrack(file.name, sampleRate);
}

function scheduleUrlStateSave() {
  if (!slState.sourceUrl) return;
  const url = slState.sourceUrl;
  const payload = slCaptureFileStatePayload();
  clearTimeout(urlStateSaveTimer);
  urlStateSaveTimer = setTimeout(() => pushUrlState(url, payload), 600);
}
async function pushUrlState(url, payload) {
  try {
    const res = await fetch(`${url}/state`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`save failed (${res.status})`);
  } catch (err) {
    updateSidecarHint('自动保存失败（网络问题）· 请稍后重试或用"保存 sidecar"手动备份');
  }
}

// Applies this track's remembered bpm/key/loop/offset/speed/pitch/phrase
// markers/annotations (if any) and refreshes every bit of UI that depends
// on them. Shared by a Lick's materials-library track (loadFileFromUrl)
// and a local file that's already been seen before (loadLocalFile's
// dedupe-hit path) — both end up with the same kind of stable url.
//
// Reads from the server first; if that comes back empty (a brand-new
// material, or a track saved before this state moved server-side), falls
// back to the legacy localStorage copy as a one-time migration seed, then
// pushes it server-side and clears the old key so this only happens once.
async function applySavedUrlStateIfAny(url) {
  let saved = await fetch(`${url}/state`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (saved && Object.keys(saved).length === 0) saved = null;
  if (!saved) {
    const legacy = slReadLegacyUrlState(url);
    if (legacy) {
      saved = legacy;
      pushUrlState(url, legacy);
      localStorage.removeItem(slUrlStateKey(url));
    }
  }
  // "Opened now" needs to be pushed even for a brand-new material with
  // nothing saved yet — the picker's recency sort should count this as
  // practiced starting from this open, not just from the next edit. But
  // it must happen *after* slApplyFileStatePayload(saved) below, not
  // before: capturing/pushing state before restoring `saved` would send
  // the not-yet-restored (still-default) annotations/bpm/etc. and stomp
  // the very data this call is about to restore.
  if (!saved) {
    slState.lastOpenedAt = Date.now();
    pushUrlState(url, slCaptureFileStatePayload());
    return;
  }
  slApplyFileStatePayload(saved);
  applySpeed();
  normalizePhraseStarts();
  applyPrefsToUI();
  updateKeyTag();
  updateBpmTag();
  updateOffsetReadout();
  updatePhrasePanelStyle();
  updatePhraseReadout();
  renderWaveBars();
  renderBarGrid();
  updateWaveOverlays();
  updateTimeReadout();
  // Bypasses the usual 600ms debounce (scheduleUrlStateSave) since this is
  // a one-off on load, not a burst of rapid edits to coalesce — and it's
  // safe to push now that the restored state is what's captured.
  slState.lastOpenedAt = Date.now();
  pushUrlState(url, slCaptureFileStatePayload());
}

// External entry point for a Lick's materials-library backing track (see
// slLoadFromUrl below, module scope) — fetches the URL into a Blob and
// funnels it through the exact same decode/waveform pipeline as a local
// file, then restores this specific track's remembered state, since the
// URL is a stable id.
async function loadFileFromUrl(url, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const blob = await res.blob();
  // Prefer the caller's clean display name — falling back to the URL's
  // own last path segment (e.g. for direct testing/console use) means a
  // materials-library URL's timestamp-prefixed on-disk filename, which is
  // only ever a fallback, not what a caller that has the real name sees.
  const name = label || decodeURIComponent(url.split('/').pop() || 'track');
  await loadFile(new File([blob], name, { type: blob.type }));
  slState.sourceUrl = url;
  await applySavedUrlStateIfAny(url);
  updateSidecarHint('来自素材库 · 改动会自动保存 · 也可用"保存 sidecar"额外导出备份');
}

// Uploads a freshly-picked local file to the same materials library Licks
// uses (POST /api/materials — see web/licks.js's materialUploadAndInsert
// for the same call shape), then treats it exactly like a Lick's track
// from then on: sourceUrl gets set, so every future edit auto-persists.
// Failure (offline, server down, >100MB) leaves sourceUrl null — the
// track still plays fine locally, just falls back to manual "保存
// sidecar" for anything you want to keep across a refresh.
async function registerAsLibraryMaterial(file, dedupeKey) {
  const myGeneration = loadGeneration;
  updateSidecarHint('正在加入素材库…');
  try {
    // Checks by content hash (see materials.js) before actually uploading
    // — a local file that happens to be byte-identical to something
    // already in the library (e.g. the same track picked from a
    // different folder) reuses that url instead of storing a duplicate.
    const existing = typeof mtCheckDuplicateBeforeUpload === 'function'
      ? await mtCheckDuplicateBeforeUpload(file) : null;
    let url;
    if (existing) {
      url = existing.url;
    } else {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/materials', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`upload failed (${res.status})`);
      ({ url } = await res.json());
    }
    if (myGeneration !== loadGeneration) return; // a different track has since been loaded
    slSaveLocalUploadMapEntry(dedupeKey, url);
    slState.sourceUrl = url;
    slState.lastOpenedAt = Date.now(); // counts as "practiced" for the library picker's recency sort
    slSaveCurrentFileState(); // persists the current (default) state under the new url right away
    updateSidecarHint(existing
      ? '已关联到资料库里已有的同名文件 · 改动会自动保存 · 也可用"保存 sidecar"额外导出备份'
      : '已加入素材库 · 改动会自动保存 · 也可用"保存 sidecar"额外导出备份');
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    updateSidecarHint('未加入素材库（离线或上传失败）· 请用"保存 sidecar"手动备份，避免刷新丢失');
  }
}

// Entry point for the local file picker/dropzone. Decodes+plays
// immediately (doesn't wait on the network), then either recognizes the
// file from a previous session (same name+size, see the local-upload
// dedupe map at module scope) and restores its saved state, or uploads it
// as a brand-new materials-library entry.
async function loadLocalFile(file) {
  await loadFile(file);
  const key = slLocalUploadKey(file.name, file.size);
  const knownUrl = slLoadLocalUploadMap()[key];
  if (knownUrl) {
    slState.sourceUrl = knownUrl;
    await applySavedUrlStateIfAny(knownUrl);
    updateSidecarHint('已从素材库恢复上次进度 · 改动会自动保存');
    return;
  }
  await registerAsLibraryMaterial(file, key);
}

// "从资料库选择": lists every audio material regardless of whether any
// Lick links to it (unlike Licks' own material picker, which is really
// for inserting a link into a lick's notes). Reuses licksIsAudioUrl
// (defined in licks.js, loaded on the same page — see the existing
// cross-file precedent already used elsewhere in this app) and the
// existing slLoadFromUrl entry point, so opening a picked track goes
// through the exact same path as Licks' "🎧 Practice with Song Loop".
async function openLibraryPicker() {
  els.libraryModal.classList.add('show');
  els.libraryList.innerHTML = '加载中…';
  try {
    const materials = await (await fetch('/api/materials')).json();
    const audio = materials.filter(m => licksIsAudioUrl(m.url));
    // Sort by "last opened in Song Loop" (see slState.lastOpenedAt), not
    // upload time — this list is for resuming practice, and a file you
    // uploaded weeks ago but practiced yesterday should still float to the
    // top. Materials never opened in Song Loop (no lastOpenedAt on their
    // state) have no such signal, so they keep /api/materials' own
    // upload-time order — Array#sort is stable, so returning 0 for that
    // pair preserves it — but sink below anything with a real timestamp.
    audio.sort((a, b) => {
      const la = a.state && Number.isFinite(a.state.lastOpenedAt) ? a.state.lastOpenedAt : null;
      const lb = b.state && Number.isFinite(b.state.lastOpenedAt) ? b.state.lastOpenedAt : null;
      if (la != null && lb != null) return lb - la;
      if (la != null) return -1;
      if (lb != null) return 1;
      return 0;
    });
    els.libraryList.innerHTML = audio.length
      ? audio.map(m => `<div class="material-picker-item" data-url="${htmlEsc(m.url)}" data-filename="${htmlEsc(m.filename)}">🎧 ${htmlEsc(m.filename)}</div>`).join('')
      : '<p class="empty-state">资料库里还没有音频文件。</p>';
  } catch (e) {
    els.libraryList.innerHTML = '加载失败：' + htmlEsc(e.message);
  }
}
function closeLibraryPicker() {
  els.libraryModal.classList.remove('show');
}

function toggleSpacebarPlay() {
  if (!slState.duration) return;
  if (els.audioEl.paused) slPlay(); else slPause();
}

function seekFromEvent(e) {
  const rect = els.wave.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  els.audioEl.currentTime = frac * slState.duration;
  updateTimeReadout();
  updateWaveOverlays();
  updateBarGridHighlight();
}

// ── speed ─────────────────────────────────────────────────────────────
function applySpeed() {
  els.audioEl.playbackRate = slState.speed / 100;
  els.audioEl.preservesPitch = slState.preservePitch;
  els.audioEl.webkitPreservesPitch = slState.preservePitch;
  els.audioEl.mozPreservesPitch = slState.preservePitch;
}
// Target-BPM is a second, absolute-valued input for the same underlying
// speed% — not a separately persisted field. speed% stays the source of
// truth (matches sl_prefs/per-URL state, both already speed%-shaped); the
// BPM box is just speed% * slState.bpm, kept in sync both directions.
function updateSpeedBpmReadout() {
  els.speedBpmInput.value = Math.round(slState.bpm * slState.speed / 100);
}
function setSpeed(v) {
  v = Math.max(50, Math.min(150, Math.round(v) || 100));
  slState.speed = v;
  els.speedSlider.value = v;
  els.speedNum.value = v;
  updateSpeedBpmReadout();
  applySpeed();
  slPrefsSave();
  slSaveCurrentFileState();
}
function setSpeedFromTargetBpm(targetBpm) {
  if (!Number.isFinite(targetBpm) || targetBpm <= 0 || !slState.bpm) { updateSpeedBpmReadout(); return; }
  setSpeed(Math.round((targetBpm / slState.bpm) * 100));
}

// ── zoom (bar grid horizontal scale — a viewing preference, saved via
// slPrefsSave alongside speed/loopOn, not per-song) ──────────────────────
function setZoom(px) {
  slState.zoomPxPerBar = slClampZoom(px);
  els.zoomSlider.value = slState.zoomPxPerBar;
  els.zoomNum.value = slState.zoomPxPerBar;
  renderBarGrid();
  updateWaveOverlays();
  scrollGridToBar(slTimeToBar(els.audioEl.currentTime), { behavior: 'auto' });
  slPrefsSave();
}
function fitZoomToWidth() {
  setZoom(slFitZoomPxPerBar(slTotalBars(), els.barGrid.clientWidth, 92));
}

function setBpm(v, manual) {
  v = Math.max(40, Math.min(220, Math.round(v) || slState.bpm));
  slState.bpm = v;
  if (manual) slState.bpmManual = true;
  els.bpmInput.value = v;
  updateBpmTag();
  updateSpeedBpmReadout();
  renderWaveBars(); // bar boundaries moved — nothing to redraw for peaks themselves, but overlays/grid depend on them
  renderBarGrid();
  updateWaveOverlays();
  slSaveCurrentFileState();
}

function doTap() {
  const now = Date.now();
  slState.tapTimes = slState.tapTimes.filter(t => now - t < 2500);
  slState.tapTimes.push(now);
  slState.tapTimes = slState.tapTimes.slice(-6);
  if (slState.tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < slState.tapTimes.length; i++) intervals.push(slState.tapTimes[i] - slState.tapTimes[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    setBpm(Math.round(60000 / avg), true);
  }
}

// ── A-B loop ──────────────────────────────────────────────────────────
function readLoopInputs() {
  slState.loopFromBar = Math.max(slState.startBarNumber, parseInt(els.loopFromInput.value) || slState.startBarNumber);
  slState.loopToBar = Math.max(slState.loopFromBar, parseInt(els.loopToInput.value) || slState.loopFromBar);
  els.loopToInput.value = slState.loopToBar;
  slState.loopOn = els.loopToggle.checked;
  updateLoopPanelStyle();
  applyBarGridHighlightClasses();
  updateWaveOverlays();
  if (slState.loopOn && !els.audioEl.paused) startLoopGuard();
  else if (!slState.loopOn) stopLoopGuard();
  slPrefsSave();
  slSaveCurrentFileState();
}

// Pure display/structure preferences for the bar grid's numbering — see
// slFirstFullBarNumber() for how they interact with bar1TimeSec.
function readBarNumberingInputs() {
  const oldFirstFullBar = slFirstFullBarNumber();
  const parsedStart = parseInt(els.startBarNumInput.value, 10);
  slState.startBarNumber = Number.isInteger(parsedStart) ? parsedStart : 1;
  const parsedPickup = parseInt(els.pickupBeatsInput.value, 10);
  slState.pickupBeats = Number.isInteger(parsedPickup)
    ? Math.max(0, Math.min(slState.beatsPerBar - 1, parsedPickup))
    : 0;
  els.startBarNumInput.value = slState.startBarNumber;
  els.pickupBeatsInput.value = slState.pickupBeats;
  slShiftBarKeyedState(slFirstFullBarNumber() - oldFirstFullBar);
  normalizePhraseStarts(); // the valid-bar floor just moved to startBarNumber
  renderBarGrid();
  updateWaveOverlays();
  slSaveCurrentFileState();
}

// Fills a bar range with relative "=N" chord references in one shot — the
// bulk-editing escape hatch so repeated sections (e.g. two verses) don't
// have to be retyped bar by bar. Each target bar still stays independently
// overridable afterward (typing a literal value over it just detaches it).
function applyChordRefBatch() {
  const targetFrom = parseInt(els.chordrefTargetFrom.value, 10);
  const targetTo = parseInt(els.chordrefTargetTo.value, 10);
  const sourceFrom = parseInt(els.chordrefSourceFrom.value, 10);
  if (![targetFrom, targetTo, sourceFrom].every(Number.isInteger) || targetTo < targetFrom) return;
  for (let t = targetFrom; t <= targetTo; t++) {
    annotationFor(t).chord = `=${sourceFrom + (t - targetFrom)}`;
  }
  renderBarGrid();
  slSaveCurrentFileState();
}

// ── main tick loop ────────────────────────────────────────────────────
function enforceLoop() {
  if (!slState.loopOn || slState.duration <= 0 || els.audioEl.paused) return;
  const loopStartTime = slBarToTime(slState.loopFromBar);
  const loopEndTime = slBarToTime(slState.loopToBar + 1);
  if (loopEndTime <= loopStartTime) return;
  if (els.audioEl.currentTime >= loopEndTime) els.audioEl.currentTime = loopStartTime;
}

function startLoopGuard() {
  if (loopGuardTimerId != null) return;
  loopGuardTimerId = setInterval(enforceLoop, 50);
}
function stopLoopGuard() {
  if (loopGuardTimerId == null) return;
  clearInterval(loopGuardTimerId);
  loopGuardTimerId = null;
}
function tick() {
  if (!els.audioEl.paused && slState.duration > 0) {
    enforceLoop();
    updateTimeReadout();
    updateWaveOverlays();
    updateBarGridHighlight();
  }
  requestAnimationFrame(tick);
}

function initSongLoopPage() {
  if (slState.inited) return;
  slState.inited = true;

  const $ = (id) => document.getElementById(id);
  els = slState.els = {
    dropzoneRow: $('sl-dropzone-row'),
    timeReadout: $('sl-time-readout'),
    speedSlider: $('sl-speed-slider'), speedNum: $('sl-speed-num'), speedBpmInput: $('sl-speed-bpm'),
    zoomSlider: $('sl-zoom-slider'), zoomNum: $('sl-zoom-num'), zoomFitBtn: $('sl-zoom-fit'),
    barTickStepInput: $('sl-bar-tick-step'),
    pitchDownBtn: $('sl-pitch-down'), pitchUpBtn: $('sl-pitch-up'), pitchLabel: $('sl-pitch-label'),
    loopPanel: $('sl-loop-panel'), loopToggle: $('sl-loop-toggle'),
    loopFromInput: $('sl-loop-from'), loopToInput: $('sl-loop-to'), loopHint: $('sl-loop-hint'),
    offsetPanel: $('sl-offset-panel'), offsetMinusBar: $('sl-offset-minus-bar'),
    offsetMinusBeat: $('sl-offset-minus-beat'), offsetSetHere: $('sl-offset-set-here'),
    offsetPlusBeat: $('sl-offset-plus-beat'), offsetPlusBar: $('sl-offset-plus-bar'),
    offsetReadout: $('sl-offset-readout'),
    startBarNumInput: $('sl-start-bar-num'), pickupBeatsInput: $('sl-pickup-beats'),
    countInToggle: $('sl-count-in-toggle'),
    phrasePanel: $('sl-phrase-panel'), phraseSetHere: $('sl-phrase-set-here'),
    phrasePrev: $('sl-phrase-prev'), phraseNext: $('sl-phrase-next'),
    phraseClear: $('sl-phrase-clear'), phraseReadout: $('sl-phrase-readout'),
    tocToggle: $('sl-toc-toggle'), tocList: $('sl-toc-list'),
    chordrefTargetFrom: $('sl-chordref-target-from'), chordrefTargetTo: $('sl-chordref-target-to'),
    chordrefSourceFrom: $('sl-chordref-source-from'), chordrefApply: $('sl-chordref-apply'),
    chordDiagramToggle: $('sl-chord-diagram-toggle'), chordDiagramBox: $('sl-chord-diagram-box'),
    wave: $('sl-wave'), waveMeta: $('sl-wave-meta'), waveLoop: $('sl-wave-loop'),
    waveBars: $('sl-wave-bars'), wavePlayhead: $('sl-wave-playhead'), wavePlayheadTime: $('sl-wave-playhead-time'), waveViewport: $('sl-wave-viewport'),
    waveLabels: $('sl-wave-labels'), waveRuler: $('sl-wave-ruler'), waveBarTicks: $('sl-wave-bar-ticks'),
    keySelect: $('sl-key-select'), keyTag: $('sl-key-tag'),
    bpmInput: $('sl-bpm-input'), bpmTag: $('sl-bpm-tag'), tapBtn: $('sl-tap-btn'),
    barGrid: $('sl-bar-grid'), barGridEmpty: $('sl-bar-grid-empty'), barFooter: $('sl-bar-footer'),
    sidecarSaveBtn: $('sl-sidecar-save'), sidecarLoadBtn: $('sl-sidecar-load'),
    sidecarHint: $('sl-sidecar-hint'), sidecarInput: $('sl-sidecar-input'),
    lyricSongIdInput: $('sl-lyric-song-id'), lyricImportBtn: $('sl-lyric-import-btn'),
    lyricImportHint: $('sl-lyric-import-hint'), lyricNeteaseLink: $('sl-lyric-netease-link'),
    browseLibraryBtn: $('sl-browse-library-btn'), libraryModal: $('sl-library-modal'),
    libraryList: $('sl-library-list'), libraryCloseBtn: $('sl-library-close-btn'),
    audioEl: $('sl-player'),
  };
  // Route playback through the app-wide output-device picker (fb-audio.js)
  // like every other sound this app generates — without this, the <audio>
  // element just plays through the system default regardless of what's
  // selected up top, since HTMLMediaElement.setSinkId() is a separate call
  // from the AudioContext.setSinkId() the metronome/ear-training tones use.
  if (typeof fbRegisterMediaElement === 'function') fbRegisterMediaElement(els.audioEl);

  els.barGrid.addEventListener('focusin', (e) => {
    if (e.target.matches('input, select, textarea')) gridEditActive = true;
  });
  els.barGrid.addEventListener('focusout', (e) => {
    if (e.target.matches('input, select, textarea')) gridEditActive = false;
  });

  $('sl-key-list').innerHTML = SL_KEY_OPTIONS.map(k => `<option value="${htmlEsc(k)}">`).join('');

  els.chordDiagramToggle.addEventListener('change', () => {
    slState.showChordDiagram = els.chordDiagramToggle.checked;
    slPrefsSave();
    updateChordDiagramPanel();
  });
  els.countInToggle.addEventListener('change', () => {
    slState.countInEnabled = els.countInToggle.checked;
    slPrefsSave();
  });

  slState.scheduleUrlStateSave = scheduleUrlStateSave;
  slState.loadFileFromUrl = loadFileFromUrl;
  els.browseLibraryBtn.addEventListener('click', openLibraryPicker);
  els.libraryCloseBtn.addEventListener('click', closeLibraryPicker);
  els.libraryModal.addEventListener('click', (e) => { if (e.target === els.libraryModal) closeLibraryPicker(); });
  els.libraryList.addEventListener('click', (e) => {
    const item = e.target.closest('.material-picker-item');
    if (!item) return;
    closeLibraryPicker();
    slLoadFromUrl(item.dataset.url, item.dataset.filename);
  });

  const fileInput = document.getElementById('sl-file-input');
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadLocalFile(e.target.files[0]); });
  els.sidecarSaveBtn.addEventListener('click', saveSidecarFile);
  els.sidecarLoadBtn.addEventListener('click', pickAndLoadSidecar);
  els.sidecarInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) loadSidecarFromFile(e.target.files[0]);
    e.target.value = '';
  });

  // ── 网易云歌词导入：拉取时间轴 LRC，按每行时间戳分配到最近的小节 ──────────
  let lyricImportInFlight = false;
  els.lyricImportBtn.addEventListener('click', async () => {
    if (lyricImportInFlight) return;
    const songId = els.lyricSongIdInput.value.trim();
    if (!/^\d+$/.test(songId)) { els.lyricImportHint.textContent = '歌曲ID 必须是数字'; return; }
    if (slState.duration <= 0) { els.lyricImportHint.textContent = '请先加载音频（歌词要按时间对到小节），再导入'; return; }
    lyricImportInFlight = true;
    els.lyricImportBtn.disabled = true;
    els.lyricImportHint.textContent = '拉取中…';
    try {
      const res = await fetch(`/api/netease-lyric?song_id=${songId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `请求失败 (${res.status})`);
      const entries = slParseLrc(data.lrc);
      if (entries.length === 0) throw new Error('解析出 0 行歌词，格式可能不对');
      // Full replace, not append — this clears every bar's 歌词 field first,
      // so any manual tweaks made after a previous import (re-aligning a
      // line to the right bar, fixing a mis-transcribed word, …) would be
      // silently lost on a re-sync. Confirm first — but only when there's
      // actually existing lyric content to lose (first-ever import has none).
      const hasExistingLyric = Object.values(slState.annotations).some(ann => ann.lyric);
      if (hasExistingLyric && !confirm('这会替换所有小节现有的歌词内容（包括你手动改过的部分），确定要重新导入吗？')) {
        els.lyricImportHint.textContent = '已取消';
        return;
      }
      Object.values(slState.annotations).forEach((ann) => { ann.lyric = ''; });
      const touchedBars = new Set();
      entries.forEach(({ timeSec, text }) => {
        const bar = slTimeToBar(timeSec);
        if (bar < slState.startBarNumber) return; // before bar 1 (e.g. a 作词/作曲 credit tag at 0:00)
        const ann = annotationFor(bar);
        ann.lyric = ann.lyric ? ann.lyric + '\n' + text : text;
        touchedBars.add(bar);
      });
      slState.lyricSongId = songId;
      updateLyricNeteaseLink();
      renderBarGrid();
      slSaveCurrentFileState();
      els.lyricImportHint.textContent = `已导入 ${entries.length} 行歌词，写入 ${touchedBars.size} 个小节`;
    } catch (err) {
      els.lyricImportHint.textContent = '导入失败：' + err.message;
    } finally {
      lyricImportInFlight = false;
      els.lyricImportBtn.disabled = false;
    }
  });
  ['dragover', 'dragenter'].forEach(ev => els.dropzoneRow.addEventListener(ev, (e) => { e.preventDefault(); els.dropzoneRow.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => els.dropzoneRow.addEventListener(ev, (e) => { e.preventDefault(); els.dropzoneRow.classList.remove('drag'); }));
  els.dropzoneRow.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadLocalFile(f); });
  // clicking the waveform before a file is loaded re-opens the file picker,
  // since the dropzone row hides itself after a track loads (matches the
  // ported design's single always-visible waveform slot)
  els.wave.addEventListener('click', () => { if (!slState.duration) fileInput.click(); });

  // ── transport ─────────────────────────────────────────────────────────
  // Play/Pause/Stop themselves (slPlay/slPause/slStop, module-scope above)
  // are registered with the app-wide floating panel via
  // updateTransportForPage('songloop'). Only 'play' is handled generically
  // here — pause and stop both call audioEl.pause() under the hood, so the
  // native 'pause' event can't tell them apart; slPause/slStop each set
  // their own transport state instead. Natural end-of-track (no explicit
  // pause/stop call) still needs to flip the panel back, hence 'ended' →
  // slStop() (rewinds to the loop/track start, same as a manual Stop).
  els.audioEl.addEventListener('play', () => setTransportState('playing'));
  els.audioEl.addEventListener('ended', () => slStop());

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    if (!document.getElementById('page-songloop')?.classList.contains('active')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    toggleSpacebarPlay();
  });

  // seeking by clicking/dragging the waveform itself
  let scrubbing = false;
  els.wave.addEventListener('pointerdown', (e) => {
    if (!slState.duration) return;
    scrubbing = true;
    els.wave.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  els.wave.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
  els.wave.addEventListener('pointerup', () => { scrubbing = false; });
  els.wave.addEventListener('pointercancel', () => { scrubbing = false; });
  els.speedSlider.addEventListener('input', () => setSpeed(parseInt(els.speedSlider.value)));
  els.speedNum.addEventListener('change', () => setSpeed(parseInt(els.speedNum.value)));
  els.speedBpmInput.addEventListener('change', () => setSpeedFromTargetBpm(parseFloat(els.speedBpmInput.value)));
  els.zoomSlider.addEventListener('input', () => setZoom(parseInt(els.zoomSlider.value)));
  els.zoomNum.addEventListener('change', () => setZoom(parseInt(els.zoomNum.value)));
  els.zoomFitBtn.addEventListener('click', fitZoomToWidth);
  els.barGrid.addEventListener('scroll', () => requestAnimationFrame(updateWaveViewportBox));

  // ── overview waveform's bar-number tick interval (default 4 — see
  // renderWaveBarTicks) — a viewing preference, saved alongside zoom ──────
  els.barTickStepInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(64, parseInt(els.barTickStepInput.value, 10) || slState.barTickStep));
    slState.barTickStep = v;
    els.barTickStepInput.value = v;
    renderWaveBarTicks();
    slPrefsSave();
  });

  // ── pitch (UI-only — see file header) ────────────────────────────────
  els.pitchUpBtn.addEventListener('click', () => { slState.pitch = Math.min(6, slState.pitch + 1); updatePitchLabel(); slSaveCurrentFileState(); });
  els.pitchDownBtn.addEventListener('click', () => { slState.pitch = Math.max(-6, slState.pitch - 1); updatePitchLabel(); slSaveCurrentFileState(); });

  // ── key / BPM / tap-tempo ─────────────────────────────────────────────
  els.keySelect.addEventListener('change', () => {
    const normalized = slNormalizeKeyInput(els.keySelect.value);
    if (!normalized) {
      els.keySelect.classList.add('invalid');
      els.keyTag.textContent = '格式错误';
      return;
    }
    els.keySelect.classList.remove('invalid');
    els.keySelect.value = normalized;
    slState.key = normalized;
    slState.keyManual = true;
    updateKeyTag();
    refreshRomanDisplays(); // 级数 track is relative to the key — recompute now it's changed
    slSaveCurrentFileState();
  });

  els.bpmInput.addEventListener('change', () => setBpm(parseInt(els.bpmInput.value), true));

  els.tapBtn.addEventListener('click', doTap); // deliberately not guarded — rapid repeated taps are the point
  [els.loopFromInput, els.loopToInput].forEach(el => el.addEventListener('change', readLoopInputs));
  els.loopToggle.addEventListener('change', readLoopInputs);
  els.offsetMinusBar.addEventListener('click', () => shiftBar1ByBeats(-slState.beatsPerBar));
  els.offsetMinusBeat.addEventListener('click', () => shiftBar1ByBeats(-1));
  els.offsetSetHere.addEventListener('click', setBar1ToCurrentTime);
  els.offsetPlusBeat.addEventListener('click', () => shiftBar1ByBeats(1));
  els.offsetPlusBar.addEventListener('click', () => shiftBar1ByBeats(slState.beatsPerBar));
  els.startBarNumInput.addEventListener('change', readBarNumberingInputs);
  els.pickupBeatsInput.addEventListener('change', readBarNumberingInputs);
  els.phraseSetHere.addEventListener('click', () => addPhraseStartAt(slTimeToBar(els.audioEl.currentTime)));
  els.phrasePrev.addEventListener('click', () => shiftSelectedPhraseStart(-1));
  els.phraseNext.addEventListener('click', () => shiftSelectedPhraseStart(1));
  els.phraseClear.addEventListener('click', removeSelectedPhraseStart);
  els.tocToggle.addEventListener('click', toggleTocList);
  els.tocList.addEventListener('click', (e) => {
    const item = e.target.closest('.gp-toc-item');
    if (!item) return;
    closeTocList();
    seekToBar(parseInt(item.dataset.bar, 10));
    scrollGridToBar(parseInt(item.dataset.bar, 10), { behavior: 'smooth' });
  });
  els.chordrefApply.addEventListener('click', applyChordRefBatch);
  els.audioEl.addEventListener('seeked', () => { updateTimeReadout(); updateWaveOverlays(); updateBarGridHighlight(); });
  els.audioEl.addEventListener('timeupdate', () => {
    enforceLoop();
    if (els.audioEl.paused) { updateTimeReadout(); updateWaveOverlays(); }
  });
  els.audioEl.addEventListener('play', () => { if (slState.loopOn) startLoopGuard(); });
  els.audioEl.addEventListener('pause', stopLoopGuard);
  window.addEventListener('beforeunload', stopLoopGuard);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) enforceLoop(); });

  document.addEventListener('fb-master-volume-change', slApplyPlaybackVolume);

  slPrefsLoad();
  normalizePhraseStarts();
  applyPrefsToUI();
  applySpeed();
  slApplyPlaybackVolume();
  updateOffsetReadout();
  updateSidecarHint('保存段落 / 歌词 / 简谱 / 偏移到同目录的 .songloop.json');
  requestAnimationFrame(tick);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    slState, slPrefsLoad, slPrefsSave, slSecPerBar, slTimeToBar, slBarToTime, slTotalBars,
    slFmtTime, slPitchLabelFor, slPlaybackVolume, slApplyPlaybackVolume, initSongLoopPage,
    slBaseName, slSidecarFileName,
    slBuildSidecarDocument, slParseSidecarText, slExtractSidecarState,
    slSaveCurrentFileState, slPersistUrlStateIfApplicable,
    slReadLegacyUrlState, slUrlStateKey,
    slLocalUploadKey, slLoadLocalUploadMap, slSaveLocalUploadMapEntry,
    slCaptureFileStatePayload, slApplyFileStatePayload,
    slClampZoom, slFitZoomPxPerBar, slShouldRecenter, slCenterScrollLeft, slComputeViewportBox,
    SL_KEY_OPTIONS, SL_INTERVAL_NAMES, SL_ZOOM_MIN, SL_ZOOM_MAX, slNormalizeKeyInput,
    slNormalizeAnnotations, SL_PHRASE_LABEL_PRESETS,
    slNormalizeCustomTracks, slNormalizePhraseStarts, slShiftBarKeyedState, slResolveChordRef,
    slChordDiagramFor, SL_CHORD_SHAPE_TABLE,
    slParseLrc,
    slKeyTonicPc, slParseChordSymbol, slChordToRoman, slRomanToChord, slRomanDegreeDigit,
    slCountInClickCount, slCountInDurationSec, slPhraseLabelColor, slBarRelativeToLabel,
    slPhraseSections, slSongChordList,
  };
}
