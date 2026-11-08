// Browser smoke test for the Lick detail board. Drives headless Chrome over CDP
// against the running dev server (default http://localhost:3050); read-only.
//   just smoke        (LICK=对四 BASE=http://localhost:3050 to override)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3050';
const LICK = process.env.LICK || '对四';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1500,900',
  `--user-data-dir=${process.env.TMPDIR || '/tmp'}/lick-smoke-profile`, 'about:blank'], { stdio: 'ignore' });
let failed = false;
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://localhost:${port}/json`)).json(); if (targets.length) break; } catch (_) {} await sleep(200); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pend = {};
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); assert.ok(r.result, JSON.stringify(r.error) + ' in: ' + expr.slice(0, 80)); assert.ok(!r.result.exceptionDetails, JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };

  await send('Page.enable');
  await send('Page.navigate', { url: `${BASE}/#/licks/${encodeURIComponent(LICK)}` });
  await send('Page.reload');
  await sleep(4000);

  const blocks = await ev(`document.querySelectorAll('#lkb-canvas .lkb-blk').length`);
  assert.ok(blocks > 0, 'board renders at least one block');

  const overlap = await ev(`(()=>{const r=[...document.querySelectorAll('#lkb-canvas .lkb-blk')].map(e=>e.getBoundingClientRect());
    return r.some((a,i)=>r.some((b,j)=>i<j&&a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1))})()`);
  assert.equal(overlap, false, 'no two blocks overlap');

  assert.equal(await ev(`!!document.querySelector('.lkw .lkw-h') && getComputedStyle(document.querySelector('.lkw')).display !== 'none'`), true, 'practice window is visible');
  assert.equal(await ev(`typeof lkwApply`), 'function');

  const pdfs = await ev(`[...document.querySelectorAll('#lkb-canvas iframe')].filter(f=>{try{return f.contentWindow.PDFViewerApplication.pagesCount>0}catch(e){return false}}).length`);
  const total = await ev(`document.querySelectorAll('#lkb-canvas iframe').length`);
  assert.equal(pdfs, total, 'every PDF block loaded');

  // A session refresh must not reload the PDFs.
  if (total > 0) {
    await ev(`window.__pdf0 = document.querySelector('#lkb-canvas iframe').contentWindow; 0`);
    await ev(`licksRefreshSessions(licksState.currentLick)`);
    assert.equal(await ev(`document.querySelector('#lkb-canvas iframe').contentWindow === window.__pdf0`), true, 'PDF iframe survives a sessions refresh');
  }
  console.log(`smoke OK: ${LICK} — ${blocks} blocks, ${total} PDFs`);
} catch (e) {
  failed = true; console.error('smoke FAILED:', e.message);
} finally {
  chrome.kill();
}
process.exit(failed ? 1 : 0);
