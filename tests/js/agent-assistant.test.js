// agent-assistant.js is a plain browser <script> — stub just enough of the
// DOM/localStorage globals it touches at module scope to load it (same
// pattern as licks.test.js). getElementById/querySelector return null so the
// render helpers no-op; window is stubbed for agentPageContext's selection read.
global.document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  body: { innerText: '' },
};
global.window = { getSelection: () => null };
let _fakeStore = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(_fakeStore, k) ? _fakeStore[k] : null; },
  setItem(k, v) { _fakeStore[k] = v; },
};

const test = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../../web/agent-assistant.js');

test('agentClamp keeps values within [min, max]', () => {
  assert.equal(agent.agentClamp(100, agent.AGENT_SIDEBAR_WIDTH_MIN, agent.AGENT_SIDEBAR_WIDTH_MAX), agent.AGENT_SIDEBAR_WIDTH_MIN);
  assert.equal(agent.agentClamp(900, agent.AGENT_SIDEBAR_WIDTH_MIN, agent.AGENT_SIDEBAR_WIDTH_MAX), agent.AGENT_SIDEBAR_WIDTH_MAX);
  assert.equal(agent.agentClamp(400, agent.AGENT_SIDEBAR_WIDTH_MIN, agent.AGENT_SIDEBAR_WIDTH_MAX), 400);
});

test('agentFmtDuration renders seconds and minutes', () => {
  assert.equal(agent.agentFmtDuration(2500), '3s');
  assert.equal(agent.agentFmtDuration(65000), '1m5s');
});

test('agentReadSseEvent parses a data+id block and advances the cursor', () => {
  const parsed = agent.agentReadSseEvent('id: 3\ndata: {"type":"delta","text":"hi"}', 0);
  assert.deepEqual(parsed.msg, { type: 'delta', text: 'hi' });
  assert.equal(parsed.nextCursor, 4);
});

test('agentReadSseEvent falls back to fallbackCursor+1 without an id line', () => {
  const parsed = agent.agentReadSseEvent('data: {"type":"done"}', 7);
  assert.equal(parsed.nextCursor, 8);
});

test('agentReadSseEvent returns null for a block with no data line', () => {
  assert.equal(agent.agentReadSseEvent('', 0), null);
});

test('agentFmtContextMeta prefers token counts over char counts', () => {
  assert.equal(
    agent.agentFmtContextMeta({ ctx_tokens: 100, ctx_window: 272000 }),
    '100/272k (0.0%)',
  );
  assert.equal(
    agent.agentFmtContextMeta({ context_chars: 500, context_limit_chars: 384000 }),
    '~500/384k chars 估算 (0.1%)',
  );
  assert.equal(agent.agentFmtContextMeta({}), '');
});

test('agentHumanizeNum abbreviates counts >= 1000 with a "k" suffix, leaves small ones alone', () => {
  assert.equal(agent.agentHumanizeNum(384000), '384k');
  assert.equal(agent.agentHumanizeNum(750), '750');
  assert.equal(agent.agentHumanizeNum(999), '999');
  assert.equal(agent.agentHumanizeNum(1048576), '1,049k');
});

test('agentComposeWithMarks passes through when the tray is empty', () => {
  assert.equal(agent.agentComposeWithMarks('这个和弦为什么这样按？', []), '这个和弦为什么这样按？');
  assert.equal(agent.agentComposeWithMarks('', []), '');
});

test('agentComposeWithMarks composes a structured follow-up with source suffixes', () => {
  const out = agent.agentComposeWithMarks('展开讲', [
    { quote: 'V7 省略五音', source: '助教回答' },
    { quote: 'BPM 120', source: '页面' },
  ]);
  assert.ok(out.startsWith('标记追问（共 2 处）：'));
  assert.ok(out.includes('1. 「V7 省略五音」'));          // 助教回答来源不带后缀（默认来源）
  assert.ok(!out.includes('「V7 省略五音」（'));
  assert.ok(out.includes('2. 「BPM 120」（标注自：页面）'));
  assert.ok(out.endsWith('补充问题：展开讲'));
});

test('agentComposeWithMarks supports marks-only sends (no typed question)', () => {
  const out = agent.agentComposeWithMarks('', [{ quote: 'guide tone', source: '助教回答' }]);
  assert.ok(out.includes('「guide tone」'));
  assert.ok(!out.includes('补充问题'));
});

test('agentComposeWithMarks clips over-long compositions to the backend question limit', () => {
  const out = agent.agentComposeWithMarks('q', [{ quote: 'x'.repeat(5000), source: '' }]);
  assert.ok(out.length <= agent.AGENT_COMPOSE_LIMIT + 20);
  assert.ok(out.includes('截断'));
});

test('agentComposeWithMarks carries the per-mark note as a 批注 line', () => {
  const out = agent.agentComposeWithMarks('', [
    { quote: 'V7 省略五音', source: '助教回答', note: '为什么可以省？' },
    { quote: 'BPM 120', source: '页面', note: '' },
  ]);
  assert.ok(out.includes('1. 「V7 省略五音」\n   批注：为什么可以省？'));
  assert.ok(!out.includes('「BPM 120」（标注自：页面）\n   批注')); // 空批注不占行
});

