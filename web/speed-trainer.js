// ── Speed Trainer: click-track tempo ramp for "I can't play this fast part
// yet" practice — start slow, only bump the tempo once you're actually clean
// at the current one. No server dependency, works for any lick/solo
// regardless of whether it's represented anywhere else in the app. Uses
// fbRegisterAudioContext/fbOutput/fbMasterGain from fretboard.js for output
// device + volume routing (global, shared with Ear Training) — index.html
// loads fretboard.js first so these are always defined by the time stStart() runs.

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
  // Rhythm analysis (mic-based — see "Rhythm Analysis" section below):
  // doesn't know what notes you're supposed to play, only *when* you played
  // something, compared against the click grid. That's deliberately the
  // whole scope — judging pitch correctness would need the actual note
  // sequence entered ahead of time, which this app has no data model for yet.
  // Runs automatically whenever ▶ Start is running (see analyzeEnabled).
  analyzeEnabled: true,
  onsetRatio: 2.2,      // mic sensitivity — how far above background counts as an attack
  listening: false,
  tickLog: [],          // { wallMs, isDownbeat } for recently scheduled clicks
  barLineLog: [],       // wallMs of each bar's downbeat — feeds the chart's vertical gridlines
  onsetLog: [],         // { tMs, deviation } relative to sessionStartMs — feeds the live chart
  sessionStartMs: 0,
  timingStats: {},      // bpm -> { count, sumAbs, sumSigned } — cumulative across the page visit
  lastDeviationMs: null,
  _energyHistory: [],
  _onsetRefractoryUntil: 0,
  // Fixed system latency (audio output + mic input + processing) — measured
  // once via "Calibrate latency" and subtracted from every deviation after
  // that, so what's left reflects your actual playing, not your hardware.
  latencyOffsetMs: 0,
  calibrating: false,
  calibrationSamples: [],
  _currentNote: null,   // last detected pitch (e.g. 'A4') — shown in real-time display
  _noteHoldUntil: 0,    // keep showing _currentNote for 1 s after signal drops
  _pendingNote: null,   // most recently detected pitch, captured into onsetLog on next onset
  _prevRms: 0,          // previous frame RMS for rise-based onset detection
  _prevMagnitudes: null, // previous frame linear magnitude spectrum for spectral flux
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
  if (typeof saved.analyzeEnabled === 'boolean') stState.analyzeEnabled = saved.analyzeEnabled;
  if (Number.isFinite(saved.onsetRatio))      stState.onsetRatio      = saved.onsetRatio;
  if (Number.isFinite(saved.latencyOffsetMs)) stState.latencyOffsetMs = saved.latencyOffsetMs;
}

function stApplyStateToUI() {
  document.getElementById('st-start-bpm').value         = stState.startBpm;
  document.getElementById('st-target-bpm').value        = stState.targetBpm;
  document.getElementById('st-step-bpm').value          = stState.stepBpm;
  document.getElementById('st-beats-per-bar').value     = stState.beatsPerBar;
  document.getElementById('st-subdivision').value       = stState.subdivision;
  document.getElementById('st-auto-advance').checked    = stState.autoAdvance;
  document.getElementById('st-auto-advance-bars').value = stState.autoAdvanceBars;
  document.getElementById('st-analyze-enabled').checked = stState.analyzeEnabled;
  document.getElementById('st-sensitivity').value       = stState.onsetRatio;
}

