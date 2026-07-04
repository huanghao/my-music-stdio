// ── Speed Trainer: click-track tempo ramp for "I can't play this fast part
// yet" practice — start slow, only bump the tempo once you're actually clean
// at the current one. No server dependency, works for any lick/solo
// regardless of whether it's represented anywhere else in the app. Uses
// fbRegisterAudioContext/fbOutput from fretboard.js for output-device
// routing (global picker, shared with Ear Training) — index.html loads
// fretboard.js first so this is always defined by the time stStart() runs.

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
  // Rhythm analysis (mic-based — see "Listen & Analyze" below): doesn't know
  // what notes you're supposed to play, only *when* you played something,
  // compared against the click grid. That's deliberately the whole scope —
  // judging pitch correctness would need the actual note sequence entered
  // ahead of time, which this app has no data model for yet.
  listening: false,
  tickLog: [],       // { wallMs, isDownbeat } for recently scheduled clicks
  timingStats: {},   // bpm -> { count, sumAbs, sumSigned }
  lastDeviationMs: null,
  _energyHistory: [],
  _onsetRefractoryUntil: 0,
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
    autoAdvanceBars: stState.autoAdvanceBars,
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
  stPrefsLoad();
  stApplyStateToUI();
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
  stPrefsSave();
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

  const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
  if (isBeat) {
    setTimeout(() => stFlashBeat(beatIndexInBar, isDownbeat), delayMs);
  }

  // Log every tick's estimated wall-clock time (not just beats) so onset
  // analysis can compare against whatever grid resolution is configured —
  // converting from the audio clock to performance.now()'s timeline the same
  // way the beat-flash setTimeout above does.
  stState.tickLog.push({ wallMs: performance.now() + delayMs, isDownbeat });
  if (stState.tickLog.length > 200) stState.tickLog.shift();
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
    fbRegisterAudioContext(stState.audioCtx); // routes to the globally-selected output device (fretboard.js)
  }
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

// ── Listen & Analyze: mic-based rhythm timing feedback ──
// Detects note *onsets* from the mic's amplitude envelope (a sudden rise
// above the recent background level — a guitar pluck has a sharp attack) and
// compares each one against the nearest logged click time. Purely a timing
// check: it has no idea what note you played, only when you played *something*.

const ST_ONSET_MIN_RMS = 0.02;       // ignore near-silence (room noise, hum)
const ST_ONSET_RATIO = 2.2;          // how far above recent background counts as an attack
const ST_ONSET_REFRACTORY_MS = 120;  // don't re-trigger on the same note's sustain/decay
const ST_ONSET_MAX_MATCH_MS = 400;   // an onset further than this from any click isn't useful feedback

function stOnMicFrame(analyser) {
  if (!stState.listening) return;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / buf.length);

  const hist = stState._energyHistory;
  const baseline = hist.length > 5 ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  hist.push(rms);
  if (hist.length > 30) hist.shift(); // ~0.5s of recent frames at ~60fps

  const now = performance.now();
  if (rms > ST_ONSET_MIN_RMS && rms > baseline * ST_ONSET_RATIO && now >= stState._onsetRefractoryUntil) {
    stState._onsetRefractoryUntil = now + ST_ONSET_REFRACTORY_MS;
    stRecordOnset(now);
  }
}

function stRecordOnset(onsetMs) {
  if (!stState.tickLog.length) return;
  let best = null, bestDiff = Infinity;
  for (const tick of stState.tickLog) {
    const diff = Math.abs(tick.wallMs - onsetMs);
    if (diff < bestDiff) { bestDiff = diff; best = tick; }
  }
  if (!best || bestDiff > ST_ONSET_MAX_MATCH_MS) return;

  const deviation = onsetMs - best.wallMs; // + = late/dragging, - = early/rushing
  const bpm = stState.currentBpm;
  const s = stState.timingStats[bpm] || (stState.timingStats[bpm] = { count: 0, sumAbs: 0, sumSigned: 0 });
  s.count++;
  s.sumAbs += Math.abs(deviation);
  s.sumSigned += deviation;
  stState.lastDeviationMs = deviation;
  stRenderAnalysis();
}

async function stStartListening() {
  const fb = document.getElementById('st-analysis-msg');
  try {
    await fbMicStart('speed', stOnMicFrame);
  } catch (e) {
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    return;
  }
  fb.textContent = '';
  stState.listening = true;
  stState._energyHistory = [];
  document.getElementById('st-listen-start-btn').style.display = 'none';
  document.getElementById('st-listen-stop-btn').style.display = '';
}

function stStopListening() {
  stState.listening = false;
  if (fbMic.listening && fbMic.owner === 'speed') fbMicStop();
  document.getElementById('st-listen-start-btn').style.display = '';
  document.getElementById('st-listen-stop-btn').style.display = 'none';
}

function stResetAnalysis() {
  stState.timingStats = {};
  stState.lastDeviationMs = null;
  stRenderAnalysis();
}

function stRenderAnalysis() {
  const last = document.getElementById('st-analysis-last');
  if (stState.lastDeviationMs != null) {
    const d = Math.round(stState.lastDeviationMs);
    const tag = d > 8 ? 'late' : d < -8 ? 'early' : 'on time';
    last.textContent = `Last note: ${d > 0 ? '+' : ''}${d}ms (${tag})`;
  }

  const table = document.getElementById('st-analysis-table');
  const rows = Object.keys(stState.timingStats).map(Number).sort((a, b) => a - b).map(bpm => {
    const s = stState.timingStats[bpm];
    return { bpm, count: s.count, avgAbs: Math.round(s.sumAbs / s.count), bias: Math.round(s.sumSigned / s.count) };
  });
  if (!rows.length) {
    table.innerHTML = '<span style="color:#aaa;font-size:12px">No notes captured yet — start listening and play along with the click.</span>';
    return;
  }
  table.innerHTML = `
    <table class="fb-stats-table">
      <tr><th>BPM</th><th>Notes</th><th>Avg timing error</th><th>Tendency</th></tr>
      ${rows.map(r => `<tr><td>${r.bpm}</td><td>${r.count}</td><td>${r.avgAbs}ms</td><td>${
        r.bias > 8 ? `dragging (+${r.bias}ms)` : r.bias < -8 ? `rushing (${r.bias}ms)` : 'even'
      }</td></tr>`).join('')}
    </table>
  `;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stState, stScheduleClick, stRecordOnset };
}
