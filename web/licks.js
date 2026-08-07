// ── Lick Tracker ─────────────────────────────────────────────────────────────
// Tracks short practice exercises (licks / riffs) with per-session BPM + time
// data, so the user can see their progress over weeks and months.
//
// Data lives on the server (GET/POST /api/licks, /api/licks/:id/sessions).
// State and routing are handled here; the Speed Trainer integration
// (activeLick banner + auto-logged sessions, see licksAutoLogSession) hooks
// into state.activeLick.

// ── State ──

const licksState = {
  activeLick: null,   // { id, title, lastBpm } — set when practicing a lick
  currentLick: null,  // full lick object currently in detail view
  licksById: {},      // id → { title, last_bpm, last_practiced_bpm } cache from list response
  editor: null,       // { id } while the full-page editor is open
  editorMode: 'edit', // 'edit' | 'preview' — persisted (see lick_editor_prefs)
};

// ── Notes rendering (Markdown, with video/PDF/audio links previewed inline) ──
// Notes are the user's own local content (this is a single-user local app,
// not a shared/multi-user surface), so rendering them as raw HTML via marked
// is a deliberate, scoped exception to the project's "always htmlEsc
// innerHTML" rule — there's no other user who could plant a payload in it.

// Matches youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID and
// /shorts/ID, wherever they appear in a URL (extra query params, etc.).
function licksYoutubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Matches bilibili.com/video/BVxxxxx or /video/avNNNN, plus an optional
// ?p=N part-number query param (defaults to part 1).
function licksBilibiliId(url) {
  if (!url) return null;
  // Case-sensitive on purpose: bvid encoding is case-sensitive, so a
  // case-mangled id (e.g. from a tool that lowercases URLs) should fail to
  // match and fall back to a plain link, not silently embed the wrong video.
  const m = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+|av\d+)/);
  if (!m) return null;
  const pageMatch = url.match(/[?&]p=(\d+)/);
  const page = pageMatch ? pageMatch[1] : '1';
  return m[1].startsWith('av')
    ? { aid: m[1].slice(2), page }
    : { bvid: m[1], page };
}

