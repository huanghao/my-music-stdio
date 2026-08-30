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