function stPrefsSave() {
  localStorage.setItem(ST_PREFS_KEY, JSON.stringify({
    startBpm: stState.startBpm, targetBpm: stState.targetBpm,
    stepBpm: stState.stepBpm, beatsPerBar: stState.beatsPerBar,
    subdivision: stState.subdivision, autoAdvance: stState.autoAdvance,
    autoAdvanceBars: stState.autoAdvanceBars,
    analyzeEnabled: stState.analyzeEnabled, onsetRatio: stState.onsetRatio,
    latencyOffsetMs: stState.latencyOffsetMs,
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
    document.getElementById('st-analyze-enabled').addEventListener('change', stOnAnalyzeToggle);
    document.getElementById('st-sensitivity').addEventListener('input', stOnSensitivityChange);
  }

  stRenderBeatRow();
  stUpdateDisplay();
  stRenderAnalysis(); // show the "no notes yet" placeholder immediately, not just after the first onset
  stUpdateCalibrationStatus();
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
  document.getElementById('st-bpm-current').value = stState.currentBpm;
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

  // fbMasterGain() lives in fretboard.js — shared across every sound this
  // app generates, since some audio interfaces don't expose a software
  // volume the OS volume keys can actually reach. Skip creating any audio
  // nodes at all when muted — exponentialRampToValueAtTime throws if asked
  // to ramp from/to exactly 0, and there's no point playing silence anyway.
  const vol = (isDownbeat ? 0.9 : (isBeat ? 0.55 : 0.25)) * fbMasterGain();
  if (vol > 0) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isDownbeat ? 1500 : (isBeat ? 1000 : 700);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

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

  // Separately log just the bar boundaries (downbeats) — feeds the vertical
  // bar-line gridlines on the analysis chart.
  if (isDownbeat) {
    stState.barLineLog.push(performance.now() + delayMs);
    if (stState.barLineLog.length > 64) stState.barLineLog.shift();
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
  if (stState.analyzeEnabled) stStartListening();
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
  stStopListening(); // chart/stats already gathered stay on screen — only the mic stops
}

// Manual "I nailed it, next tempo" — also called by auto-advance once enough
// bars have passed at the current tempo. Clamped to the configured target —
// this is specifically the ramp-toward-target ratchet.
function stBumpUp() {
  stState.currentBpm = Math.min(stState.targetBpm, stState.currentBpm + stState.stepBpm);
  stState.barsCompletedAtCurrentBpm = 0;
  stUpdateDisplay();
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
  stUpdateDisplay();
}

function stReset() {
  stReadOptionsFromUI();
  stState.currentBpm = stState.startBpm;
  stState.barsCompletedAtCurrentBpm = 0;
  stUpdateDisplay();
}

// ── Rhythm Analysis: mic-based, real-time, runs automatically while ▶ Start
// is running ──
// Detects note *onsets* from the mic's amplitude envelope (a sudden rise
// above the recent background level — a guitar pluck has a sharp attack) and
// compares each one against the nearest logged click time. Purely a timing
// check: it has no idea what note you played, only when you played *something*.

const ST_ONSET_MIN_RMS = 0.015;      // ignore near-silence (room noise, hum)
const ST_ONSET_REFRACTORY_MS = 50;   // don't re-trigger on same note's attack — 50ms handles ~120BPM sextuplets
const ST_ONSET_RISE_THRESHOLD = 0.025; // min RMS rise per frame to count as an attack (energy-based)
const ST_ONSET_FLUX_THRESHOLD = 2.5;  // spectral flux threshold (sum of positive bin increases, linear scale)
const ST_ONSET_MAX_MATCH_MS = 400;   // an onset further than this from any click isn't useful feedback
const ST_CHART_WINDOW_BARS = 4;      // how much history the scrolling chart shows, in bars (not a fixed time)
const ST_CHART_MAX_DEV_MS = 150;     // deviation magnitude that maxes out the chart's y-axis
const ST_ROLLING_WINDOW_N = 8;       // how many recent notes the "steady/uneven" verdict looks at
const ST_STEADY_STDDEV_MS = 15;      // stddev below this counts as "steady"
// Meter reference level: typical mic input RMS while actually playing tops
// out well under 1.0 — this just picks a sane scale so the bar isn't either
// always empty or always pinned full; it's a visual VU meter, not a measurement.
const ST_METER_MAX_RMS = 0.3;

// Bar-based rather than a fixed number of seconds: a fixed-time window would
// show a different number of bars at every tempo (cramped at slow BPMs, way
// too sparse at fast ones) — sizing it in bars keeps "how much of the piece
// you're looking at" constant as the ramp speeds up.
function stChartWindowMs() {
  const barDurationMs = (60000 / stState.currentBpm) * stState.beatsPerBar;
  return barDurationMs * ST_CHART_WINDOW_BARS;
}

function stOnMicFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / buf.length);
  stUpdateMicLevel(rms);
  stDrawWaveform(buf); // same buffer already read above for RMS — no extra capture cost

  const hist = stState._energyHistory;
  const baseline = hist.length > 5 ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  hist.push(rms);
  if (hist.length > 30) hist.shift(); // ~0.5s of recent frames at ~60fps

  // Real-time pitch detection — runs every frame for the live note display.
  // Uses the same buffer already read for RMS (no extra getUserMedia call).
  const now = performance.now();
  if (sampleRate) {
    const freq = fbAutoCorrelate(buf, sampleRate, 0.003);
    if (freq > 60 && freq < 2000) {
      const { noteName, midi } = fbFreqToNote(freq);
      const octave = Math.floor(midi / 12) - 1;
      stState._pendingNote = noteName + octave;
      stState._currentNote = stState._pendingNote;
      stState._noteHoldUntil = now + 1000; // hold display for 1 s after signal drops
    } else if (now < stState._noteHoldUntil) {
      // Signal dropped — keep showing the last note briefly
    } else {
      stState._currentNote = null;
    }
  }
  stUpdateNoteDisplay();

  // ── Triple-mode onset detection ──
  // 1. Spectral flux: sum of positive magnitude increases across all FFT bins.
  //    Detects when new frequency energy appears (new note attack).
  //    Most reliable for dense passages — not fooled by sustained previous notes.
  const freqBuf = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqBuf);       // dB values, already computed by the analyser
  if (!stState._prevMagnitudes) stState._prevMagnitudes = new Float32Array(freqBuf.length);
  let flux = 0;
  for (let i = 0; i < freqBuf.length; i++) {
    const lin = Math.pow(10, freqBuf[i] / 20);   // dB → linear amplitude
    flux += Math.max(0, lin - stState._prevMagnitudes[i]);
    stState._prevMagnitudes[i] = lin;
  }
  // 2. RMS rise: large per-frame energy jump (strong attack transient)
  const rise = rms - (stState._prevRms || 0);
  stState._prevRms = rms;
  // 3. Ratio: current level significantly above rolling baseline
  const onsetByFlux  = rms > ST_ONSET_MIN_RMS && flux  > ST_ONSET_FLUX_THRESHOLD;
  const onsetByRise  = rms > ST_ONSET_MIN_RMS && rise  > ST_ONSET_RISE_THRESHOLD;
  const onsetByRatio = rms > ST_ONSET_MIN_RMS && rms   > baseline * stState.onsetRatio;
  if ((onsetByFlux || onsetByRise || onsetByRatio) && now >= stState._onsetRefractoryUntil) {
    stState._onsetRefractoryUntil = now + ST_ONSET_REFRACTORY_MS;
    stRecordOnset(now, stState._pendingNote);
  }

  stDrawChart(); // redraw every frame so the timeline keeps scrolling even without a new onset
}