// Filenames come from the filesystem, not typed text — unlike the rest of a
// note's Markdown (which the user wrote themselves), a filename can carry
// characters that break the Markdown link/image syntax it gets spliced into
// ([, ], (, )) or, once rendered, break out of the surrounding HTML (<, >,
// "). Neutralize those before a filename ever becomes part of generated
// Markdown — this is the one seam where "notes are trusted because the user
// typed them" (see the file-header comment on skipping htmlEsc) doesn't
// hold: a file can be downloaded from elsewhere and renamed by someone else.
function licksSafeLinkLabel(name) {
  return String(name ?? 'file').replace(/[[\]()<>"]/g, '_');
}

function licksIsPdfUrl(url) {
  return !!url && /\.pdf(?:[?#]|$)/i.test(url);
}

function licksIsAudioUrl(url) {
  return !!url && /\.(mp3|wav|m4a|ogg|flac)(?:[?#]|$)/i.test(url);
}

// A link's title text doubles as preview-control directives instead of a
// plain tooltip, e.g. [demo](url "w=300") or [score](url "page=2,y=0.4") —
// comma-separated key=value pairs. Returns {} (meaning: "just a normal
// tooltip, nothing recognized") when nothing parses, so the caller can fall
// back to rendering the title as an actual title attribute.
function licksParseLinkDirectives(title) {
  const out = {};
  if (!title) return out;
  for (const part of title.split(',')) {
    // The separator (: or =) is required, not optional — without it, an
    // ordinary caption like "page 2" or an abbreviation like "y2" would
    // collide with this syntax and silently vanish as a swallowed directive
    // instead of rendering as the tooltip text the user actually wrote.
    // `h`/`height` is PDF-specific (see licksPdfEmbedHtml) — video embeds
    // ignore it since their aspect ratio is fixed by the player itself.
    const m = part.trim().match(/^(w|width|h|height|page|y)[:=]\s*([\d.]+)$/i);
    if (!m) continue;
    const lowered = m[1].toLowerCase();
    const key = lowered === 'width' ? 'w' : lowered === 'height' ? 'h' : lowered;
    out[key] = parseFloat(m[2]);
  }
  return out;
}

// Rewrites the w=/h= preview-size directives of the idx-th resizable media
// link (video/PDF, in document order — the ordinal the link renderer stamps
// as data-ml-idx) in the raw notes Markdown, returning the updated notes.
// This is how a drag-resize on the detail page persists: the new pixel size
// is written back into the link's title directives and saved to the server.
// Returns null when the link can't be rewritten safely (unexpected syntax —
// single-quote/paren title forms, angle-bracket hrefs — or idx out of
// range); the caller then keeps the resize as a view-only tweak.
function licksRewriteLinkSize(notes, idx, sizes) {
  if (typeof marked === 'undefined' || !notes) return null;
  const w = Number.isFinite(sizes.w) ? Math.round(sizes.w) : null;
  const h = Number.isFinite(sizes.h) ? Math.round(sizes.h) : null;
  if (w === null && h === null) return null;

  const links = [];
  try {
    marked.walkTokens(marked.lexer(notes), (t) => {
      if (t.type !== 'link' || !t.raw) return;
      if (licksYoutubeId(t.href) || licksBilibiliId(t.href) || licksIsPdfUrl(t.href)) links.push(t);
    });
  } catch (e) {
    console.warn('licksRewriteLinkSize: failed to lex notes:', e);
    return null;
  }
  if (idx < 0 || idx >= links.length) return null;

  // Find this occurrence in the source: links were collected in document
  // order, so walking indexOf past each preceding raw keeps identical
  // duplicate links from colliding on the first match.
  let offset = 0, pos = -1;
  for (let i = 0; i <= idx; i++) {
    pos = notes.indexOf(links[i].raw, offset);
    if (pos === -1) return null;
    offset = pos + links[i].raw.length;
  }
  const raw = links[idx].raw;

  // Only `[text](href)` and `[text](href "title")` are rewritten.
  const m = raw.match(/^\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/);
  if (!m) {
    console.warn('licksRewriteLinkSize: unsupported link syntax, leaving notes unchanged:', raw);
    return null;
  }
  // Split the title into its comma-separated parts and replace (or append)
  // the size keys, preserving everything else (page=, y=, plain captions).
  const parts = m[3] ? m[3].split(',').map(p => p.trim()).filter(Boolean) : [];
  const setKey = (keyRe, key, val) => {
    const i = parts.findIndex(p => keyRe.test(p));
    if (i >= 0) parts[i] = parts[i].replace(keyRe, `${key}=${val}`);
    else parts.push(`${key}=${val}`);
  };
  if (w !== null) setKey(/^(?:w|width)[:=]\s*[\d.]+$/i, 'w', w);
  if (h !== null) setKey(/^(?:h|height)[:=]\s*[\d.]+$/i, 'h', h);

  const newRaw = `[${m[1]}](${m[2]} "${parts.join(',')}")`;
  return notes.slice(0, pos) + newRaw + notes.slice(pos + raw.length);
}

// Ordinal of the next resizable media embed (video/PDF — audio players are
// fixed-size and don't participate) within the notes currently being
// rendered. Reset per licksRenderNotes call; stamped as data-ml-idx so a
// rendered embed maps back to the Nth resizable link in the Markdown source
// (see licksRewriteLinkSize — renderers run in document order, so the counts
// stay in sync).
let licksMediaEmbedIdx = 0;

if (typeof marked !== 'undefined') {
  // Any link whose href is a video/PDF/audio URL renders as the normal link
  // (so it still opens in a new tab) plus a click-to-open preview right
  // below it — not eager iframes/players, since a note with several such
  // links would otherwise fire off a full load for each one on every
  // render, which is what made the preview feel slow. Returning `false`
  // from a marked renderer override falls back to the library's default
  // rendering for that token.
  marked.use({
    renderer: {
      link({ href, title, tokens }) {
        const ytId = licksYoutubeId(href);
        const bili = !ytId && licksBilibiliId(href);
        const isPdf = !ytId && !bili && licksIsPdfUrl(href);
        const isAudio = !ytId && !bili && !isPdf && licksIsAudioUrl(href);
        if (!ytId && !bili && !isPdf && !isAudio) return false;
        const text = this.parser.parseInline(tokens);
        const dir = licksParseLinkDirectives(title);
        const hasDirectives = Object.keys(dir).length > 0;
        const titleAttr = title && !hasDirectives ? ` title="${htmlEsc(title)}"` : '';
        const link = `<a href="${htmlEsc(href)}" target="_blank" rel="noopener"${titleAttr}>${text}</a>`;

        if (isPdf) return link + licksPdfEmbedHtml(href, dir, licksMediaEmbedIdx++);
        // Link label as a plain-text display name for Song Loop (strip any
        // inline Markdown formatting) — without this, Song Loop derives a
        // name from the URL itself, which for a materials-library URL is
        // the timestamp-prefixed on-disk filename, not the clean original.
        if (isAudio) return link + licksAudioEmbedHtml(href, text.replace(/<[^>]*>/g, ''));

        const styleAttr = dir.w ? ` style="max-width:${dir.w}px"` : '';
        const embedSrc = ytId
          ? `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1`
          : bili.bvid
            ? `https://player.bilibili.com/player.html?bvid=${bili.bvid}&page=${bili.page}&high_quality=1&danmaku=0&autoplay=1`
            : `https://player.bilibili.com/player.html?aid=${bili.aid}&page=${bili.page}&high_quality=1&danmaku=0&autoplay=1`;
        const thumbHtml = ytId
          ? `<img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" alt="" loading="lazy">`
          : `<span class="lick-video-thumb-fallback">📺 Bilibili</span>`;

        return link +
          `<div class="lick-video-embed" data-ml-idx="${licksMediaEmbedIdx++}"${styleAttr}>` +
          `<div class="lick-video-thumb" onclick="licksPlayVideoEmbed(this)" data-src="${htmlEsc(embedSrc)}">` +
          thumbHtml +
          `<span class="lick-video-play">▶</span>` +
          `</div></div>`;
      },
    },
  });
}

// Swaps a clicked video thumbnail for the real player iframe — see the
// renderer comment above for why this is click-to-play instead of eager.
function licksPlayVideoEmbed(thumbEl) {
  const src = thumbEl.dataset.src;
  // No loading="lazy" here — the user just clicked specifically to load this
  // now, so deferring on the browser's usual viewport heuristics would
  // reintroduce the delay this click-to-play redesign exists to avoid.
  thumbEl.parentElement.innerHTML =
    `<iframe src="${src}" title="video player" frameborder="0" ` +
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}

// PDF preview: click-to-expand inline, using the browser's own built-in PDF
// viewer via an iframe fragment — no PDF-rendering library needed.
//
// The fragment always carries view=FitH (fit page width): Chrome/Edge's
// PDFium viewer honors it, so the score fills the embed instead of opening
// fit-page with dead margins on both sides. Firefox/Safari's viewers ignore
// it and fall back to their own default — same scoped degradation the `y`
// parameter always had (see below), not something fixable here without
// vendoring a full PDF-rendering library.
//
// `y` (0-1, fraction down the page) rides on FitH's optional top argument,
// mapped from page-height points with a bottom-left origin, which only
// Chrome/PDFium's built-in viewer reliably honors — Firefox/Safari are
// expected to just land on the top of the page.
//
// Expanded/collapsed state persists per PDF URL (localStorage, last toggle
// wins) so a score you opened stays open across refreshes/previews instead
// of needing a click every render — the original all-collapsed default only
// survives for PDFs never touched, where eager-loading every iframe on every
// render is still not worth it.
const LICK_PDF_OPEN_KEY = 'lick_pdf_open';

function licksPdfOpenMap() {
  try {
    const m = JSON.parse(localStorage.getItem(LICK_PDF_OPEN_KEY));
    return m && typeof m === 'object' ? m : {};
  } catch (_) { return {}; }
}

function licksPdfSetOpen(href, open) {
  const m = licksPdfOpenMap();
  m[href] = open;
  localStorage.setItem(LICK_PDF_OPEN_KEY, JSON.stringify(m));
}

// The wrapper carries everything needed to rebuild either state (data-href/
// data-src/data-page/data-h) so expanding and collapsing are just innerHTML
// swaps — no re-parsing of the Markdown source required.
function licksPdfEmbedHtml(href, dir, mlIdx) {
  const page = Number.isFinite(dir.page) ? Math.max(1, Math.round(dir.page)) : 1;
  // `w` overrides the default max-width (see .lick-pdf-embed in style.css —
  // raised from a cramped 480px default, but still capped unless you ask
  // for wider, e.g. for a two-page spread that needs real width to be
  // legible). `h` overrides the fixed 600px iframe height for the same
  // reason — a much wider embed with the old fixed height would letterbox.
  const styleAttr = dir.w ? ` style="max-width:${dir.w}px"` : '';
  const h = Number.isFinite(dir.h) ? Math.max(100, Math.round(dir.h)) : null;
  const PAGE_HEIGHT_PT = 792; // US Letter height in PDF points — approximate for A4/other sizes
  const frag = Number.isFinite(dir.y)
    ? `page=${page}&view=FitH,${Math.round((1 - Math.min(1, Math.max(0, dir.y))) * PAGE_HEIGHT_PT)}`
    : `page=${page}&view=FitH`;
  const src = `${href}#${frag}`;
  const dataAttrs = ` data-href="${htmlEsc(href)}" data-src="${htmlEsc(src)}" data-page="${page}"` +
    (h ? ` data-h="${h}"` : '');
  const body = licksPdfOpenMap()[href]
    ? licksPdfExpandedHtml(src, page, h)
    : licksPdfThumbHtml(src, page);
  return `<div class="lick-pdf-embed" data-ml-idx="${mlIdx}"${styleAttr}${dataAttrs}>${body}</div>`;
}

function licksPdfThumbHtml(src, page) {
  return `<div class="lick-pdf-thumb" onclick="licksPlayPdfEmbed(this)">` +
    `<span class="lick-pdf-thumb-icon">📄</span><span class="lick-pdf-thumb-label">点击查看谱例（第 ${page} 页）</span>` +
    `</div>`;
}

function licksPdfExpandedHtml(src, page, h) {
  // The frame (not the iframe) carries the size: it's the CSS-resizable box
  // (resize: both — iframes are replaced elements and can't be resized
  // directly), with the iframe filling it absolutely.
  const styleAttr = h ? ` style="height:${h}px"` : '';
  return `<button class="btn btn-ghost btn-sm lick-pdf-collapse" onclick="licksCollapsePdfEmbed(this)">▾ 收起谱例（第 ${page} 页）</button>` +
    `<div class="lick-pdf-frame"${styleAttr}><iframe src="${htmlEsc(src)}" title="PDF preview"></iframe></div>`;
}

function licksPlayPdfEmbed(thumbEl) {
  const wrapper = thumbEl.closest('.lick-pdf-embed');
  licksPdfSetOpen(wrapper.dataset.href, true);
  wrapper.innerHTML = licksPdfExpandedHtml(
    wrapper.dataset.src, +(wrapper.dataset.page || 1), +(wrapper.dataset.h || 0) || null);
  // A collapsed PDF had no frame to observe at render time — watch the fresh
  // one so its resizes write back too (no-op outside the detail page).
  licksWatchEmbedResizes(wrapper);
}

function licksCollapsePdfEmbed(btnEl) {
  const wrapper = btnEl.closest('.lick-pdf-embed');
  licksPdfSetOpen(wrapper.dataset.href, false);
  wrapper.innerHTML = licksPdfThumbHtml(wrapper.dataset.src, +(wrapper.dataset.page || 1));
}

// Audio preview: an inline mini-player (play/pause, seek, speed) right next
// to the score — the "一边放 mp3 一边看谱" case, which shouldn't require
// leaving for the Song Loop page. Song Loop stays one click away as a
// secondary button for when A-B-loop/waveform/bar-grid tooling is needed.
//
// The <audio> element is created lazily on first play/seek interaction with
// preload="none", so a note full of audio links costs no loads until one is
// actually used (same click-to-load philosophy as the video/PDF embeds).
// Playing one player pauses every sibling — overlapping backing tracks is
// never what you want while reading a score.
//
// data-url/data-label (not inline onclick(...) args) for the same reason as
// the material picker: a label derived from a filename can contain quotes
// that would otherwise break out of a JS string literal.
const LICK_AUDIO_SPEED_KEY = 'lick_audio_speed';
const LICK_AUDIO_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

// Live <audio> elements, one per embed that has been interacted with.
// Backs one-track-at-a-time enforcement and licksAudioStopAll — the players'
// DOM gets rebuilt whenever the hosting page re-renders, and an <audio>
// keeps playing while referenced even after its controls are gone from the
// page (an orphan you can't stop).
const lickAudioPlayers = new Set();

// Speed preference per audio URL (localStorage, last change wins — same
// pattern as lick_pdf_open): which tempo you practice this track at is a
// property of the track, not of the viewing session.
function licksAudioSpeedMap() {
  try {
    const m = JSON.parse(localStorage.getItem(LICK_AUDIO_SPEED_KEY));
    return m && typeof m === 'object' ? m : {};
  } catch (_) { return {}; }
}

function licksAudioSpeedSet(href, speed) {
  const m = licksAudioSpeedMap();
  m[href] = speed;
  localStorage.setItem(LICK_AUDIO_SPEED_KEY, JSON.stringify(m));
}

function licksFmtAudioTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '–:––';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function licksAudioEmbedHtml(href, label) {
  const saved = licksAudioSpeedMap()[href];
  const speed = LICK_AUDIO_SPEEDS.includes(saved) ? saved : 1;
  return `<div class="lick-audio-embed">` +
    `<div class="lick-audio-player" data-url="${htmlEsc(href)}">` +
      `<button type="button" class="btn btn-ghost btn-sm lick-audio-toggle" onclick="licksAudioToggle(this)">▶</button>` +
      `<input type="range" class="lick-audio-seek" min="0" max="1000" value="0" step="1" oninput="licksAudioSeek(this)">` +
      `<span class="lick-audio-time">0:00 / –:––</span>` +
      `<select class="lick-audio-speed" title="变速（保调）" onchange="licksAudioSetSpeed(this)">` +
        LICK_AUDIO_SPEEDS.map(s => `<option value="${s}"${s === speed ? ' selected' : ''}>${s}x</option>`).join('') +
      `</select>` +
    `</div>` +
    `<button type="button" class="btn btn-ghost btn-sm" onclick="licksPracticeWithSongLoop(this)" data-url="${htmlEsc(href)}" data-label="${htmlEsc(label || '')}">🎧 Song Loop →</button>` +
    `</div>`;
}

// Lazily creates (or returns) the embed's <audio> element. Kept off-DOM;
// all UI sync goes through its event listeners. Re-registers into
// lickAudioPlayers on every call, since licksAudioStopAll clears the
// registry without removing the (paused, still in-DOM) players.
function licksAudioEl(playerEl) {
  if (playerEl._audio) {
    lickAudioPlayers.add(playerEl._audio);
    return playerEl._audio;
  }
  const a = new Audio();
  a.preload = 'none';
  a.src = playerEl.dataset.url;
  a.preservesPitch = true; // default in modern browsers, stated for clarity
  a.playbackRate = parseFloat(playerEl.querySelector('.lick-audio-speed').value) || 1;
  a.addEventListener('play', () => {
    for (const other of lickAudioPlayers) { if (other !== a) other.pause(); }
    playerEl.querySelector('.lick-audio-toggle').textContent = '⏸';
  });
  // 'pause' also fires on natural end (spec: pause then ended), so the
  // button resets itself with no separate ended-handling for the icon.
  a.addEventListener('pause', () => {
    playerEl.querySelector('.lick-audio-toggle').textContent = '▶';
  });
  a.addEventListener('loadedmetadata', () => {
    // A seek dragged before the first play (duration still unknown then)
    // lands here once the real duration arrives.
    if (playerEl._pendingSeek != null && Number.isFinite(a.duration) && a.duration > 0) {
      a.currentTime = playerEl._pendingSeek * a.duration;
      playerEl._pendingSeek = null;
    }
    licksAudioSyncUI(playerEl);
  });
  a.addEventListener('timeupdate', () => licksAudioSyncUI(playerEl));
  a.addEventListener('ended', () => { a.currentTime = 0; });
  playerEl._audio = a;
  lickAudioPlayers.add(a);
  return a;
}

function licksAudioToggle(btnEl) {
  const playerEl = btnEl.closest('.lick-audio-player');
  if (!playerEl) return;
  const a = licksAudioEl(playerEl);
  if (!a.paused) { a.pause(); return; }
  a.play().catch(e => setStatus('音频播放失败: ' + (e?.message || e)));
}

function licksAudioSeek(rangeEl) {
  const playerEl = rangeEl.closest('.lick-audio-player');
  if (!playerEl) return;
  const frac = (+rangeEl.value) / 1000;
  if (!playerEl._audio) { playerEl._pendingSeek = frac; return; }
  playerEl._pendingSeek = null;
  const a = playerEl._audio;
  if (Number.isFinite(a.duration) && a.duration > 0) a.currentTime = frac * a.duration;
}

function licksAudioSetSpeed(selectEl) {
  const playerEl = selectEl.closest('.lick-audio-player');
  const v = parseFloat(selectEl.value);
  if (!playerEl || !LICK_AUDIO_SPEEDS.includes(v)) return;
  if (playerEl._audio) playerEl._audio.playbackRate = v;
  licksAudioSpeedSet(playerEl.dataset.url, v);
}

function licksAudioSyncUI(playerEl) {
  const a = playerEl._audio;
  if (!a) return;
  const range = playerEl.querySelector('.lick-audio-seek');
  const time = playerEl.querySelector('.lick-audio-time');
  const dur = a.duration;
  if (Number.isFinite(dur) && dur > 0) {
    // Don't fight an in-progress drag — the user's thumb wins over the
    // timeupdate echo of the position they're dragging away from.
    if (document.activeElement !== range) range.value = Math.round((a.currentTime / dur) * 1000);
    time.textContent = `${licksFmtAudioTime(a.currentTime)} / ${licksFmtAudioTime(dur)}`;
  } else {
    time.textContent = `${licksFmtAudioTime(a.currentTime)} / –:––`;
  }
}

// Pauses every live mini-player and clears the registry. Called when the
// hosting page (lick detail / editor preview) is left or about to be
// re-rendered — otherwise audio would keep playing with its controls gone
// from the DOM.
function licksAudioStopAll() {
  for (const a of lickAudioPlayers) a.pause();
  lickAudioPlayers.clear();
}

// navigateTo (not plain showPage+slLoadFromUrl) so this jump lands in
// history — Back from Song Loop now returns to this exact Lick instead of
// leaving the browser with nothing to go back to. Error handling for a
// failed fetch/decode (bad network, corrupt file) lives in navApplyRoute's
// songloop branch, shared with every other way of reaching a Song Loop
// deep link (a fresh page load, Back/Forward).
function licksPracticeWithSongLoop(btnEl) {
  const url = btnEl.dataset.url;
  const label = btnEl.dataset.label || undefined;
  navigateTo({ page: 'songloop', songUrl: url, songLabel: label });
}

function licksRenderNotes(notes) {
  if (typeof marked === 'undefined') return `<p>${htmlEsc(notes)}</p>`; // vendor script missing — plain-text fallback
  licksMediaEmbedIdx = 0; // data-ml-idx ordinals are per-render (see its declaration)
  return marked.parse(notes);
}

// ── Embed drag-resize → write back into the notes ──
// On the detail page, resizing a video/PDF embed via its bottom-right handle
// persists the new size into the notes' w=/h= link directives and saves the
// lick to the server, so the size survives reloads and shows in the editor.
// The editor's preview render is deliberately NOT wired up: there the
// textarea is the source of truth and a write-back would trample in-progress
// edits.

const licksEmbedResizeObservers = [];
// Guards against double-observing an element (e.g. a PDF re-expanded after a
// collapse) — duplicate observers would stack redundant debounce timers.
const licksEmbedResizeWatched = new WeakSet();

function licksDisconnectEmbedResizes() {
  while (licksEmbedResizeObservers.length) licksEmbedResizeObservers.pop().disconnect();
}

// Finds not-yet-observed resizable embeds under `container` and watches them.
// Called after every render that can introduce one: the detail-page render
// and PDF expand-by-click (a collapsed PDF has no frame to observe).
function licksWatchEmbedResizes(container) {
  const lick = licksState.currentLick;
  if (!lick || licksState.editor || typeof ResizeObserver === 'undefined' || !container) return;
  // One debounce for the whole page, not per embed: saves PUT the full notes
  // text, so two embeds' saves racing from a stale copy would silently
  // clobber each other (last writer wins). Batching applies every pending
  // size to the latest notes in a single save; the promise chain serializes
  // a flush against one still awaiting its PUT.
  const pending = licksWatchEmbedResizes._pending || (licksWatchEmbedResizes._pending = new Map());
  const schedule = (idx, sizes) => {
    pending.set(idx, { ...pending.get(idx), ...sizes });
    const st = licksWatchEmbedResizes;
    if (st._timer) clearTimeout(st._timer);
    st._timer = setTimeout(() => {
      st._timer = null;
      const batch = [...pending.entries()];
      pending.clear();
      st._chain = (st._chain || Promise.resolve()).then(() => licksSaveEmbedSizes(lick, batch));
    }, 500);
  };
  const watch = (el, idxEl, getSizes) => {
    if (licksEmbedResizeWatched.has(el)) return;
    licksEmbedResizeWatched.add(el);
    let first = true; // observe() fires once immediately with the current size — not a user resize
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; }
      const idx = parseInt(idxEl.dataset.mlIdx, 10);
      if (!Number.isInteger(idx)) return;
      schedule(idx, getSizes());
    });
    ro.observe(el);
    licksEmbedResizeObservers.push(ro);
  };
  container.querySelectorAll('.lick-video-embed[data-ml-idx]').forEach(el => {
    watch(el, el, () => ({ w: el.offsetWidth }));
  });
  container.querySelectorAll('.lick-pdf-embed[data-ml-idx] .lick-pdf-frame').forEach(el => {
    const embed = el.closest('.lick-pdf-embed');
    watch(el, embed, () => {
      // Uncap mid-drag: the embed's default 640px max-width would otherwise
      // clamp the frame before the debounced save can write a wider w= back.
      embed.style.maxWidth = el.offsetWidth + 'px';
      return { w: el.offsetWidth, h: el.offsetHeight };
    });
  });
}

async function licksSaveEmbedSizes(lick, batch) {
  if (licksState.currentLick !== lick || !batch.length) return; // navigated away mid-debounce
  // Apply each resize to the result of the previous one — every rewrite
  // re-lexes, so ordinals stay valid (rewrites only touch link titles).
  let notes = lick.notes;
  for (const [idx, sizes] of batch) {
    const next = licksRewriteLinkSize(notes, idx, sizes);
    if (next !== null) notes = next;
  }
  if (notes === lick.notes) return;
  try {
    await api(`/api/licks/${lick.id}`, 'PUT', { title: lick.title, notes, target_bpm: lick.target_bpm ?? null });
    // No re-render: the DOM already shows the new size (the user dragged it
    // there), and rebuilding mid-drag would clobber the resize. Just keep
    // the cached copies in sync so a later render/edit sees the new text.
    lick.notes = notes;
    const cached = licksState.licksById[lick.id];
    if (cached) cached.notes = notes;
  } catch (e) {
    // View-only degradation: the resize stays on screen but won't survive a
    // reload — warn rather than silently drop it.
    console.warn('failed to save resized embed back to notes:', e);
  }
}

// ── List page ──

// Manual list order, persisted locally (not server data — it's a per-device
// UI preference, same pattern as everything else in fb_prefs/st_prefs).
// Licks not yet in the saved order (new, or created before this existed)
// are shown first, in the server's default (most-recently-updated) order,
// so a freshly created lick is easy to find; drag it wherever it belongs.
const LICKS_ORDER_KEY = 'licks_order';

function licksOrderLoad() {
  try { return JSON.parse(localStorage.getItem(LICKS_ORDER_KEY)) || []; }
  catch (_) { return []; }
}

function licksOrderSave(ids) {
  localStorage.setItem(LICKS_ORDER_KEY, JSON.stringify(ids));
}

function licksApplyOrder(licks) {
  const order = licksOrderLoad();
  const byId = new Map(licks.map(l => [l.id, l]));
  const ordered = order.map(id => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(ordered.map(l => l.id));
  const unordered = licks.filter(l => !orderedIds.has(l.id));
  return [...unordered, ...ordered];
}

async function loadLicks() {
  const el = document.getElementById('licks-list');
  if (!el) return;
  el.innerHTML = '<p class="empty-state">Loading…</p>';
  const licks = licksApplyOrder(await api('/api/licks'));
  if (!licks.length) {
    el.innerHTML = '<p class="empty-state">No licks yet — click "+ New Lick" to start tracking.</p>';
    return;
  }
  licks.forEach(l => { licksState.licksById[l.id] = l; });
  const totalSessions = licks.reduce((sum, l) => sum + (l.session_count || 0), 0);
  const mostRecent = licks
    .map(l => l.last_date).filter(Boolean).sort().pop();
  const summary = totalSessions === 0 ? '' : `
    <p class="lick-list-summary">
      ${licks.length} lick${licks.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
      ${totalSessions} session${totalSessions !== 1 ? 's' : ''} total
      ${mostRecent ? `&nbsp;·&nbsp; last practice: ${timeAgo(mostRecent)}` : ''}
    </p>`;
  el.innerHTML = summary + licks.map(l => {
    const lastBpm  = l.last_bpm  ? `${l.last_bpm} BPM` : 'no sessions yet';
    const lastDate = l.last_date ? timeAgo(l.last_date) : '—';
    const count    = l.session_count || 0;
    return `
      <div class="lick-card" data-lick-id="${l.id}" onclick="navOpenLick('${l.id}')" ondragover="licksDragOver(event)">
        <span class="lick-drag-handle" draggable="true" title="Drag to reorder"
          onclick="event.stopPropagation()" ondragstart="licksDragStart(event)" ondragend="licksDragEnd(event)">⠿</span>
        <div class="lick-card-body">
          <div class="lick-card-title">${htmlEsc(l.title)}</div>
          <div class="lick-card-meta">${lastBpm} &nbsp;·&nbsp; last: ${lastDate} &nbsp;·&nbsp; ${count} session${count !== 1 ? 's' : ''}</div>
        </div>
        <div class="lick-card-actions">
          <button class="btn btn-ghost btn-sm danger" onclick="event.stopPropagation(); deleteLick('${l.id}')">Delete</button>
        </div>
      </div>`;
  }).join('');
  // Render the practice heatmap below the list (non-blocking)
  renderLickHeatmap();
}

// ── Drag-to-reorder (list page) ──
// The drag handle starts the native HTML5 drag; dragover on any other card
// live-reorders the DOM (insert before/after based on cursor position
// relative to the target's vertical midpoint), and dragend persists
// whatever order the cards ended up in.

function licksDragStart(e) {
  const card = e.target.closest('.lick-card');
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.lickId); // Firefox requires data to be set to allow the drag
}

function licksDragOver(e) {
  e.preventDefault();
  const dragging = document.querySelector('.lick-card.dragging');
  const target = e.currentTarget;
  if (!dragging || dragging === target) return;
  const rect = target.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  const wantedNext = before ? target : target.nextSibling;
  if (dragging.nextSibling === wantedNext) return; // already in place — skip the reflow
  target.parentNode.insertBefore(dragging, wantedNext);
}

function licksDragEnd(e) {
  e.target.closest('.lick-card').classList.remove('dragging');
  const ids = [...document.querySelectorAll('#licks-list .lick-card')].map(el => el.dataset.lickId);
  licksOrderSave(ids);
}

// ── Practice heatmap ──
// GitHub-style calendar: last ~26 weeks as a grid of week-columns (7 rows,
// one per weekday).  Cell colour intensity = total practice minutes that day.
// Pure SVG, no dependencies.  Tooltips show date + minutes + lick count.
async function renderLickHeatmap() {
  const el = document.getElementById('lick-heatmap');
  if (!el) return;
  let sessions = [];
  try { sessions = await api('/api/licks/sessions/all'); }
  catch (_) { el.innerHTML = ''; return; }
  if (!sessions.length) { el.innerHTML = ''; return; }

  // Aggregate minutes per ISO date (YYYY-MM-DD)
  const byDate = {};
  sessions.forEach(s => {
    const d = s.date.slice(0, 10);
    if (!byDate[d]) byDate[d] = { min: 0, count: 0, licks: new Set() };
    byDate[d].min += s.duration_min;
    byDate[d].count++;
    byDate[d].licks.add(s.lick_title);
  });

  // Build a 26-week window ending today
  const WEEKS = 26;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Find the Sunday of the current week (column alignment)
  const startSunday = new Date(today);
  startSunday.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);

  const CELL = 13, GAP = 3, PAD_L = 28, PAD_T = 16, PAD_B = 16, PAD_R = 8;
  const colW = CELL + GAP;
  const W = PAD_L + PAD_R + WEEKS * colW;
  const H = PAD_T + PAD_B + 7 * colW;

  // Month labels along the top — show on the first column that starts a new month
  const monthLabels = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(startSunday);
    d.setDate(startSunday.getDate() + w * 7);
    if (d.getMonth() !== lastMonth) {
      monthLabels.push({ x: PAD_L + w * colW, label: d.toLocaleDateString('en-US', { month: 'short' }) });
      lastMonth = d.getMonth();
    }
  }

  // Weekday labels on the left (Mon/Wed/Fri)
  const dayLabels = [1, 3, 5].map(dow => ({
    y: PAD_T + dow * colW + CELL / 2,
    label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow],
  }));

  // Max minutes for colour scaling (cap at 60 so even a single 10-min session is visible)
  const maxMin = Math.max(60, ...Object.values(byDate).map(d => d.min));

  const cells = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(startSunday);
      d.setDate(startSunday.getDate() + w * 7 + dow);
      if (d > today) continue;
      const iso = d.toISOString().slice(0, 10);
      const info = byDate[iso];
      const x = PAD_L + w * colW;
      const y = PAD_T + dow * colW;
      if (!info) {
        cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" class="heat-cell-empty"/>`);
      } else {
        const intensity = Math.min(1, info.min / maxMin);
        const lvl = Math.min(4, 1 + Math.floor(intensity * 4));
        const tip = `${iso}: ${Math.round(info.min)} min, ${info.count} session${info.count !== 1 ? 's' : ''} (${[...info.licks].join(', ')})`;
        cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" class="heat-cell heat-l${lvl}"><title>${tip}</title></rect>`);
      }
    }
  }

  const totalMin = Math.round(Object.values(byDate).reduce((s, d) => s + d.min, 0));
  const activeDays = Object.keys(byDate).length;

  el.innerHTML = `
    <div class="lick-heatmap-wrap">
      <h3 class="lick-heatmap-title">Practice — last 6 months</h3>
      <svg viewBox="0 0 ${W} ${H}" class="lick-heatmap-svg" preserveAspectRatio="xMidYMid meet">
        ${monthLabels.map(m => `<text x="${m.x}" y="${PAD_T - 5}" class="heat-month-label">${m.label}</text>`).join('')}
        ${dayLabels.map(d => `<text x="${PAD_L - 5}" y="${d.y}" class="heat-day-label" text-anchor="end" dominant-baseline="middle">${d.label}</text>`).join('')}
        ${cells.join('')}
      </svg>
      <div class="lick-heatmap-legend">
        <span>${activeDays} active day${activeDays !== 1 ? 's' : ''} · ${totalMin} min total</span>
        <span class="heat-scale">
          <span class="heat-cell-empty" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l1" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l2" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l3" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span class="heat-l4" style="display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:middle"></span>
          <span style="margin-left:4px">more</span>
        </span>
      </div>
    </div>
  `;
}

