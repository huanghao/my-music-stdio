// song-loop.js is a plain browser <script>; its DOM work all lives inside
// initSongLoopPage(), which these tests never call, so no DOM stub is needed
// except a fake localStorage for the persistence round-trip test.
let _store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null; },
  setItem(k, v) { _store[k] = v; },
};

const test = require('node:test');
const assert = require('node:assert/strict');
const sl = require('../../web/song-loop.js');

// song-loop.js's 级数 (roman numeral) helpers reuse progression-lab.js's
// roman-numeral grammar via bare global references (real page load: both
// <script>s share one global scope — see slRomanEngineAvailable()'s own
// comment). Node has no such shared scope across separate require()s, so
// mirror the fbMasterGain() precedent below: copy the real functions onto
// `global` once, up front, rather than hand-rolling a stand-in that could
// drift from the actual parser.
Object.assign(global, require('../../web/progression-lab.js'));
// Same reasoning for the chord-diagram lookup: slChordDiagramFor() calls
// fretboard.js's fbBarreFretForShape()/FB_CAGED_SHAPES via a bare global
// reference (shared <script> scope on the real page). fretboard.js registers
// a visibilitychange listener and probes HTMLMediaElement at module scope —
// stub both first, same as tests/js/fretboard.test.js does.
global.document = global.document || { addEventListener() {} };
global.HTMLMediaElement = global.HTMLMediaElement || function HTMLMediaElement() {};
global.HTMLMediaElement.prototype.setSinkId = global.HTMLMediaElement.prototype.setSinkId || function () {};
Object.assign(global, require('../../web/fretboard.js'));

function resetState() {
  sl.slState.bpm = 120;
  sl.slState.beatsPerBar = 4;
  sl.slState.duration = 0;
  sl.slState.bar1TimeSec = 0;
  sl.slState.startBarNumber = 1;
  sl.slState.pickupBeats = 0;
}

test('slSecPerBar / slTimeToBar / slBarToTime follow the single-constant-BPM model', () => {
  resetState();
  sl.slState.bpm = 120; // 60/120*4 = 2s per bar
  assert.equal(sl.slSecPerBar(), 2);
  assert.equal(sl.slTimeToBar(0), 1);
  assert.equal(sl.slTimeToBar(1.9), 1);
  assert.equal(sl.slTimeToBar(2), 2);
  assert.equal(sl.slTimeToBar(5), 3);
  assert.equal(sl.slBarToTime(1), 0);
  assert.equal(sl.slBarToTime(3), 4);
});

test('slSecPerBar scales with beatsPerBar as well as bpm', () => {
  resetState();
  sl.slState.bpm = 60; sl.slState.beatsPerBar = 3;
  assert.equal(sl.slSecPerBar(), 3); // 60/60*3
});

test('slTotalBars rounds up to cover a partial final bar, and is never less than 1', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar
  sl.slState.duration = 0;
  assert.equal(sl.slTotalBars(), 1); // zero duration still reports at least 1 bar
  sl.slState.duration = 4;
  assert.equal(sl.slTotalBars(), 2);
  sl.slState.duration = 4.5;
  assert.equal(sl.slTotalBars(), 3); // partial 3rd bar still counts
});

test('slTimeToBar / slBarToTime honor a global bar-1 offset for pickups or intro gaps', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar
  sl.slState.bar1TimeSec = 1;
  assert.equal(sl.slTimeToBar(0), 0);
  assert.equal(sl.slTimeToBar(1), 1);
  assert.equal(sl.slTimeToBar(2.9), 1);
  assert.equal(sl.slTimeToBar(3), 2);
  assert.equal(sl.slBarToTime(1), 1);
  assert.equal(sl.slBarToTime(2), 3);
});

test('pickupBeats adds a short leading bar before bar1TimeSec, numbered startBarNumber; the next bar is unaffected', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar, 0.5s/beat
  sl.slState.bar1TimeSec = 4; // first FULL bar starts at t=4
  sl.slState.startBarNumber = 1;
  sl.slState.pickupBeats = 1; // 1 beat = 0.5s pickup bar right before it
  assert.equal(sl.slBarToTime(1), 3.5); // the pickup bar itself
  assert.equal(sl.slBarToTime(2), 4);   // first full bar, still bar1TimeSec exactly
  assert.equal(sl.slBarToTime(3), 6);
  assert.equal(sl.slTimeToBar(3.5), 1); // inside the pickup bar
  assert.equal(sl.slTimeToBar(0), 1);   // before the pickup even starts still reads as the pickup bar
  assert.equal(sl.slTimeToBar(4), 2);
  assert.equal(sl.slTimeToBar(5.9), 2);
  assert.equal(sl.slTimeToBar(6), 3);
});

