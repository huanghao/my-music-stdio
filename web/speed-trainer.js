// ── Speed Trainer: click-track tempo ramp for "I can't play this fast part
// yet" practice — start slow, only bump the tempo once you're actually clean
// at the current one. No server dependency, works for any lick/solo
// regardless of whether it's represented anywhere else in the app. Uses
// fbRegisterAudioContext/fbOutput/fbMasterGain from fb-audio.js for output
// device + volume routing (global, shared with Ear Training) — index.html
// loads the fb-*.js modules first so these are always defined by the time stStart() runs.

// Web Audio scheduling needs a lookahead: naive setTimeout-per-click drifts
// because JS timers aren't sample-accurate, so instead we poll frequently and
// schedule any clicks due in the next SCHEDULE_AHEAD_SEC using the audio
// clock (ctx.currentTime), which *is* sample-accurate. Standard technique —
// see "A Tale of Two Clocks" (Chris Wilson, HTML5Rocks).
const ST_LOOKAHEAD_MS = 25;
const ST_SCHEDULE_AHEAD_SEC = 0.1;

const stState = {
  inited: false, // guards initSpeedPage() below — see the comment there
  startBpm: 60, targetBpm: 120, stepBpm: 4,
  beatsPerBar: 4, subdivision: 1, // ticks per beat: 1=quarter, 2=eighth, 4=sixteenth
  autoAdvance: false, autoAdvanceBars: 4,
  currentBpm: 60,
  running: false,
  audioCtx: null, timerId: null,
  nextTickTime: 0, tickIndex: 0, barsCompletedAtCurrentBpm: 0,
};

// ── Persistence ──

const ST_PREFS_KEY = 'st_prefs';

function stPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(ST_PREFS_KEY)) || {}; } catch (_) {}
  if (Number.isFinite(saved.startBpm))        stState.startBpm        = saved.startBpm;
  if (Number.isFinite(saved.targetBpm))       stState.targetBpm       = saved.targetBpm;
  if (Number.isFinite(saved.stepBpm))         stState.stepBpm         = saved.stepBpm;
  if (Number.isFinite(saved.beatsPerBar))     stState.beatsPerBar     = saved.beatsPerBar;
  if (Number.isFinite(saved.subdivision))     stState.subdivision     = saved.subdivision;
  if (typeof saved.autoAdvance === 'boolean') stState.autoAdvance     = saved.autoAdvance;
  if (Number.isFinite(saved.autoAdvanceBars)) stState.autoAdvanceBars = saved.autoAdvanceBars;
  // The live tempo is persisted too, so a revisit picks up where the last
  // session left off instead of snapping back to Start BPM.
  if (Number.isFinite(saved.currentBpm)) {
    stState.currentBpm = Math.max(20, Math.min(300, saved.currentBpm));
    return true;
  }
  return false;
}

function stApplyStateToUI() {
  document.getElementById('st-start-bpm').value         = stState.startBpm;
  document.getElementById('st-target-bpm').value        = stState.targetBpm;
  document.getElementById('st-step-bpm').value          = stState.stepBpm;
  document.getElementById('st-beats-per-bar').value     = stState.beatsPerBar;
  document.getElementById('st-subdivision').value       = stState.subdivision;
  document.getElementById('st-auto-advance').checked    = stState.autoAdvance;
  document.getElementById('st-auto-advance-bars').value = stState.autoAdvanceBars;
}

function stPrefsSave() {
  localStorage.setItem(ST_PREFS_KEY, JSON.stringify({
    startBpm: stState.startBpm, targetBpm: stState.targetBpm,
    stepBpm: stState.stepBpm, beatsPerBar: stState.beatsPerBar,
    subdivision: stState.subdivision, autoAdvance: stState.autoAdvance,
    autoAdvanceBars: stState.autoAdvanceBars, currentBpm: stState.currentBpm,
  }));
}

function stReadOptionsFromUI() {
  stState.startBpm = Math.max(20, parseInt(document.getElementById('st-start-bpm').value) || 60);
  stState.targetBpm = Math.max(stState.startBpm, parseInt(document.getElementById('st-target-bpm').value) || 120);
  stState.stepBpm = Math.max(1, parseInt(document.getElementById('st-step-bpm').value) || 4);
  stState.beatsPerBar = Math.max(1, parseInt(document.getElementById('st-beats-per-bar').value) || 4);
  stState.subdivision = parseInt(document.getElementById('st-subdivision').value) || 1;
  stState.autoAdvance = document.getElementById('st-auto-advance').checked;
  stState.autoAdvanceBars = Math.max(1, parseInt(document.getElementById('st-auto-advance-bars').value) || 4);
}

