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

function resetState() {
  sl.slState.bpm = 120;
  sl.slState.beatsPerBar = 4;
  sl.slState.duration = 0;
  sl.slState.bar1TimeSec = 0;
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
  sl.slState.annotations = { 4: { chord: 'D', lyric: 'la', note: '1 2' } };

  const doc = sl.slBuildSidecarDocument('demo.mp3');
  assert.equal(doc.kind, 'my-music-songloop-sidecar');
  assert.equal(doc.sourceFileName, 'demo.mp3');
  assert.equal(doc.state.bpm, 88);
  assert.equal(doc.state.annotations[4].chord, 'D');

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
