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

test('stChartWindowMs scales with tempo and beats-per-bar (last N bars, not a fixed duration)', () => {
  st.stState.currentBpm = 120;
  st.stState.beatsPerBar = 4;
  // one bar at 120bpm/4-4 = 2000ms; window is 4 bars
  assert.equal(st.stChartWindowMs(), 8000);

  st.stState.currentBpm = 60; // half the tempo -> bar takes twice as long -> window doubles
  assert.equal(st.stChartWindowMs(), 16000);
});
