// ── Fretboard trainer — Bend & Vibrato drills ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Bend & Vibrato ──

// Bend exercises: G (3), B (4), high-E (5) strings, frets 5-17.
// Frets 1-4 are skipped (high tension near nut, awkward to bend);
// frets 5-17 covers all five pentatonic box positions in any key.
const FB_BEND_STRINGS   = [3, 4, 5];  // G=3, B=4, high-E=5
const FB_BEND_FRET_MIN  = 5;
const FB_BEND_FRET_MAX  = 17;

const FB_BEND_STABLE_FRAMES   = 3;    // frames of stable pitch to lock baseline (3 @ 60fps ≈ 50ms)
const FB_BEND_HOLD_MS         = 700;  // must sit in the target zone this long (real time, not frames) → success
const FB_BEND_ZONE_GRACE_MS   = 150;  // brief in/out noise near the edge of the zone doesn't reset the hold timer
const FB_BEND_TOLERANCE       = 30;   // cents around target → success (was 25 — wider zone reduces false negatives)
const FB_BEND_NEXT_DELAY_MS   = 2000; // ms before auto-advancing to the next exercise after success
const FB_BEND_HISTORY_MS      = 5000; // rolling graph window
const FB_BEND_SILENCE_HOLD_MS = 600;  // keep last reading for this long during decay

// Detects a fresh pick (re-attack) via the amplitude envelope, independent of
// pitch tracking — a real bend is one continuous string ring with gradually
// rising pitch, while plucking the target fret directly to "check" the pitch
// produces a new sharp attack transient. Used to reject that shortcut: once
// baseFreq is locked, any new attack means "this isn't a bend, it's a re-pick."
const FB_BEND_ATTACK_RATIO        = 1.8;  // new RMS this many× the rolling baseline counts as a fresh pick
const FB_BEND_ATTACK_MIN_RMS      = 0.01; // ignore near-silence/noise floor
const FB_BEND_ATTACK_REFRACTORY_MS = 150; // don't re-trigger on the same attack's own transient

const FB_VIBRATO_HISTORY_MS    = 4000;
const FB_VIBRATO_SUCCESS_MS    = 3000;
const FB_VIBRATO_MIN_DEPTH     = 25;   // cents peak amplitude
const FB_VIBRATO_SUCCESS_FR    = 180;  // 3 s × ~60 fps

const FB_VIBRATO_TARGET_RANGES = { 3: [2, 4.5], 5: [3.5, 6.5], 7: [5.5, 9] };

const FB_STRING_DISPLAY = ['low E', 'A', 'D', 'G', 'B', 'high E'];

// Every standard bend amount, drawn on the graph *every* time regardless of
// the current target — keeps the graph's layout fixed across questions
// (only the highlighted/green one changes) instead of the axis rescaling
// and every line shifting position each time you get a new exercise.
const FB_BEND_REFERENCE_CENTS = [
  { cents: 50,  label: '¼ step' },
  { cents: 100, label: '½ step' },
  { cents: 200, label: '1 step' },
  { cents: 300, label: '1½ steps' },
];
const FB_BEND_GRAPH_MAX_CENTS = 350; // fixed scale — covers the widest reference (300¢) plus headroom

