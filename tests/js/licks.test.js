// licks.js is a plain browser <script> — stub just enough DOM to load it
// (it registers a DOMContentLoaded listener at module scope, mirroring
// fretboard.js's test setup), plus a fake localStorage for licksApplyOrder.
global.document = { addEventListener() {} };
let _fakeStore = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(_fakeStore, k) ? _fakeStore[k] : null; },
  setItem(k, v) { _fakeStore[k] = v; },
};

const test = require('node:test');
const assert = require('node:assert/strict');
// The vendored marked is UMD/CommonJS-compatible — load it as the global so
// licks.js registers its link renderer (and so licksRewriteLinkSize can lex).
global.marked = require('../../web/vendor/marked.umd.js');
const licks = require('../../web/licks.js');

test('licksYoutubeId extracts the video id from watch/short/embed/youtu.be URLs', () => {
  assert.equal(
    licks.licksYoutubeId('https://www.youtube.com/watch?v=keQUk4VQCi4&list=PLIEs1KQc1yMJmdaoe8_BEyOWmdt14d7yl&index=4'),
    'keQUk4VQCi4'
  );
  assert.equal(licks.licksYoutubeId('https://youtu.be/keQUk4VQCi4'), 'keQUk4VQCi4');
  assert.equal(licks.licksYoutubeId('https://www.youtube.com/embed/keQUk4VQCi4'), 'keQUk4VQCi4');
  assert.equal(licks.licksYoutubeId('https://www.youtube.com/shorts/keQUk4VQCi4'), 'keQUk4VQCi4');
});

test('licksYoutubeId returns null for non-YouTube URLs and empty input', () => {
  assert.equal(licks.licksYoutubeId('https://example.com/chart.png'), null);
  assert.equal(licks.licksYoutubeId(''), null);
  assert.equal(licks.licksYoutubeId(null), null);
});

test('licksPickPracticeBpm prefers last_practiced_bpm over logged sessions and list summary', () => {
  assert.equal(licks.licksPickPracticeBpm({ last_practiced_bpm: 95, sessions: [{ bpm: 80 }], last_bpm: 70 }), 95);
  assert.equal(licks.licksPickPracticeBpm({ sessions: [{ bpm: 80 }, { bpm: 88 }], last_bpm: 70 }), 88);
  assert.equal(licks.licksPickPracticeBpm({ sessions: [], last_bpm: 70 }), 70);
  assert.equal(licks.licksPickPracticeBpm({ sessions: [] }), 60);
  assert.equal(licks.licksPickPracticeBpm({}), 60);
});

test('licksPickPracticeBpm ignores a non-finite last_practiced_bpm (e.g. undefined from a stale cache)', () => {
  assert.equal(licks.licksPickPracticeBpm({ last_practiced_bpm: undefined, sessions: [{ bpm: 82 }] }), 82);
  assert.equal(licks.licksPickPracticeBpm({ last_practiced_bpm: null, last_bpm: 77, sessions: [] }), 77);
});

test('licksSuggestedDurationMin rounds a timed total to the nearest half minute', () => {
  assert.equal(licks.licksSuggestedDurationMin(600), 10);    // exactly 10 min
  assert.equal(licks.licksSuggestedDurationMin(615), 10.5);  // 10.25 min -> rounds to 10.5
  assert.equal(licks.licksSuggestedDurationMin(50), 1);      // 0.83 min -> rounds to nearest 0.5 (1.0)
});

test('licksSuggestedDurationMin falls back to 5 when there is no timer data', () => {
  assert.equal(licks.licksSuggestedDurationMin(0), 5);
  assert.equal(licks.licksSuggestedDurationMin(-1), 5);
  assert.equal(licks.licksSuggestedDurationMin(undefined), 5);
});

