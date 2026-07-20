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
  sl.slPrefsSave();

  // mutate away, then reload from the fake localStorage and confirm restoration
  sl.slState.loopOn = false;
  sl.slState.speed = 100;
  sl.slPrefsLoad();
  assert.equal(sl.slState.loopFromBar, 4);
  assert.equal(sl.slState.loopToBar, 12);
  assert.equal(sl.slState.loopOn, true);
  assert.equal(sl.slState.bar1TimeSec, -0.5);
  assert.equal(sl.slState.speed, 80);
  assert.equal(sl.slState.preservePitch, false);

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

test('slSaveCurrentFileState is now a no-op shim and does not write localStorage', () => {
  _store = {};
  assert.doesNotThrow(() => sl.slSaveCurrentFileState());
  assert.deepEqual(_store, {});
});

test('slSaveUrlState/slLoadUrlState round-trip bpm/key/loop/offset/speed, keyed by URL', () => {
  _store = {};
  resetState();
  sl.slState.bpm = 108;
  sl.slState.key = 'C 大调';
  sl.slState.bar1TimeSec = 2.5;
  sl.slState.loopFromBar = 5;
  sl.slState.loopToBar = 9;
  sl.slState.loopOn = true;
  sl.slState.speed = 85;
  sl.slSaveUrlState('/api/materials/take-a-train-backing.mp3');
  const restored = sl.slLoadUrlState('/api/materials/take-a-train-backing.mp3');
  assert.deepEqual(restored, {
    bpm: 108, key: 'C 大调', bar1TimeSec: 2.5,
    loopFromBar: 5, loopToBar: 9, loopOn: true, speed: 85,
  });
});

test('slLoadUrlState returns null for a URL with no saved state', () => {
  _store = {};
  assert.equal(sl.slLoadUrlState('/api/materials/never-saved.mp3'), null);
});

test('slSaveUrlState keys are independent per URL — saving one does not affect another', () => {
  _store = {};
  resetState();
  sl.slState.bpm = 60;
  sl.slSaveUrlState('/api/materials/a.mp3');
  sl.slState.bpm = 200;
  sl.slSaveUrlState('/api/materials/b.mp3');
  assert.equal(sl.slLoadUrlState('/api/materials/a.mp3').bpm, 60);
  assert.equal(sl.slLoadUrlState('/api/materials/b.mp3').bpm, 200);
});
