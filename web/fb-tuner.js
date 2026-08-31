// ── Fretboard trainer — Tuner ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Tuner (auto-detects nearest string from pitch, shows sharp/flat + in-tune) ──

const FB_TUNER_TOLERANCE_CENTS = 5;
const FB_TUNER_HOLD_FRAMES = 15; // ~0.25s sustained in-tune before marking a string done

// Tuner has no mode-specific options of its own — input/output device
// pickers now live in the shared fb-device-bar above the mode tabs.

function fbRenderTunerStrings() {
  const s = fbState.tuner;
  document.getElementById('fb-tuner-strings').innerHTML = FB_STRING_NAMES.map((n, i) => `
    <div class="fb-tuner-chip${s.tuned[i] ? ' done' : ''}${s.activeString === i ? ' active' : ''}">${n}${i===0?' (6)':i===5?' (1)':''}</div>
  `).join('');
}

async function fbTunerStart() {
  try {
    await fbMicStart('tuner', fbTunerOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-tuner-hint');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('tuner');
}

function fbTunerStop() {
  fbMicStop();
  fbSyncMicButtons('tuner');
  document.getElementById('fb-tuner-meter').innerHTML = '';
  fbState.tuner.activeString = -1;
  fbRenderTunerStrings();
}

function fbTunerReset() {
  fbState.tuner.tuned = [false, false, false, false, false, false];
  fbRenderTunerStrings();
}

function fbRenderTunerMeter(r) {
  const meter = document.getElementById('fb-tuner-meter');
  const inTune = Math.abs(r.cents) <= FB_TUNER_TOLERANCE_CENTS;
  const dir = inTune ? 'In tune ✓' : (r.cents < 0 ? 'Too low — tune UP ⬆' : 'Too high — tune DOWN ⬇');
  meter.innerHTML = `
    <div class="fb-pitch-detected${inTune ? ' match' : ''}${r.held ? ' held' : ''}">${FB_STRING_NAMES[r.string]} string<span class="fb-pitch-octave">${r.via}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents.toFixed(0)} cents &nbsp;·&nbsp; ${dir}</div>
  `;
}

function fbTunerOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.tuner;
  const meter = document.getElementById('fb-tuner-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // hold the last reading briefly instead of vanishing the instant the note decays
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">play a string…</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  // Match against every string's open pitch AND its 12th-fret (octave-up) pitch,
  // and take whichever reference is closest — so open-string or 12th-fret
  // harmonic playing both work for tuning.
  let best = null;
  for (let i = 0; i < 6; i++) {
    [0, 12].forEach(offset => {
      const refFreq = fbFreqFromMidi(FB_STRING_OPEN_MIDI[i] + offset);
      const cents = 1200 * Math.log2(freq / refFreq);
      if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { string: i, cents, via: offset === 0 ? 'open' : '12th-fret' };
    });
  }

  if (!best || Math.abs(best.cents) > 60) {
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderTunerMeter({ ...s._lastReading, held: true });
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">${freq.toFixed(1)} Hz</div><div class="fb-pitch-hz">no clear string match — play one string at a time</div>`;
      s.activeString = -1;
      fbRenderTunerStrings();
    }
    s._holdCount = 0;
    return;
  }

  s.activeString = best.string;
  s._lastReading = { string: best.string, cents: best.cents, via: best.via, freq, ts: now };
  fbRenderTunerMeter(s._lastReading);

  const inTune = Math.abs(best.cents) <= FB_TUNER_TOLERANCE_CENTS;
  if (inTune) {
    s._holdCount = (s._holdString === best.string) ? s._holdCount + 1 : 1;
    s._holdString = best.string;
    if (s._holdCount >= FB_TUNER_HOLD_FRAMES) s.tuned[best.string] = true;
  } else {
    s._holdCount = 0; s._holdString = -1;
  }
  fbRenderTunerStrings();
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_TUNER_TOLERANCE_CENTS, FB_TUNER_HOLD_FRAMES, fbRenderTunerStrings, fbTunerStart, fbTunerStop, fbTunerReset,
    fbRenderTunerMeter, fbTunerOnFrame,
  };
}
