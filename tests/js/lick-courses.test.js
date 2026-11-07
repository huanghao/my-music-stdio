const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../../web/lick-courses.js');

test('course order stays fixed regardless of recent practice order', () => {
  const rows = [{ id: 'b', course_order: 2, last_date: '2026-11-08' }, { id: 'a', course_order: 1 }];
  assert.deepEqual(c.licksCourseOrder(rows).map(l => l.id), ['a', 'b']);
  assert.equal(rows[0].id, 'b');
});

test('search intersects tags and status without exposing other collections', () => {
  const rows = [
    { title: 'High octave', collection: 'Picking', tags: ['跨弦'], status: 'waiting' },
    { title: 'Other', collection: 'Picking', tags: ['琶音'], status: 'active' },
    { title: 'Old', tags: ['跨弦'] },
  ];
  assert.equal(c.licksFilterItems(rows, 'picking', 'waiting', '跨弦').length, 1);
  assert.deepEqual(c.licksFilterItems(rows, '', 'active', '跨弦').map(l => l.title), ['Old']);
  assert.equal(c.licksGroupCourses(rows).length, 1);
  assert.equal(c.licksGroupCourses(rows)[0].lessons.length, 2);
});

test('several tags narrow the list (a lick must carry all of them)', () => {
  const rows = [
    { title: 'A', tags: ['歌曲', '蓝调'] }, { title: 'B', tags: ['歌曲'] }, { title: 'C', tags: ['蓝调'] },
  ];
  assert.deepEqual(c.licksFilterItems(rows, '', '', ['歌曲', '蓝调']).map(l => l.title), ['A']);
  assert.equal(c.licksFilterItems(rows, '', '', []).length, 3);
  assert.equal(c.licksFilterItems(rows, '', '', '歌曲').length, 2);
});

test('older saved tag filters map to the new two-type filter', () => {
  assert.equal(c.licksCourseUiLoad({ getItem: () => JSON.stringify({ tag: '歌曲' }) }).type, '歌曲');
  assert.equal(c.licksCourseUiLoad({ getItem: () => JSON.stringify({ tags: ['蓝调', '练习'] }) }).type, '练习');
  assert.equal(c.licksCourseUiLoad({ getItem: () => JSON.stringify({ tag: '蓝调' }) }).type, '');
});

test('tempo ramp advances only after complete loops and uses the personal goal', () => {
  const settings = c.licksPracticeSettings({
    target_bpm: 110, reference_bpm_max: 180,
    practice_plan: { start_bpm: 70, loop_bars: 8, rounds_per_step: 3, step_bpm: 5 },
  }, 85);
  assert.equal(settings.autoAdvanceBars, 24);
  assert.equal(settings.startBpm, 70);
  assert.equal(settings.currentBpm, 85);
  assert.equal(settings.targetBpm, 110);
  assert.equal(settings.autoAdvance, false);
});

test('switching to an old lick resets the previous lesson rhythm and ramp', () => {
  const old = c.licksPracticeSettings({}, 75);
  assert.equal(old.subdivision, 1);
  assert.equal(old.beatsPerBar, 4);
  assert.equal(old.autoAdvanceBars, 8);
  assert.equal(old.autoAdvance, false);
  assert.equal(old.bounceMode, false);
});

test('course view preferences restore filters, individual panel states and video position', () => {
  const stored = { query: '跨弦', type: '歌曲',
    panels: { 'collection:Picking': true, 'reference:lesson1': false, 'editor:course': true },
    videos: { '/api/materials/demo.mp4': { time: 32, rate: 0.75 } } };
  const storage = { getItem: key => { assert.equal(key, 'lick_course_ui'); return JSON.stringify(stored); } };
  assert.deepEqual(c.licksCourseUiLoad(storage), stored);
});

test('damaged view preferences cannot restore invalid states or playback values', () => {
  assert.deepEqual(c.licksCourseUiLoad({ getItem: () => '{' }), { query: '', type: '', panels: {}, videos: {} });
  const saved = c.licksCourseUiLoad({ getItem: () => JSON.stringify({ query: 42, type: 'bogus',
    panels: { good: true, invalid: 'false' }, videos: { broken: { time: -2, rate: 0 } } }) });
  assert.deepEqual(saved, { query: '', type: '', panels: { good: true }, videos: {} });
});

test('course navigation does not start a second transition while the first is pending', async () => {
  let release;
  const ids = [];
  global.navOpenLick = id => { ids.push(id); return new Promise(resolve => { release = resolve; }); };
  try {
    const first = c.licksOpenCourseLick('a');
    await c.licksOpenCourseLick('b');
    assert.deepEqual(ids, ['a']);
    release(); await first;
    const next = c.licksOpenCourseLick('b');
    assert.deepEqual(ids, ['a', 'b']);
    release(); await next;
  } finally { delete global.navOpenLick; }
});
