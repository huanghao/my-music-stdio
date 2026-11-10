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
  const f = b.lkbNormalizeLayout({ blocks: [{ ...blk('x', 0, 0, 60, 100), fit: false }, { ...blk('y', 0, 0, 60, 100), fit: 'maybe' }] });
  assert.deepEqual(f.blocks.map(o => o.fit), [false, undefined]);
});

test('lkbPlaceNew puts a block next to the last one if it fits, else on a new row', () => {
  const blocks = [blk('a', 0, 0, 60, 300)];
  const side = { w: 60, h: 100 }; b.lkbPlaceNew(blocks, side);
  assert.equal(side.x, 60); assert.equal(side.y, 0);
  blocks.push(blk('b', 60, 0, 60, 200));
  const below = { w: 60, h: 100 }; b.lkbPlaceNew(blocks, below);
  assert.equal(below.x, 0); assert.equal(below.y, 310); // bottom 300 + GAP 10, snapped
});

test('lkbCompact packs blocks upward and leftward without overlaps', () => {
  const out = b.lkbCompact([
    { id: 'a', x: 0, y: 0, w: 60, h: 200 },
    { id: 'c', x: 60, y: 300, w: 60, h: 100 },   // floats below nothing → moves up beside a
    { id: 'd', x: 30, y: 500, w: 90, h: 100 },   // under both → just below them
  ]);
  const by = Object.fromEntries(out.map(o => [o.id, o]));
  assert.equal(by.c.y, 0); assert.equal(by.c.x, 60);
  assert.equal(by.d.y, 210);                                    // a ends at 200 + GAP
  assert.equal(by.d.x, 0);                                      // and it slides left once nothing is in the way
  assert.ok(out.every((p, i) => out.every((q, j) => i === j || !b.lkbHit(p, q))));
});

test('lkbCompact slides a block left into free space, and stacks blocks that share columns in order', () => {
  const out = b.lkbCompact([{ id: 'a', x: 70, y: 40, w: 50, h: 100 }, { id: 'b', x: 70, y: 400, w: 50, h: 100 }]);
  assert.deepEqual(out.map(o => [o.id, o.x, o.y]), [['a', 0, 0], ['b', 50, 0]]);   // both fit side by side
  const st = b.lkbCompact([{ id: 'a', x: 0, y: 40, w: 120, h: 100 }, { id: 'b', x: 0, y: 400, w: 120, h: 100 }]);
  assert.deepEqual(st.map(o => [o.id, o.y]), [['a', 0], ['b', 110]]);
});

test('lkbCompact: a block dropped below everything keeps its row when it is full width', () => {
  const out = b.lkbCompact([{ id: 'a', x: 0, y: 0, w: 60, h: 100 }, { id: 'b', x: 60, y: 0, w: 60, h: 300 }, { id: 'f', x: 0, y: 900, w: 120, h: 50 }]);
  assert.equal(out.find(o => o.id === 'f').y, 310);
});

test('lkbShiftRight: a block that grows pushes its right neighbour along instead of dropping it a row', () => {
  const items = [{ id: 'a', x: 0, y: 0, w: 80, h: 100 }, { id: 'b', x: 60, y: 0, w: 40, h: 100 }];
  b.lkbShiftRight(items, items[0]);
  assert.deepEqual([items[1].x, items[1].w], [80, 40]);
  assert.ok(b.lkbCompact(items).every(o => o.y === 0));                       // still one row
  const tight = [{ id: 'a', x: 0, y: 0, w: 100, h: 100 }, { id: 'b', x: 60, y: 0, w: 60, h: 100 }, { id: 'c', x: 0, y: 200, w: 120, h: 50 }];
  b.lkbShiftRight(tight, tight[0]);
  assert.deepEqual([tight[1].x, tight[1].w], [100, 20]);                       // narrowed to the minimum that fits
  assert.equal(tight[2].x, 0);                                                 // blocks in other rows are untouched
  const stacked = [{ id: 'a', x: 0, y: 0, w: 80, h: 300 }, { id: 'u', x: 0, y: 200, w: 50, h: 100 }];
  b.lkbShiftRight(stacked, stacked[0]);
  assert.equal(stacked[1].x, 0);                                               // a block starting at the same x is below it, not beside it
  const full = [{ id: 'a', x: 0, y: 0, w: 120, h: 100 }, { id: 'b', x: 60, y: 0, w: 60, h: 100 }];
  b.lkbShiftRight(full, full[0]);
  assert.equal(b.lkbCompact(full).find(o => o.id === 'b').y, 110);             // no room: stacked below
});

test('lkbDock splits the target: the dragged block takes half beside it', () => {
  const T = { id: 't', x: 0, y: 100, w: 120, h: 200 }, d = { id: 'd', x: 50, y: 700, w: 60, h: 100 };
  b.lkbDock(T, d, 'R');
  assert.deepEqual([T.x, T.w, d.x, d.w, d.y], [0, 60, 60, 60, 100]);
  const T2 = { id: 't', x: 40, y: 0, w: 80, h: 100 }, d2 = { id: 'd', x: 0, y: 500, w: 30, h: 100 };
  b.lkbDock(T2, d2, 'L');
  assert.deepEqual([d2.x, d2.w, T2.x, T2.w], [40, 40, 80, 40]);
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
