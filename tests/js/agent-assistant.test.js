// agent-assistant.js is a plain browser <script> — stub just enough of the
// DOM/localStorage globals it touches at module scope to load it (same
// pattern as licks.test.js).
global.document = { addEventListener() {} };
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