async function newLick() {
  // A lick's title is free text (e.g. a song/section name), not a chord — the
  // shared modal's chord-suggestion chips don't apply here and were
  // misleading (they look like a "key" picker but just overwrite the title).
  openModal('New Lick', 'My practice lick', async title => {
    const r = await api('/api/licks', 'POST', { title, notes: '', target_bpm: null });
    // navOpenLick then navOpenLickEdit (not direct calls) so both land in
    // history — Back from the editor returns to the new lick's detail page,
    // and Back from there returns to wherever "New Lick" was clicked from.
    await navOpenLick(r.id);
    navOpenLickEdit(r.id); // then the full-page editor to fill notes + target BPM
  }, false);
}

// ── Detail page ──

async function openLick(id) {
  const lick = await api(`/api/licks/${id}`);
  licksState.currentLick = lick;
  licksState.licksById[id] = lick;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-lick-detail').classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  renderLickDetail(lick);
}

function renderLickDetail(lick) {
  const el = document.getElementById('lick-detail-content');
  if (!el) return;
  // #st-panel may currently be a real DOM child of #lick-practice-slot
  // (below) — rescue it out to <body> *before* the innerHTML reassignment
  // wipes that slot, or it gets destroyed for real along with it (innerHTML
  // reset deletes actual descendant nodes, it doesn't just detach them).
  // licksSyncPracticePanelHome() re-homes it correctly once the new HTML —
  // including a fresh, empty #lick-practice-slot — is in place.
  const rescuedPanel = document.getElementById('st-panel');
  if (rescuedPanel) document.body.appendChild(rescuedPanel);
  // Same rescue for the notes' inline audio players: the innerHTML reset
  // below deletes their controls, and an off-DOM <audio> would keep playing
  // with no way to stop it.
  licksAudioStopAll();
  // Drop resize observers on the outgoing embeds before the rebuild removes
  // them (see licksWatchEmbedResizes — fresh ones attach below).
  licksDisconnectEmbedResizes();
  const sessions = lick.sessions || [];
  const lastLoggedBpm = sessions.length ? sessions[sessions.length - 1].bpm : null;
  const targetLine = lick.target_bpm
    ? `<span class="lick-target">目标 ${lick.target_bpm} BPM</span>` : '';
  // Live progress: the tempo auto-saved while practicing (see
  // licksNotifyBpmChange) can be ahead of the last formally logged session —
  // surface that explicitly so "did my 95 BPM actually get saved?" has a
  // visible answer.
  const liveNote = (lick.last_practiced_bpm != null && lick.last_practiced_bpm !== lastLoggedBpm)
    ? `<div class="lick-live-bpm">🎯 Last practiced at <b>${lick.last_practiced_bpm} BPM</b> (not yet logged as a session)</div>`
    : '';

  el.innerHTML = `
    <div class="lick-detail-header">
      <div>
        <h2 class="lick-detail-title" id="lick-detail-title">${htmlEsc(lick.title)}</h2>
        ${targetLine}
      </div>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" onclick="navOpenLickEdit('${lick.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm danger"
          onclick="deleteLick('${lick.id}')">Delete</button>
      </div>
    </div>

    ${liveNote}
    ${lick.notes ? `<div class="lick-notes-md">${licksRenderNotes(lick.notes)}</div>` : ''}

    <!-- Practice slot lives directly under the notes: while practicing, the
         flow is score + metronome together, with the chart/sessions history
         below as reference. Empty when not practicing — no visual change. -->
    <div id="lick-practice-slot"></div>

    <div class="lick-chart-wrap" id="lick-chart-wrap">
      ${renderLickChart(sessions, lick.target_bpm)}
    </div>

    <div class="lick-sessions-header">
      <h3>Sessions (${sessions.length})</h3>
    </div>
    <div class="lick-sessions-list">
      ${sessions.length === 0
        ? '<p class="empty-state">No sessions yet — practice and log one!</p>'
        : (() => {
            const MAX = 20;
            const shown = [...sessions].reverse().slice(0, MAX);
            const rows = shown.map(s => `
              <div class="lick-session-row">
                <span class="lick-session-bpm">${s.bpm} BPM</span>
                <span class="lick-session-dur">${s.duration_min} min</span>
                <span class="lick-session-date">${fmtDate(s.date)}</span>
              </div>`).join('');
            const more = sessions.length > MAX
              ? `<p class="empty-state" style="padding:8px 0">… and ${sessions.length - MAX} earlier sessions</p>`
              : '';
            return rows + more;
          })()}
    </div>
  `;
  licksSyncPracticePanelHome();
  licksWatchEmbedResizes(el);
}

