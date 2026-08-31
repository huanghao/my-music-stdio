// Floating/sidebar agent assistant — a TA-style helper that defaults to
// floating bottom-right (position: fixed, overlays whatever page is open,
// never reflows layout) but can also dock as a right sidebar (agentState.mode
// === 'sidebar', collapsible + drag-resizable, does push page layout via a
// body-level padding — see .agent-sidebar-open in style.css). Page-independent
// (like practice-timer.js), initialized once from app.js's init().
//
// Talks to src/server.py's /api/agent/* endpoints, which relay to
// src/agent_client.py — direct Anthropic-protocol calls (Pydantic AI), no CLI
// subprocess. This file assembles no music theory itself: agentPageContext()
// defers to fbCidAgentContext() (chord-id.js) when Chord ID is active, reusing
// the exact same theory-engine functions the page itself renders with — the
// agent reasons over the same roman numerals/candidate readings the UI is
// showing, not a re-derivation of its own.

const AGENT_PREFS_KEY = 'mps_agent_prefs';
const AGENT_SESSION_LIMIT = 12;
const AGENT_HISTORY_LIMIT = 30;
const AGENT_FALLBACK_CONTEXT_CHARS = 128000 * 3;
const AGENT_CONTEXT_TEXT_LIMIT = 6000;
const AGENT_SELECTED_TEXT_LIMIT = 2000;
const AGENT_SIDEBAR_WIDTH_MIN = 280;
const AGENT_SIDEBAR_WIDTH_MAX = 640;
const AGENT_INPUT_HEIGHT_MIN = 36;
const AGENT_INPUT_HEIGHT_MAX = 400;
const AGENT_MARK_QUOTE_LIMIT = 400;  // 单条引用上限，防止整段谱例灌爆 question 的 4000 字上限
const AGENT_MARK_LIMIT = 10;
const AGENT_COMPOSE_LIMIT = 3900;    // 后端 AgentAskRequest.question max_length=4000，留余量

function agentNewSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function agentClamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Human-readable shorthand for big counts (384000 -> "384k") — only kicks in
// above 1000, small counts stay as plain numbers.
function agentHumanizeNum(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n >= 1000) return Math.round(n / 1000).toLocaleString() + 'k';
  return n.toLocaleString();
}

let agentState = {
  open: false,
  provider: null, // null = server default
  model: null,
  thinking: null,
  modelByProvider: {}, // { [providerName]: { model, thinking } } — remembered per-provider choice
  mode: 'float', // 'float' | 'sidebar'
  sidebarWidth: 360,
  sidebarCollapsed: false,
  panelWidth: 400,
  panelHeight: 520,
  inputHeight: 60,
  sessions: [{ id: agentNewSessionId(), title: '新对话', messages: [] }],
  activeId: null, // set right below, from sessions[0]
};
agentState.activeId = agentState.sessions[0].id;

let agentProviders = [];
let agentController = null;
let agentLoading = false;
let agentCurrentRunId = null;
let agentCurrentAttachPromise = null;
let agentTicker = null;   // 1s interval driving the live "思考中… Xs" counter
let agentTickBase = null; // the rest of the status text that the ticker appends the time to

function agentActiveSession() {
  return agentState.sessions.find(s => s.id === agentState.activeId) || agentState.sessions[0];
}

function agentFmtDuration(ms) {
  const secs = Math.max(0, Math.round(ms / 1000));
  return secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
}

function agentReadSseEvent(raw, fallbackCursor) {
  const lines = raw.split('\n');
  const dataLine = lines.find(line => line.startsWith('data: '));
  if (!dataLine) return null;
  let msg;
  try { msg = JSON.parse(dataLine.slice(6)); } catch (_) { return null; }
  const idLine = lines.find(line => line.startsWith('id: '));
  const id = Number.parseInt((idLine || '').slice(4), 10);
  return { msg, nextCursor: Number.isFinite(id) ? id + 1 : fallbackCursor + 1 };
}

// ── Persistence (project convention: every UI option survives a refresh) ──

function agentPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(AGENT_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  if (typeof saved.provider === 'string') agentState.provider = saved.provider;
  if (typeof saved.model === 'string') agentState.model = saved.model;
  if (typeof saved.thinking === 'string') agentState.thinking = saved.thinking;
  if (saved.modelByProvider && typeof saved.modelByProvider === 'object') {
    for (const [name, choice] of Object.entries(saved.modelByProvider)) {
      if (choice && typeof choice === 'object') {
        agentState.modelByProvider[name] = { model: choice.model ?? null, thinking: choice.thinking ?? null };
      }
    }
  }
  if (saved.mode === 'float' || saved.mode === 'sidebar') agentState.mode = saved.mode;
  if (Number.isFinite(saved.sidebarWidth)) agentState.sidebarWidth = agentClamp(saved.sidebarWidth, AGENT_SIDEBAR_WIDTH_MIN, AGENT_SIDEBAR_WIDTH_MAX);
  if (typeof saved.sidebarCollapsed === 'boolean') agentState.sidebarCollapsed = saved.sidebarCollapsed;
  if (Number.isFinite(saved.panelWidth)) agentState.panelWidth = saved.panelWidth;
  if (Number.isFinite(saved.panelHeight)) agentState.panelHeight = saved.panelHeight;
  if (Number.isFinite(saved.inputHeight)) agentState.inputHeight = agentClamp(saved.inputHeight, AGENT_INPUT_HEIGHT_MIN, AGENT_INPUT_HEIGHT_MAX);
  if (typeof saved.open === 'boolean') agentState.open = saved.open;
  if (Array.isArray(saved.sessions) && saved.sessions.length) {
    const valid = saved.sessions
      .filter(s => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map(s => ({
        id: s.id,
        title: typeof s.title === 'string' && s.title ? s.title : '新对话',
        messages: s.messages
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          // Keep the post-hoc context-info meta too — otherwise it vanishes
          // on refresh even though durationMs (also per-message) is kept.
          .map(m => {
            if (m.role !== 'assistant') return m;
            const next = { ...m };
            if (m.contextInfo && typeof m.contextInfo === 'object') next.contextInfo = m.contextInfo;
            if (m.runMeta && typeof m.runMeta === 'object') next.runMeta = m.runMeta;
            if (m.error) next.error = true;
            if (m.done) next.done = true;
            return next;
          })
          .slice(-AGENT_HISTORY_LIMIT),
        // 划词托盘随会话持久化；加载时做类型/长度清洗，防坏数据进 UI
        marks: (Array.isArray(s.marks) ? s.marks : [])
          .filter(m => m && typeof m.quote === 'string' && m.quote)
          .slice(0, AGENT_MARK_LIMIT)
          .map(m => ({
            quote: m.quote.slice(0, AGENT_MARK_QUOTE_LIMIT),
            source: typeof m.source === 'string' ? m.source : '',
          })),
      }));
    if (valid.length) agentState.sessions = valid.slice(0, AGENT_SESSION_LIMIT);
  }
  agentState.activeId = (typeof saved.activeId === 'string' && agentState.sessions.some(s => s.id === saved.activeId))
    ? saved.activeId : agentState.sessions[0].id;
}

function agentPrefsSave() {
  localStorage.setItem(AGENT_PREFS_KEY, JSON.stringify({
    open: agentState.open,
    provider: agentState.provider, model: agentState.model, thinking: agentState.thinking,
    modelByProvider: agentState.modelByProvider,
    mode: agentState.mode, sidebarWidth: agentState.sidebarWidth, sidebarCollapsed: agentState.sidebarCollapsed,
    panelWidth: agentState.panelWidth, panelHeight: agentState.panelHeight, inputHeight: agentState.inputHeight,
    sessions: agentState.sessions, activeId: agentState.activeId,
  }));
}

// ── 划词追问托盘（抄 kolab 的 mark tray）──
// 在助教回答或当前页面里选中一段文本 → 选区旁弹出「＋ 加入追问托盘」→
// 攒成 chip 留在输入框上方，下次提问时和留言合成一条结构化追问发出去。
// 标记按会话存（session.marks），随 agentPrefsSave 持久化、切会话自动切换；
// 发出即清，发送失败原样还原（同 kolab 的乐观清空/失败回滚约定）。

function agentSessionMarks(session) {
  if (!Array.isArray(session.marks)) session.marks = [];
  return session.marks;
}

function agentRenderTray() {
  const tray = document.getElementById('agent-mark-tray');
  if (!tray) return;
  const marks = agentSessionMarks(agentActiveSession());
  tray.classList.toggle('hidden', !marks.length);
  tray.innerHTML = '';
  marks.forEach((m, i) => {
    const chip = document.createElement('span');
    chip.className = 'agent-mchip';
    chip.title = `${m.quote}${m.source && m.source !== '助教回答' ? `\n标注自：${m.source}` : ''}\n（点击定位原文）`;
    chip.innerHTML = `<span class="q">「${htmlEsc(m.quote)}」</span><span class="x">×</span>`;
    chip.querySelector('.x').onclick = (e) => {
      e.stopPropagation();
      marks.splice(i, 1);
      agentPrefsSave();
      agentRenderTray();
    };
    chip.onclick = () => agentFlashMark(m.quote);
    tray.appendChild(chip);
  });
}

// 点 chip → 在消息流里找到含这段引用的气泡，滚过去闪一下
function agentFlashMark(quote) {
  for (const b of document.querySelectorAll('#agent-messages .agent-msg-bubble')) {
    if (b.textContent.includes(quote.slice(0, 30))) {
      b.scrollIntoView({ block: 'center', behavior: 'smooth' });
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 900);
      return;
    }
  }
}

