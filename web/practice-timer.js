// ── Practice Timer ───────────────────────────────────────────────────────
// A generic countdown/Pomodoro-style timer, available on every page (not
// tied to Licks or any specific practice mode). Renders into #pt-row, the
// bottom row of the app-wide floating panel defined in index.html/app.js —
// sharing one draggable pill with the transport bar's Play/Listen action,
// but as a state machine it's independent from app.js's registerTransport:
// the transport action tracks "the current page's primary play/stop" and
// gets replaced on every page switch, whereas this timer needs to keep
// counting down *across* page switches (start it on Chord Match, walk over
// to Fretboard, it's still running) — different enough lifecycles that they
// stay separate state, even sharing one visual panel.
//
// `context` (a lick id/title, or null) is tracked on every completed block
// so Licks' session-log autofill (see ptSecondsForContextSince) can sum up
// how much time was spent practicing a specific lick.

const PT_PRESET_MIN = [5, 10, 15];
const PT_STATE_KEY = 'pt_state';
// Cap how many completed blocks we keep around — this is a lightweight
// local log, not a real database; a few hundred is more history than the
// "today total" / future autofill use cases need.
const PT_MAX_BLOCKS = 200;

const ptState = {
  running: false,
  paused: false,
  endAt: null,        // ms epoch when the current countdown reaches zero — only meaningful while running
  remainingSec: 0,     // frozen remaining seconds — only meaningful while paused
  totalSec: 0,          // duration of the current/last countdown (for the "X min done" label)
  justDone: false,      // true right after a countdown completes, until dismissed or restarted
  linked: false,        // if true, the metronome's Play/Stop also resumes/pauses this timer — see ptOnMetronomeStart/Stop
  context: null,        // { lickId, lickTitle } | null — who this timer is "for"
  blocks: [],           // [{ durationSec, completedAt (ISO), context }]
  intervalId: null,
  audioCtx: null,
};

function ptFmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

// Pure: remaining seconds given an end timestamp and "now" — kept wall-clock
// based (not a decrementing tick counter) so backgrounded/throttled tabs and
// page reloads both recover the correct remaining time instead of drifting.
function ptRemainingSec(endAt, nowMs) {
  return (endAt - nowMs) / 1000;
}

function ptTodayTotalSec() {
  const today = new Date().toISOString().slice(0, 10);
  return ptState.blocks
    .filter(b => b.completedAt.slice(0, 10) === today)
    .reduce((sum, b) => sum + b.durationSec, 0);
}

function ptSetContext(context) { ptState.context = context; }
function ptClearContext() { ptState.context = null; }

// Total seconds of completed blocks tied to a given context (e.g. a lick id)
// since a given ISO timestamp — the feed for Licks' auto-logged session
// duration (see licksAutoLogSession in licks.js). "Since" matters because
// blocks accumulate across the whole app lifetime; without a lower bound,
// re-practicing a lick on a later day would re-count minutes that were
// already folded into an earlier auto-logged session.
function ptSecondsForContextSince(lickId, sinceIso) {
  return ptState.blocks
    .filter(b => b.context && b.context.lickId === lickId && b.completedAt >= sinceIso)
    .reduce((sum, b) => sum + b.durationSec, 0);
}

function ptSaveState() {
  try {
    localStorage.setItem(PT_STATE_KEY, JSON.stringify({
      running: ptState.running, paused: ptState.paused,
      endAt: ptState.endAt, remainingSec: ptState.remainingSec, totalSec: ptState.totalSec,
      linked: ptState.linked, context: ptState.context, blocks: ptState.blocks.slice(-PT_MAX_BLOCKS),
    }));
  } catch (_) { /* localStorage full/unavailable — timer still works this session */ }
}

function ptLoadState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(PT_STATE_KEY)); } catch (_) { saved = null; }
  if (!saved) return;
  if (Array.isArray(saved.blocks)) ptState.blocks = saved.blocks;
  if (saved.context && typeof saved.context === 'object') ptState.context = saved.context;
  if (typeof saved.linked === 'boolean') ptState.linked = saved.linked;
  // Only resume an in-progress countdown if it hasn't already elapsed while
  // the app was closed — an already-expired one just gets dropped silently
  // rather than "completing" retroactively with a stale beep on load.
  if (saved.running && Number.isFinite(saved.endAt) && saved.endAt > Date.now()) {
    ptState.running = true;
    ptState.endAt = saved.endAt;
    ptState.totalSec = saved.totalSec;
  } else if (saved.paused && Number.isFinite(saved.remainingSec)) {
    ptState.paused = true;
    ptState.remainingSec = saved.remainingSec;
    ptState.totalSec = saved.totalSec;
  }
}

function ptStart(minutes) {
  ptState.running = true;
  ptState.paused = false;
  ptState.justDone = false;
  ptState.totalSec = minutes * 60;
  ptState.endAt = Date.now() + ptState.totalSec * 1000;
  ptSaveState();
  ptRender();
  ptEnsureTicking();
}