function stUpdateNoteDisplay() {
  const el = document.getElementById('st-note-display');
  if (!el) return;
  el.textContent = stState._currentNote || '—';
  el.className = 'st-note-display' + (stState._currentNote ? ' active' : '');
}

function stUpdateMicLevel(rms) {
  const fill = document.getElementById('st-mic-level-fill');
  if (fill) fill.style.width = `${Math.min(100, (rms / ST_METER_MAX_RMS) * 100)}%`;
}

// Raw oscilloscope-style trace of what the mic is hearing right now — cheap
// (same buffer the RMS calc above already read) and lets you visually check
// whether an attack you played actually shows up as a spike, i.e. sanity-check
// the onset detector instead of just trusting its verdict blindly.
function stDrawWaveform(buf) {
  const canvas = document.getElementById('st-waveform-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, midY = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#4a7c4a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(buf.length / w));
  for (let x = 0; x < w; x++) {
    const v = buf[x * step] || 0;
    const y = midY - v * (midY - 2);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// While calibrating, onsets are diverted here instead of into the normal
// stats/chart — see stStartCalibration below.
function stRecordOnset(onsetMs, note) {
  if (!stState.tickLog.length) return;
  let best = null, bestDiff = Infinity;
  for (const tick of stState.tickLog) {
    const diff = Math.abs(tick.wallMs - onsetMs);
    if (diff < bestDiff) { bestDiff = diff; best = tick; }
  }
  if (!best || bestDiff > ST_ONSET_MAX_MATCH_MS) return;

  const rawDeviation = onsetMs - best.wallMs; // + = late, - = early, *before* latency compensation

  if (stState.calibrating) {
    stState.calibrationSamples.push(rawDeviation);
    stUpdateCalibrationStatus();
    if (stState.calibrationSamples.length >= ST_CALIBRATION_TARGET) stFinishCalibration();
    return;
  }

  const deviation = rawDeviation - stState.latencyOffsetMs;
  const bpm = stState.currentBpm;
  const s = stState.timingStats[bpm] || (stState.timingStats[bpm] = { count: 0, sumAbs: 0, sumSigned: 0 });
  s.count++;
  s.sumAbs += Math.abs(deviation);
  s.sumSigned += deviation;
  stState.lastDeviationMs = deviation;

  stState.onsetLog.push({ tMs: onsetMs - stState.sessionStartMs, deviation, note: note || null });
  if (stState.onsetLog.length > 500) stState.onsetLog.shift();

  stUpdateVerdict();
  stRenderAnalysis();
}

function stUpdateVerdict() {
  const el = document.getElementById('st-analysis-verdict');
  if (!el) return;
  const recent = stState.onsetLog.slice(-ST_ROLLING_WINDOW_N);
  if (recent.length < 3) { el.textContent = ''; el.className = 'st-analysis-verdict'; return; }
  const mean = recent.reduce((a, b) => a + b.deviation, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b.deviation - mean) ** 2, 0) / recent.length;
  const stddev = Math.round(Math.sqrt(variance));
  const steady = stddev < ST_STEADY_STDDEV_MS;
  el.textContent = steady
    ? `Steady — last ${recent.length} notes within ±${stddev}ms of each other`
    : `Uneven timing — last ${recent.length} notes vary by ±${stddev}ms, try dropping the tempo a notch`;
  el.className = 'st-analysis-verdict ' + (steady ? 'steady' : 'uneven');
}

// Scrolling strip chart: x-axis is time (most recent on the right), y-axis
// is timing deviation from the click (0 = dead center, up = late, down =
// early). Plain canvas, no charting library — this is a handful of dots and
// a few vertical lines. Window is the last ST_CHART_WINDOW_BARS bars, not a
// fixed number of seconds — see stChartWindowMs().
function stDrawChart() {
  const canvas = document.getElementById('st-analysis-canvas');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  // Layout: top NOTE_STRIP_H px = note name strip; rest = timing deviation dots
  const NOTE_STRIP_H = 36;
  const chartTop = NOTE_STRIP_H + 4;
  const chartH    = h - chartTop;
  const midY      = chartTop + chartH / 2;
  const windowMs  = stChartWindowMs();
  const nowRel    = performance.now() - stState.sessionStartMs;

  ctx.clearRect(0, 0, w, h);

  // Note name strip background
  ctx.fillStyle = '#f5f4ee';
  ctx.fillRect(0, 0, w, NOTE_STRIP_H);

  // Separator line between note strip and timing chart
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, NOTE_STRIP_H); ctx.lineTo(w, NOTE_STRIP_H); ctx.stroke();

  // Center line for timing chart
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();

  // Bar-boundary gridlines
  ctx.strokeStyle = '#eee';
  stState.barLineLog.forEach(barWallMs => {
    const relMs = barWallMs - stState.sessionStartMs;
    if (nowRel - relMs < 0 || nowRel - relMs > windowMs) return;
    const x = w * (1 - (nowRel - relMs) / windowMs);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  });

  stState.onsetLog
    .filter(o => nowRel - o.tMs < windowMs)
    .forEach(o => {
      const x = w * (1 - (nowRel - o.tMs) / windowMs);
      const color = Math.abs(o.deviation) < 15 ? '#4a7c4a' : (o.deviation > 0 ? '#c04040' : '#4a6ac0');

      // ── Note name pill in the top strip ──
      if (o.note) {
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(o.note).width;
        const pw = tw + 8, ph = 20, py = (NOTE_STRIP_H - ph) / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x - pw / 2, py, pw, ph, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(o.note, x, NOTE_STRIP_H / 2);
        ctx.textAlign = 'left';
      }

      // ── Timing dot in the chart area ──
      const clamped = Math.max(-ST_CHART_MAX_DEV_MS, Math.min(ST_CHART_MAX_DEV_MS, o.deviation));
      const y = midY - (clamped / ST_CHART_MAX_DEV_MS) * (chartH / 2 - 8);
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
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
  stState.onsetLog = [];
  stState.sessionStartMs = performance.now();
  stState._currentNote = null;
  stState._noteHoldUntil = 0;
  stState._pendingNote = null;
  stState._prevRms = 0;
  stState._prevMagnitudes = null;
}

function stStopListening() {
  stState.listening = false;
  if (fbMic.listening && fbMic.owner === 'speed') fbMicStop();
  stUpdateMicLevel(0);
}

// Toggling the checkbox mid-session should take effect immediately, not just
// on the next Start — matches "does Play also analyze" being live-editable.
function stOnAnalyzeToggle() {
  stState.analyzeEnabled = document.getElementById('st-analyze-enabled').checked;
  stPrefsSave();
  if (stState.running) {
    if (stState.analyzeEnabled) stStartListening();
    else stStopListening();
  }
}

function stOnSensitivityChange() {
  stState.onsetRatio = parseFloat(document.getElementById('st-sensitivity').value) || 2.2;
  stPrefsSave();
}

function stResetAnalysis() {
  stState.timingStats = {};
  stState.lastDeviationMs = null;
  stState.onsetLog = [];
  stState.sessionStartMs = performance.now();
  stRenderAnalysis();
  stUpdateVerdict();
  stDrawChart();
}

function stRenderAnalysis() {
  const table = document.getElementById('st-analysis-table');
  const rows = Object.keys(stState.timingStats).map(Number).sort((a, b) => a - b).map(bpm => {
    const s = stState.timingStats[bpm];
    return { bpm, count: s.count, avgAbs: Math.round(s.sumAbs / s.count), bias: Math.round(s.sumSigned / s.count) };
  });
  if (!rows.length) {
    table.innerHTML = '<span style="color:#aaa;font-size:12px">No notes captured yet — hit ▶ Start and play along with the click (make sure a mic is selected in the bar at the top).</span>';
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

// ── Latency calibration ──
// The mic→onset-detection pipeline and the audio output both have their own
// fixed hardware/OS latency, and matching onsets to "nearest click" bakes
// that constant offset into every measurement — showing up as a suspiciously
// uniform "dragging by the same ~150ms every single note" instead of genuine
// human timing variance. Calibration measures that fixed offset once (tap or
// clap steadily along with the click for a few beats) and subtracts it from
// every future measurement.
const ST_CALIBRATION_TARGET = 8;

function stStartCalibration() {
  stState.calibrating = true;
  stState.calibrationSamples = [];
  if (!stState.running) stStart();
  if (!stState.listening) stStartListening();
  stUpdateCalibrationStatus();
}

function stCancelCalibration() {
  stState.calibrating = false;
  stState.calibrationSamples = [];
  stUpdateCalibrationStatus();
}

function stFinishCalibration() {
  const samples = stState.calibrationSamples;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  stState.latencyOffsetMs = Math.round(mean);
  stState.calibrating = false;
  stPrefsSave();
  stUpdateCalibrationStatus();
}

function stUpdateCalibrationStatus() {
  const el = document.getElementById('st-calibration-status');
  if (!el) return;
  if (stState.calibrating) {
    el.textContent = `Calibrating — tap or clap steadily along with the click… (${stState.calibrationSamples.length}/${ST_CALIBRATION_TARGET})`;
  } else if (stState.latencyOffsetMs) {
    el.textContent = `Calibrated: ~${stState.latencyOffsetMs}ms of fixed system latency is now compensated automatically.`;
  } else {
    el.textContent = "Not calibrated yet — timing numbers below include your system's raw audio latency, uncorrected.";
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stState, stScheduleClick, stRecordOnset, stFinishCalibration, stAdjustBpm, stSetCurrentBpm, stChartWindowMs, initSpeedPage };
}