test('agentNormalizeServerMessage maps a full assistant record into render shape', () => {
  const msg = agent.agentNormalizeServerMessage({
    role: 'assistant', content: '答案', done: true,
    model: 'claude-x', thinkingLevel: 'medium', durationMs: 2500,
  });
  assert.deepEqual(msg, {
    role: 'assistant', content: '答案', done: true, durationMs: 2500,
    runMeta: { model: 'claude-x', thinking: 'medium' },
  });
});

test('agentNormalizeServerMessage keeps error/interrupted flags and defaults done', () => {
  const partial = agent.agentNormalizeServerMessage({ role: 'assistant', content: '半截', interrupted: true });
  assert.deepEqual(partial, { role: 'assistant', content: '半截', done: true, interrupted: true });
  const failed = agent.agentNormalizeServerMessage({ role: 'assistant', content: '', error: true, done: true });
  assert.deepEqual(failed, { role: 'assistant', content: '', done: true, error: true });
  // 没有 model/thinkingLevel 时不出 runMeta（渲染按缺省容错）
  assert.equal(agent.agentNormalizeServerMessage({ role: 'user', content: '问', done: true }).runMeta, undefined);
});

test('agentNormalizeServerMessage carries widgets through, stripped to widget+data', () => {
  const msg = agent.agentNormalizeServerMessage({
    role: 'assistant', content: '试听一下', done: true,
    widgets: [{ name: 'generate_accompaniment', args: {}, widget: 'accompaniment_preview', data: { accompaniment: { key: 'Cm' } } }],
  });
  assert.deepEqual(msg.widgets, [{ widget: 'accompaniment_preview', data: { accompaniment: { key: 'Cm' } } }]);
  // 没有 widgets 时不出该字段（渲染按缺省容错）
  assert.equal(agent.agentNormalizeServerMessage({ role: 'assistant', content: 'x', done: true }).widgets, undefined);
});

test('agentNormalizeServerMessage rejects malformed records', () => {
  assert.equal(agent.agentNormalizeServerMessage(null), null);
  assert.equal(agent.agentNormalizeServerMessage({ role: 'system', content: 'x' }), null);
  assert.equal(agent.agentNormalizeServerMessage({ role: 'user' }), null);
});

test('agentQueueFollowup posts followup:true and keeps the user bubble marked queued on a queued response', async () => {
  const session = { id: 's1', title: 't', serverSynced: true, marks: [], messages: [{ role: 'user', content: '第一问' }] };
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ queued: true, run_id: 'r1', session_id: 's1' }) };
  };
  try {
    await agent.agentQueueFollowup(session, '追问一下', []);
  } finally {
    global.fetch = origFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/agent/runs');
  assert.equal(calls[0].body.followup, true);
  assert.equal(calls[0].body.session_id, 's1');
  // 用户气泡进列表并带排队标记；还没有 assistant 气泡（回答走现有 SSE 流）
  const last = session.messages[session.messages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content, '追问一下');
  assert.equal(last.queued, true);
  assert.equal(session.messages.some(m => m.role === 'assistant'), false);
});

test('agentApplyRunEvent on followup closes the current bubble and starts a new one for the queued question', () => {
  const session = {
    id: 's1',
    messages: [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '完整回答', runId: 'r1' },
      { role: 'user', content: '追问一下', queued: true },
    ],
  };
  const current = session.messages[1];
  const next = agent.agentApplyRunEvent({ type: 'followup' }, current, session);
  assert.equal(current.done, true);                    // 当前气泡封箱
  assert.equal(session.messages[2].queued, undefined); // 排队标记摘除
  assert.equal(session.messages.length, 4);            // 新 assistant 气泡
  assert.equal(next.role, 'assistant');
  assert.equal(next.runId, 'r1');
  assert.equal(next.retryQuestion, '追问一下');
  // 后续 delta 由循环写入新气泡，旧气泡内容不动
  const after = agent.agentApplyRunEvent({ type: 'delta', text: '续答' }, next, session);
  assert.equal(after, next);
  assert.equal(next.content, '续答');
  assert.equal(current.content, '完整回答');
});

test('agentQueueFollowup falls back to attaching a new run when the race response is not queued', async () => {
  const session = { id: 's1', title: 't', serverSynced: true, marks: [], messages: [{ role: 'user', content: '第一问' }] };
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === '/api/agent/runs') {
      return { ok: true, json: async () => ({ run_id: 'r2', session_id: 's1' }) }; // 无 queued：竞态，服务端开了新 run
    }
    // SSE events 端点：返回一条立刻结束的流
    return { ok: true, body: new ReadableStream({ start(c) { c.close(); } }) };
  };
  try {
    await agent.agentQueueFollowup(session, '追问一下', []);
  } finally {
    global.fetch = origFetch;
  }
  assert.equal(session.messages[1].queued, undefined); // 用户气泡的排队标记摘掉
  const last = session.messages[session.messages.length - 1];
  assert.equal(last.role, 'assistant');                // 按正常新 run 补了占位并 attach
  assert.equal(last.runId, 'r2');
  assert.equal(last.retryQuestion, '追问一下');
});