// ── SVG progress chart ──

function renderLickChart(sessions, targetBpm) {
  if (sessions.length < 1) {
    return '<div class="lick-chart-empty">Start practicing to see your progress here.</div>';
  }

  const W = 520, H = 160, PAD = { t: 16, r: 16, b: 32, l: 44 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;

  const bpms = sessions.map(s => s.bpm);
  const allBpms = targetBpm ? [...bpms, targetBpm] : bpms;
  const minB = Math.max(0, Math.min(...allBpms) - 10);
  const maxB = Math.max(...allBpms) + 10;

  const dates = sessions.map(s => new Date(s.date).getTime());
  const minD = dates[0], maxD = dates[dates.length - 1];
  const spanD = Math.max(maxD - minD, 1);

  const toX = d => PAD.l + ((d - minD) / spanD) * cW;
  const toY = b => PAD.t + cH - ((b - minB) / (maxB - minB)) * cH;

  // Y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.round(minB + (maxB - minB) * i / yTicks);
    const y = toY(v);
    return `<text x="${PAD.l - 6}" y="${y}" class="lick-chart-label" text-anchor="end" dominant-baseline="middle">${v}</text>
      <line x1="${PAD.l}" y1="${y}" x2="${PAD.l + cW}" y2="${y}" class="lick-chart-grid"/>`;
  }).join('');

  // X-axis: show up to ~6 date labels. Candidates come from an index stride,
  // but the axis is time-scaled — sessions clustered on the same day land on
  // nearly the same x and overprint (two "Jul 29" labels 0px apart render as
  // garbled overlap), so additionally drop any label closer than MIN_GAP px
  // to the previously kept one. The final session's label is always kept: on
  // collision the previously kept label is the one that gets dropped.
  const step = Math.max(1, Math.ceil(sessions.length / 6));
  const MIN_X_LABEL_GAP = 56;
  const xKept = [];
  sessions.forEach((s, i) => {
    if (i % step !== 0 && i !== sessions.length - 1) return;
    const x = toX(new Date(s.date).getTime());
    if (xKept.length && x - xKept[xKept.length - 1].x < MIN_X_LABEL_GAP) {
      if (i === sessions.length - 1) xKept.pop(); else return;
    }
    xKept.push({ x, label: fmtDateShort(s.date) });
  });
  const xLabels = xKept.map(({ x, label }) =>
    `<text x="${x}" y="${H - 6}" class="lick-chart-label" text-anchor="middle">${label}</text>`).join('');

  // Target BPM line
  const targetLine = targetBpm
    ? `<line x1="${PAD.l}" y1="${toY(targetBpm)}" x2="${PAD.l + cW}" y2="${toY(targetBpm)}"
        class="lick-chart-target"/>`
    : '';

  // Data line
  const pts = sessions.map(s => `${toX(new Date(s.date).getTime())},${toY(s.bpm)}`).join(' ');
  const polyline = sessions.length > 1
    ? `<polyline points="${pts}" class="lick-chart-line"/>` : '';

  // Dots + tooltips (native <title> hover — a blocking alert() on a 4px dot
  // used to fire on what was usually a mis-tap trying to read the tooltip)
  const dots = sessions.map((s) => {
    const x = toX(new Date(s.date).getTime()), y = toY(s.bpm);
    const tip = `${fmtDate(s.date)}: ${s.bpm} BPM, ${s.duration_min} min`;
    return `<circle cx="${x}" cy="${y}" r="4" class="lick-chart-dot">
      <title>${tip}</title>
    </circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" class="lick-chart-svg">
      ${yLabels}
      ${xLabels}
      <text x="${PAD.l - 30}" y="${PAD.t + cH/2}" class="lick-chart-label"
        text-anchor="middle" transform="rotate(-90,${PAD.l-30},${PAD.t+cH/2})">BPM</text>
      ${targetLine}
      ${polyline}
      ${dots}
    </svg>`;
}

// ── CRUD actions ──

// ── Full-page editor (edit / preview modes) ──
// Replaced the old 440px edit modal: the notes textarea was too cramped for
// real writing, and the resource-embed syntax ([label](url "page=2,w=900"))
// lived in a collapsed help block nobody could remember. Editing now gets its
// own routed page (#/licks/<id>/edit — Back/Forward work via navApplyRoute)
// with a tall textarea, a preview mode, and a click-to-insert cheat sheet so
// the syntax never has to be memorized.

const LICK_EDITOR_PREFS_KEY = 'lick_editor_prefs';

function lickEditorPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LICK_EDITOR_PREFS_KEY)) || {}; } catch (_) {}
  if (saved.mode === 'edit' || saved.mode === 'preview') licksState.editorMode = saved.mode;
}