test('licksBilibiliId extracts bvid + defaults page to 1, or reads ?p=N', () => {
  assert.deepEqual(licks.licksBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD'), { bvid: 'BV1xx411c7mD', page: '1' });
  assert.deepEqual(licks.licksBilibiliId('https://www.bilibili.com/video/BV1xx411c7mD/?p=3&other=1'), { bvid: 'BV1xx411c7mD', page: '3' });
  assert.deepEqual(licks.licksBilibiliId('https://www.bilibili.com/video/av170001'), { aid: '170001', page: '1' });
});

test('licksBilibiliId rejects a case-mangled bvid instead of embedding the wrong video', () => {
  assert.equal(licks.licksBilibiliId('https://www.bilibili.com/video/bv1xx411c7mD'), null);
});

test('licksBilibiliId returns null for non-Bilibili URLs and empty input', () => {
  assert.equal(licks.licksBilibiliId('https://example.com/chart.png'), null);
  assert.equal(licks.licksBilibiliId(''), null);
  assert.equal(licks.licksBilibiliId(null), null);
});

test('licksParseLinkDirectives parses w=N / width:N, ignores plain tooltip text', () => {
  assert.deepEqual(licks.licksParseLinkDirectives('w=300'), { w: 300 });
  assert.deepEqual(licks.licksParseLinkDirectives('width: 250'), { w: 250 });
  assert.deepEqual(licks.licksParseLinkDirectives('slow-motion angle'), {});
  assert.deepEqual(licks.licksParseLinkDirectives(undefined), {});
});

test('licksParseLinkDirectives requires the separator, so ordinary captions do not collide with the syntax', () => {
  // "page 2" and "y2" read as normal human tooltips, not directives — the
  // separator (: or =) is what distinguishes syntax from a caption that
  // happens to contain one of these words/letters.
  assert.deepEqual(licks.licksParseLinkDirectives('page 2'), {});
  assert.deepEqual(licks.licksParseLinkDirectives('y2'), {});
  assert.deepEqual(licks.licksParseLinkDirectives('W240'), {});
});

test('licksParseLinkDirectives parses page=N and page=N,y=F together', () => {
  assert.deepEqual(licks.licksParseLinkDirectives('page=2'), { page: 2 });
  assert.deepEqual(licks.licksParseLinkDirectives('page=3,y=0.4'), { page: 3, y: 0.4 });
});

test('licksParseLinkDirectives ignores unknown directives while keeping recognized ones', () => {
  assert.deepEqual(licks.licksParseLinkDirectives('page=2,unknown=3'), { page: 2 });
});

test('licksIsPdfUrl / licksIsAudioUrl detect by extension, ignoring query/fragment', () => {
  assert.equal(licks.licksIsPdfUrl('/api/materials/abc_Chapter1.pdf'), true);
  assert.equal(licks.licksIsPdfUrl('/api/materials/abc_Chapter1.pdf?x=1'), true);
  assert.equal(licks.licksIsPdfUrl('/api/materials/abc_backing.mp3'), false);
  assert.equal(licks.licksIsPdfUrl(''), false);

  assert.equal(licks.licksIsAudioUrl('/api/materials/abc_backing.mp3'), true);
  assert.equal(licks.licksIsAudioUrl('/api/materials/abc_backing.wav#t=5'), true);
  assert.equal(licks.licksIsAudioUrl('/api/materials/abc_Chapter1.pdf'), false);
  assert.equal(licks.licksIsAudioUrl(''), false);
});

test('licksMaterialLinkMarkdown: PDFs get a page=1 starting directive, everything else gets a bare link', () => {
  assert.equal(
    licks.licksMaterialLinkMarkdown('Chapter1.pdf', '/api/materials/abc_Chapter1.pdf'),
    '[Chapter1.pdf](/api/materials/abc_Chapter1.pdf "page=1")\n'
  );
  assert.equal(
    licks.licksMaterialLinkMarkdown('backing.mp3', '/api/materials/abc_backing.mp3'),
    '[backing.mp3](/api/materials/abc_backing.mp3)\n'
  );
});

test('licksSafeLinkLabel neutralizes characters that would break Markdown link syntax or the surrounding HTML', () => {
  assert.equal(licks.licksSafeLinkLabel('Solo [Take 2].pdf'), 'Solo _Take 2_.pdf');
  assert.equal(licks.licksSafeLinkLabel('Practice (v2).mp3'), 'Practice _v2_.mp3');
  assert.equal(licks.licksSafeLinkLabel('<img onerror=x>.png'), '_img onerror=x_.png');
  assert.equal(licks.licksSafeLinkLabel('quote".pdf'), 'quote_.pdf');
  assert.equal(licks.licksSafeLinkLabel(undefined), 'file');
});

test('licksMaterialLinkMarkdown sanitizes a filename with Markdown-breaking characters', () => {
  assert.equal(
    licks.licksMaterialLinkMarkdown('Solo [Take 2].pdf', '/api/materials/abc_Solo.pdf'),
    '[Solo _Take 2_.pdf](/api/materials/abc_Solo.pdf "page=1")\n'
  );
});

test('licksApplyOrder: unordered (new) licks come first, then saved order, deleted ids are dropped', () => {
  _fakeStore = { licks_order: JSON.stringify(['b', 'a']) };
  const licksIn = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
  assert.deepEqual(licks.licksApplyOrder(licksIn).map(l => l.id), ['c', 'b', 'a']);
});

test('licksApplyOrder: falls back to server order entirely when nothing saved yet', () => {
  _fakeStore = {};
  const licksIn = [{ id: 'x' }, { id: 'y' }];
  assert.deepEqual(licks.licksApplyOrder(licksIn).map(l => l.id), ['x', 'y']);
});

test('timeAgo renders relative phrases for recent timestamps', () => {
  const now = Date.now();
  assert.equal(licks.timeAgo(new Date(now - 30 * 1000).toISOString()), 'just now');
  assert.equal(licks.timeAgo(new Date(now - 5 * 60 * 1000).toISOString()), '5 minutes ago');
  assert.equal(licks.timeAgo(new Date(now - 60 * 1000).toISOString()), '1 minute ago');
  assert.equal(licks.timeAgo(new Date(now - 3 * 3600 * 1000).toISOString()), '3 hours ago');
  assert.equal(licks.timeAgo(new Date(now - 2 * 86400 * 1000).toISOString()), '2 days ago');
});

test('timeAgo falls back to fmtDate-style output for timestamps a week or older', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 86400 * 1000);
  const result = licks.timeAgo(eightDaysAgo.toISOString());
  // fmtDate's format: "Jan 1, 2026" — just assert it's NOT a relative phrase
  assert.ok(!/ago$/.test(result));
});