test('startBarNumber renumbers every bar with no pickup and no change to bar1TimeSec semantics', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar
  sl.slState.bar1TimeSec = 0;
  sl.slState.startBarNumber = 0; // e.g. classical "pickup is bar 0" convention, but pickupBeats=0 here
  assert.equal(sl.slBarToTime(0), 0);
  assert.equal(sl.slBarToTime(1), 2);
  assert.equal(sl.slTimeToBar(0), 0);
  assert.equal(sl.slTimeToBar(1.9), 0);
  assert.equal(sl.slTimeToBar(2), 1);
});

test('startBarNumber and pickupBeats compose independently: pickup labeled 0, first full bar labeled 1', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar, 0.5s/beat
  sl.slState.bar1TimeSec = 4;
  sl.slState.startBarNumber = 0;
  sl.slState.pickupBeats = 1;
  assert.equal(sl.slBarToTime(0), 3.5); // pickup, now numbered 0
  assert.equal(sl.slBarToTime(1), 4);   // first full bar, now numbered 1
  assert.equal(sl.slTimeToBar(3.5), 0);
  assert.equal(sl.slTimeToBar(4), 1);
});

test('slTotalBars counts one extra bar when a pickup is present', () => {
  resetState();
  sl.slState.bpm = 120; // 2s/bar
  sl.slState.duration = 4;
  sl.slState.bar1TimeSec = 0;
  assert.equal(sl.slTotalBars(), 2); // no pickup
  sl.slState.pickupBeats = 1;
  assert.equal(sl.slTotalBars(), 3); // same duration, +1 for the pickup bar
});

test('slCountInClickCount fills a pickup bar up to a full bar (beatsPerBar - pickupBeats clicks)', () => {
  resetState();
  sl.slState.beatsPerBar = 4;
  sl.slState.pickupBeats = 1;
  assert.equal(sl.slCountInClickCount(), 3);
  sl.slState.pickupBeats = 3;
  assert.equal(sl.slCountInClickCount(), 1);
});

test('slCountInClickCount counts a whole extra bar ("预备小节") when there is no pickup', () => {
  resetState();
  sl.slState.beatsPerBar = 4;
  sl.slState.pickupBeats = 0;
  assert.equal(sl.slCountInClickCount(), 4);
  sl.slState.beatsPerBar = 3;
  assert.equal(sl.slCountInClickCount(), 3);
});

test('slCountInDurationSec converts the click count to seconds at the current tempo', () => {
  resetState();
  sl.slState.bpm = 120; // 0.5s/beat
  sl.slState.beatsPerBar = 4;
  sl.slState.pickupBeats = 0;
  assert.equal(sl.slCountInDurationSec(), 2); // 4 clicks * 0.5s
  sl.slState.pickupBeats = 1;
  assert.equal(sl.slCountInDurationSec(), 1.5); // 3 clicks * 0.5s
});

test('slFmtTime formats seconds as m:ss, clamping negative input to 0:00', () => {
  assert.equal(sl.slFmtTime(0), '0:00');
  assert.equal(sl.slFmtTime(65), '1:05');
  assert.equal(sl.slFmtTime(-5), '0:00');
});

test('slPitchLabelFor matches the ported design copy exactly for 0 and nonzero semitones', () => {
  assert.equal(sl.slPitchLabelFor(0), '原调（不移调）');
  assert.equal(sl.slPitchLabelFor(2), '升2半音 · 大二度');
  assert.equal(sl.slPitchLabelFor(-1), '降1半音 · 小二度');
  assert.equal(sl.slPitchLabelFor(6), '升6半音 · 三全音');
});

test('SL_KEY_OPTIONS has exactly the 12 keys from the ported design, in order', () => {
  assert.deepEqual(sl.SL_KEY_OPTIONS, [
    'C 大调', 'G 大调', 'D 大调', 'A 大调', 'E 大调', 'F 大调', 'Bb 大调',
    'Am 小调', 'Em 小调', 'Dm 小调', 'Bm 小调', 'Gm 小调',
  ]);
});

test('slPlaybackVolume follows shared master gain when available, defaults to 1 otherwise', () => {
  const prev = global.fbMasterGain;
  global.fbMasterGain = () => 0.36;
  assert.equal(sl.slPlaybackVolume(), 0.36);
  delete global.fbMasterGain;
  assert.equal(sl.slPlaybackVolume(), 1);
  global.fbMasterGain = prev;
});