function fbBendNoteLabel(midi) {
  return FB_NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function fbBendIntervalCents(interval) {
  if (interval === 'quarter') return 50;
  return interval === 'half' ? 100 : interval === 'full' ? 200 : 300;
}

function fbBendIntervalLabel(interval) {
  if (interval === 'quarter') return '¼ step';
  return interval === 'half' ? '½ step' : interval === 'full' ? '1 full step' : '1½ steps';
}

function fbBendPickExercise() {
  const s = fbState.bend;
  // Pick a random enabled string (fall back to B if none selected)
  const enabledStrings = FB_BEND_STRINGS.filter(i => s.strings[i]);
  const string = (enabledStrings.length ? enabledStrings : [4])[
    Math.floor(Math.random() * (enabledStrings.length || 1))
  ];
  // Pick a random fret in the common-bending range
  const fret = FB_BEND_FRET_MIN + Math.floor(Math.random() * (FB_BEND_FRET_MAX - FB_BEND_FRET_MIN + 1));
  return { string, fret };
}

function fbBendPickInterval() {
  const s = fbState.bend;
  const enabled = Object.keys(s.intervals).filter(k => s.intervals[k]);
  return (enabled.length ? enabled : ['full'])[Math.floor(Math.random() * (enabled.length || 1))];
}

function fbBendToggleString(idx, checked) {
  fbState.bend.strings[idx] = checked;
  // Keep at least one string enabled
  if (!Object.values(fbState.bend.strings).some(Boolean)) fbState.bend.strings[idx] = true;
  fbPrefsSave();
}

function fbBendToggleInterval(key, checked) {
  fbState.bend.intervals[key] = checked;
  // Keep at least one interval enabled
  if (!Object.values(fbState.bend.intervals).some(Boolean)) fbState.bend.intervals[key] = true;
  fbPrefsSave();
}

// ── Render helpers ──

function fbBendRenderOptions() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-chord-type-groups">
      <div class="fb-chord-type-group">
        <label class="fb-chord-group-label">String:</label>
        <span class="fb-chord-type-children">
          <label><input type="checkbox" ${s.strings[3]?'checked':''} onchange="fbBendToggleString(3,this.checked)"> G</label>
          <label><input type="checkbox" ${s.strings[4]?'checked':''} onchange="fbBendToggleString(4,this.checked)"> B <small class="text-fg-muted">(most common)</small></label>
          <label><input type="checkbox" ${s.strings[5]?'checked':''} onchange="fbBendToggleString(5,this.checked)"> high E</label>
        </span>
      </div>
      <div class="fb-chord-type-group">
        <label class="fb-chord-group-label">Interval:</label>
        <span class="fb-chord-type-children">
          <label><input type="checkbox" ${s.intervals.quarter?'checked':''} onchange="fbBendToggleInterval('quarter',this.checked)"> ¼ step <small class="text-fg-muted">(blues touch)</small></label>
          <label><input type="checkbox" ${s.intervals.half?'checked':''} onchange="fbBendToggleInterval('half',this.checked)"> ½ step</label>
          <label><input type="checkbox" ${s.intervals.full?'checked':''} onchange="fbBendToggleInterval('full',this.checked)"> 1 full step <small class="text-fg-muted">(most common)</small></label>
          <label><input type="checkbox" ${s.intervals.full_half?'checked':''} onchange="fbBendToggleInterval('full_half',this.checked)"> 1½ steps</label>
        </span>
      </div>
    </div>`;
}

function fbVibratoRenderOptions() {
  const v = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-options');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-options">
      <label>Target speed:
        <select onchange="fbState.vibrato.targetHz=parseInt(this.value); fbPrefsSave()">
          <option value="3" ${v.targetHz===3?'selected':''}>Slow (~3 Hz)</option>
          <option value="5" ${v.targetHz===5?'selected':''}>Medium (~5 Hz)</option>
          <option value="7" ${v.targetHz===7?'selected':''}>Fast (~7 Hz)</option>
        </select>
      </label>
    </div>`;
}

function fbBendRenderPrompt() {
  const s = fbState.bend;
  const c = s.current;
  if (!c) return;
  const el = document.getElementById('fb-bend-prompt');
  if (!el) return;
  el.innerHTML = `
    <div class="fb-bend-exercise-row">
      <span class="fb-bend-location">${FB_STRING_DISPLAY[c.string]} string &nbsp;·&nbsp; fret ${c.fret}</span>
      <span class="fb-bend-arrow">→</span>
      <span class="fb-bend-intlabel">bend <strong>${c.intLabel}</strong></span>
    </div>
    <div class="fb-bend-notes-row">${c.startLabel} &nbsp;→&nbsp; <span class="fb-bend-target-note">${c.targetLabel}</span></div>`;
}