// Freezes the countdown without discarding it — unlike ptCancel, ptResume()
// can pick back up from exactly where this left off. Distinct from
// "stopping the metronome": pausing the timer is a deliberate break in your
// own practice, not tied to whether a metronome happens to be playing
// (see ptOnMetronomeStart/Stop for the optional link between the two).
function ptPause() {
  if (!ptState.running) return;
  ptState.remainingSec = Math.max(0, ptRemainingSec(ptState.endAt, Date.now()));
  ptState.running = false;
  ptState.paused = true;
  ptState.endAt = null;
  ptStopTicking();
  ptSaveState();
  ptRender();
}

function ptResume() {
  if (!ptState.paused) return;
  ptState.endAt = Date.now() + ptState.remainingSec * 1000;
  ptState.remainingSec = 0;
  ptState.running = true;
  ptState.paused = false;
  ptSaveState();
  ptRender();
  ptEnsureTicking();
}

function ptCancel() {
  ptState.running = false;
  ptState.paused = false;
  ptState.justDone = false;
  ptState.endAt = null;
  ptState.remainingSec = 0;
  ptStopTicking();
  ptSaveState();
  ptRender();
  ptStopLinkedMetronome(); // "end together" — see its own comment below
}

function ptDismissDone() {
  ptState.justDone = false;
  ptRender();
}

// Optional metronome link: when enabled, the Speed Trainer's Play/Stop
// (stStart/stStop, speed-trainer.js) also resumes/pauses this timer — so
// starting the metronome un-pauses your practice clock and stopping it
// takes a break, without you having to operate two separate controls. Off
// by default and easy to toggle (see ptToggleLinked / the 🔗 button) — the
// timer is just as often used on its own (Pomodoro-style, no metronome
// involved at all) or with a metronome you don't want tied to it.
//
// This is deliberately a per-lick preference, not one global switch — some
// licks are inherently metronome-paired practice, others aren't. ptState
// itself just holds whatever the CURRENT lick's (or no-lick standalone use's)
// value is; licks.js is responsible for seeding it when practice starts
// (ptSetLinked, called from practiceLick) and persisting it back to that
// specific lick whenever it's toggled (licksNotifyLinkedChange, mirroring
// licksNotifyBpmChange's auto-save pattern).
function ptSetLinked(linked) {
  ptState.linked = !!linked;
  ptSaveState();
  ptRender();
}
function ptToggleLinked() {
  ptState.linked = !ptState.linked;
  ptSaveState();
  ptRender();
  if (typeof licksNotifyLinkedChange === 'function') licksNotifyLinkedChange(ptState.linked);
}
function ptOnMetronomeStart() {
  if (!ptState.linked) return;
  if (ptState.paused) { ptResume(); return; }
  // Idle (never started, or previously ✕-cancelled) is the common case for
  // "link then press Play" — without this the link looked like it did
  // nothing at all, since resume-from-pause is only reachable once a
  // countdown already exists. Reuse the last countdown's length (ptCancel
  // clears running/paused but deliberately leaves totalSec alone) so a
  // re-link picks up your usual practice-block length; fall back to the
  // shortest preset the one time there's no prior length yet.
  if (!ptState.running) ptStart(ptState.totalSec > 0 ? ptState.totalSec / 60 : PT_PRESET_MIN[0]);
}
function ptOnMetronomeStop() {
  if (ptState.linked && ptState.running) ptPause();
}
// The other half of the link: metronome Stop pauses the timer (above), but
// the timer can also end on its own (countdown reaches 0, or the user hits
// ✕) without anyone touching the metronome — "start together, end together"
// means those need to stop the metronome too, not just the timer. Guarded
// like every other cross-file call to Speed Trainer, and safe to call
// unconditionally: stStop() itself no-ops if the metronome isn't running.
function ptStopLinkedMetronome() {
  if (ptState.linked && typeof stStop === 'function') stStop();
}

function ptComplete() {
  ptState.running = false;
  ptState.justDone = true;
  ptState.blocks.push({
    durationSec: ptState.totalSec,
    completedAt: new Date().toISOString(),
    context: ptState.context,
  });
  ptSaveState();
  ptRender();
  ptBeep();
  ptStopLinkedMetronome(); // "end together" — the countdown reaching 0 on its own is as much an "end" as ✕/metronome-Stop
}

function ptEnsureTicking() {
  if (ptState.intervalId) return;
  ptState.intervalId = setInterval(ptTick, 500);
}

function ptStopTicking() {
  if (ptState.intervalId) { clearInterval(ptState.intervalId); ptState.intervalId = null; }
}

function ptTick() {
  if (!ptState.running) { ptStopTicking(); return; }
  if (ptRemainingSec(ptState.endAt, Date.now()) <= 0) { ptComplete(); return; }
  ptRender();
}