test('slPrefsLoad/slPrefsSave round-trip only the generic (non-song-specific) fields', () => {
  _store = {};
  sl.slState.loopFromBar = 4;
  sl.slState.loopToBar = 12;
  sl.slState.loopOn = true;
  sl.slState.bar1TimeSec = -0.5;
  sl.slState.speed = 80;
  sl.slState.preservePitch = false;
  sl.slState.zoomPxPerBar = 200;
  sl.slPrefsSave();

  // mutate away, then reload from the fake localStorage and confirm restoration
  sl.slState.loopOn = false;
  sl.slState.speed = 100;
  sl.slState.zoomPxPerBar = 140;
  sl.slPrefsLoad();
  assert.equal(sl.slState.loopFromBar, 4);
  assert.equal(sl.slState.loopToBar, 12);
  assert.equal(sl.slState.loopOn, true);
  assert.equal(sl.slState.bar1TimeSec, -0.5);
  assert.equal(sl.slState.speed, 80);
  assert.equal(sl.slState.preservePitch, false);
  assert.equal(sl.slState.zoomPxPerBar, 200);

  // corrupted storage must not crash or pollute state with garbage
  _store['sl_prefs'] = 'not json';
  assert.doesNotThrow(() => sl.slPrefsLoad());
});

test('sidecar helpers build stable adjacent JSON names and unwrap nested state payloads', () => {
  assert.equal(sl.slBaseName('demo.mp3'), 'demo');
  assert.equal(sl.slBaseName('demo.backing.wav'), 'demo.backing');
  assert.equal(sl.slSidecarFileName('demo.mp3'), 'demo.songloop.json');

  sl.slState.bar1TimeSec = 2;
  sl.slState.bpm = 88;
  sl.slState.key = 'D 大调';
  sl.slState.phraseStarts = [1, 4];
  sl.slState.selectedPhraseStartBar = 4;
  sl.slState.annotations = { 4: { chord: 'D', lyric: 'la', note: '1 2', label: '副歌' } };

  const doc = sl.slBuildSidecarDocument('demo.mp3');
  assert.equal(doc.kind, 'my-music-songloop-sidecar');
  assert.equal(doc.sourceFileName, 'demo.mp3');
  assert.equal(doc.state.bpm, 88);
  assert.equal(doc.state.annotations[4].chord, 'D');
  assert.equal(doc.state.annotations[4].label, '副歌');

  const parsed = sl.slParseSidecarText(JSON.stringify(doc));
  assert.equal(parsed.key, 'D 大调');
  assert.deepEqual(parsed.phraseStarts, [1, 4]);

  const parsedLegacy = sl.slParseSidecarText(JSON.stringify(doc.state));
  assert.equal(parsedLegacy.bar1TimeSec, 2);
});

test('slSaveCurrentFileState no-ops when the track has no materials-library url yet', () => {
  _store = {};
  resetState();
  sl.slState.sourceUrl = null;
  assert.doesNotThrow(() => sl.slSaveCurrentFileState());
  assert.deepEqual(_store, {});
});

// slSaveCurrentFileState's positive case (sourceUrl set) now schedules a
// debounced network PUT to /api/materials/<id>/state instead of writing
// localStorage synchronously — like the rest of this file's fetch/DOM-driven
// code (loadFileFromUrl, registerAsLibraryMaterial), that path isn't unit
// tested here; it's verified manually end-to-end against a real server.

test('slReadLegacyUrlState reads the pre-migration localStorage blob (one-time migration source only)', () => {
  _store = {};
  _store[sl.slUrlStateKey('/api/materials/take-a-train-backing.mp3')] = JSON.stringify({ bpm: 108, key: 'C 大调' });
  const restored = sl.slReadLegacyUrlState('/api/materials/take-a-train-backing.mp3');
  assert.deepEqual(restored, { bpm: 108, key: 'C 大调' });
});

test('slReadLegacyUrlState returns null for a URL with no legacy blob, and tolerates corrupted storage', () => {
  _store = {};
  assert.equal(sl.slReadLegacyUrlState('/api/materials/never-saved.mp3'), null);
  _store[sl.slUrlStateKey('/api/materials/broken.mp3')] = 'not json';
  assert.doesNotThrow(() => sl.slReadLegacyUrlState('/api/materials/broken.mp3'));
  assert.equal(sl.slReadLegacyUrlState('/api/materials/broken.mp3'), null);
});

test('slLocalUploadKey combines name and size so same-name-different-size files don\'t collide', () => {
  assert.equal(sl.slLocalUploadKey('song.mp3', 12345), 'song.mp3::12345');
  assert.notEqual(sl.slLocalUploadKey('song.mp3', 12345), sl.slLocalUploadKey('song.mp3', 54321));
});