function fbBendRenderGraph() {
  const canvas = document.getElementById('fb-bend-canvas');
  if (!canvas) return;
  const s = fbState.bend;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const targetCents = s.current ? s.current.targetCents : 200;
  const maxCents    = FB_BEND_GRAPH_MAX_CENTS;
  const PAD_T = 20, PAD_B = 16, PAD_L = 0, PAD_R = 0;
  const innerH = H - PAD_T - PAD_B;

  // cents → canvas y (0¢ at bottom, maxCents at top)
  const cy = c => PAD_T + innerH - Math.max(0, Math.min(innerH, (Math.max(0, c) / maxCents) * innerH));

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // Fixed reference gridlines for every standard bend amount — always drawn,
  // regardless of which one is this question's target, so the graph's
  // layout never shifts between questions. Only the current target's line
  // gets the green highlight + tolerance band.
  FB_BEND_REFERENCE_CENTS.forEach(({ cents, label }) => {
    const isTarget = cents === targetCents;
    const y = cy(cents);
    if (isTarget) {
      const yz1 = cy(cents + FB_BEND_TOLERANCE);
      const yz2 = cy(cents - FB_BEND_TOLERANCE);
      ctx.fillStyle = 'rgba(74,124,74,0.15)';
      ctx.fillRect(0, yz1, W, yz2 - yz1);
      ctx.save();
      ctx.strokeStyle = '#4a7c4a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#4a7c4a';
      ctx.font = 'bold 11px sans-serif';
    } else {
      ctx.save();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#bbb';
      ctx.font = '10px sans-serif';
    }
    ctx.textBaseline = 'bottom';
    const targetSuffix = isTarget && s.current ? `  ${s.current.targetLabel}` : '';
    ctx.fillText(`${cents}¢ ${label}${targetSuffix}`, 6, y - 1);
  });

  // Baseline
  const yb = cy(0);
  ctx.strokeStyle = '#6a8caa';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(W, yb); ctx.stroke();
  ctx.fillStyle = '#6a8caa';
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`0¢  ${s.current ? s.current.startLabel : ''}`, 6, yb + 2);

  // ── Idle-phase: show live pitch vs. expected start note ──
  if (!s.baseFreq) {
    // Draw a horizontal "0¢ reference" line so the user knows where to aim
    const y0 = cy(0);
    ctx.strokeStyle = '#6a8caa';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke();
    ctx.fillStyle = '#6a8caa';
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(s.current ? `0¢  ${s.current.startLabel} ← pluck here` : '0¢  pluck to begin', 6, y0 + 2);

    if (s._lastFreq && s.current) {
      // Show how far the current pitch is from the expected starting note
      const centsFromStart = 1200 * Math.log2(s._lastFreq / fbFreqFromMidi(s.current.midi));
      const px = W - 12;
      const py = cy(Math.max(-50, Math.min(300, centsFromStart)));
      const near = Math.abs(centsFromStart) < 80;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = near ? '#4a7c4a' : '#aaa';
      ctx.fill();
      ctx.fillStyle = near ? '#4a7c4a' : '#888';
      ctx.font = 'bold 12px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText((centsFromStart >= 0 ? '+' : '') + Math.round(centsFromStart) + '¢', px - 8, py);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('pluck and hold the string…', W / 2, H / 2);
      ctx.textAlign = 'left';
    }
    return;
  }

  if (!s._history || s._history.length < 2) return;

  // Pitch trace
  const now = performance.now();
  const succeeded = s.phase === 'success';
  ctx.strokeStyle = succeeded ? '#27ae60' : '#b8843a';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of s._history) {
    const x = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - ts) / FB_BEND_HISTORY_MS);
    const y = cy(Math.max(-20, Math.min(maxCents, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = s._history[s._history.length - 1];
  if (last) {
    const inZone = succeeded || Math.abs(last.cents - targetCents) <= FB_BEND_TOLERANCE;
    ctx.fillStyle = inZone ? '#27ae60' : '#b8843a';
    const dx = PAD_L + (W - PAD_L - PAD_R) * (1 - (now - last.ts) / FB_BEND_HISTORY_MS);
    const dy = cy(Math.max(-20, Math.min(maxCents, last.cents)));
    ctx.beginPath();
    ctx.arc(Math.min(W - 4, Math.max(4, dx)), dy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Cents readout in top-right
    ctx.fillStyle = inZone ? '#27ae60' : '#2a2a2a';
    ctx.font = 'bold 14px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillText((last.cents >= 0 ? '+' : '') + last.cents + '¢', W - 8, 4);
    ctx.textAlign = 'left';
  }

  // Success: countdown bar at the bottom of the canvas
  if (succeeded && s._nextAt) {
    const remaining = Math.max(0, s._nextAt - now);
    const frac = remaining / FB_BEND_NEXT_DELAY_MS;
    // Background track
    ctx.fillStyle = '#e0f0e0';
    ctx.fillRect(0, H - 6, W, 6);
    // Shrinking fill
    ctx.fillStyle = '#4a7c4a';
    ctx.fillRect(0, H - 6, W * frac, 6);
  }
}

function fbBendRenderStats() {
  const s = fbState.bend;
  const el = document.getElementById('fb-bend-stats');
  if (!el) return;
  const acc = s.total ? Math.round(s.correct / s.total * 100) + '%' : '—';
  el.innerHTML = `<span class="fb-stat-item">${s.correct}/${s.total}</span>
    <span class="fb-stat-item">streak ${s.streak}</span>
    <span class="fb-stat-item">acc ${acc}</span>`;
}

function fbBendFb(msg, cls) {
  const el = document.getElementById('fb-bend-feedback');
  if (el) { el.textContent = msg; el.className = 'fb-feedback ' + (cls || ''); }
}

// ── Lifecycle ──

function fbBendInit() {
  fbBendSetSubMode(fbState.bend.subMode, false);
}

function fbBendSetSubMode(mode, save = true) {
  fbState.bend.subMode = mode;
  if (save) fbPrefsSave();
  document.querySelectorAll('#fb-bend .fb-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.bendmode === mode));
  document.getElementById('fb-bend-bend-panel').classList.toggle('hidden', mode !== 'bend');
  document.getElementById('fb-bend-vibrato-panel').classList.toggle('hidden', mode !== 'vibrato');
  if (fbMic.listening && fbMic.owner === 'bend') fbBendMicStop();
  fbBendRenderOptions();
  fbVibratoRenderOptions();
  if (mode === 'bend')    fbBendNext();
  if (mode === 'vibrato') fbVibratoNext();
}

function fbBendNext() {
  const s = fbState.bend;
  s.phase = 'idle';
  s.baseFreq = null;
  s._stableFr = 0;
  s._holdSinceMs = 0;
  s._lastInZoneAt = 0;
  s._lastFreq = null;
  s._nextAt = null;
  s._history = [];
  s._lastFreqTs = null;
  s._smoothedCents = null;
  s._ampHistory = [];
  s._lastAttackAt = 0;
  // Cooldown: block baseline detection for 500 ms so a still-ringing string
  // from the previous exercise doesn't immediately lock as the new baseline.
  s._readyAt = performance.now() + 500;
  const ex = fbBendPickExercise();
  const midi = FB_STRING_OPEN_MIDI[ex.string] + ex.fret;
  const interval    = fbBendPickInterval();
  const targetCents = fbBendIntervalCents(interval);
  const targetMidi  = midi + Math.round(targetCents / 100);
  s.current = {
    string: ex.string, fret: ex.fret,
    midi,              // expected starting MIDI note — used to validate the baseline
    startLabel: fbBendNoteLabel(midi),
    targetLabel: fbBendNoteLabel(targetMidi),
    targetCents, intLabel: fbBendIntervalLabel(interval),
  };
  fbBendRenderPrompt();
  fbBendRenderGraph();
  fbBendRenderStats();
  fbBendFb(fbMic.owner === 'bend' ? 'Pluck the string…' : '', '');
}

async function fbBendMicStart() {
  try {
    await fbMicStart('bend', fbBendOnFrame);
  } catch (e) {
    fbBendFb('Mic error: ' + e.message, 'err');
    return;
  }
  if (fbState.bend.subMode === 'bend') {
    // Reset detection state so each listening session starts fresh
    fbState.bend.phase    = 'pluck';
    fbState.bend.baseFreq = null;
    fbState.bend._stableFr = 0;
    fbState.bend._lastFreq = null;
    fbState.bend._holdSinceMs = 0;
    fbState.bend._lastInZoneAt = 0;
    fbState.bend._history  = [];
    fbState.bend._lastFreqTs = null;
    fbState.bend._smoothedCents = null;
    fbState.bend._ampHistory = [];
    fbState.bend._lastAttackAt = 0;
    fbBendFb('Pluck the string — then bend…', '');
    fbBendRenderGraph();
  } else {
    fbState.vibrato.phase = 'pluck';
    document.getElementById('fb-vibrato-feedback').textContent = 'Pluck any note and apply vibrato…';
    document.getElementById('fb-vibrato-feedback').className = 'fb-feedback';
  }
  fbSyncMicButtons('bend');
}

function fbBendMicStop() {
  fbMicStop();
  fbState.bend.phase = 'idle';
  fbState.vibrato.phase = 'idle';
  fbBendRenderGraph();
  fbSyncMicButtons('bend');
}

// ── onFrame dispatcher ──

function fbBendOnFrame(analyser, sampleRate) {
  if (fbState.bend.subMode === 'vibrato') {
    fbVibratoOnFrame(analyser, sampleRate);
  } else {
    fbBendBendOnFrame(analyser, sampleRate);
  }
}

// ── Bending onFrame ──

function fbBendBendOnFrame(analyser, sampleRate) {
  const s = fbState.bend;
  const now = performance.now();

  // Auto-advance after success
  if (s._nextAt && now >= s._nextAt) {
    s._nextAt = null;
    fbBendNext();
    return;
  }

  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);

  // Re-pick (fresh attack) detection, from the amplitude envelope — tracked
  // independently of pitch so it catches a pick even during the split-second
  // before autocorrelate locks onto its frequency. A real bend is one
  // continuous ring with the pitch gradually rising; a "let me pluck the
  // target fret to check" shortcut instead produces a brand-new attack
  // transient partway through — that's exactly what this rejects.
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
  const rms = Math.sqrt(sumSq / buf.length);
  const ampBaseline = s._ampHistory.length > 5
    ? s._ampHistory.reduce((a, b) => a + b, 0) / s._ampHistory.length : 0;
  s._ampHistory.push(rms);
  if (s._ampHistory.length > 20) s._ampHistory.shift();
  const isAttack = rms > FB_BEND_ATTACK_MIN_RMS && rms > ampBaseline * FB_BEND_ATTACK_RATIO
    && now - s._lastAttackAt > FB_BEND_ATTACK_REFRACTORY_MS;
  if (isAttack) s._lastAttackAt = now;

  if (s.baseFreq && s.phase === 'bending' && isAttack) {
    s.baseFreq       = null;
    s.phase          = 'idle';
    s._history       = [];
    s._holdSinceMs   = 0;
    s._lastInZoneAt  = 0;
    s._smoothedCents = null;
    s._stableFr      = 0;
    s._lastFreq      = null;
    // Brief cooldown so this same pick's own ring-out doesn't immediately
    // re-lock as the new baseline before it's decayed away.
    s._readyAt = now + 300;
    fbBendFb('检测到重新拨弦——要连续推上去，不能松手重弹目标音。请重新弹起始音', 'err');
    return;
  }

  // Use a lower RMS threshold (0.003 vs default 0.01) so decaying notes
  // during bending are still detected rather than discarded as silence.
  const freq = fbAutoCorrelate(buf, sampleRate, 0.003);
  const hasSignal = freq > 60 && freq < 2000;

  if (hasSignal) {
    s._lastFreqTs = now;

    if (!s.baseFreq) {
      // ── Phase 1: lock baseline ──
      // During the cooldown window (just after fbBendNext), ignore all incoming
      // signal so a still-ringing previous note can't contaminate the baseline.
      if (s._readyAt && now < s._readyAt) {
        s._stableFr = 0;
        s._lastFreq  = null;
        return;
      }
      // Accumulate N frames with < 25¢ pitch drift to confirm the note is stable.
      if (s._lastFreq) {
        const delta = Math.abs(1200 * Math.log2(freq / s._lastFreq));
        if (delta < 25) s._stableFr++;
        else            s._stableFr = 0;
      } else {
        s._stableFr = 1;
      }
      s._lastFreq = freq;
      if (s._stableFr >= FB_BEND_STABLE_FRAMES) {
        // Validate: detected note must be within ±100¢ (1 semitone) of the
        // exercise's expected starting note.  This catches completely wrong
        // frets while still allowing for slightly out-of-tune strings.
        const lockedMidi = 69 + 12 * Math.log2(s._lastFreq / 440);
        const centsOff   = Math.abs((lockedMidi - s.current.midi) * 100);
        if (centsOff > 100) {
          fbBendFb(
            `Wrong note — play ${s.current.startLabel} (${FB_STRING_DISPLAY[s.current.string]} string, fret ${s.current.fret})`,
            'err'
          );
          s._stableFr = 0;
          s._lastFreq  = null;
          return;
        }
        s.baseFreq      = s._lastFreq;
        s.phase         = 'bending';
        s._history      = [];
        s._holdSinceMs  = 0;
        s._lastInZoneAt = 0;
        s._lastFreq     = null;
        s._stableFr     = 0;
        s._smoothedCents = 0;
        fbBendFb('Got it — now bend up!', '');
      }
    } else {
      // ── Phase 2: measure & smooth ──
      const rawCents = 1200 * Math.log2(freq / s.baseFreq);
      // EMA smoothing (α=0.4): keeps the curve fluid while tracking the bend.
      // Lower α → smoother but more lag; 0.4 gives ~80 ms lag at 60 fps.
      s._smoothedCents = (s._smoothedCents === null)
        ? rawCents
        : 0.6 * s._smoothedCents + 0.4 * rawCents;
      s._recordCents(now);
    }
  } else if (s.baseFreq && s._lastFreqTs !== null) {
    // ── Silence window ──
    // A decaying bent note goes quiet before the bend position is released.
    // Keep the smoothed value alive for up to SILENCE_HOLD_MS so the hold
    // counter can still accumulate during the quieter tail of the note.
    const sinceMs = now - s._lastFreqTs;
    if (sinceMs < FB_BEND_SILENCE_HOLD_MS && s._smoothedCents !== null) {
      s._recordCents(now);  // freeze last smoothed value — bend still held
    }
  } else if (!s.baseFreq) {
    // ── Idle + silence ──
    // No signal while waiting for the starting note. Clear _lastFreq so the
    // idle-phase pitch dot doesn't stick on the previous reading.
    s._lastFreq = null;
  }

  fbBendRenderGraph(); // always render — idle phase shows reference grid + live pitch
}

// Shared helper: push current smoothedCents into history, trim window,
// and advance the hold timer / check success.  Called from both the
// active-signal and silence-hold branches so both count toward success.
// Success requires sitting in the target zone for FB_BEND_HOLD_MS of real
// time (not an instant match) — a brief pass-through no longer counts.
fbState.bend._recordCents = function(now) {
  const s = fbState.bend;
  const cents = Math.round(s._smoothedCents);
  s._history.push({ cents, ts: now });
  const cutoff = now - FB_BEND_HISTORY_MS;
  while (s._history.length > 0 && s._history[0].ts < cutoff) s._history.shift();

  // In success state: keep history alive so the graph stays live (shows the
  // pitch dropping back as the string releases), but don't re-trigger success.
  if (s.phase === 'success') return;

  // Quarter-bend overshoot: if you push past 100¢ you've gone too far
  const isQuarter = s.current.targetCents <= 60;
  if (isQuarter && cents > 100) {
    s._holdSinceMs = 0;
    fbBendFb('太多了！停在 ¼ 音（30–70¢），不要推到半音', 'err');
    return;
  }

  const inZone = Math.abs(cents - s.current.targetCents) <= FB_BEND_TOLERANCE;
  if (inZone) {
    if (!s._holdSinceMs) s._holdSinceMs = now;
    s._lastInZoneAt = now;
    if (now - s._holdSinceMs >= FB_BEND_HOLD_MS) {
      s.phase = 'success';
      s.correct++; s.total++; s.streak++;
      fbBendRenderStats();
      s._nextAt = now + FB_BEND_NEXT_DELAY_MS;
      fbBendFb('✓ 推准了！按 Next → 继续', 'ok');
    }
  } else if (s._holdSinceMs && now - s._lastInZoneAt > FB_BEND_ZONE_GRACE_MS) {
    // Been out of the zone for more than a brief blip — reset, don't count
    // this partial hold. (A single noisy frame right at the edge doesn't
    // reset it immediately, matching the old frame-decay's intent.)
    s._holdSinceMs = 0;
    fbBendFb(isQuarter ? '推一点点，停在两音之间…' : 'Got it — now bend up!', '');
  }
};

// ── Vibrato ──

function fbVibratoNext() {
  const v = fbState.vibrato;
  v.phase = 'idle';
  v.baseFreq = null;
  v._history = [];
  v._stableFr = 0;
  v._lastFreq = null;
  v._successFr = 0;
  v._startTime = null;
  v.speed = null;
  v.depth = null;
  const fb = document.getElementById('fb-vibrato-feedback');
  if (fb) { fb.textContent = fbMic.owner === 'bend' ? 'Pluck any note and apply vibrato…' : ''; fb.className = 'fb-feedback'; }
  fbVibratoRenderWaveform();
  fbVibratoRenderReadout(null, null);
  fbVibratoRenderProgress(0);
  fbVibratoRenderStats();
}

function fbVibratoOnFrame(analyser, sampleRate) {
  const v = fbState.vibrato;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  if (!(freq > 60 && freq < 2000)) return;

  if (v.phase === 'pluck') {
    if (!v._lastFreq) { v._lastFreq = freq; return; }
    const delta = Math.abs(1200 * Math.log2(freq / v._lastFreq));
    v._lastFreq = freq;
    if (delta < 40) {
      v._stableFr++;
      if (v._stableFr >= FB_BEND_STABLE_FRAMES) {
        v.baseFreq = freq;
        v.phase = 'sustain';
        v._history = [];
        v._successFr = 0;
        v._startTime = performance.now();
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = 'Now apply vibrato!'; fb.className = 'fb-feedback'; }
      }
    } else {
      v._stableFr = 0;
    }
    return;
  }

  if (v.phase === 'sustain' || v.phase === 'success') {
    const now  = performance.now();
    const cents = Math.round(1200 * Math.log2(freq / v.baseFreq));
    v._history.push({ cents, ts: now });
    // Trim to window
    const cutoff = now - FB_VIBRATO_HISTORY_MS;
    while (v._history.length > 0 && v._history[0].ts < cutoff) v._history.shift();

    fbVibratoRenderWaveform();

    const { speed, depth } = fbVibratoAnalyze(v._history);
    v.speed = speed;
    v.depth = depth;
    fbVibratoRenderReadout(speed, depth);

    if (v.phase === 'success') return;  // stay in success until next()

    const [lo, hi] = FB_VIBRATO_TARGET_RANGES[v.targetHz] || FB_VIBRATO_TARGET_RANGES[5];
    const ok = speed >= lo && speed <= hi && depth >= FB_VIBRATO_MIN_DEPTH;
    if (ok) {
      v._successFr++;
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
      if (v._successFr >= FB_VIBRATO_SUCCESS_FR) {
        v.phase = 'success';
        v.correct++; v.total++;
        const fb = document.getElementById('fb-vibrato-feedback');
        if (fb) { fb.textContent = '✓ Great vibrato!'; fb.className = 'fb-feedback ok'; }
        fbVibratoRenderStats();
        setTimeout(() => { if (fbMic.listening && fbMic.owner === 'bend') fbVibratoNext(); }, 2000);
      }
    } else {
      v._successFr = Math.max(0, v._successFr - 1);
      fbVibratoRenderProgress(v._successFr / FB_VIBRATO_SUCCESS_FR);
    }
  }
}

function fbVibratoAnalyze(history) {
  if (history.length < 8) return { speed: 0, depth: 0 };
  const vals    = history.map(h => h.cents);
  const mean    = vals.reduce((a, b) => a + b, 0) / vals.length;
  const centered = vals.map(v => v - mean);
  const depth   = Math.round((Math.max(...centered) - Math.min(...centered)) / 2);
  let crossings = 0;
  for (let i = 1; i < centered.length; i++) {
    if (centered[i - 1] * centered[i] < 0) crossings++;
  }
  const durSec = (history[history.length - 1].ts - history[0].ts) / 1000;
  const speed  = durSec > 0.3 ? Math.round(crossings / 2 / durSec * 10) / 10 : 0;
  return { speed, depth };
}

function fbVibratoRenderWaveform() {
  const canvas = document.getElementById('fb-vibrato-canvas');
  if (!canvas) return;
  const v   = fbState.vibrato;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CENTS_RANGE = 150;  // ±150¢ displayed
  const cy2 = c => H / 2 - (c / CENTS_RANGE) * (H / 2 - 4);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8f7f0';
  ctx.fillRect(0, 0, W, H);

  // ±50¢ green zone
  const y50 = cy2(50), y50n = cy2(-50);
  ctx.fillStyle = 'rgba(74,124,74,0.1)';
  ctx.fillRect(0, y50, W, y50n - y50);

  // Dashed center
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  if (v._history.length < 2) return;

  const now = performance.now();
  ctx.strokeStyle = '#4a7c4a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (const { cents, ts } of v._history) {
    const x = W - (now - ts) / FB_VIBRATO_HISTORY_MS * W;
    const y = cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, cents)));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Current dot
  const last = v._history[v._history.length - 1];
  if (last) {
    ctx.fillStyle = '#b8843a';
    ctx.beginPath();
    ctx.arc(W - 2, cy2(Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, last.cents))), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fbVibratoRenderReadout(speed, depth) {
  const el = document.getElementById('fb-vibrato-readout');
  if (!el) return;
  if (speed !== null) {
    el.innerHTML = `<span class="fb-vib-stat">Speed: <strong>${speed} Hz</strong></span>
      &nbsp;·&nbsp; <span class="fb-vib-stat">Depth: <strong>±${depth}¢</strong></span>`;
  } else {
    el.innerHTML = '<span class="text-fg-faint">listening…</span>';
  }
}