function initSpeedPage() {
  const restoredBpm = stPrefsLoad();
  stApplyStateToUI();
  stReadOptionsFromUI();
  // First visit (nothing persisted yet): start at the configured Start BPM.
  if (!restoredBpm) stState.currentBpm = stState.startBpm;

  // The option inputs live in static HTML (unlike most other panels in this
  // app, which re-render their controls via innerHTML on every visit) — they
  // never get destroyed/recreated, so attaching listeners here needs a guard.
  // Without one, revisiting this page via showPage('speed') would silently
  // stack a fresh, duplicate set of listeners onto the same elements every
  // single time (an accumulating leak — each stacked listener still fires,
  // still holds its closure alive, and is never released for the rest of the tab's life).
  if (!stState.inited) {
    stState.inited = true;
    ['st-start-bpm', 'st-target-bpm', 'st-step-bpm', 'st-beats-per-bar', 'st-subdivision'].forEach(id => {
      document.getElementById(id).addEventListener('change', stOnOptionsChanged);
    });
    document.getElementById('st-auto-advance').addEventListener('change', stOnOptionsChanged);
    document.getElementById('st-auto-advance-bars').addEventListener('change', stOnOptionsChanged);
  }

  stRenderBeatRow();
  stUpdateDisplay();
}

// Changing beats-per-bar/subdivision while running would desync the beat
// indicator mid-bar, so only live-apply BPM-related fields while playing —
// structural changes take effect the next time you hit Start.
function stOnOptionsChanged() {
  const wasRunning = stState.running;
  stReadOptionsFromUI();
  if (!wasRunning) stState.currentBpm = Math.min(stState.currentBpm, stState.targetBpm);
  stPrefsSave(); // after the currentBpm clamp above, so the persisted tempo matches
  stRenderBeatRow();
  stUpdateDisplay();
}

function stRenderBeatRow() {
  const row = document.getElementById('st-beat-row');
  row.innerHTML = Array.from({ length: stState.beatsPerBar }, (_, i) =>
    `<div class="st-beat-dot" data-beat="${i}"></div>`
  ).join('');
}

function stFlashBeat(beatIndexInBar, isDownbeat) {
  const row = document.getElementById('st-beat-row');
  row.querySelectorAll('.st-beat-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === beatIndexInBar);
    dot.classList.toggle('downbeat', i === beatIndexInBar && isDownbeat);
  });
}

function stUpdateDisplay() {
  document.getElementById('st-bpm-current').value = stState.currentBpm;
  const progress = document.getElementById('st-progress');
  progress.textContent = stState.running
    ? `${stState.barsCompletedAtCurrentBpm} bar${stState.barsCompletedAtCurrentBpm === 1 ? '' : 's'} at this tempo`
    : (stState.currentBpm >= stState.targetBpm ? "At target tempo — nice." : 'Stopped');
}

function stScheduleClick(tickIndex, time) {
  const ctx = stState.audioCtx;
  const isBeat = tickIndex % stState.subdivision === 0;
  const beatIndexInBar = Math.floor(tickIndex / stState.subdivision) % stState.beatsPerBar;
  const isDownbeat = isBeat && beatIndexInBar === 0;

  // fbMasterGain() lives in fb-audio.js — shared across every sound this
  // app generates, since some audio interfaces don't expose a software
  // volume the OS volume keys can actually reach. fbSoundGain('metronome')
  // is a second, independent knob (Preferences → 声音音量) for just this
  // sound's own default loudness. Skip creating any audio nodes at all when
  // muted — exponentialRampToValueAtTime throws if asked to ramp from/to
  // exactly 0, and there's no point playing silence anyway.
  //
  // Peaks were previously 1 / 0.85 / 0.45, and the oscillator was a pure
  // sine — at fbSoundGain('metronome') defaulting to 1 and fbMasterGain()
  // defaulting to 1, the downbeat click's peak sample was already AT
  // digital full scale (1.0). Turning the "声音音量" slider above 100% just
  // pushed samples past ±1 into clipping, which reads as thinner/harsher,
  // not louder — that's why 135% still sounded quiet. Fixed two ways:
  // triangle (vs. sine) carries real harmonic energy, which is perceived as
  // noticeably louder than a pure sine at the *same* peak amplitude; and
  // peaks are pulled down to 0.7/0.6/0.32 so there's real headroom left for
  // the volume slider (now up to 200%, see FB_SOUND_VOLUME_MAX) to actually
  // do something before hitting the ceiling.
  const soundGain = typeof fbSoundGain === 'function' ? fbSoundGain('metronome') : 1;
  const vol = (isDownbeat ? 0.7 : (isBeat ? 0.6 : 0.32)) * fbMasterGain() * soundGain;
  if (vol > 0) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = isDownbeat ? 1500 : (isBeat ? 1000 : 700);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
  if (isBeat) {
    setTimeout(() => stFlashBeat(beatIndexInBar, isDownbeat), delayMs);
  }

}