test('slLoadLocalUploadMap returns {} when nothing has been uploaded yet, and tolerates corrupted storage', () => {
  _store = {};
  assert.deepEqual(sl.slLoadLocalUploadMap(), {});
  _store['sl_local_upload_map'] = 'not json';
  assert.doesNotThrow(() => sl.slLoadLocalUploadMap());
  assert.deepEqual(sl.slLoadLocalUploadMap(), {});
});

test('slSaveLocalUploadMapEntry round-trips and keeps multiple entries independent', () => {
  _store = {};
  sl.slSaveLocalUploadMapEntry('song-a.mp3::100', '/api/materials/song-a-123.mp3');
  sl.slSaveLocalUploadMapEntry('song-b.mp3::200', '/api/materials/song-b-456.mp3');
  const map = sl.slLoadLocalUploadMap();
  assert.equal(map['song-a.mp3::100'], '/api/materials/song-a-123.mp3');
  assert.equal(map['song-b.mp3::200'], '/api/materials/song-b-456.mp3');
});

test('slClampZoom clamps to [SL_ZOOM_MIN, SL_ZOOM_MAX] and rounds', () => {
  assert.equal(sl.slClampZoom(10), sl.SL_ZOOM_MIN);
  assert.equal(sl.slClampZoom(9999), sl.SL_ZOOM_MAX);
  assert.equal(sl.slClampZoom(140.6), 141);
  assert.equal(sl.slClampZoom(NaN), sl.SL_ZOOM_MIN);
});

test('slFitZoomPxPerBar fits the container width to the bar count and stays within zoom range', () => {
  // 1000px container, 92px label column -> 908px for bars; 20 bars -> 45.4px/bar
  assert.equal(sl.slFitZoomPxPerBar(20, 1000, 92), 45);
  // very few bars would compute an oversized per-bar width, clamped to SL_ZOOM_MAX
  assert.equal(sl.slFitZoomPxPerBar(1, 1000, 92), sl.SL_ZOOM_MAX);
  // a huge bar count would compute an undersized width, clamped to SL_ZOOM_MIN
  assert.equal(sl.slFitZoomPxPerBar(5000, 1000, 92), sl.SL_ZOOM_MIN);
  // totalBars <= 0 must not divide by zero / go negative
  assert.equal(sl.slFitZoomPxPerBar(0, 1000, 92), sl.SL_ZOOM_MAX);
});

test('slShouldRecenter only fires once the cell nears the edge of the visible area', () => {
  // viewport [0,1000), 15% margin = 150px; cell comfortably in the middle
  assert.equal(sl.slShouldRecenter(400, 540, 0, 1000), false);
  // cell poking past the right margin
  assert.equal(sl.slShouldRecenter(880, 1020, 0, 1000), true);
  // cell poking past the left margin
  assert.equal(sl.slShouldRecenter(-20, 120, 0, 1000), true);
});

test('slCenterScrollLeft centers the cell in the viewport and never goes negative', () => {
  assert.equal(sl.slCenterScrollLeft(900, 140, 1000), 900 - 500 + 70);
  assert.equal(sl.slCenterScrollLeft(0, 140, 1000), 0); // near the very start, clamps to 0
});

test('slComputeViewportBox maps grid scroll position to an overview box, without dividing by zero', () => {
  // 1000px client width, 92px label column -> 908px content, 140px/bar, 50 total bars
  const box = sl.slComputeViewportBox(0, 1000, 140, 92, 50);
  assert.equal(box.leftPct, 0);
  assert.ok(Math.abs(box.widthPct - (908 / 140 / 50) * 100) < 1e-9);

  // scrolled halfway through a 50-bar song
  const scrolled = sl.slComputeViewportBox(50 * 140 / 2, 1000, 140, 92, 50);
  assert.ok(Math.abs(scrolled.leftPct - 50) < 1e-9);

  // totalBars of 0 must not throw or divide by zero
  assert.doesNotThrow(() => sl.slComputeViewportBox(0, 1000, 140, 92, 0));
});

test('slNormalizeAnnotations keeps a valid label string and defaults missing/invalid ones to empty', () => {
  const out = sl.slNormalizeAnnotations({
    4: { chord: 'D', lyric: 'la', note: '1 2', label: '副歌' },
    5: { chord: 'G' }, // no label key at all — pre-existing data from before this field existed
    6: { label: 42 },  // wrong type
  });
  assert.equal(out[4].label, '副歌');
  assert.equal(out[5].label, '');
  assert.equal(out[6].label, '');
});

test('slNormalizeAnnotations preserves arbitrary custom-track values (dynamic keys beyond chord/lyric/label)', () => {
  const out = sl.slNormalizeAnnotations({
    4: { chord: 'D', note: '1 2', t_bass: 'walking bassline', junk: 42 },
  });
  // the legacy fixed "note" field is now just another dynamic custom-track key
  assert.equal(out[4].note, '1 2');
  assert.equal(out[4].t_bass, 'walking bassline');
  assert.equal(out[4].junk, undefined); // non-string values are dropped, not coerced
});