// 标记 + 留言合成结构化提问，直接烤进用户消息 content（kolab 同款）——
// 这样历史回放和重试（retryQuestion）都自带标记，不用额外字段。
function agentComposeWithMarks(question, marks) {
  if (!marks || !marks.length) return question;
  const lines = [`标记追问（共 ${marks.length} 处）：`];
  marks.forEach((m, i) => {
    const suffix = m.source && m.source !== '助教回答' ? `（标注自：${m.source}）` : '';
    lines.push(`${i + 1}. 「${m.quote}」${suffix}`);
  });
  if (question) lines.push(`\n补充问题：${question}`);
  const composed = lines.join('\n');
  return composed.length > AGENT_COMPOSE_LIMIT
    ? composed.slice(0, AGENT_COMPOSE_LIMIT) + '\n…[过长已截断]'
    : composed;
}

// 发送前的乐观清空在别处做了；这里只负责把标记还原回托盘（别的会话正在
// 流式、发送失败等没发出去的情况）
function agentRestoreMarks(session, marks) {
  if (!marks.length) return;
  session.marks = [...marks, ...agentSessionMarks(session)];
  agentPrefsSave();
  agentRenderTray();
}

let agentMarkAnchor = null;   // 选区的 getBoundingClientRect（fixed 定位基准）
let agentMarkPending = null;  // { quote, source } — 点了「加入托盘」才落进 marks

function agentHideMarkMenu() {
  document.getElementById('agent-mark-menu')?.classList.add('hidden');
  agentMarkAnchor = null;
  agentMarkPending = null;
}

function agentPositionMarkMenu() {
  const menu = document.getElementById('agent-mark-menu');
  if (!menu || !agentMarkAnchor) return;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(agentMarkAnchor.left, window.innerWidth - mw - 8)) + 'px';
  menu.style.top = (agentMarkAnchor.bottom + 6 + mh > window.innerHeight - 8
    ? agentMarkAnchor.top - mh - 6
    : agentMarkAnchor.bottom + 6) + 'px';
}

