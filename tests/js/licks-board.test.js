// licks-board.js is a plain browser <script>; only its pure layout logic is
// tested here (collision push-aside, default placement, layout normalisation).
global.window = { innerWidth: 1500 };
global.document = { addEventListener() {} };
global.addEventListener = () => {};

const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../../web/licks-board.js');

const blk = (id, x, y, w, h) => ({ id, of: id, x, y, w, h, page: 1 });
b.lkb.canvas = { clientWidth: 1200 }; // 10px per column

test('lkbNormalizeLayout drops malformed entries and defaults the rest', () => {
  const L = b.lkbNormalizeLayout({ hidden: ['a', 3], blocks: [blk('ok', 0, 0, 60, 100), { id: 'bad', x: 'x' }, null] });
  assert.deepEqual(L.hidden, ['a']);
  assert.equal(L.blocks.length, 1);
  assert.deepEqual(b.lkbNormalizeLayout(null), { v: 1, hidden: [], blocks: [] });
});

test('lkbPlaceNew puts a block next to the last one if it fits, else on a new row', () => {
  const blocks = [blk('a', 0, 0, 60, 300)];
  const side = { w: 60, h: 100 }; b.lkbPlaceNew(blocks, side);
  assert.equal(side.x, 60); assert.equal(side.y, 0);
  blocks.push(blk('b', 60, 0, 60, 200));
  const below = { w: 60, h: 100 }; b.lkbPlaceNew(blocks, below);
  assert.equal(below.x, 0); assert.equal(below.y, 310); // bottom 300 + GAP 10, snapped
});

test('lkbResolve pushes an overlapped block right when that is the smaller shift, else down', () => {
  const a = blk('a', 0, 0, 60, 300), o = blk('o', 50, 0, 40, 300);
  b.lkbResolve(a, [a, o]);
  assert.equal(o.x, 60);          // moved right by 10 cols (100px) < down shift (310px)
  assert.equal(o.y, 0);
  const wide = blk('w', 0, 0, 120, 100), under = blk('u', 0, 50, 120, 100);
  b.lkbResolve(wide, [wide, under]);
  assert.equal(under.y, 110);     // no room on the right → goes below
  assert.equal(b.lkbOverlap(wide, under), false);
});

test('lkbResolve never moves the fixed block and terminates on chains', () => {
  const fixed = blk('f', 0, 0, 40, 100);
  const others = [blk('1', 20, 0, 40, 100), blk('2', 50, 0, 40, 100), blk('3', 80, 0, 40, 100)];
  b.lkbResolve(fixed, [fixed, ...others]);
  assert.deepEqual([fixed.x, fixed.y], [0, 0]);
  for (const o of others) assert.equal(b.lkbOverlap(fixed, o), false);
});

test('lkbReconcile places new sources, drops vanished ones and respects hidden', () => {
  b.lkb.sources = new Map([['text', { id: 'text', kind: 'text' }], ['pdf:x', { id: 'pdf:x', kind: 'pdf', page: 2 }], ['img:h', { id: 'img:h', kind: 'img' }]]);
  b.lkb.layout = { v: 1, hidden: ['img:h', 'gone'], blocks: [blk('text', 0, 0, 60, 200), blk('ghost', 0, 300, 60, 100)] };
  b.lkbReconcile();
  const ids = b.lkb.layout.blocks.map(x => x.id);
  assert.deepEqual(ids, ['text', 'pdf:x']);              // ghost dropped, hidden img not added
  assert.deepEqual(b.lkb.layout.hidden, ['img:h']);      // vanished 'gone' pruned
  assert.equal(b.lkb.layout.blocks[1].page, 2);          // new pdf block starts on the source's page
});