test('slNormalizeCustomTracks falls back to the single legacy 简谱/备注 track only when the field is absent, keeps an explicit empty array as-is', () => {
  assert.deepEqual(sl.slNormalizeCustomTracks(undefined), [{ id: 'note', name: '简谱 / 备注' }]);
  assert.deepEqual(sl.slNormalizeCustomTracks(null), [{ id: 'note', name: '简谱 / 备注' }]);
  assert.deepEqual(sl.slNormalizeCustomTracks([]), []); // user explicitly removed every track — respected
  assert.deepEqual(
    sl.slNormalizeCustomTracks([{ id: 'bass', name: '贝斯' }, { id: 'note', name: '备注' }]),
    [{ id: 'bass', name: '贝斯' }, { id: 'note', name: '备注' }],
  );
});

test('slNormalizeCustomTracks drops malformed entries and de-dupes by id (keeping the first)', () => {
  const out = sl.slNormalizeCustomTracks([
    { id: 'bass', name: '贝斯' },
    { id: 'bass', name: '重复 id 应该被丢弃' },
    { id: '', name: '空 id 无效' },
    { name: '缺 id' },
    { id: 'ok', name: 42 }, // non-string name
    null,
  ]);
  assert.deepEqual(out, [{ id: 'bass', name: '贝斯' }]);
});

test('SL_PHRASE_LABEL_PRESETS is a non-empty list of plain strings', () => {
  assert.ok(Array.isArray(sl.SL_PHRASE_LABEL_PRESETS));
  assert.ok(sl.SL_PHRASE_LABEL_PRESETS.length > 0);
  sl.SL_PHRASE_LABEL_PRESETS.forEach(label => assert.equal(typeof label, 'string'));
});

test('slNormalizePhraseStarts floors against slState.startBarNumber (default 1), not a hardcoded 1', () => {
  resetState();
  assert.deepEqual(sl.slNormalizePhraseStarts([3, 1, 1, 4]), [1, 3, 4]); // dedupes + sorts, default floor 1
  assert.deepEqual(sl.slNormalizePhraseStarts([]), [1]); // empty falls back to the current startBarNumber

  sl.slState.startBarNumber = 0;
  assert.deepEqual(sl.slNormalizePhraseStarts([-1, 0, 2]), [0, 2]); // -1 is below the new floor, dropped
  assert.deepEqual(sl.slNormalizePhraseStarts([]), [0]); // fallback now tracks the new startBarNumber
});

test('slShiftBarKeyedState re-keys annotations/phraseStarts/loop range so content stays attached to the same physical bar after renumbering', () => {
  resetState();
  sl.slState.annotations = { 2: { chord: 'C', lyric: '', label: '' }, 3: { chord: 'G', lyric: '', label: '' } };
  sl.slState.phraseStarts = [2, 3];
  sl.slState.selectedPhraseStartBar = 2;
  sl.slState.loopFromBar = 2;
  sl.slState.loopToBar = 3;

  sl.slShiftBarKeyedState(-1); // e.g. startBarNumber went from 1 to 0

  assert.deepEqual(Object.keys(sl.slState.annotations).sort(), ['1', '2']);
  assert.equal(sl.slState.annotations[1].chord, 'C');
  assert.equal(sl.slState.annotations[2].chord, 'G');
  assert.deepEqual(sl.slState.phraseStarts, [1, 2]);
  assert.equal(sl.slState.selectedPhraseStartBar, 1);
  assert.equal(sl.slState.loopFromBar, 1);
  assert.equal(sl.slState.loopToBar, 2);
});

test('slShiftBarKeyedState is a no-op for delta=0', () => {
  resetState();
  sl.slState.annotations = { 2: { chord: 'C' } };
  sl.slShiftBarKeyedState(0);
  assert.deepEqual(sl.slState.annotations, { 2: { chord: 'C' } });
});

test('slNormalizeAnnotations floors bar keys against slState.startBarNumber', () => {
  resetState();
  sl.slState.startBarNumber = 0;
  const out = sl.slNormalizeAnnotations({ '-1': { chord: 'X' }, 0: { chord: 'C' }, 1: { chord: 'G' } });
  assert.equal(out[-1], undefined); // below the floor — dropped
  assert.equal(out[0].chord, 'C');
  assert.equal(out[1].chord, 'G');
});