test('timeAgo returns em dash for a missing timestamp', () => {
  assert.equal(licks.timeAgo(null), '—');
  assert.equal(licks.timeAgo(undefined), '—');
});

test('licksAudioEmbedHtml renders an inline mini-player plus the Song Loop hand-off, defaulting to 1x', () => {
  global.htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = licks.licksAudioEmbedHtml('/materials/backing.mp3', 'Backing');
  assert.match(html, /class="lick-audio-player" data-url="\/materials\/backing\.mp3"/);
  assert.match(html, /<option value="1" selected>1x<\/option>/);
  assert.match(html, /onclick="licksPracticeWithSongLoop\(this\)"/);
});

test('licksAudioEmbedHtml restores the per-URL saved speed (and ignores values outside the offered set)', () => {
  global.htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  licks.licksAudioSpeedSet('/materials/slow.mp3', 0.75);
  assert.match(licks.licksAudioEmbedHtml('/materials/slow.mp3', ''), /<option value="0.75" selected>0.75x<\/option>/);
  licks.licksAudioSpeedSet('/materials/weird.mp3', 3);
  assert.match(licks.licksAudioEmbedHtml('/materials/weird.mp3', ''), /<option value="1" selected>1x<\/option>/);
});

test('licksAudioSpeedMap tolerates corrupted localStorage data', () => {
  _fakeStore['lick_audio_speed'] = '{not json';
  assert.deepEqual(licks.licksAudioSpeedMap(), {});
  _fakeStore['lick_audio_speed'] = '"a string, not an object"';
  assert.deepEqual(licks.licksAudioSpeedMap(), {});
});

// renderLickChart calls app.js's date formatters — stub them (and count the
// x-axis <text> labels via the y= attribute that only axis labels use).
function stubDateFmt() {
  global.fmtDateShort = iso => {
    const d = new Date(iso);
    return `${d.toLocaleString('en', { month: 'short' })} ${d.getDate()}`;
  };
  global.fmtDate = iso => iso.slice(0, 10);
}
const xAxisLabels = svg => [...svg.matchAll(new RegExp(`<text x="([\\d.]+)" y="154"`, 'g'))]
  .map(m => parseFloat(m[1]));