function fbVibratoRenderProgress(frac) {
  const el = document.getElementById('fb-vibrato-progress');
  if (!el) return;
  const pct  = Math.round(Math.min(1, frac) * 100);
  const secs = (frac * FB_VIBRATO_SUCCESS_MS / 1000).toFixed(1);
  el.innerHTML = `<div class="fb-vibrato-prog-bar"><div class="fb-vibrato-prog-fill" style="width:${pct}%"></div></div>
    <span class="fb-vibrato-prog-label">${secs} / ${FB_VIBRATO_SUCCESS_MS / 1000}s</span>`;
}

function fbVibratoRenderStats() {
  const v  = fbState.vibrato;
  const el = document.getElementById('fb-vibrato-stats');
  if (!el) return;
  el.innerHTML = `<span class="fb-stat-item">${v.correct}/${v.total} sessions completed</span>`;
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_BEND_STRINGS, FB_BEND_FRET_MIN, FB_BEND_FRET_MAX, FB_BEND_STABLE_FRAMES, FB_BEND_HOLD_MS, FB_BEND_ZONE_GRACE_MS,
    FB_BEND_TOLERANCE, FB_BEND_NEXT_DELAY_MS, FB_BEND_HISTORY_MS, FB_BEND_SILENCE_HOLD_MS, FB_BEND_ATTACK_RATIO, FB_BEND_ATTACK_MIN_RMS,
    FB_BEND_ATTACK_REFRACTORY_MS, FB_VIBRATO_HISTORY_MS, FB_VIBRATO_SUCCESS_MS, FB_VIBRATO_MIN_DEPTH, FB_VIBRATO_SUCCESS_FR, FB_VIBRATO_TARGET_RANGES,
    FB_STRING_DISPLAY, FB_BEND_REFERENCE_CENTS, FB_BEND_GRAPH_MAX_CENTS, fbBendNoteLabel, fbBendIntervalCents, fbBendIntervalLabel,
    fbBendPickExercise, fbBendPickInterval, fbBendToggleString, fbBendToggleInterval, fbBendRenderOptions, fbVibratoRenderOptions,
    fbBendRenderPrompt, fbBendRenderGraph, fbBendRenderStats, fbBendFb, fbBendInit, fbBendSetSubMode,
    fbBendNext, fbBendMicStart, fbBendMicStop, fbBendOnFrame, fbBendBendOnFrame, fbVibratoNext,
    fbVibratoOnFrame, fbVibratoAnalyze, fbVibratoRenderWaveform, fbVibratoRenderReadout, fbVibratoRenderProgress, fbVibratoRenderStats,
  };
}