test('slResolveChordRef returns literal chords as-is', () => {
  const annotations = { 1: { chord: 'C' }, 2: { chord: '' } };
  assert.deepEqual(sl.slResolveChordRef(1, annotations), { value: 'C', isRef: false, broken: false });
  assert.deepEqual(sl.slResolveChordRef(2, annotations), { value: '', isRef: false, broken: false });
  assert.deepEqual(sl.slResolveChordRef(99, annotations), { value: '', isRef: false, broken: false }); // no entry at all
});

test('slResolveChordRef resolves "=N" to the target bar\'s chord, tolerating whitespace', () => {
  const annotations = { 1: { chord: 'C' }, 2: { chord: '=1' }, 3: { chord: '= 1' } };
  assert.deepEqual(sl.slResolveChordRef(2, annotations), { value: 'C', isRef: true, broken: false });
  assert.deepEqual(sl.slResolveChordRef(3, annotations), { value: 'C', isRef: true, broken: false });
});

test('slResolveChordRef follows a chain of references to the literal at the end', () => {
  const annotations = { 1: { chord: 'G' }, 2: { chord: '=1' }, 3: { chord: '=2' }, 4: { chord: '=3' } };
  assert.deepEqual(sl.slResolveChordRef(4, annotations), { value: 'G', isRef: true, broken: false });
});

test('slResolveChordRef detects circular references and marks them broken instead of infinite-looping', () => {
  const annotations = { 1: { chord: '=2' }, 2: { chord: '=1' } };
  assert.deepEqual(sl.slResolveChordRef(1, annotations), { value: '', isRef: true, broken: true });
  assert.deepEqual(sl.slResolveChordRef(2, annotations), { value: '', isRef: true, broken: true });

  const selfRef = { 5: { chord: '=5' } };
  assert.deepEqual(sl.slResolveChordRef(5, selfRef), { value: '', isRef: true, broken: true });
});

test('slResolveChordRef treats a reference to an empty/nonexistent bar as a normal (non-broken) empty resolution', () => {
  const annotations = { 2: { chord: '=1' } }; // bar 1 has no entry at all
  assert.deepEqual(sl.slResolveChordRef(2, annotations), { value: '', isRef: true, broken: false });
});

test('slSongChordList dedupes chords across the whole song, keeping first-appearance order', () => {
  const annotations = { 1: { chord: 'C' }, 2: { chord: 'G' }, 3: { chord: 'C' }, 4: { chord: 'Am' } };
  assert.deepEqual(sl.slSongChordList(annotations, 1, 4), ['C', 'G', 'Am']);
});

test('slSongChordList resolves "=N" references to their literal chord and skips empty bars', () => {
  const annotations = { 1: { chord: 'C' }, 2: { chord: '' }, 3: { chord: '=1' }, 4: {} };
  assert.deepEqual(sl.slSongChordList(annotations, 1, 4), ['C']);
});

test('slSongChordList respects a non-default startBarNumber', () => {
  const annotations = { 5: { chord: 'D' }, 6: { chord: 'A' } };
  assert.deepEqual(sl.slSongChordList(annotations, 5, 2), ['D', 'A']);
});

test('slSongChordList splits a mid-bar chord change ("Em F#7") into two separate entries', () => {
  const annotations = { 1: { chord: 'Em F#7' } };
  assert.deepEqual(sl.slSongChordList(annotations, 1, 1), ['Em', 'F#7']);
});

test('slSongChordList silently drops tokens that are not chord symbols at all (e.g. "%1" repeat shorthand)', () => {
  const annotations = { 1: { chord: '%1' }, 2: { chord: 'C' } };
  assert.deepEqual(sl.slSongChordList(annotations, 1, 2), ['C']);
});

test('slChordDiagramFor picks the shape with the smaller barre fret', () => {
  // C major: E-shape barres at fret 8, A-shape barres at fret 3 — A-shape wins
  const c = sl.slChordDiagramFor(0, '');
  assert.equal(c.barreFret, 3);
  // E major: E-shape is already open (barre 0) — must win over A-shape (barre 7)
  const e = sl.slChordDiagramFor(4, '');
  assert.equal(e.barreFret, 0);
});

test('slChordDiagramFor returns null for qualities without a shape (sus4/dim/aug/9/...)', () => {
  assert.equal(sl.slChordDiagramFor(0, 'sus4'), null);
  assert.equal(sl.slChordDiagramFor(0, 'dim'), null);
});

test('slChordDiagramFor covers every quality SL_CHORD_SHAPE_TABLE claims to (minor/7/maj7/m7), plus major', () => {
  assert.ok(sl.slChordDiagramFor(0, ''));    // major (special-cased onto FB_CAGED_SHAPES)
  ['m', '7', 'maj7', 'm7'].forEach(q => assert.ok(sl.slChordDiagramFor(0, q), `expected a shape for quality "${q}"`));
});

