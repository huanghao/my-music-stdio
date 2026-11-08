// speed-trainer.js is a plain browser <script> — stub just enough DOM to load it.
// getElementById returns the *same* element object on repeated calls for the
// same id (like a real static DOM would) so addEventListener calls across
// multiple initSpeedPage() invocations land on one shared listener list —
// that's what makes the "duplicate listener" regression test below meaningful.
const _fakeElements = {};
function _fakeElement(id) {
  if (!_fakeElements[id]) {
    _fakeElements[id] = {
      textContent: '', innerHTML: '', style: {}, value: '', checked: false,
      _listeners: {},
      addEventListener(type, fn) {
        (this._listeners[type] || (this._listeners[type] = [])).push(fn);
      },
    };
  }
  return _fakeElements[id];
}
global.document = {
  addEventListener() {},
  getElementById(id) { return _fakeElement(id); },
};
global.performance = { now: () => Date.now() };
global.localStorage = { getItem() { return null; }, setItem() {} };

const test = require('node:test');
const assert = require('node:assert/strict');
const st = require('../../web/speed-trainer.js');

test('initSpeedPage only attaches its input listeners once, even if called again (e.g. revisiting the page)', () => {
  // Regression test for a real leak: the option inputs live in static HTML —
  // unlike most other panels in this app, they're never destroyed/recreated
  // on re-render — so calling initSpeedPage() on every page visit without a
  // guard would stack a fresh duplicate listener on the same element each time.
  const original = st.stState.inited;
  try {
    st.stState.inited = false;
    st.initSpeedPage();
    st.initSpeedPage();
    st.initSpeedPage();

    const el = _fakeElement('st-start-bpm');
    assert.equal(el._listeners.change.length, 1);
  } finally {
    st.stState.inited = original;
  }
});

test('stSetCurrentBpm clamps to [20, 300] and resets the bars-at-tempo counter', () => {
  st.stState.barsCompletedAtCurrentBpm = 7;
  st.stSetCurrentBpm(90);
  assert.equal(st.stState.currentBpm, 90);
  assert.equal(st.stState.barsCompletedAtCurrentBpm, 0);

  st.stState.barsCompletedAtCurrentBpm = 3;
  st.stSetCurrentBpm(500); // above the hard ceiling
  assert.equal(st.stState.currentBpm, 300);

  st.stSetCurrentBpm(5); // below the hard floor
  assert.equal(st.stState.currentBpm, 20);

  st.stSetCurrentBpm('not a number');
  assert.equal(st.stState.currentBpm, 20); // unchanged, doesn't crash or go to NaN
});

test('stAdjustBpm moves by a signed delta and is not clamped to targetBpm (unlike stBumpUp)', () => {
  st.stState.currentBpm = 90;
  st.stState.targetBpm = 100;
  st.stAdjustBpm(20); // would overshoot targetBpm — should be allowed
  assert.equal(st.stState.currentBpm, 110);
  st.stAdjustBpm(-50);
  assert.equal(st.stState.currentBpm, 60);
});

test('stBumpUp clamps at targetBpm and stays there when bounceMode is off (unchanged default behavior)', () => {
  st.stState.bounceMode = false;
  st.stState.rampDirection = 1;
  st.stState.startBpm = 80; st.stState.targetBpm = 90; st.stState.stepBpm = 5;
  st.stState.currentBpm = 87;
  st.stBumpUp();
  assert.equal(st.stState.currentBpm, 90); // clamped, not 92
  st.stBumpUp();
  assert.equal(st.stState.currentBpm, 90); // stays put — no direction to reverse into
  assert.equal(st.stState.rampDirection, 1);
});

test('stBumpUp reverses direction at both ends and loops when bounceMode is on', () => {
  st.stState.bounceMode = true;
  st.stState.rampDirection = 1;
  st.stState.startBpm = 80; st.stState.targetBpm = 90; st.stState.stepBpm = 5;
  st.stState.currentBpm = 80;
  st.stBumpUp(); // 80 -> 85
  assert.equal(st.stState.currentBpm, 85);
  assert.equal(st.stState.rampDirection, 1);
  st.stBumpUp(); // 85 -> 90 (hits Target, flips direction)
  assert.equal(st.stState.currentBpm, 90);
  assert.equal(st.stState.rampDirection, -1);
  st.stBumpUp(); // 90 -> 85 (descending now)
  assert.equal(st.stState.currentBpm, 85);
  assert.equal(st.stState.rampDirection, -1);
  st.stBumpUp(); // 85 -> 80 (hits Start, flips direction back)
  assert.equal(st.stState.currentBpm, 80);
  assert.equal(st.stState.rampDirection, 1);
  st.stBumpUp(); // loops again: 80 -> 85
  assert.equal(st.stState.currentBpm, 85);
  assert.equal(st.stState.rampDirection, 1);
  st.stState.bounceMode = false; // reset for other tests
});

test('stChartWindowMs scales with tempo and beats-per-bar (last N bars, not a fixed duration)', () => {
  st.stState.currentBpm = 120;
  st.stState.beatsPerBar = 4;
  // one bar at 120bpm/4-4 = 2000ms; window is 4 bars
  assert.equal(st.stChartWindowMs(), 8000);

  st.stState.currentBpm = 60; // half the tempo -> bar takes twice as long -> window doubles
  assert.equal(st.stChartWindowMs(), 16000);
});

function _setOptionInputs({ start = '60', target = '200', step = '4', beats = '4', sub = '1' } = {}) {
  _fakeElement('st-start-bpm').value = start;
  _fakeElement('st-target-bpm').value = target;
  _fakeElement('st-step-bpm').value = step;
  _fakeElement('st-beats-per-bar').value = beats;
  _fakeElement('st-subdivision').value = sub;
  _fakeElement('st-auto-advance').checked = false;
  _fakeElement('st-auto-advance-bars').value = '4';
}