function agentInitMarkMenu() {
  const menu = document.getElementById('agent-mark-menu');
  if (!menu) return;
  // 点菜单自身不能清掉选区（选区没了 quote 就没了）
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.querySelector('button').addEventListener('click', () => {
    if (agentMarkPending?.quote) {
      const marks = agentSessionMarks(agentActiveSession());
      if (marks.length < AGENT_MARK_LIMIT) marks.push(agentMarkPending);
      agentPrefsSave();
      agentRenderTray();
    }
    agentHideMarkMenu();
    window.getSelection()?.removeAllRanges();
  });
  // 划选文字（助教回答 / 当前页面正文）→ 弹菜单；点别处/选区塌陷 → 收起。
  // lick 的 PDF 在 pdf.js iframe 里，跨文档拿不到选区，覆盖不到它。
  document.addEventListener('mouseup', (e) => {
    if (menu.contains(e.target)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { agentHideMarkMenu(); return; }
    const node = sel.anchorNode;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    let source = null;
    if (el?.closest?.('#agent-messages .agent-msg-bubble')) source = '助教回答';
    else if (el?.closest?.('.page.active')) source = '页面';
    if (!source) { agentHideMarkMenu(); return; }
    const quote = sel.toString().trim().slice(0, AGENT_MARK_QUOTE_LIMIT);
    if (!quote) { agentHideMarkMenu(); return; }
    agentMarkPending = { quote, source };
    agentMarkAnchor = sel.getRangeAt(0).getBoundingClientRect();
    menu.classList.remove('hidden'); // 先显示再量宽高——display:none 时 offsetWidth 是 0
    agentPositionMarkMenu();
  });
  document.getElementById('agent-messages')?.addEventListener('scroll', agentHideMarkMenu);
}

// ── Page context — the one part that varies by page ──

function agentPageContext() {
  const selectedText = (window.getSelection()?.toString() || '').trim().slice(0, AGENT_SELECTED_TEXT_LIMIT);
  const chordIdActive = document.getElementById('fb-chordid')?.classList.contains('active');
  if (chordIdActive && typeof fbCidAgentContext === 'function') {
    return { page: 'chord-id', title: 'Chord ID — 和弦识别与和声进行', selectedText, data: fbCidAgentContext() };
  }
  const activePage = document.querySelector('.page.active');
  const visibleText = (activePage?.innerText || document.body.innerText || '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, AGENT_CONTEXT_TEXT_LIMIT);
  // Lick detail: the score PDFs render in pdf.js iframes, so their content
  // never reaches visibleText — hand the model their material ids instead,
  // which the backend's read_pdf tool can open.
  const lickDetailActive = document.getElementById('page-lick-detail')?.classList.contains('active');
  if (lickDetailActive && typeof licksAgentContext === 'function'
      && typeof licksState !== 'undefined' && licksState.currentLick) {
    return {
      page: 'lick-detail',
      title: `Lick — ${licksState.currentLick.title}`,
      selectedText,
      data: licksAgentContext(licksState.currentLick),
      visibleText,
    };
  }
  // Generic fallback for every other page: whichever top-level page is
  // showing, its visible text — same shape mnl-workers-portal's assistant
  // uses when a route has no richer structured context wired up yet.
  return { page: activePage?.id?.replace('page-', '') || '', title: document.title, selectedText, data: {}, visibleText };
}

// ── Rendering ──

function agentSetOpenUI(open) {
  document.getElementById('agent-panel')?.classList.toggle('open', open);
  document.getElementById('agent-toggle')?.classList.toggle('hidden', open);
  agentApplySidebarLayout();
}

function agentRenderMessages(forceScroll) {
  const el = document.getElementById('agent-messages');
  if (!el) return;
  const wasNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  const prevTop = el.scrollTop;
  const session = agentActiveSession();
  if (!session.messages.length) {
    el.innerHTML = '<div class="agent-empty">可以问某个和弦为什么这么判断、还有哪些备选读法、终止式是什么，或者练习上遇到的其他问题。</div>';
    return;
  }
  el.innerHTML = session.messages.map(m => {
    // 思考过程实时可见（借鉴 kolab）：流式中展开跟着读，一收到 done 就自动折叠——
    // 折叠靠重渲染时按 m.done 决定要不要带 open 属性，不用额外记一份"用户手动展开过"的状态。
    const think = (m.role === 'assistant' && m.thinking)
      ? `<details class="agent-think"${m.done ? '' : ' open'}><summary>思考过程</summary><div class="agent-think-body">${htmlEsc(m.thinking)}</div></details>`
      : '';
    const tools = (m.role === 'assistant' && Array.isArray(m.tools) && m.tools.length)
      ? m.tools.map(t => `<div class="agent-msg-tool">🔧 ${htmlEsc(t.name || '')}(${htmlEsc(JSON.stringify(t.args || {}))})</div>`).join('')
      : '';
    const bubble = m.role === 'user'
      ? `<div class="agent-msg-bubble">${htmlEsc(m.content)}</div>`
      : `<div class="agent-msg-bubble">${typeof marked !== 'undefined' ? marked.parse(m.content || '') : htmlEsc(m.content || '')}</div>`;
    const metaBits = [];
    if (m.role === 'assistant' && Number.isFinite(m.durationMs)) {
      metaBits.push(agentFmtDuration(m.durationMs));
    }
    if (m.role === 'assistant' && m.runMeta) {
      if (m.runMeta.model) metaBits.push(htmlEsc(m.runMeta.model));
      if (m.runMeta.thinking) metaBits.push(htmlEsc(m.runMeta.thinking));
      // num_turns = API request count for the run; 1 means the model answered
      // directly without any tool call — the overwhelmingly common case, so
      // it's only shown when > 1 (tool calls happened).
      if (Number.isFinite(m.runMeta.num_turns) && m.runMeta.num_turns > 1) {
        metaBits.push(`${m.runMeta.num_turns} turns`);
      }
      const contextMeta = agentFmtContextMeta(m.runMeta);
      if (contextMeta) metaBits.push(htmlEsc(contextMeta));
      if (Number.isFinite(m.runMeta.total_ms)) {
        metaBits.push(`累计 ${agentFmtDuration(m.runMeta.total_ms)}`);
      }
    }
    if (m.role === 'assistant' && m.interrupted) metaBits.push('已被新消息打断');
    else if (m.role === 'assistant' && m.error) metaBits.push('error');
    const retry = (m.role === 'assistant' && m.error && m.retryQuestion)
      ? `<button type="button" class="agent-retry-btn" onclick="agentRetryMessage(${agentState.sessions.indexOf(session)}, ${session.messages.indexOf(m)})">重试</button>`
      : '';
    const meta = (metaBits.length || retry) ? `<div class="agent-msg-meta">${metaBits.join(' · ')}${retry}</div>` : '';
    return `<div class="agent-msg agent-msg-${m.role}">${think}${tools}${bubble}${meta}</div>`;
  }).join('');
  if (forceScroll || wasNearBottom) el.scrollTop = el.scrollHeight;
  else el.scrollTop = prevTop;
}

function agentSessionPreview(session) {
  const last = session.messages[session.messages.length - 1];
  return (last?.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// The .agent-think-body box scrolls independently of the outer message list
// (it has its own max-height) — keep it pinned to its own bottom while text
// is still streaming in, same idea as the outer list's own auto-scroll.
function agentFollowThinkingScroll() {
  const open = document.querySelector('.agent-think[open] .agent-think-body');
  if (open) open.scrollTop = open.scrollHeight;
}

function agentRenderSessions() {
  const el = document.getElementById('agent-sessions-menu');
  if (!el) return;
  el.innerHTML = agentState.sessions.map(s => {
    const preview = agentSessionPreview(s);
    return `<button type="button" class="agent-session-item${s.id === agentState.activeId ? ' active' : ''}" onclick="agentSwitchSession('${s.id}')">`
      + `<div class="agent-session-item-title">${htmlEsc(s.title)}</div>`
      + (preview ? `<div class="agent-session-item-preview">${htmlEsc(preview)}</div>` : '')
      + `<div class="agent-session-item-id">${htmlEsc(s.id)}</div>`
      + `</button>`;
  }).join('') || '<div class="agent-empty" style="padding:6px 8px;">还没有历史对话</div>';
}

function agentToggleSessionsMenu(forceOpen) {
  const menu = document.getElementById('agent-sessions-menu');
  if (!menu) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
}

document.addEventListener('click', (e) => {
  const wrap = document.querySelector('.agent-sessions-wrap');
  if (wrap && !wrap.contains(e.target)) agentToggleSessionsMenu(false);
});

function agentActiveProvider() {
  return agentProviders.find(p => p.name === (agentState.provider || undefined)) || agentProviders.find(p => p.default) || agentProviders[0];
}

function agentActiveModel() {
  const p = agentActiveProvider();
  if (!p) return null;
  return p.models.find(m => m.name === agentState.model) || p.models[0] || null;
}

function agentRenderModelSelect() {
  const modelSel = document.getElementById('agent-model-select');
  const thinkingSel = document.getElementById('agent-thinking-select');
  if (!modelSel || !thinkingSel) return;
  const p = agentActiveProvider();
  const models = p?.models || [];
  modelSel.innerHTML = models.map(m => `<option value="${htmlEsc(m.name)}">${htmlEsc(m.name)}</option>`).join('');
  const wantedModel = models.some(m => m.name === agentState.model) ? agentState.model : models[0]?.name;
  if (wantedModel) modelSel.value = wantedModel;
  const m = agentActiveModel();
  const levels = m?.thinking_levels?.length ? m.thinking_levels : ['off'];
  thinkingSel.innerHTML = levels.map(t => `<option value="${htmlEsc(t)}">${htmlEsc(t)}</option>`).join('');
  const wantedThinking = levels.includes(agentState.thinking) ? agentState.thinking : levels[0];
  if (wantedThinking) thinkingSel.value = wantedThinking;
}

async function agentRenderProviders() {
  const sel = document.getElementById('agent-provider-select');
  if (!sel) return;
  try {
    const all = await (await fetch('/api/agent/providers')).json();
    // 不可用的 provider（缺 key/登录态过期）直接不给选，不占列表位置——
    // 反正选了也用不了，禁用态灰字比不上直接不出现干净。
    agentProviders = all.filter(p => !p.unavailable_reason);
  } catch (_) {
    agentProviders = [];
  }
  if (!agentProviders.length) {
    sel.innerHTML = '<option value="">默认</option>';
    return;
  }
  sel.innerHTML = agentProviders.map(p =>
    `<option value="${htmlEsc(p.name)}" title="${htmlEsc(p.description)}">${htmlEsc(p.name)}</option>`
  ).join('');
  const wanted = agentState.provider || agentProviders.find(p => p.default)?.name;
  if (wanted && [...sel.options].some(o => o.value === wanted)) sel.value = wanted;
  agentRenderModelSelect();
}

function agentSetStatus(text, isError) {
  const el = document.getElementById('agent-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function agentContextWindowForModel() {
  const m = agentActiveModel();
  return Number.isFinite(m?.context_window) ? m.context_window : null;
}

function agentFmtContextMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';
  if (Number.isFinite(meta.ctx_tokens) && Number.isFinite(meta.ctx_window) && meta.ctx_window > 0) {
    const pct = meta.ctx_tokens / meta.ctx_window * 100;
    return `${meta.ctx_tokens.toLocaleString()}/${agentHumanizeNum(meta.ctx_window)} (${pct.toFixed(1)}%)`;
  }
  if (Number.isFinite(meta.context_chars)) {
    // Proxy metric (no real token usage known yet) — chars, not tokens; "~"/
    // 估算 make that explicit so it doesn't read as a token count.
    const denom = Number.isFinite(meta.context_limit_chars)
      ? meta.context_limit_chars
      : AGENT_FALLBACK_CONTEXT_CHARS;
    const pct = meta.context_chars / denom * 100;
    return `~${meta.context_chars.toLocaleString()}/${agentHumanizeNum(denom)} chars 估算 (${pct.toFixed(1)}%)`;
  }
  return '';
}

function agentSessionTotalMs(session) {
  return (session?.messages || []).reduce(
    (total, msg) => total + (Number.isFinite(msg.durationMs) ? msg.durationMs : 0),
    0,
  );
}

// While a request is in flight the status line should feel alive: a 1s
// ticker appends the elapsed time (whole seconds — sub-second precision
// here just makes the number jitter distractingly) to whatever the
// stream's thinking events have most recently set as the base text
// (agentTickBase), so "思考中…" doesn't sit there frozen with no sign of
// progress during long model thinking phases.
function agentStartTicker(startedAt) {
  agentStopTicker();
  agentTicker = setInterval(() => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    agentSetStatus(`${agentTickBase || '思考中…'} ${secs}s`);
  }, 1000);
}

function agentStopTicker() {
  if (agentTicker) { clearInterval(agentTicker); agentTicker = null; }
  agentTickBase = null;
}

// ── Actions ──

function agentOpen() {
  agentState.open = true;
  agentSetOpenUI(true);
  agentRenderMessages(true);
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
  const session = { id: agentNewSessionId(), title: '新对话', messages: [], marks: [] };
  agentState.sessions.unshift(session);
  if (agentState.sessions.length > AGENT_SESSION_LIMIT) agentState.sessions.length = AGENT_SESSION_LIMIT;
  agentState.activeId = session.id;
  agentRenderSessions();
  agentRenderMessages(true);
  agentRenderTray();
  agentPrefsSave();
}

function agentSwitchSession(id) {
  if (agentLoading || !agentState.sessions.some(s => s.id === id)) return;
  agentState.activeId = id;
  agentToggleSessionsMenu(false);
  agentRenderSessions();
  agentRenderMessages(true);
  agentRenderTray();
  agentPrefsSave();
}

// 记住每个 provider 上一次用的 model/thinking，切换 provider 来回时不用重选
// （借鉴 kolab：provider→model→thinking 三级联动，且记忆是逐 provider 的）。
function agentSetProvider(name) {
  agentRememberProviderChoice();
  agentState.provider = name || null;
  const remembered = name ? agentState.modelByProvider[name] : null;
  agentState.model = remembered?.model ?? null;
  agentState.thinking = remembered?.thinking ?? null;
  agentRenderModelSelect();
  agentPrefsSave();
}

function agentRememberProviderChoice() {
  if (agentState.provider) {
    agentState.modelByProvider[agentState.provider] = { model: agentState.model, thinking: agentState.thinking };
  }
}

function agentSetModel(name) {
  agentState.model = name || null;
  agentState.thinking = null;
  agentRememberProviderChoice();
  agentRenderModelSelect();
  agentPrefsSave();
}

function agentSetThinking(name) {
  agentState.thinking = name || null;
  agentRememberProviderChoice();
  agentPrefsSave();
}

function agentCancel() {
  if (agentCurrentRunId) {
    fetch(`/api/agent/runs/${agentCurrentRunId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
  }
  if (agentController) agentController.abort();
}

function agentActivePendingRun() {
  for (const session of agentState.sessions) {
    for (const msg of session.messages) {
      if (msg.role === 'assistant' && msg.runId && !msg.done && !msg.error) {
        return { session, assistantMsg: msg };
      }
    }
  }
  return null;
}

function agentRetryMessage(sessionIndex, messageIndex) {
  if (agentLoading) return;
  const session = agentState.sessions[sessionIndex];
  if (!session || session.id !== agentState.activeId) return;
  const assistant = session.messages[messageIndex];
  const user = session.messages[messageIndex - 1];
  const question = assistant?.retryQuestion || user?.content || '';
  if (!question || assistant?.role !== 'assistant' || user?.role !== 'user') return;
  session.messages.splice(messageIndex - 1, 2);
  agentRenderMessages(true);
  agentPrefsSave();
  agentSend(question);
}

function agentApplyRunEvent(msg, assistantMsg, session) {
  if (msg.type === 'delta') {
    agentTickBase = '回答中…';
    assistantMsg.content += msg.text;
    agentRenderMessages();
  } else if (msg.type === 'thinking') {
    agentTickBase = '思考中…' + (msg.text ? ' ' + msg.text.slice(-60).replace(/\n/g, ' ') : '');
    agentSetStatus(agentTickBase);
    assistantMsg.thinking = (assistantMsg.thinking || '') + msg.text;
    agentRenderMessages();
    agentFollowThinkingScroll();
  } else if (msg.type === 'retry') {
    agentTickBase = `自动重试中 (${msg.attempt}/${msg.max})…`;
    agentSetStatus(`${agentTickBase} ${msg.reason || ''}`.trim());
  } else if (msg.type === 'tool') {
    assistantMsg.tools = assistantMsg.tools || [];
    assistantMsg.tools.push({ name: msg.name, args: msg.args, result_preview: msg.result_preview });
    agentTickBase = `调用工具 ${msg.name}…`;
    agentSetStatus(agentTickBase);
    agentRenderMessages();
  } else if (msg.type === 'steered') {
    assistantMsg.interrupted = true;
  } else if (msg.type === 'meta') {
    assistantMsg.runMeta = {
      duration_ms: msg.duration_ms,
      round_ms: msg.round_ms || msg.duration_ms,
      num_turns: msg.num_turns,
      model: msg.model,
      thinking: msg.thinking,
      ctx_tokens: msg.ctx_tokens,
      ctx_window: msg.ctx_window || agentContextWindowForModel(),
      context_chars: msg.context_chars,
      context_hits: msg.context_hits,
      context_limit_chars: AGENT_FALLBACK_CONTEXT_CHARS,
      total_ms: agentSessionTotalMs(session) + (msg.duration_ms || 0),
    };
  } else if (msg.type === 'error') {
    assistantMsg.error = true;
    assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + `（出错了：${msg.message}）`;
    agentRenderMessages();
  } else if (msg.type === 'done') {
    assistantMsg.done = true;
  }
}

async function agentAttachRun(session, assistantMsg, startedAt) {
  agentLoading = true;
  agentController = new AbortController();
  agentCurrentRunId = assistantMsg.runId;
  agentTickBase = assistantMsg.content ? '回答中…' : '思考中…';
  agentSetStatus(agentTickBase);
  agentStartTicker(startedAt);
  // Send button stays visible (not hidden) while streaming — sending during
  // an active run is how steering works (see agentSend()), so it can't be
  // disabled the way a plain "one shot at a time" chat input would be.
  const cancelBtn = document.getElementById('agent-cancel-btn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');
  let hadError = false;

  try {
    const cursor = Number.isFinite(assistantMsg.runCursor) ? assistantMsg.runCursor : 0;
    const res = await fetch(`/api/agent/runs/${assistantMsg.runId}/events?cursor=${cursor}`, {
      signal: agentController.signal,
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
        const parsed = agentReadSseEvent(ev, assistantMsg.runCursor || 0);
        if (!parsed) continue;
        assistantMsg.runCursor = parsed.nextCursor;
        agentApplyRunEvent(parsed.msg, assistantMsg, session);
        if (parsed.msg.type === 'error') hadError = true;
        agentPrefsSave();
      }
    }
    assistantMsg.durationMs = assistantMsg.durationMs
      || assistantMsg.runMeta?.duration_ms
      || Date.now() - startedAt;
    if (assistantMsg.runMeta) assistantMsg.runMeta.total_ms = agentSessionTotalMs(session);
    // Just the outcome word — the full breakdown (duration/model/thinking/ctx)
    // is already permanently shown under the message itself; repeating it
    // here in the transient status line was pure duplication.
    const statusWord = assistantMsg.interrupted ? '已中断' : (assistantMsg.error ? '出错' : '完成');
    agentSetStatus(statusWord, assistantMsg.error);
  } catch (e) {
    if (e.name === 'AbortError') {
      assistantMsg.error = true;
      assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + '（已取消）';
      agentSetStatus('已取消');
    } else {
      assistantMsg.error = true;
      assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + `（请求失败：${e.message || e}）`;
      agentSetStatus('请求失败', true);
    }
    hadError = true;
  } finally {
    agentLoading = false;
    agentController = null;
    if (agentCurrentRunId === assistantMsg.runId) agentCurrentRunId = null;
    agentCurrentAttachPromise = null;
    agentStopTicker();
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (hadError) assistantMsg.error = true;
    agentRenderMessages();
    agentPrefsSave();
  }
}

// Sending has its own re-entrancy guard (agentLoading, checked and set
// synchronously before any await) that lasts the whole in-flight request —
// stronger than guarded()'s fixed debounce window would give it, so this
// doesn't need that wrapper (same "already has an internal lock" exemption
// fretboard.js's answer buttons get). The one exception is steering: sending
// while a run in THIS session is already streaming interrupts it (via
// DELETE .../runs/{id}?reason=steer) instead of being dropped, folds the
// partial output into history as an "interrupted" message, then proceeds
// with the new question as usual.
async function agentSend(retryQuestion) {
  const input = document.getElementById('agent-input');
  const isRetry = typeof retryQuestion === 'string';
  const raw = (isRetry ? retryQuestion : input?.value || '').trim();
  const session = agentActiveSession();
  // 划词托盘只在全新提问时取走（splice 即乐观清空）；重试的问题里已经烤过
  // 标记（agentComposeWithMarks），再取会重复
  const sentMarks = isRetry ? [] : agentSessionMarks(session).splice(0);
  const question = agentComposeWithMarks(raw, sentMarks);
  if (!question) return;
  if (sentMarks.length) { agentRenderTray(); agentPrefsSave(); } // 发出即清托盘

  if (agentLoading) {
    const pendingId = agentCurrentRunId;
    if (!pendingId || !session.messages.some(m => m.runId === pendingId)) {
      agentRestoreMarks(session, sentMarks); // 别的会话在流式，这条没发出去——标记回托盘
      return;
    }
    if (!isRetry) input.value = '';
    fetch(`/api/agent/runs/${pendingId}?reason=steer`, { method: 'DELETE', keepalive: true }).catch(() => {});
    if (agentCurrentAttachPromise) await agentCurrentAttachPromise;
    return agentSend(question);
  }

  if (!isRetry) input.value = '';
  session.messages.push({ role: 'user', content: question });
  if (session.messages.length === 1) session.title = (raw || question).slice(0, 24) || '新对话';
  if (session.messages.length > AGENT_HISTORY_LIMIT) session.messages.splice(0, session.messages.length - AGENT_HISTORY_LIMIT);
  agentRenderSessions();

  const assistantMsg = {
    role: 'assistant', content: '', retryQuestion: question,
    provider: agentState.provider, model: agentState.model, thinking: agentState.thinking,
  };
  session.messages.push(assistantMsg);
  agentRenderMessages(true);
  agentPrefsSave();

  agentLoading = true;
  const startedAt = Date.now();
  try {
    const context = agentPageContext();
    assistantMsg.contextInfo = {
      page: context.page,
      title: context.title,
      dataKeys: Object.keys(context.data || {}),
      hasVisibleText: !!context.visibleText,
      hasSelectedText: !!context.selectedText,
    };
    const res = await fetch('/api/agent/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        provider: agentState.provider || null,
        model: agentState.model || null,
        thinking: agentState.thinking || null,
        history: session.messages
          .slice(0, -2)
          .filter(m => !m.error)
          .slice(-8)
          .map(({ role, content }) => ({ role, content })),
        context,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.run_id) throw new Error('missing run_id');
    assistantMsg.runId = body.run_id;
    assistantMsg.runCursor = 0;
    agentPrefsSave();
    agentCurrentAttachPromise = agentAttachRun(session, assistantMsg, startedAt);
    await agentCurrentAttachPromise;
  } catch (e) {
    agentLoading = false;
    agentRestoreMarks(session, sentMarks); // 发送失败：内容还原回托盘，用户自己决定要不要重发
    assistantMsg.error = true;
    assistantMsg.content += (assistantMsg.content ? '\n\n' : '') + `（请求失败：${e.message || e}）`;
    agentSetStatus('请求失败', true);
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

// ── Sidebar mode (dock right, collapsible, drag-resizable width) ──

function agentInitSidebarResize() {
  const handle = document.getElementById('agent-sidebar-resize-handle');
  const panel = document.getElementById('agent-panel');
  if (!handle || !panel) return;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = agentState.sidebarWidth;
    function onMove(ev) {
      agentState.sidebarWidth = agentClamp(startW + (startX - ev.clientX), AGENT_SIDEBAR_WIDTH_MIN, AGENT_SIDEBAR_WIDTH_MAX);
      agentApplySidebarLayout();
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

function agentInitInputResize() {
  const handle = document.getElementById('agent-input-resize-handle');
  const input = document.getElementById('agent-input');
  if (!handle || !input) return;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = agentState.inputHeight;
    function onMove(ev) {
      // Dragging the handle up (clientY decreases) grows the textarea from its top edge.
      agentState.inputHeight = agentClamp(startH + (startY - ev.clientY), AGENT_INPUT_HEIGHT_MIN, AGENT_INPUT_HEIGHT_MAX);
      input.style.height = agentState.inputHeight + 'px';
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

// Single source of truth for how mode/width/collapsed map onto the panel's
// inline style, the body-level push-layout class, and the toggle icon —
// called on init and after every mode/collapse/resize change so they never
// drift apart.
function agentApplySidebarLayout() {
  const panel = document.getElementById('agent-panel');
  if (!panel) return;
  const isSidebar = agentState.mode === 'sidebar';
  panel.classList.toggle('sidebar', isSidebar);
  panel.classList.toggle('collapsed', isSidebar && agentState.sidebarCollapsed);
  if (isSidebar) {
    panel.style.width = agentState.sidebarCollapsed ? '' : agentState.sidebarWidth + 'px';
    panel.style.height = '';
  } else {
    panel.style.width = agentState.panelWidth + 'px';
    panel.style.height = agentState.panelHeight + 'px';
  }
  const pushOpen = isSidebar && agentState.open && !agentState.sidebarCollapsed;
  document.body.classList.toggle('agent-sidebar-open', pushOpen);
  document.documentElement.style.setProperty('--agent-sidebar-w', pushOpen ? agentState.sidebarWidth + 'px' : '0px');
}

function agentToggleMode() {
  agentState.mode = agentState.mode === 'sidebar' ? 'float' : 'sidebar';
  agentApplySidebarLayout();
  agentPrefsSave();
}

function agentToggleSidebarCollapsed() {
  agentState.sidebarCollapsed = !agentState.sidebarCollapsed;
  agentApplySidebarLayout();
  agentPrefsSave();
}

function agentInit() {
  agentPrefsLoad();
  agentApplySidebarLayout();
  agentSetOpenUI(agentState.open); // restore, but don't steal focus like a fresh agentOpen() would
  agentRenderSessions();
  agentRenderMessages(true);
  agentRenderTray();
  agentInitMarkMenu();
  agentRenderProviders();
  const pending = agentActivePendingRun();
  if (pending) {
    agentState.activeId = pending.session.id;
    agentRenderSessions();
    agentRenderMessages(true);
    agentRenderTray();
    agentAttachRun(pending.session, pending.assistantMsg, Date.now());
  }
  agentInitResize();
  agentInitSidebarResize();
  agentInitInputResize();
  const input = document.getElementById('agent-input');
  if (input) {
    input.style.height = agentState.inputHeight + 'px';
    input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); agentSend(); }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    agentClamp, agentFmtDuration, agentReadSseEvent, agentFmtContextMeta, agentHumanizeNum,
    agentComposeWithMarks,
    AGENT_SIDEBAR_WIDTH_MIN, AGENT_SIDEBAR_WIDTH_MAX,
    AGENT_MARK_QUOTE_LIMIT, AGENT_MARK_LIMIT, AGENT_COMPOSE_LIMIT,
  };
}