test('slParseChordSymbol -> slChordDiagramFor wiring: a typical chord track entry resolves to a real shape', () => {
  const parsed = sl.slParseChordSymbol('Dm7');
  assert.deepEqual(parsed, { rootPc: 2, quality: 'm7' });
  const picked = sl.slChordDiagramFor(parsed.rootPc, parsed.quality);
  assert.ok(picked);
  assert.ok(picked.shape);
  assert.ok(Number.isInteger(picked.barreFret));
});

test('slChordToRoman reads diatonic triads/7ths off the current key, matching standard analysis conventions', () => {
  assert.equal(sl.slChordToRoman('G', 'G 大调'), 'I');
  assert.equal(sl.slChordToRoman('Am', 'G 大调'), 'ii');
  assert.equal(sl.slChordToRoman('Bm', 'G 大调'), 'iii');
  assert.equal(sl.slChordToRoman('D7', 'G 大调'), 'V7');       // dominant7 on an upper-case numeral stays bare "7"
  assert.equal(sl.slChordToRoman('Em7', 'G 大调'), 'vi7');     // m7 on a lower-case numeral also stays bare "7"
  assert.equal(sl.slChordToRoman('F#dim', 'G 大调'), 'vii');   // bare lower-case vii already implies diminished
  assert.equal(sl.slChordToRoman('Gmaj7', 'G 大调'), 'Imaj7'); // non-default quality needs an explicit suffix
});

test('slChordToRoman spells common borrowed/modal-mixture chords with a flat, not a sharp', () => {
  assert.equal(sl.slChordToRoman('Bb', 'G 大调'), 'bIII');
  assert.equal(sl.slChordToRoman('Eb', 'G 大调'), 'bVI');
  assert.equal(sl.slChordToRoman('F', 'G 大调'), 'bVII');
});

test('slChordToRoman handles a minor key the same way (case follows the chord\'s own quality, not the key\'s mode)', () => {
  assert.equal(sl.slChordToRoman('Am', 'Am 小调'), 'i');
  assert.equal(sl.slChordToRoman('G', 'Am 小调'), 'bVII'); // borrowed dominant-ish major chord in a minor key
});

test('slChordToRoman ignores a slash bass note (shows the chord\'s own root, not the inversion)', () => {
  assert.equal(sl.slChordToRoman('G/B', 'G 大调'), 'I');
});

test('slChordToRoman falls back to \'\' for empty/unparseable chord text or key', () => {
  assert.equal(sl.slChordToRoman('', 'G 大调'), '');
  assert.equal(sl.slChordToRoman('xyz123', 'G 大调'), '');
  assert.equal(sl.slChordToRoman('G', 'not a key'), '');
});

test('slChordToRoman handles a mid-bar chord change (space-separated chord pair)', () => {
  assert.equal(sl.slChordToRoman('Em F#7', 'C 大调'), 'iii bV7');
  assert.equal(sl.slRomanDegreeDigit(sl.slChordToRoman('Em F#7', 'C 大调')), '3 b5');
});

test('slRomanToChord handles a mid-bar chord change (space-separated roman pair)', () => {
  assert.equal(sl.slRomanToChord('vi V7', 'C 大调'), 'Am G7');
});

test('slRomanToChord is the exact inverse of slChordToRoman for plain diatonic and borrowed chords', () => {
  assert.equal(sl.slRomanToChord('I', 'G 大调'), 'G');
  assert.equal(sl.slRomanToChord('ii', 'G 大调'), 'Am');
  assert.equal(sl.slRomanToChord('V7', 'G 大调'), 'D7');
  assert.equal(sl.slRomanToChord('vi7', 'G 大调'), 'Em7');
  assert.equal(sl.slRomanToChord('bVII', 'G 大调'), 'F');
  assert.equal(sl.slRomanToChord('i', 'Am 小调'), 'Am');
});

test('slRomanToChord supports secondary dominants (progression-lab\'s "/target" grammar) for free', () => {
  assert.equal(sl.slRomanToChord('V7/ii', 'G 大调'), 'E7'); // the V7 of Am (G major's ii)
});

test('slRomanToChord treats a blank input as clearing the chord, and rejects unrecognized text', () => {
  assert.equal(sl.slRomanToChord('', 'G 大调'), '');
  assert.equal(sl.slRomanToChord('not roman', 'G 大调'), null);
  assert.equal(sl.slRomanToChord('I', 'not a key'), null);
});