// Three ascending short beeps through a dedicated AudioContext, routed
// through the shared master-volume gain (fbMasterGain, fretboard.js) like
// every other sound this app generates, plus its own 'timerAlert' category
// gain (Preferences → 声音音量) for adjusting just this sound's default.
function ptBeep() {
  try {
    if (!ptState.audioCtx) {
      ptState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (typeof fbRegisterAudioContext === 'function') fbRegisterAudioContext(ptState.audioCtx);
    }
    const ctx = ptState.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const masterGain = typeof fbMasterGain === 'function' ? fbMasterGain() : 1;
    const soundGain = typeof fbSoundGain === 'function' ? fbSoundGain('timerAlert') : 1;
    const gainScale = masterGain * soundGain;
    // Was a pure sine at peak 0.85 — at default gains (masterGain=1,
    // soundGain=1) that's already close to digital full scale (1.0), so the
    // "声音音量" slider had almost no real headroom before clipping (see the
    // matching note on stScheduleClick in speed-trainer.js — same root
    // cause, same fix: triangle for real perceived loudness at equal peak
    // amplitude, peak pulled down to leave the now-raised slider max
    // (FB_SOUND_VOLUME_MAX, fretboard.js) room to actually do something).
    [880, 1108, 1318].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.65 * gainScale, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.23);
    });
  } catch (_) { /* audio unavailable — the visual pill state still shows completion */ }
}

function ptPresetButtonsHtml() {
  return PT_PRESET_MIN.map(m => `<button class="pt-preset-btn" onclick="ptStart(${m})">${m}m</button>`).join('');
}

// The 🔗 link toggle is shown in every state (not just idle) since you
// might want to flip it mid-countdown too.
function ptLinkButtonHtml() {
  const title = ptState.linked
    ? 'Linked to metronome — its Play/Stop also resumes/pauses this timer (click to unlink)'
    : 'Not linked to metronome — timer runs independently (click to link)';
  return `<button class="btn btn-ghost btn-sm pt-link-btn${ptState.linked ? ' linked' : ''}" onclick="ptToggleLinked()" title="${title}">🔗</button>`;
}

function ptRender() {
  const row = document.getElementById('pt-row');
  if (!row) return;
  const todayMin = Math.round(ptTodayTotalSec() / 60);
  const todayLabel = todayMin > 0 ? `<span class="pt-today">Today: ${todayMin} min</span>` : '';

  let body;
  if (ptState.running) {
    row.classList.remove('done');
    const remaining = ptRemainingSec(ptState.endAt, Date.now());
    body = `
      <span class="pt-label">⏱</span>
      <span class="pt-time">${ptFmtTime(remaining)}</span>
      <button class="btn btn-ghost btn-sm" onclick="ptPause()">⏸</button>
      <button class="btn btn-ghost btn-sm" onclick="ptCancel()">✕</button>
      ${ptLinkButtonHtml()}
    `;
  } else if (ptState.paused) {
    row.classList.remove('done');
    body = `
      <span class="pt-label">⏱</span>
      <span class="pt-time">${ptFmtTime(ptState.remainingSec)}</span>
      <button class="btn btn-ghost btn-sm" onclick="ptResume()">▶</button>
      <button class="btn btn-ghost btn-sm" onclick="ptCancel()">✕</button>
      ${ptLinkButtonHtml()}
    `;
  } else if (ptState.justDone) {
    row.classList.add('done');
    body = `
      <span class="pt-label">⏱</span>
      <span class="pt-done-label">✅ ${Math.round(ptState.totalSec / 60)} min done!</span>
      <span class="pt-presets">${ptPresetButtonsHtml()}</span>
      <button class="btn btn-ghost btn-sm" onclick="ptDismissDone()">✕</button>
      ${ptLinkButtonHtml()}
    `;
  } else {
    row.classList.remove('done');
    body = `
      <span class="pt-label">⏱</span>
      <span class="pt-presets">${ptPresetButtonsHtml()}</span>
      ${ptLinkButtonHtml()}
    `;
  }
  row.innerHTML = body + todayLabel;
  // Content width just changed (e.g. idle -> running, or preset buttons
  // appearing) — re-clamp the shared panel so it can't drift off-screen.
  if (typeof transportApplyPos === 'function') transportApplyPos();
}

function ptInit() {
  ptLoadState();
  ptRender();
  if (ptState.running) ptEnsureTicking();
}

// Debounced against rapid double-click, per project convention for any
// button with a side effect (guarded() is defined in fretboard.js, loaded
// before this file).
if (typeof guarded === 'function') ptStart = guarded(ptStart);

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ptState, ptFmtTime, ptRemainingSec, ptTodayTotalSec, ptSecondsForContextSince, PT_PRESET_MIN,
    ptStart, ptPause, ptResume, ptCancel, ptSetLinked, ptToggleLinked, ptOnMetronomeStart, ptOnMetronomeStop,
    ptComplete,
  };
}
