// ── Speed Trainer: click-track tempo ramp for "I can't play this fast part
// yet" practice — start slow, only bump the tempo once you're actually clean
// at the current one. Standalone module, no server dependency, works for any
// lick/solo regardless of whether it's represented anywhere else in the app.

// Web Audio scheduling needs a lookahead: naive setTimeout-per-click drifts
// because JS timers aren't sample-accurate, so instead we poll frequently and
// schedule any clicks due in the next SCHEDULE_AHEAD_SEC using the audio
// clock (ctx.currentTime), which *is* sample-accurate. Standard technique —
// see "A Tale of Two Clocks" (Chris Wilson, HTML5Rocks).
const ST_LOOKAHEAD_MS = 25;
const ST_SCHEDULE_AHEAD_SEC = 0.1;

const stState = {
  startBpm: 60, targetBpm: 120, stepBpm: 4,
  beatsPerBar: 4, subdivision: 1, // ticks per beat: 1=quarter, 2=eighth, 4=sixteenth
  autoAdvance: false, autoAdvanceBars: 4,
  currentBpm: 60,
  running: false,
  audioCtx: null, timerId: null,
  nextTickTime: 0, tickIndex: 0, barsCompletedAtCurrentBpm: 0,
};

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
  stReadOptionsFromUI();
  stState.currentBpm = stState.startBpm;
  ['st-start-bpm', 'st-target-bpm', 'st-step-bpm', 'st-beats-per-bar', 'st-subdivision'].forEach(id => {
    document.getElementById(id).addEventListener('change', stOnOptionsChanged);
  });
  document.getElementById('st-auto-advance').addEventListener('change', stOnOptionsChanged);
  document.getElementById('st-auto-advance-bars').addEventListener('change', stOnOptionsChanged);
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
  document.getElementById('st-bpm-current').textContent = stState.currentBpm;
  document.getElementById('st-bpm-target-label').textContent = `(target ${stState.targetBpm})`;
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

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = isDownbeat ? 1500 : (isBeat ? 1000 : 700);
  const gain = ctx.createGain();
  const vol = isDownbeat ? 0.9 : (isBeat ? 0.55 : 0.25);
  gain.gain.setValueAtTime(vol, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);

  if (isBeat) {
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
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
  if (!stState.audioCtx) stState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (stState.audioCtx.state === 'suspended') stState.audioCtx.resume();
  stState.currentBpm = Math.min(Math.max(stState.currentBpm, stState.startBpm), stState.targetBpm);
  stState.tickIndex = 0;
  stState.barsCompletedAtCurrentBpm = 0;
  stState.nextTickTime = stState.audioCtx.currentTime + 0.05;
  stState.running = true;
  document.getElementById('st-start-btn').style.display = 'none';
  document.getElementById('st-stop-btn').style.display = '';
  stScheduler();
  stState.timerId = setInterval(stScheduler, ST_LOOKAHEAD_MS);
  stUpdateDisplay();
}

function stStop() {
  if (!stState.running) return;
  stState.running = false;
  clearInterval(stState.timerId);
  stState.timerId = null;
  document.getElementById('st-start-btn').style.display = '';
  document.getElementById('st-stop-btn').style.display = 'none';
  stFlashBeat(-1, false);
  stUpdateDisplay();
}

// Manual "I nailed it, next tempo" — also called by auto-advance once enough
// bars have passed at the current tempo.
function stBumpUp() {
  stState.currentBpm = Math.min(stState.targetBpm, stState.currentBpm + stState.stepBpm);
  stState.barsCompletedAtCurrentBpm = 0;
  stUpdateDisplay();
}

function stReset() {
  stReadOptionsFromUI();
  stState.currentBpm = stState.startBpm;
  stState.barsCompletedAtCurrentBpm = 0;
  stUpdateDisplay();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stState, stScheduleClick };
}
