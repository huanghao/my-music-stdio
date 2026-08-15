// Floating agent assistant — a TA-style helper pinned bottom-right that
// overlays whatever page is open (position: fixed), never a docked sidebar,
// so it never reflows any page's own layout. Page-independent (like
// practice-timer.js), initialized once from app.js's init().
//
// Talks to src/server.py's /api/agent/* endpoints, which relay to
// src/agent_client.py — the local claude/kc/mc CLIs already authenticated on
// this machine (~/.config/agent-backends.yaml), no API key of this app's own
// to manage. This file assembles no music theory itself: agentPageContext()
// defers to fbCidAgentContext() (chord-id.js) when Chord ID is the active
// tab, which reuses the exact same theory-engine functions the page itself
// renders with — the agent reasons over the same roman numerals, cadences
// and candidate readings the UI is showing, not a re-derivation of its own.

const AGENT_PREFS_KEY = 'mps_agent_prefs';
const AGENT_SESSION_LIMIT = 12;
const AGENT_HISTORY_LIMIT = 30;

function agentNewSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let agentState = {
  open: false,
  backend: null, // null = server default
  panelWidth: 400,
  panelHeight: 520,
  sessions: [{ id: agentNewSessionId(), title: '新对话', messages: [] }],
  activeId: null, // set right below, from sessions[0]
};
agentState.activeId = agentState.sessions[0].id;

let agentBackends = [];
let agentController = null;
let agentLoading = false;

function agentActiveSession() {
  return agentState.sessions.find(s => s.id === agentState.activeId) || agentState.sessions[0];
}

// ── Persistence (project convention: every UI option survives a refresh) ──

function agentPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(AGENT_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  if (typeof saved.backend === 'string') agentState.backend = saved.backend;
  if (Number.isFinite(saved.panelWidth)) agentState.panelWidth = saved.panelWidth;
  if (Number.isFinite(saved.panelHeight)) agentState.panelHeight = saved.panelHeight;
  if (typeof saved.open === 'boolean') agentState.open = saved.open;
  if (Array.isArray(saved.sessions) && saved.sessions.length) {
    const valid = saved.sessions
      .filter(s => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map(s => ({
        id: s.id,
        title: typeof s.title === 'string' && s.title ? s.title : '新对话',
        messages: s.messages
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-AGENT_HISTORY_LIMIT),
      }));
    if (valid.length) agentState.sessions = valid.slice(0, AGENT_SESSION_LIMIT);
  }
  agentState.activeId = (typeof saved.activeId === 'string' && agentState.sessions.some(s => s.id === saved.activeId))
    ? saved.activeId : agentState.sessions[0].id;
}

function agentPrefsSave() {
  localStorage.setItem(AGENT_PREFS_KEY, JSON.stringify({
    open: agentState.open, backend: agentState.backend,
    panelWidth: agentState.panelWidth, panelHeight: agentState.panelHeight,
    sessions: agentState.sessions, activeId: agentState.activeId,
  }));
}

// ── Page context — the one part that varies by page ──