function stScheduler() {
  const ctx = stState.audioCtx;
  while (stState.nextTickTime < ctx.currentTime + ST_SCHEDULE_AHEAD_SEC) {
    stScheduleClick(stState.tickIndex, stState.nextTickTime);

    const isBeat = stState.tickIndex % stState.subdivision === 0;
    const beatIndexInBar = Math.floor(stState.tickIndex / stState.subdivision) % stState.beatsPerBar;
    if (isBeat && beatIndexInBar === stState.beatsPerBar - 1) {
      // this tick completes a bar — advance the bar counter and, if enabled,
      // auto-bump the tempo once enough bars have passed at this one
      stState.barsCompletedAtCurrentBpm++;
      if (stState.autoAdvance && stState.barsCompletedAtCurrentBpm >= stState.autoAdvanceBars) {
        stBumpUp();
      }
      stUpdateDisplay();
    }

    const secondsPerTick = 60 / stState.currentBpm / stState.subdivision;
    stState.nextTickTime += secondsPerTick;
    stState.tickIndex++;
  }
}

function stStart() {
  if (stState.running) return;
  stReadOptionsFromUI();
  if (!stState.audioCtx) {
    stState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fbRegisterAudioContext(stState.audioCtx); // routes to the globally-selected output device (fb-audio.js)
  }
  if (stState.audioCtx.state === 'suspended') stState.audioCtx.resume();
  stState.currentBpm = Math.min(Math.max(stState.currentBpm, stState.startBpm), stState.targetBpm);
  stPrefsSave(); // the clamp above may have moved the persisted tempo
  stState.tickIndex = 0;
  stState.barsCompletedAtCurrentBpm = 0;
  stState.nextTickTime = stState.audioCtx.currentTime + 0.05;
  stState.running = true;
  if (typeof setTransportState === 'function') setTransportState('playing');
  if (typeof ptOnMetronomeStart === 'function') ptOnMetronomeStart(); // optional timer link — see practice-timer.js
  stScheduler();
  stState.timerId = setInterval(stScheduler, ST_LOOKAHEAD_MS);
  stUpdateDisplay();
}

function stStop() {
  if (!stState.running) return;
  stState.running = false;
  clearInterval(stState.timerId);
  stState.timerId = null;
  if (typeof setTransportState === 'function') setTransportState('stopped');
  if (typeof ptOnMetronomeStop === 'function') ptOnMetronomeStop(); // optional timer link — see practice-timer.js
  stFlashBeat(-1, false);
  stUpdateDisplay();
}

// Notifies the active lick (if any — see licksState.activeLick in licks.js)
// that the live tempo changed, so it can be auto-saved and resumed from next
// time, and so the eventual auto-logged session (see licksAutoLogSession)
// records the tempo actually practiced at. Guarded the same way
// the fb-*.js modules guard their calls into app.js's transport bar — licks.js may
// not be loaded (e.g. under the Node test harness).
function stNotifyLickBpm() {
  if (typeof licksNotifyBpmChange === 'function') licksNotifyBpmChange(stState.currentBpm);
}

// Manual "I nailed it, next tempo" — also called by auto-advance once enough
// bars have passed at the current tempo. Clamped to the configured target —
// this is specifically the ramp-toward-target ratchet.
function stBumpUp() {
  stState.currentBpm = Math.min(stState.targetBpm, stState.currentBpm + stState.stepBpm);
  stState.barsCompletedAtCurrentBpm = 0;
  stPrefsSave();
  stUpdateDisplay();
  stNotifyLickBpm();
}

// Free-form tempo control (+/- buttons or typing directly into the BPM box)
// — unlike stBumpUp, not clamped to [startBpm, targetBpm], since this is you
// overriding the tempo on the fly, not the automatic ramp mechanic. Takes
// effect immediately even mid-run: stScheduler() reads stState.currentBpm
// fresh on every tick, so no restart is needed.
function stAdjustBpm(delta) {
  stSetCurrentBpm(stState.currentBpm + delta);
}

function stSetCurrentBpm(value) {
  const n = Math.round(parseFloat(value));
  if (!Number.isFinite(n)) { stUpdateDisplay(); return; }
  stState.currentBpm = Math.max(20, Math.min(300, n));
  stState.barsCompletedAtCurrentBpm = 0;
  stPrefsSave();
  stUpdateDisplay();
  stNotifyLickBpm();
}

// Returns the chart's scrolling window in ms (4 bars at the current tempo).
function stChartWindowMs() {
  const barDurationMs = (60000 / stState.currentBpm) * stState.beatsPerBar;
  return barDurationMs * 4;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stState, stScheduleClick, stAdjustBpm, stSetCurrentBpm, stChartWindowMs, initSpeedPage };
}