test('slRomanDegreeDigit collapses a full roman numeral down to just the degree number, keeping the accidental but dropping quality/case', () => {
  assert.equal(sl.slRomanDegreeDigit('V7'), '5');
  assert.equal(sl.slRomanDegreeDigit('v7'), '5'); // lowercase (minor) -> same digit, no case kept
  assert.equal(sl.slRomanDegreeDigit('IVmaj7'), '4');
  assert.equal(sl.slRomanDegreeDigit('bIII7'), 'b3'); // accidental kept — it changes which degree this is
  assert.equal(sl.slRomanDegreeDigit('#ivdim'), '#4');
  assert.equal(sl.slRomanDegreeDigit('VII'), '7'); // longest-numeral-first: not cut short to "V" + stray "II"
  assert.equal(sl.slRomanDegreeDigit('vi'), '6');
  assert.equal(sl.slRomanDegreeDigit(''), '');
  assert.equal(sl.slRomanDegreeDigit('not roman'), '');
});

test('slBarRelativeToLabel numbers bars relative to the most recent *labeled* 句首 marker at or before them', () => {
  const phraseStarts = [1, 5, 9];
  const annotations = { 1: { label: '' }, 5: { label: '主歌' }, 9: { label: '副歌' } };
  assert.equal(sl.slBarRelativeToLabel(1, phraseStarts, annotations), null); // no labeled section yet
  assert.equal(sl.slBarRelativeToLabel(4, phraseStarts, annotations), null); // still before any label
  assert.equal(sl.slBarRelativeToLabel(5, phraseStarts, annotations), 1);  // 主歌's own first bar
  assert.equal(sl.slBarRelativeToLabel(7, phraseStarts, annotations), 3);  // 主歌's 3rd bar
  assert.equal(sl.slBarRelativeToLabel(9, phraseStarts, annotations), 1);  // 副歌 resets the count
  assert.equal(sl.slBarRelativeToLabel(12, phraseStarts, annotations), 4); // 副歌's 4th bar
});

test('slBarRelativeToLabel skips unlabeled phrase markers — they do not reset the count', () => {
  const phraseStarts = [1, 5, 9];
  const annotations = { 1: { label: '主歌' }, 5: { label: '' }, 9: { label: '' } }; // 5 and 9 are unlabeled 句首 markers
  assert.equal(sl.slBarRelativeToLabel(10, phraseStarts, annotations), 10); // still counting from bar 1's 主歌
});

test('slPhraseSections spans each 段落 up to the next one, and the last one to the end of the song', () => {
  const phraseStarts = [1, 5, 9];
  const annotations = { 1: { label: '前奏' }, 5: { label: '主歌' }, 9: { label: '' } };
  const sections = sl.slPhraseSections(phraseStarts, annotations, 1, 16); // bars 1..16
  assert.deepEqual(sections, [
    { bar: 1, label: '前奏', barCount: 4 },  // bars 1-4
    { bar: 5, label: '主歌', barCount: 4 },  // bars 5-8
    { bar: 9, label: '', barCount: 8 },      // bars 9-16 (runs to the end)
  ]);
});

test('slPhraseSections handles a single section covering the whole song', () => {
  const sections = sl.slPhraseSections([1], { 1: { label: '' } }, 1, 8);
  assert.deepEqual(sections, [{ bar: 1, label: '', barCount: 8 }]);
});

test('slPhraseSections respects a non-default startBarNumber', () => {
  const sections = sl.slPhraseSections([3, 7], { 3: { label: 'A' }, 7: { label: 'B' } }, 3, 10); // bars 3..12
  assert.deepEqual(sections, [
    { bar: 3, label: 'A', barCount: 4 }, // bars 3-6
    { bar: 7, label: 'B', barCount: 6 }, // bars 7-12
  ]);
});

test('lyricSongId round-trips through capture/apply so re-opening a track keeps the NetEase song id', () => {
  resetState();
  sl.slState.lyricSongId = '28403111';
  const payload = sl.slCaptureFileStatePayload();
  assert.equal(payload.lyricSongId, '28403111');
  sl.slState.lyricSongId = '';
  sl.slApplyFileStatePayload(payload);
  assert.equal(sl.slState.lyricSongId, '28403111');
});

test('slApplyFileStatePayload defaults lyricSongId to \'\' when absent (older saved state, or none imported yet)', () => {
  resetState();
  sl.slState.lyricSongId = '999';
  sl.slApplyFileStatePayload({});
  assert.equal(sl.slState.lyricSongId, '');
});

test('speed round-trips through capture/apply (previously only spliced on ad-hoc at call sites, dropped by sidecar save/load)', () => {
  resetState();
  sl.slState.speed = 65;
  const payload = sl.slCaptureFileStatePayload();
  assert.equal(payload.speed, 65);
  sl.slState.speed = 100;
  sl.slApplyFileStatePayload(payload);
  assert.equal(sl.slState.speed, 65);
});