function agentPageContext() {
  const chordIdActive = document.getElementById('fb-chordid')?.classList.contains('active');
  if (chordIdActive && typeof fbCidAgentContext === 'function') {
    return { page: 'chord-id', title: 'Chord ID — 和弦识别与和声进行', data: fbCidAgentContext() };
  }
  // Generic fallback for every other page: whichever top-level page is
  // showing, its visible text — same shape mnl-workers-portal's assistant
  // uses when a route has no richer structured context wired up yet.
  const activePage = document.querySelector('.page.active');
  const visibleText = (activePage?.innerText || document.body.innerText || '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
  return { page: activePage?.id?.replace('page-', '') || '', title: document.title, data: {}, visibleText };
}

// ── Rendering ──

function agentSetOpenUI(open) {
  document.getElementById('agent-panel')?.classList.toggle('open', open);
  document.getElementById('agent-toggle')?.classList.toggle('hidden', open);
}

function agentRenderMessages() {
  const el = document.getElementById('agent-messages');
  if (!el) return;
  const session = agentActiveSession();
  if (!session.messages.length) {
    el.innerHTML = '<div class="agent-empty">可以问某个和弦为什么这么判断、还有哪些备选读法、终止式是什么，或者练习上遇到的其他问题。</div>';
    return;
  }
  el.innerHTML = session.messages.map(m => {
    const bubble = m.role === 'user'
      ? `<div class="agent-msg-bubble">${htmlEsc(m.content)}</div>`
      : `<div class="agent-msg-bubble">${typeof marked !== 'undefined' ? marked.parse(m.content || '') : htmlEsc(m.content || '')}</div>`;
    const meta = (m.role === 'assistant' && Number.isFinite(m.durationMs))
      ? `<div class="agent-msg-meta">${(m.durationMs / 1000).toFixed(1)}s</div>` : '';
    return `<div class="agent-msg agent-msg-${m.role}">${bubble}${meta}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function agentRenderSessions() {
  const sel = document.getElementById('agent-session-select');
  if (!sel) return;
  sel.innerHTML = agentState.sessions.map(s =>
    `<option value="${htmlEsc(s.id)}" ${s.id === agentState.activeId ? 'selected' : ''}>${htmlEsc(s.title)}</option>`
  ).join('');
}

async function agentRenderBackends() {
  const sel = document.getElementById('agent-backend-select');
  if (!sel) return;
  try {
    agentBackends = await (await fetch('/api/agent/backends')).json();
  } catch (_) {
    agentBackends = [];
  }
  if (!agentBackends.length) { sel.innerHTML = '<option value="">默认</option>'; return; }
  sel.innerHTML = agentBackends.map(b => {
    const label = b.unavailable_reason ? `${b.name}（不可用）` : b.name;
    const title = b.description + (b.unavailable_reason ? ' — ' + b.unavailable_reason : '');
    return `<option value="${htmlEsc(b.name)}" ${b.unavailable_reason ? 'disabled' : ''} title="${htmlEsc(title)}">${htmlEsc(label)}</option>`;
  }).join('');
  const wanted = agentState.backend || agentBackends.find(b => b.default)?.name;
  if (wanted && [...sel.options].some(o => o.value === wanted)) sel.value = wanted;
}

function agentSetStatus(text, isError) {
  const el = document.getElementById('agent-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

// ── Actions ──

function agentOpen() {
  agentState.open = true;
  agentSetOpenUI(true);
  agentRenderMessages();
  agentPrefsSave();
  document.getElementById('agent-input')?.focus();
}

function agentClose() {
  agentState.open = false;
  agentSetOpenUI(false);
  agentPrefsSave();
}

function agentNewSession() {
  if (agentLoading) return;
  const session = { id: agentNewSessionId(), title: '新对话', messages: [] };
  agentState.sessions.unshift(session);
  if (agentState.sessions.length > AGENT_SESSION_LIMIT) agentState.sessions.length = AGENT_SESSION_LIMIT;
  agentState.activeId = session.id;
  agentRenderSessions();
  agentRenderMessages();
  agentPrefsSave();
}

function agentSwitchSession(id) {
  if (agentLoading || !agentState.sessions.some(s => s.id === id)) return;
  agentState.activeId = id;
  agentRenderMessages();
  agentPrefsSave();
}

function agentSetBackend(name) {
  agentState.backend = name || null;
  agentPrefsSave();
}

function agentCancel() {
  if (agentController) agentController.abort();
}

// Sending has its own re-entrancy guard (agentLoading, checked and set
// synchronously before any await) that lasts the whole in-flight request —
// stronger than guarded()'s fixed debounce window would give it, so this
// doesn't need that wrapper (same "already has an internal lock" exemption
// fretboard.js's answer buttons get).
async function agentSend() {
  if (agentLoading) return;
  const input = document.getElementById('agent-input');
  const question = (input?.value || '').trim();
  if (!question) return;
  input.value = '';

  const session = agentActiveSession();
  session.messages.push({ role: 'user', content: question });
  if (session.messages.length === 1) session.title = question.slice(0, 24) || '新对话';
  if (session.messages.length > AGENT_HISTORY_LIMIT) session.messages.splice(0, session.messages.length - AGENT_HISTORY_LIMIT);
  agentRenderSessions();

  const assistantMsg = { role: 'assistant', content: '' };
  session.messages.push(assistantMsg);
  agentRenderMessages();
  agentPrefsSave();

  agentLoading = true;
  agentController = new AbortController();
  const startedAt = Date.now();
  agentSetStatus('思考中…');
  const sendBtn = document.getElementById('agent-send-btn');
  const cancelBtn = document.getElementById('agent-cancel-btn');
  if (sendBtn) sendBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = '';

  try {
    const res = await fetch('/api/agent/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: agentController.signal,
      body: JSON.stringify({
        question,
        backend: agentState.backend || null,
        history: session.messages.slice(0, -2).slice(-8).map(({ role, content }) => ({ role, content })),
        context: agentPageContext(),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop();
      for (const ev of events) {
        if (!ev.startsWith('data: ')) continue;
        let msg;
        try { msg = JSON.parse(ev.slice(6)); } catch (_) { continue; }
        if (msg.type === 'delta') {
          assistantMsg.content += msg.text;
          agentRenderMessages();
        } else if (msg.type === 'thinking') {
          agentSetStatus('思考中…' + (msg.text ? ' ' + msg.text.slice(-60).replace(/\n/g, ' ') : ''));
        } else if (msg.type === 'error') {
          assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + `（出错了：${msg.message}）`;
          agentRenderMessages();
        }
      }
    }
    assistantMsg.durationMs = Date.now() - startedAt;
    agentSetStatus('');
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + '（已取消）';
      agentSetStatus('已取消');
    } else {
      assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + `（请求失败：${e.message || e}）`;
      agentSetStatus('请求失败', true);
    }
  } finally {
    agentLoading = false;
    agentController = null;
    if (sendBtn) sendBtn.style.display = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
    agentRenderMessages();
    agentPrefsSave();
  }
}

// ── Panel resize (drag the top-left corner handle — the panel is anchored
// bottom-right, so growing it means growing up-and-left) ──

function agentInitResize() {
  const handle = document.getElementById('agent-resize-handle');
  const panel = document.getElementById('agent-panel');
  if (!handle || !panel) return;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startW = agentState.panelWidth, startH = agentState.panelHeight;
    function onMove(ev) {
      agentState.panelWidth = Math.max(320, Math.min(window.innerWidth - 40, startW + (startX - ev.clientX)));
      agentState.panelHeight = Math.max(320, Math.min(window.innerHeight - 40, startH + (startY - ev.clientY)));
      panel.style.width = agentState.panelWidth + 'px';
      panel.style.height = agentState.panelHeight + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      agentPrefsSave();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function agentInit() {
  agentPrefsLoad();
  const panel = document.getElementById('agent-panel');
  if (panel) {
    panel.style.width = agentState.panelWidth + 'px';
    panel.style.height = agentState.panelHeight + 'px';
  }
  agentSetOpenUI(agentState.open); // restore, but don't steal focus like a fresh agentOpen() would
  agentRenderSessions();
  agentRenderMessages();
  agentRenderBackends();
  agentInitResize();
  const input = document.getElementById('agent-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); agentSend(); }
    });
  }
}
