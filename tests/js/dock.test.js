// dock.js / dock-win.js are plain browser <script>s; only the pure parts are tested here.
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.window = { innerWidth: 1500, innerHeight: 900 };
global.document = { addEventListener() {}, getElementById: () => null, documentElement: { classList: { toggle() {} }, style: { setProperty() {} } } };
global.addEventListener = () => {};

const test = require('node:test');
const assert = require('node:assert/strict');
const dock = require('../../web/dock.js');
const board = require('../../web/licks-board.js');

test('dockInset reserves width only on the side the dock is on', () => {
  dock.dockState.side = 'r';
  assert.equal(dock.dockInset('r'), 56);
  assert.equal(dock.dockInset('l'), 0);
  dock.dockState.side = 'l';
  assert.equal(dock.dockInset('l'), 56);
  assert.equal(dock.dockInset('r'), 0);
});

test('dock items that depend on page-only globals report unavailable instead of throwing', () => {
  const st = dock.DOCK_ITEMS.find(i => i.id === 'st');
  assert.equal(st.avail(), false);   // no lkwIsAvailable on a page without a Lick
  const ag = dock.DOCK_ITEMS.find(i => i.id === 'ag');
  assert.equal(ag.avail(), false);   // agent script not loaded
});

test('lkfLoad restores only well-formed floated-block records for the requested lick', () => {
  store.lick_floats = JSON.stringify({
    'lick-1': { tracks: { x: 10, y: 20, w: 400, open: false }, bad: { x: 'a', open: true }, nul: null },
    'lick-2': { tracks: { x: 1, y: 2 } },
  });
  const f = board.lkfLoad('lick-1');
  assert.deepEqual(f.tracks, { x: 10, y: 20, w: 400, open: false });
  assert.deepEqual(f.bad, { x: null, y: null, w: null, open: true });
  assert.deepEqual(Object.keys(board.lkfLoad('missing')), []);
  store.lick_floats = '{not json';
  assert.deepEqual(board.lkfLoad('lick-1'), {});
});

test('lsJson falls back on missing, corrupt, falsy values and throwing storage', () => {
  const { lsJson } = require('../../web/ls.js');
  assert.deepEqual(lsJson('nope', { a: 1 }), { a: 1 });
  store.bad = '{oops'; assert.deepEqual(lsJson('bad', {}), {});
  store.zero = 'null'; assert.deepEqual(lsJson('zero', {}), {});
  store.ok = '{"x":2}'; assert.deepEqual(lsJson('ok', {}), { x: 2 });
});