function lickEditorPrefsSave() {
  localStorage.setItem(LICK_EDITOR_PREFS_KEY, JSON.stringify({ mode: licksState.editorMode }));
}

async function openLickEditor(id) {
  const lick = await api(`/api/licks/${id}`);
  licksState.editor = { id };
  document.getElementById('lick-edit-title').value = lick.title || '';
  document.getElementById('lick-edit-notes').value = lick.notes || '';
  document.getElementById('lick-edit-target-bpm').value = lick.target_bpm ?? '';
  document.getElementById('lick-edit-image-status').textContent = '';
  lickEditorPrefsLoad();
  licksRenderCheatsheet();
  // Entering the editor does NOT end practice on this lick — the editor is a
  // side-trip from the detail page (see the leaving-Speed-Trainer exemption
  // in showPage), so the metronome/timer keep running while you edit.
  showPage('lick-edit');
  licksEditorSetMode(licksState.editorMode);
}

function licksEditorSetMode(mode) {
  licksState.editorMode = mode;
  lickEditorPrefsSave();
  const isPreview = mode === 'preview';
  document.getElementById('lick-editor-edit-pane').style.display = isPreview ? 'none' : '';
  const prev = document.getElementById('lick-editor-preview');
  prev.style.display = isPreview ? '' : 'none';
  document.getElementById('lick-editor-mode-edit').classList.toggle('active', !isPreview);
  document.getElementById('lick-editor-mode-preview').classList.toggle('active', isPreview);
  if (isPreview) {
    // Rebuilding the preview wipes any inline audio players' controls —
    // stop them first, same orphan-audio reasoning as renderLickDetail.
    licksAudioStopAll();
    const md = document.getElementById('lick-edit-notes').value;
    prev.innerHTML = md.trim()
      ? licksRenderNotes(md)
      : '<p class="empty-state">还没有内容 —— 切回「编辑」写点什么。</p>';
  }
}