test('renderLickChart does not overprint x-axis labels for same-day session clusters', () => {
  stubDateFmt();
  const sessions = [
    { date: '2026-07-29T10:00:00', bpm: 60, duration_min: 3 },
    { date: '2026-07-29T18:00:00', bpm: 60, duration_min: 1 },
    { date: '2026-08-01T10:00:00', bpm: 60, duration_min: 3.5 },
  ];
  const xs = xAxisLabels(licks.renderLickChart(sessions, null));
  assert.equal(xs.length, 2); // one label for the Jul 29 cluster, one for Aug 1
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 56);
});

test('renderLickChart always keeps the final session label, dropping the previous one on collision', () => {
  stubDateFmt();
  const sessions = [
    { date: '2026-07-29T10:00:00', bpm: 60, duration_min: 3 },
    { date: '2026-08-01T10:00:00', bpm: 62, duration_min: 2 },
    { date: '2026-08-01T18:00:00', bpm: 64, duration_min: 2 },
  ];
  const xs = xAxisLabels(licks.renderLickChart(sessions, null));
  assert.equal(xs.length, 2);
  // the surviving right-side label is the LAST session's (rightmost x)
  const maxX = Math.max(...xs);
  assert.ok(xs[xs.length - 1] === maxX);
});

// ── licksRewriteLinkSize: drag-resize write-back into the notes Markdown ──

test('licksRewriteLinkSize inserts w= into a title-less video link', () => {
  const notes = 'watch [demo](https://youtu.be/keQUk4VQCi4) slowly';
  assert.equal(
    licks.licksRewriteLinkSize(notes, 0, { w: 480 }),
    'watch [demo](https://youtu.be/keQUk4VQCi4 "w=480") slowly'
  );
});

test('licksRewriteLinkSize updates an existing w= value', () => {
  const notes = '[demo](https://youtu.be/keQUk4VQCi4 "w=300")';
  assert.equal(
    licks.licksRewriteLinkSize(notes, 0, { w: 480 }),
    '[demo](https://youtu.be/keQUk4VQCi4 "w=480")'
  );
});

test('licksRewriteLinkSize writes w and h for a PDF link, preserving page=/y= directives', () => {
  const notes = '[score](https://x.com/a.pdf "page=2,y=0.4")';
  assert.equal(
    licks.licksRewriteLinkSize(notes, 0, { w: 900.4, h: 700 }),
    '[score](https://x.com/a.pdf "page=2,y=0.4,w=900,h=700")' // w rounded
  );
});

test('licksRewriteLinkSize preserves a plain caption in the title when appending w=', () => {
  const notes = '[score](https://x.com/a.pdf "my caption")';
  assert.equal(
    licks.licksRewriteLinkSize(notes, 0, { w: 700, h: 500 }),
    '[score](https://x.com/a.pdf "my caption,w=700,h=500")'
  );
});

test('licksRewriteLinkSize counts only video/PDF links — plain and audio links do not consume an ordinal', () => {
  const notes = '[plain](https://example.com) [audio](https://x.com/t.mp3) [v](https://youtu.be/keQUk4VQCi4) [s](https://x.com/b.pdf)';
  assert.equal(
    licks.licksRewriteLinkSize(notes, 1, { w: 800 }),
    '[plain](https://example.com) [audio](https://x.com/t.mp3) [v](https://youtu.be/keQUk4VQCi4) [s](https://x.com/b.pdf "w=800")'
  );
});

test('licksRewriteLinkSize disambiguates identical duplicate links by ordinal', () => {
  const link = '[demo](https://youtu.be/keQUk4VQCi4)';
  const notes = `${link} and ${link}`;
  assert.equal(
    licks.licksRewriteLinkSize(notes, 1, { w: 500 }),
    `${link} and [demo](https://youtu.be/keQUk4VQCi4 "w=500")`
  );
});

test('licksRewriteLinkSize returns null for an out-of-range ordinal', () => {
  assert.equal(licks.licksRewriteLinkSize('[demo](https://youtu.be/keQUk4VQCi4)', 3, { w: 500 }), null);
});

test('licksRewriteLinkSize returns null for a single-quote title instead of mangling it', () => {
  const notes = "[demo](https://youtu.be/keQUk4VQCi4 'w=300')";
  assert.equal(licks.licksRewriteLinkSize(notes, 0, { w: 500 }), null);
});

test('licksRewriteLinkSize returns null when no size is given', () => {
  assert.equal(licks.licksRewriteLinkSize('[demo](https://youtu.be/keQUk4VQCi4)', 0, {}), null);
});
