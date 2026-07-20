// practice-timer.js is a plain browser <script>. The pure functions under
// test never touch `document`, but the stateful ptStart/ptPause/etc. call
// ptRender() internally, which looks up '#pt-row' — stub it to return null
// (ptRender() already no-ops gracefully when the row isn't found) so those
// state-transition tests don't need a full DOM.
global.document = { getElementById() { return null; } };

const test = require('node:test');
const assert = require('node:assert/strict');
const pt = require('../../web/practice-timer.js');

test('ptFmtTime formats seconds as m:ss, rounding and clamping negative input to 0:00', () => {
  assert.equal(pt.ptFmtTime(0), '0:00');
  assert.equal(pt.ptFmtTime(5), '0:05');
  assert.equal(pt.ptFmtTime(65), '1:05');
  assert.equal(pt.ptFmtTime(600), '10:00');
  assert.equal(pt.ptFmtTime(599.6), '10:00'); // rounds up to the next second
  assert.equal(pt.ptFmtTime(-5), '0:00');
});

test('ptRemainingSec computes seconds left from an end timestamp and "now"', () => {
  const now = 1_000_000;
  assert.equal(pt.ptRemainingSec(now + 10_000, now), 10);
  assert.equal(pt.ptRemainingSec(now - 5_000, now), -5); // already elapsed
  assert.equal(pt.ptRemainingSec(now, now), 0);
});

test('PT_PRESET_MIN offers the documented common durations in ascending order', () => {
  assert.deepEqual(pt.PT_PRESET_MIN, [5, 10, 15]);
});

test('ptTodayTotalSec sums only blocks completed today, ignoring other days', () => {
  const today = new Date().toISOString().slice(0, 10);
  const original = pt.ptState.blocks;
  try {
    pt.ptState.blocks = [
      { durationSec: 300, completedAt: `${today}T09:00:00.000Z`, context: null },
      { durationSec: 600, completedAt: `${today}T14:00:00.000Z`, context: { lickId: 'x', lickTitle: 'X' } },
      { durationSec: 900, completedAt: '2020-01-01T09:00:00.000Z', context: null }, // a different day
    ];
    assert.equal(pt.ptTodayTotalSec(), 900); // 300 + 600, excludes the 2020 entry
  } finally {
    pt.ptState.blocks = original;
  }
});

test('ptTodayTotalSec returns 0 when there are no blocks yet', () => {
  const original = pt.ptState.blocks;
  try {
    pt.ptState.blocks = [];
    assert.equal(pt.ptTodayTotalSec(), 0);
  } finally {
    pt.ptState.blocks = original;
  }
});

test('ptSecondsForContextSince sums only blocks for the given lick on/after the given timestamp', () => {
  const original = pt.ptState.blocks;
  try {
    pt.ptState.blocks = [
      { durationSec: 300, completedAt: '2026-07-19T09:00:00.000Z', context: { lickId: 'a', lickTitle: 'A' } },
      { durationSec: 600, completedAt: '2026-07-19T09:10:00.000Z', context: { lickId: 'a', lickTitle: 'A' } },
      { durationSec: 900, completedAt: '2026-07-19T09:05:00.000Z', context: { lickId: 'b', lickTitle: 'B' } }, // different lick
      { durationSec: 100, completedAt: '2026-07-19T08:00:00.000Z', context: { lickId: 'a', lickTitle: 'A' } }, // before "since"
      { durationSec: 200, completedAt: '2026-07-19T09:15:00.000Z', context: null }, // untied block
    ];
    assert.equal(pt.ptSecondsForContextSince('a', '2026-07-19T09:00:00.000Z'), 900); // 300 + 600
    assert.equal(pt.ptSecondsForContextSince('b', '2026-07-19T09:00:00.000Z'), 900);
    assert.equal(pt.ptSecondsForContextSince('c', '2026-07-19T09:00:00.000Z'), 0); // no blocks at all
  } finally {
    pt.ptState.blocks = original;
  }
});

test('ptStart -> ptPause -> ptResume preserves the remaining time across the pause', () => {
  const original = { ...pt.ptState };
  try {
    pt.ptStart(10);
    assert.equal(pt.ptState.running, true);
    assert.equal(pt.ptState.paused, false);

    // Simulate 3 minutes having elapsed before pausing
    pt.ptState.endAt = Date.now() + 7 * 60 * 1000;
    pt.ptPause();
    assert.equal(pt.ptState.running, false);
    assert.equal(pt.ptState.paused, true);
    assert.ok(Math.abs(pt.ptState.remainingSec - 7 * 60) < 1);

    pt.ptResume();
    assert.equal(pt.ptState.running, true);
    assert.equal(pt.ptState.paused, false);
    assert.ok(Math.abs(pt.ptRemainingSec(pt.ptState.endAt, Date.now()) - 7 * 60) < 1);
  } finally {
    pt.ptCancel(); // ptResume() above started a real setInterval — stop it or the test process hangs
    Object.assign(pt.ptState, original);
  }
});

test('ptPause is a no-op when not running (already paused or idle)', () => {
  const original = { ...pt.ptState };
  try {
    pt.ptCancel(); // ensure idle
    pt.ptPause();
    assert.equal(pt.ptState.paused, false); // nothing to pause
  } finally {
    Object.assign(pt.ptState, original);
  }
});

test('ptCancel resets running/paused/remaining state entirely', () => {
  const original = { ...pt.ptState };
  try {
    pt.ptStart(5);
    pt.ptPause();
    pt.ptCancel();
    assert.equal(pt.ptState.running, false);
    assert.equal(pt.ptState.paused, false);
    assert.equal(pt.ptState.remainingSec, 0);
    assert.equal(pt.ptState.endAt, null);
  } finally {
    Object.assign(pt.ptState, original);
  }
});

test('ptToggleLinked flips ptState.linked', () => {
  const original = pt.ptState.linked;
  try {
    pt.ptState.linked = false;
    pt.ptToggleLinked();
    assert.equal(pt.ptState.linked, true);
    pt.ptToggleLinked();
    assert.equal(pt.ptState.linked, false);
  } finally {
    pt.ptState.linked = original;
  }
});

test('ptOnMetronomeStart/Stop only affect the timer when linked, and only resume/pause (never start/cancel)', () => {
  const original = { ...pt.ptState };
  try {
    pt.ptCancel();
    pt.ptState.linked = false;

    // Not linked: metronome events are ignored entirely
    pt.ptOnMetronomeStart();
    assert.equal(pt.ptState.running, false);
    assert.equal(pt.ptState.paused, false);

    // Linked, but timer was never started: starting the metronome must not
    // auto-pick a duration and start a countdown out of nowhere
    pt.ptState.linked = true;
    pt.ptOnMetronomeStart();
    assert.equal(pt.ptState.running, false);
    assert.equal(pt.ptState.paused, false);

    // Linked and paused: metronome starting resumes the timer
    pt.ptStart(10);
    pt.ptPause();
    pt.ptOnMetronomeStart();
    assert.equal(pt.ptState.running, true);
    assert.equal(pt.ptState.paused, false);

    // Linked and running: metronome stopping pauses the timer
    pt.ptOnMetronomeStop();
    assert.equal(pt.ptState.running, false);
    assert.equal(pt.ptState.paused, true);
  } finally {
    Object.assign(pt.ptState, original);
  }
});