// Click-to-insert cheat sheet — the fix for "记不住资源插入语法". Every embed
// form the notes renderer understands (see the marked renderer at the top of
// this file) is one button here; clicking splices a ready-made snippet in at
// the cursor, leaving only the URL and the numbers to fill in.
const LICKS_EDITOR_SNIPPETS = [
  { label: '图片', code: '![说明](图片链接)', snippet: '![说明](图片链接)\n' },
  { label: '视频 — YouTube/Bilibili 自动预览', code: '[说明](视频链接)', snippet: '[说明](视频链接)\n' },
  { label: '视频改宽度（px）', code: '[说明](链接 "w=300")', snippet: '[说明](视频链接 "w=300")\n' },
  { label: 'PDF 翻到第 N 页', code: '[谱例](链接 "page=2")', snippet: '[谱例](PDF链接 "page=2")\n' },
  { label: 'PDF 页内位置（仅 Chrome）', code: '"page=2,y=0.4"', snippet: '[谱例](PDF链接 "page=2,y=0.4")\n' },
  { label: 'PDF 预览框宽×高（px，默认 640×600）', code: '"page=2,w=900,h=700"', snippet: '[谱例](PDF链接 "page=2,w=900,h=700")\n' },
  { label: '音频 → 内嵌播放器（+ Song Loop 入口）', code: '[伴奏](音频链接)', snippet: '[伴奏](音频链接)\n' },
];

function licksRenderCheatsheet() {
  const el = document.getElementById('lick-editor-cheatsheet');
  if (!el || el.childNodes.length) return; // static content — build once
  el.innerHTML = '<div class="lick-editor-cheatsheet-title">点一下插入写法</div>' +
    LICKS_EDITOR_SNIPPETS.map((s, i) => `
      <button type="button" class="lick-snippet-btn" data-snippet-idx="${i}">
        <span class="lick-snippet-label">${htmlEsc(s.label)}</span>
        <code>${htmlEsc(s.code)}</code>
      </button>`).join('') +
    '<div class="lick-editor-cheatsheet-foot">📷/📎 按钮插入的链接已带好语法，只需改数字<br>详情页拖视频/PDF 右下角调整大小，会自动写回 w=/h=</div>';
  el.addEventListener('click', e => {
    const btn = e.target.closest('.lick-snippet-btn');
    if (btn) licksInsertAtNotesCursor(LICKS_EDITOR_SNIPPETS[+btn.dataset.snippetIdx].snippet);
  });
}

// Inserts text at the cursor position in the notes textarea (or appends it
// if nothing was focused there) — shared by image upload and the material
// picker below. The user still has to click Save to persist the notes text.
function licksInsertAtNotesCursor(text) {
  const textarea = document.getElementById('lick-edit-notes');
  const pos = textarea.selectionStart ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, pos) + text + textarea.value.slice(pos);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = pos + text.length;
}

// Uploads the selected file to this lick's attachment storage, then inserts
// Markdown image syntax at the cursor position in the notes textarea.
async function lickUploadImage(inputEl) {
  const file = inputEl.files[0];
  const id = licksState.editor?.id;
  const statusEl = document.getElementById('lick-edit-image-status');
  if (!file || !id) return;
  statusEl.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`/api/licks/${id}/attachments`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const { url } = await res.json();
    licksInsertAtNotesCursor(`![${licksSafeLinkLabel(file.name)}](${url})\n`);
    statusEl.textContent = `Inserted ${file.name}`;
  } catch (e) {
    statusEl.textContent = 'Upload error: ' + e.message;
  } finally {
    inputEl.value = '';
  }
}

// ── Material picker (shared PDF/audio library) ──
// Distinct from lickUploadImage above: materials aren't owned by any single
// lick, so several licks can reuse the same uploaded PDF/backing-track URL
// without duplicating storage or breaking if one of those licks gets
// deleted (see api_upload_material / api_get_material in src/server.py).

// Markdown to insert for a given material — PDF gets a page=1 starting
// point the user edits by hand (see the syntax-help block in the modal);
// audio/other files just need the bare link, the renderer handles the rest.
function licksMaterialLinkMarkdown(filename, url) {
  const label = licksSafeLinkLabel(filename);
  if (licksIsPdfUrl(url)) return `[${label}](${url} "page=1")\n`;
  return `[${label}](${url})\n`;
}