test('stOnOptionsChanged propagates a Start BPM edit to the active lick', () => {
  // Regression test: editing Start BPM while practicing a lick used to only
  // reach the global st_prefs — which practiceLick then clobbered on the next
  // visit when it reseeded startBpm from the lick's saved last_practiced_bpm,
  // so the edit silently reverted on refresh.
  const notified = [];
  global.licksState = { activeLick: { id: 'L1', lastBpm: 60 } };
  global.licksNotifyBpmChange = (bpm) => { notified.push(bpm); };
  try {
    st.stState.running = false;
    st.stState.startBpm = 60; st.stState.currentBpm = 60; st.stState.targetBpm = 200;
    _setOptionInputs({ start: '80' });
    st.stOnOptionsChanged();
    assert.equal(st.stState.startBpm, 80);
    assert.equal(st.stState.currentBpm, 80); // live tempo adopts the edit
    assert.deepEqual(notified, [80]);        // and the lick is told so it persists
  } finally {
    delete global.licksState;
    delete global.licksNotifyBpmChange;
  }
});

test('stOnOptionsChanged without an active lick leaves the live tempo alone', () => {
  st.stState.running = false;
  st.stState.startBpm = 60; st.stState.currentBpm = 100; st.stState.targetBpm = 200;
  _setOptionInputs({ start: '80' });
  st.stOnOptionsChanged();
  assert.equal(st.stState.startBpm, 80);
  assert.equal(st.stState.currentBpm, 100); // standalone Speed Trainer behavior unchanged
});

test('stOnOptionsChanged mid-run does not override the tempo being practiced', () => {
  const notified = [];
  global.licksState = { activeLick: { id: 'L1', lastBpm: 100 } };
  global.licksNotifyBpmChange = (bpm) => { notified.push(bpm); };
  try {
    st.stState.running = true;
    st.stState.startBpm = 60; st.stState.currentBpm = 100; st.stState.targetBpm = 200;
    _setOptionInputs({ start: '80' });
    st.stOnOptionsChanged();
    assert.equal(st.stState.currentBpm, 100); // the running tempo stays the truth
    assert.deepEqual(notified, []);
  } finally {
    st.stState.running = false;
    delete global.licksState;
    delete global.licksNotifyBpmChange;
  }
});

test('auto step: chime on the step beat, count-in bars do not count toward the step', () => {
  global.fbMasterGain = () => 1;
  const realSetTimeout = global.setTimeout;
  global.setTimeout = () => 0; // UI flashes are timer-driven and need a real DOM
  const freqs = [];
  const ctx = {
    currentTime: 0, destination: {},
    createOscillator() { return { type: '', frequency: { set value(v) { freqs.push(v); } }, connect() {}, start() {}, stop() {} }; },
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; },
  };
  Object.assign(st.stState, {
    audioCtx: ctx, currentBpm: 60, startBpm: 60, targetBpm: 120, stepBpm: 5,
    beatsPerBar: 4, subdivision: 1, autoAdvance: true, autoAdvanceBars: 2,
    stepChime: true, countInBars: 1, bounceMode: false, rampDirection: 1,
    nextTickTime: 0, tickIndex: 0, barsCompletedAtCurrentBpm: 0, totalBars: 0, countInLeft: 0, pendingCue: null,
  });
  // 60 BPM = 1 tick/s. Run 12 ticks: 2 counted bars, step, 1 count-in bar.
  for (let t = 0; t < 12.5; t += 0.05) { ctx.currentTime = t; st.stScheduler(); }
  assert.equal(st.stState.currentBpm, 65);
  assert.equal(st.stState.countInLeft, 0);               // count-in bar finished
  assert.equal(st.stState.barsCompletedAtCurrentBpm, 0); // …and was not counted
  assert.equal(freqs.filter(f => f === 1800).length, 1); // exactly one chime
  // the next counted bar starts counting normally
  for (let t = 12.5; t < 17; t += 0.05) { ctx.currentTime = t; st.stScheduler(); }
  assert.equal(st.stState.barsCompletedAtCurrentBpm, 1);
  global.setTimeout = realSetTimeout;
});

test('stReset returns to Start BPM and clears every counter, even mid-run', () => {
  Object.assign(st.stState, {
    running: false, startBpm: 70, currentBpm: 95, barsCompletedAtCurrentBpm: 3, totalBars: 11,
    countInLeft: 1, pendingCue: { from: 90, to: 95 }, rampDirection: -1,
  });
  st.stReset();
  assert.equal(st.stState.currentBpm, 70);
  assert.equal(st.stState.barsCompletedAtCurrentBpm, 0);
  assert.equal(st.stState.totalBars, 0);
  assert.equal(st.stState.countInLeft, 0);
  assert.equal(st.stState.pendingCue, null);
  assert.equal(st.stState.rampDirection, 1);
});

test('a hand-set tempo beyond Target survives option edits and the ramp never drags it back', () => {
  Object.assign(st.stState, { running: false, startBpm: 60, targetBpm: 100, stepBpm: 5, bounceMode: false, rampDirection: 1 });
  st.stSetCurrentBpm(120);
  st.stOnOptionsChanged();
  assert.equal(st.stState.currentBpm, 120);
  Object.assign(st.stState, { startBpm: 60, targetBpm: 100, stepBpm: 5 }); // (the stub DOM re-read above resets these)
  st.stBumpUp();
  assert.equal(st.stState.currentBpm, 120);
});