async function openMaterialPicker() {
  document.getElementById('material-upload-status').textContent = '';
  document.getElementById('material-picker-modal').classList.add('show');
  const listEl = document.getElementById('material-picker-list');
  listEl.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const materials = await api('/api/materials');
    if (!materials.length) {
      listEl.innerHTML = '<p class="empty-state">No materials uploaded yet — upload one above.</p>';
      return;
    }
    // data-filename/data-url (not an inline onclick('...','...') call) —
    // htmlEsc() only escapes &<>" for HTML-attribute context, not the
    // single quotes a JS string literal needs; a filename containing an
    // apostrophe would otherwise break out of the onclick handler.
    listEl.innerHTML = materials.map(m => {
      const icon = licksIsPdfUrl(m.url) ? '📄' : licksIsAudioUrl(m.url) ? '🎧' : '📎';
      const kb = Math.round(m.size / 1024);
      return `
        <div class="material-picker-item" onclick="insertMaterialLink(this)" data-filename="${htmlEsc(m.filename)}" data-url="${htmlEsc(m.url)}">
          <span class="material-picker-item-icon">${icon}</span>
          <span class="material-picker-item-name">${htmlEsc(m.filename)}</span>
          <span class="material-picker-item-meta">${kb} KB</span>
        </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<p class="empty-state">Error loading materials: ${htmlEsc(e.message)}</p>`;
  }
}

function closeMaterialPicker() {
  document.getElementById('material-picker-modal').classList.remove('show');
}

function insertMaterialLink(itemEl) {
  licksInsertAtNotesCursor(licksMaterialLinkMarkdown(itemEl.dataset.filename, itemEl.dataset.url));
  closeMaterialPicker();
}

async function materialUploadAndInsert(inputEl) {
  const file = inputEl.files[0];
  const statusEl = document.getElementById('material-upload-status');
  if (!file) return;
  try {
    // Checks by content hash (see materials.js) before actually uploading —
    // lets the user reuse an existing byte-identical material instead of
    // silently accumulating duplicate copies.
    statusEl.textContent = 'Checking for duplicates…';
    const existing = typeof mtCheckDuplicateBeforeUpload === 'function'
      ? await mtCheckDuplicateBeforeUpload(file) : null;
    if (existing) {
      licksInsertAtNotesCursor(licksMaterialLinkMarkdown(existing.filename, existing.url));
      statusEl.textContent = `Reused existing ${existing.filename}`;
      closeMaterialPicker();
      return;
    }
    statusEl.textContent = 'Uploading…';
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/materials', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`upload failed (${res.status})`);
    const { filename, url } = await res.json();
    licksInsertAtNotesCursor(licksMaterialLinkMarkdown(filename, url));
    statusEl.textContent = `Inserted ${filename}`;
    closeMaterialPicker();
  } catch (e) {
    statusEl.textContent = 'Upload error: ' + e.message;
  } finally {
    inputEl.value = '';
  }
}

async function saveLickEdit() {
  const id = licksState.editor?.id;
  if (!id) return;
  const title = document.getElementById('lick-edit-title').value.trim() || 'Untitled';
  const notes = document.getElementById('lick-edit-notes').value.trim();
  const rawBpm = document.getElementById('lick-edit-target-bpm').value;
  const target_bpm = rawBpm !== '' ? parseFloat(rawBpm) : null;
  try {
    await api(`/api/licks/${id}`, 'PUT', { title, notes, target_bpm });
    licksState.editor = null;
    // Back to the detail page — navOpenLick re-fetches and re-renders it (so
    // the just-saved notes show up), and practice picks up where it was: the
    // editor never ended it (see openLickEditor), so startedAt is preserved.
    navOpenLick(id);
  } catch (e) {
    setStatus('Error saving: ' + e.message);
  }
}

function cancelLickEdit() {
  const id = licksState.editor?.id;
  licksState.editor = null;
  if (id) navOpenLick(id); else navGoToPage('licks');
}

async function deleteLick(id) {
  if (!confirm('Delete this lick and all its session history?')) return;
  await api(`/api/licks/${id}`, 'DELETE');
  navGoToPage('licks');
}

// ── Speed Trainer integration ──

// The bpm to resume practicing at: prefer the live "last practiced" tempo
// (auto-saved while practicing — see licksNotifyBpmChange below — even if
// it was never formally logged as a session) since it reflects more recent
// progress than a logged session might; fall back to the last logged
// session, then the list-summary's last_bpm, then a sane default.
function licksPickPracticeBpm(lick) {
  if (Number.isFinite(lick.last_practiced_bpm)) return lick.last_practiced_bpm;
  const sessions = lick.sessions || [];
  if (sessions.length) return sessions[sessions.length - 1].bpm;
  if (Number.isFinite(lick.last_bpm)) return lick.last_bpm;
  return 60;
}

// Starts (or resumes) practicing a lick in-place: the metronome panel
// embeds directly into that lick's detail page (see
// licksSyncPracticePanelHome) rather than navigating to a separate Speed
// Trainer page — sessions are auto-logged and the notes/history are all
// visible at once, with nothing to click to record progress. This is now
// the sole entry point for viewing a lick at all (replaces openLick as the
// list's row handler, and newLick's post-create navigation) — opening a
// lick's detail page and wanting to practice it are the same intent, so
// there's no separate "Practice Now" button gating the panel any more.
async function practiceLick(id) {
  // Switching to a different lick than the one currently active implicitly
  // ends that practice — auto-log it (see licksAutoLogSession) before losing
  // track of it.
  if (licksState.activeLick && licksState.activeLick.id !== id) {
    await licksAutoLogSession(licksState.activeLick);
  }
  const cached = licksState.licksById[id] || {};
  const bpm = licksPickPracticeBpm(cached);
  const title = cached.title || id;
  // startedAt marks where "time spent practicing this lick" starts being
  // summed from the practice timer (see licksAutoLogSession) — only reset it
  // when (re)starting practice on a lick that wasn't already the active one;
  // re-opening the lick you're already practicing must not silently drop
  // the time elapsed so far.
  const alreadyActive = licksState.activeLick && licksState.activeLick.id === id;
  licksState.activeLick = alreadyActive
    ? { ...licksState.activeLick, lastBpm: bpm }
    : { id, title, lastBpm: bpm, startedAt: new Date().toISOString() };
  initSpeedPage(); // one-time listener setup if the metronome has never been touched this session
  // Pre-load the metronome with the lick's last practiced BPM — must come
  // after initSpeedPage(), which reloads stState.startBpm/currentBpm from
  // the global Speed Trainer prefs and would otherwise clobber this.
  stState.startBpm = bpm;
  stState.currentBpm = bpm;
  stApplyStateToUI();
  stPrefsSave();
  if (typeof ptSetContext === 'function') ptSetContext({ lickId: id, lickTitle: title });
  // Seed the timer's metronome-link toggle from this lick's own remembered
  // preference (see licksNotifyLinkedChange below) — not a global setting,
  // since some licks are inherently metronome-paired practice and some aren't.
  if (typeof ptSetLinked === 'function') ptSetLinked(!!cached.metronome_linked);
  renderActiveLickBanner();
  // "Already viewing it" must mean the detail page is actually on screen —
  // currentLick alone is stale the moment you navigate away (back to the
  // list, or into the editor): re-rendering a hidden page used to leave the
  // URL changed but the view stuck on the list (refresh "fixed" it because a
  // reload resets currentLick to null).
  const onDetailPage = document.getElementById('page-lick-detail')?.classList.contains('active');
  if (!onDetailPage || !licksState.currentLick || licksState.currentLick.id !== id) {
    await openLick(id); // navigate to + render the detail page (also syncs panel placement)
  } else {
    renderLickDetail(licksState.currentLick); // already viewing it — re-render to swap in the panel
  }
}

// Relocates the Speed Trainer's #st-panel DOM node (the actual metronome UI)
// between its two possible homes: embedded inside the currently-viewed
// Lick's detail page (while that exact lick is the one being practiced), or
// back at #st-panel-home on the standalone Speed Trainer page otherwise.
// It's the same underlying DOM node and stState either way — this only
// moves *where it's mounted*, so every existing speed-trainer.js function
// keeps working completely unchanged. Called after anything that could
// affect placement: starting/cancelling practice, and every render of the
// Lick detail page (openLick/practiceLick) or page-level nav (showPage).
function licksSyncPracticePanelHome() {
  const panel = document.getElementById('st-panel');
  if (!panel) return;
  const a = licksState.activeLick;
  const onLickDetailPage = document.getElementById('page-lick-detail')?.classList.contains('active');
  const onActiveLickDetail = !!(a && licksState.currentLick && licksState.currentLick.id === a.id && onLickDetailPage);
  // The full-page editor is a side-trip from the detail page, not the end of
  // practice: while editing the lick being practiced, leave the panel exactly
  // where it is (it hides with the detail page and keeps running if it was)
  // and keep the bottom transport bar pointed at it, so the metronome can
  // still be stopped from the editor. showPage's leaving-Speed-Trainer logic
  // has the matching destination exemption.
  const onActiveLickEditor = !!(a && licksState.editor && licksState.editor.id === a.id
    && document.getElementById('page-lick-edit')?.classList.contains('active'));
  if (onActiveLickEditor) {
    if (typeof registerTransport === 'function') {
      registerTransport({ kind: 'playback', label: 'Speed Trainer', play: stStart, stop: stStop });
      setTransportState(stState.running ? 'playing' : 'stopped');
    }
    return;
  }
  const target = document.getElementById(onActiveLickDetail ? 'lick-practice-slot' : 'st-panel-home');
  if (target && panel.parentElement !== target) target.appendChild(panel);
  // Banner visibility depends on where the panel just landed (hidden when
  // embedded in the detail page) — re-evaluate after every move.
  renderActiveLickBanner();

  if (typeof registerTransport !== 'function') return;
  // The panel has no inline Start/Stop of its own — like the standalone
  // Speed Trainer page, it's driven by the shared bottom transport bar.
  if (onActiveLickDetail) {
    registerTransport({ kind: 'playback', label: 'Speed Trainer', play: stStart, stop: stStop });
    setTransportState(stState.running ? 'playing' : 'stopped');
  } else if (onLickDetailPage) {
    // Viewing a lick's detail page but not (or no longer) practicing it —
    // nothing to offer as the bottom bar's primary action.
    clearTransport();
  }
}

// Ends practice on the current lick — auto-logging it (see
// licksAutoLogSession) — with no click required. Called whenever practice
// implicitly ends: navigating away from the Lick detail/Speed Trainer pages
// (see showPage in app.js) or switching to a different lick (practiceLick).
async function licksEndPractice() {
  await licksAutoLogSession(licksState.activeLick);
  licksState.activeLick = null;
  if (typeof ptClearContext === 'function') ptClearContext();
  // No lick is active any more — the metronome link isn't "about" anything
  // in particular now, so don't leave whatever the last lick's preference
  // was silently in effect for unrelated standalone use.
  if (typeof ptSetLinked === 'function') ptSetLinked(false);
  renderActiveLickBanner();
  licksSyncPracticePanelHome();
  // Reflect practice having ended if the detail page content is still
  // sitting in the DOM (about to be hidden by the page nav that triggered
  // this) — otherwise it'd briefly show a stale, now-detached panel slot.
  if (licksState.currentLick) renderLickDetail(licksState.currentLick);
}

// Auto-save hook: called whenever the timer's 🔗 metronome-link toggle
// changes while a lick is being practiced (see ptToggleLinked in
// practice-timer.js) — mirrors licksNotifyBpmChange's pattern. A simple
// boolean toggle, so no debounce needed (unlike the tempo, which can fire
// rapidly while dragging/holding +/-).
function licksNotifyLinkedChange(linked) {
  const a = licksState.activeLick;
  if (!a) return;
  api(`/api/licks/${a.id}/metronome_linked`, 'POST', { linked })
    .then(() => {
      licksState.licksById[a.id] = { ...(licksState.licksById[a.id] || {}), metronome_linked: linked };
    })
    .catch(() => { /* best-effort background autosave — not worth surfacing an error for this */ });
}

function renderActiveLickBanner() {
  const el = document.getElementById('st-active-lick-banner');
  if (!el) return;
  const a = licksState.activeLick;
  // When the panel is embedded in a Lick's detail page, the banner's text is
  // dead weight: the panel's presence already says "practicing", and the
  // title it would name is the page's own <h2> right above. Only the
  // standalone Speed Trainer page lacks that context, so only there is the
  // banner shown.
  if (!a || el.closest('#lick-practice-slot')) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `
    <span class="st-lick-banner-text">🎯 Practicing: <strong>${htmlEsc(a.title)}</strong></span>
  `;
}

// Auto-save hook: called whenever the Speed Trainer's live tempo changes
// while a lick is actively being practiced (see speed-trainer.js's
// stBumpUp/stSetCurrentBpm/stReset), so the BPM used by the eventual
// auto-logged session (see licksAutoLogSession) always reflects the tempo
// actually practiced at, not just whatever it was when practice started.
// Debounced (trailing) so holding +/- or dragging the tempo doesn't fire a
// request per tick — only the value it settles on after 1.5s of quiet gets
// saved.
let _licksBpmSaveTimer = null;
function licksNotifyBpmChange(bpm) {
  const a = licksState.activeLick;
  if (!a || !Number.isFinite(bpm)) return;
  a.lastBpm = bpm;
  clearTimeout(_licksBpmSaveTimer);
  _licksBpmSaveTimer = setTimeout(() => {
    api(`/api/licks/${a.id}/bpm`, 'POST', { bpm })
      .then(() => {
        licksState.licksById[a.id] = { ...(licksState.licksById[a.id] || {}), last_practiced_bpm: bpm };
      })
      .catch(() => { /* best-effort background autosave — not worth surfacing an error for this */ });
  }, 1500);
}

// Suggested session duration: rounds a timed total (seconds, from the
// practice timer's blocks — see ptSecondsForContextSince in
// practice-timer.js, or the wall-clock fallback in licksAutoLogSession) to
// the nearest half minute, or falls back to a plain default when there's no
// timer data to go on at all.
function licksSuggestedDurationMin(timedSec) {
  if (!(timedSec > 0)) return 5;
  return Math.round(timedSec / 30) / 2;
}

// Below this, a "session" is almost certainly just opening/closing the lick
// without actually practicing — not worth a record.
const LICKS_AUTO_LOG_MIN_SEC = 30;

// Auto-logs a practice session with no user interaction whatsoever — not
// even a "Stop" click; exact duration matters less than the record existing
// at all (see the wall-clock fallback below). Called whenever practice on
// `a` implicitly ends: navigating away (licksEndPractice) or switching to a
// different lick (practiceLick).
async function licksAutoLogSession(a) {
  if (!a) return;
  const timedSec = (typeof ptSecondsForContextSince === 'function' && a.startedAt)
    ? ptSecondsForContextSince(a.id, a.startedAt) : 0;
  // If the practice timer was never started this session, fall back to how
  // long "Practice Now" has been active — a rougher number, but still a
  // real record instead of nothing.
  const wallSec = a.startedAt ? (Date.now() - new Date(a.startedAt).getTime()) / 1000 : 0;
  const effectiveSec = timedSec > 0 ? timedSec : wallSec;
  if (effectiveSec < LICKS_AUTO_LOG_MIN_SEC) return;
  const bpm = Number.isFinite(a.lastBpm) ? a.lastBpm : licksPickPracticeBpm(licksState.licksById[a.id] || {});
  const dur = licksSuggestedDurationMin(effectiveSec);
  try {
    await api(`/api/licks/${a.id}/sessions`, 'POST', { bpm, duration_min: dur });
    setStatus(`Session auto-logged: ${bpm} BPM, ${dur} min`);
    // The sessions list/chart are visible right in the Lick detail page —
    // refresh it so the entry just logged actually shows up.
    if (licksState.currentLick && licksState.currentLick.id === a.id) {
      const updated = await api(`/api/licks/${a.id}`);
      licksState.currentLick = updated;
      licksState.licksById[a.id] = updated;
      renderLickDetail(updated);
    }
  } catch (e) {
    setStatus('Error auto-logging session: ' + e.message);
  }
}

// ── Date helpers ──

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Relative "time ago" for the licks list (e.g. "3 hours ago", "2 days ago") —
// falls back to fmtDate for anything a week or older, where a relative
// phrase stops being more useful than just the date.
function timeAgo(iso) {
  if (!iso) return '—';
  const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) { const m = Math.floor(diffSec / 60); return `${m} minute${m === 1 ? '' : 's'} ago`; }
  if (diffSec < 86400) { const h = Math.floor(diffSec / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  if (diffSec < 604800) { const d = Math.floor(diffSec / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return fmtDate(iso);
}

// ── Keyboard shortcuts for the lick editor ──
// ⌘/Ctrl+S saves; Enter in the title input saves; Escape cancels back to the
// detail page. Scoped to the editor page so these keys stay free elsewhere.
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-lick-edit')?.classList.contains('active')) return;
  // The material picker overlays the editor — while it's open, Escape closes
  // just the picker, not the whole editor.
  if (document.getElementById('material-picker-modal')?.classList.contains('show')) {
    if (e.key === 'Escape') closeMaterialPicker();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveLickEdit(); return; }
  if (e.key === 'Enter' && e.target.id === 'lick-edit-title') { saveLickEdit(); return; }
  if (e.key === 'Escape') cancelLickEdit();
});

// Guard against rapid double-clicks — same convention as fretboard.js's
// guarded() list. Without this, clicking "Practice with Song Loop" twice
// before the first fetch/decode resolves can interleave two concurrent
// loads and leave slState's audio element and its bpm/loop bookkeeping
// pointing at two different tracks. guarded() only exists once fretboard.js
// has loaded (browser only, not the Node test environment for this file).
if (typeof guarded === 'function') {
  licksPracticeWithSongLoop = guarded(licksPracticeWithSongLoop);
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    licksYoutubeId, licksBilibiliId, licksIsPdfUrl, licksIsAudioUrl, licksParseLinkDirectives,
    licksRewriteLinkSize, licksMaterialLinkMarkdown, licksSafeLinkLabel,
    licksApplyOrder, licksPickPracticeBpm, licksSuggestedDurationMin, timeAgo,
    licksAudioEmbedHtml, licksAudioSpeedMap, licksAudioSpeedSet, renderLickChart,
  };
}
