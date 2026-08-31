// ── Fretboard trainer — shared audio layer: mic manager, master/sound volume, output device; plus generic pitch detection (fbAutoCorrelate/fbFreqToNote, moved from the Chord Match section) and fbOutputDeviceSelectHtml (moved from Ear) ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Shared mic manager (used by both Pitch Match and Tuner) ──

const fbMic = {
  stream: null, audioCtx: null, analyser: null, rafId: null,
  deviceId: '', userSelectedDevice: false, listening: false, onFrame: null, owner: null,
};

// ── Shared master volume (0-1) — scales every gain this app generates ──
// Many audio interfaces (Focusrite Scarlett etc.) drive their line/headphone
// output from a physical hardware knob and don't expose a software volume
// control at all — the OS volume keys/slider silently do nothing for that
// output. This is the one loudness control guaranteed to work regardless,
// since it's applied before any audio ever leaves the app.
const FB_MASTER_VOLUME_KEY = 'fb_master_volume';
let fbMasterVolume = 1;

function fbMasterVolumeLoad() {
  const saved = parseFloat(localStorage.getItem(FB_MASTER_VOLUME_KEY));
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1) fbMasterVolume = saved;
}

function fbMasterVolumeChange(value) {
  fbMasterVolume = Math.max(0, Math.min(1, parseFloat(value) || 0));
  localStorage.setItem(FB_MASTER_VOLUME_KEY, String(fbMasterVolume));
  document.querySelectorAll('.fb-master-volume-slider').forEach(el => { el.value = fbMasterVolume; });
  document.dispatchEvent(new CustomEvent('fb-master-volume-change', {
    detail: { raw: fbMasterVolume, gain: fbMasterGain() },
  }));
}

// Human loudness perception is roughly logarithmic, not linear — a slider
// wired straight to linear gain makes the top half of its travel feel like
// it does almost nothing (moving 1.0 → 0.5 is only about -6dB) and squeezes
// all the noticeable change into a sliver near the bottom. Squaring the
// slider's 0-1 position before applying it as gain (a standard "audio taper"
// approximation) spreads perceptible change more evenly across the travel.
// fbMasterVolume itself stays the raw slider position (what's persisted and
// displayed); this is what actually multiplies into every gain calculation.
function fbMasterGain() {
  return fbMasterVolume * fbMasterVolume;
}

// ── Per-sound-category default volume — a second, independent knob on top
// of the master fader above. fbMasterGain() scales *everything* at once (for
// audio interfaces with no other software volume control); these let you
// fix one specific generated sound (the metronome, say) being too quiet by
// default without turning up every other sound along with it. Each category
// is a 0-1.5 multiplier on that sound's own baked-in peak amplitude, default
// 1 (i.e. "use the baked-in default, unchanged") — same on-top-of-master
// relationship fbMasterGain() has with a sound's own peak, just one layer
// further out. Rendered in Preferences (fbRenderSoundVolumePrefs below);
// persisted client-side same as fbMasterVolume, since it's a playback
// preference, not a server-backed setting.
const FB_SOUND_VOLUME_KEY = 'fb_sound_volumes';
const FB_SOUND_VOLUME_DEFAULT = 1;
// Raised from 1.5: the underlying click/beep peaks used to already sit at
// (near) digital full scale by default, so this slider had almost no real
// headroom before clipping regardless of its max — see the notes on
// stScheduleClick (speed-trainer.js) and ptBeep (practice-timer.js). Now
// that those peaks were pulled down, 2.0 has real room to be audible.
const FB_SOUND_VOLUME_MAX = 2;
// Every generated sound effect that already multiplies fbMasterGain() into
// its own gain calculation gets an entry here — add a new one whenever a new
// synthesized sound is added elsewhere, so it doesn't silently stay stuck at
// its hardcoded default forever.
const FB_SOUND_CATEGORIES = [
  { id: 'metronome', label: '节拍器 Metronome', hint: 'Speed Trainer 的节拍点击声' },
  { id: 'timerAlert', label: '计时器提醒音 Timer alert', hint: '练习计时器倒数结束时的三声提示音' },
  { id: 'practiceTones', label: '练耳 / 和弦试听 Practice tones', hint: 'Fretboard 的 Ear Training 音程播放 + Chord Match 的和弦进行试听' },
  { id: 'progressionChords', label: '级数进行试听 Progression playback', hint: 'Progressions 页面的和弦进行试听' },
  { id: 'countIn', label: '预备拍 Count-in', hint: 'Song Loop 播放前，补齐弱起小节/预备小节用的鼓棒声' },
];
let fbSoundVolumes = {};

function fbSoundVolumesLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_SOUND_VOLUME_KEY)) || {}; } catch (_) { saved = {}; }
  fbSoundVolumes = {};
  FB_SOUND_CATEGORIES.forEach(({ id }) => {
    const v = saved[id];
    fbSoundVolumes[id] = (Number.isFinite(v) && v >= 0 && v <= FB_SOUND_VOLUME_MAX) ? v : FB_SOUND_VOLUME_DEFAULT;
  });
}
function fbSoundVolumesSave() {
  localStorage.setItem(FB_SOUND_VOLUME_KEY, JSON.stringify(fbSoundVolumes));
}
// What a sound category's own gain calculation should multiply in, alongside
// fbMasterGain(). Falls back to the neutral default for an unrecognized id
// (shouldn't happen) rather than throwing, since this runs inline in every
// note/click's gain math.
function fbSoundGain(categoryId) {
  const v = fbSoundVolumes[categoryId];
  return Number.isFinite(v) ? v : FB_SOUND_VOLUME_DEFAULT;
}
function fbSetSoundVolume(categoryId, value) {
  const v = Math.max(0, Math.min(FB_SOUND_VOLUME_MAX, parseFloat(value)));
  fbSoundVolumes[categoryId] = Number.isFinite(v) ? v : FB_SOUND_VOLUME_DEFAULT;
  fbSoundVolumesSave();
}

// Rendered into Preferences (#fb-sound-volume-prefs) — see updateTransportForPage-
// style page-show hook in app.js's showPage('prefs') branch.
function fbRenderSoundVolumePrefs() {
  const el = document.getElementById('fb-sound-volume-prefs');
  if (!el) return;
  fbSoundVolumesLoad();
  const rows = FB_SOUND_CATEGORIES.map(({ id, label, hint }) => `
    <div class="field fb-sound-vol-row">
      <label title="${htmlEsc(hint)}">${htmlEsc(label)}</label>
      <input type="range" min="0" max="${FB_SOUND_VOLUME_MAX}" step="0.05" value="${fbSoundGain(id)}"
        oninput="fbSetSoundVolume('${id}', this.value); this.nextElementSibling.textContent = Math.round(this.value*100)+'%'">
      <span class="fb-sound-vol-pct">${Math.round(fbSoundGain(id) * 100)}%</span>
      <button type="button" class="btn btn-ghost btn-sm" title="恢复默认 100%"
        onclick="fbSetSoundVolume('${id}', 1); fbRenderSoundVolumePrefs()">重置</button>
    </div>
  `).join('');
  el.innerHTML = `
    <div class="prefs-form fb-sound-vol-form">
      <h3 class="fb-sound-vol-title">声音音量 · Sound volume</h3>
      <p class="fb-sound-vol-desc">在上面的总音量之外，单独调整每种合成音效的默认大小（100% = 默认值）。</p>
      ${rows}
    </div>
  `;
}

// ── Shared output-device selection (which speaker/interface plays back any
// audio the app generates — Ear Training and Speed Trainer's metronome so
// far, each with its own AudioContext) ──
// AudioContext.setSinkId() is a newer, Chromium-only API; everywhere else this
// silently no-ops and audio just keeps playing through the system default.
const FB_SETSINKID_SUPPORTED = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
const fbOutput = { deviceId: '', userSelectedDevice: false };
// Last enumerated audiooutput devices — fbOutputDeviceName() looks up the
// selected device's label here to hand it to the backend, which routes
// server-side FluidSynth playback (Vamp/Jam) to the same interface.
let fbLastOutputDevices = [];
// Every AudioContext any feature creates registers itself here, so a single
// output-device change applies to all of them at once instead of just
// whichever one happened to exist when fbOutputDeviceChange last ran.
const fbRegisteredAudioContexts = new Set();

function fbRegisterAudioContext(ctx) {
  fbRegisteredAudioContexts.add(ctx);
  fbApplySinkId(ctx);
}

async function fbApplySinkId(ctx) {
  if (!ctx || !FB_SETSINKID_SUPPORTED) return;
  // '' is meaningful too: it resets the context to the OS default output,
  // which is how an unplugged auto-selected interface falls back.
  try { await ctx.setSinkId(fbOutput.deviceId); } catch (_) { /* device gone, or not permitted */ }
}

// HTMLMediaElement.setSinkId() is the same Audio Output Devices API, applied
// to a <audio>/<video> element instead of a Web Audio AudioContext — needed
// for anything that plays back real audio files (Song Loop's <audio id="sl-
// player">) rather than synthesizing tones through an AudioContext. Checked
// for support separately since in principle a browser could implement one
// without the other, even though in practice they track together.
const FB_MEDIA_SETSINKID_SUPPORTED = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const fbRegisteredMediaElements = new Set();

function fbRegisterMediaElement(el) {
  fbRegisteredMediaElements.add(el);
  fbApplySinkIdToMedia(el);
}

async function fbApplySinkIdToMedia(el) {
  if (!el || !FB_MEDIA_SETSINKID_SUPPORTED) return;
  try { await el.setSinkId(fbOutput.deviceId); } catch (_) { /* device gone, or not permitted */ }
}

function fbApplySinkIdToAll() {
  fbRegisteredAudioContexts.forEach(fbApplySinkId);
  fbRegisteredMediaElements.forEach(fbApplySinkIdToMedia);
}

// Output device labels only become readable after mic permission has been
// granted somewhere in the app (same browser rule as input labels) — called
// after that happens, and whenever an options panel with an output selector renders.
async function fbRefreshOutputDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = fbDedupDevices(devices.filter(d => d.kind === 'audiooutput'));
    if (!outputs.length) return;
    fbLastOutputDevices = outputs;
    // Same gone-check as the input side: a manually picked output that has
    // been unplugged hands control back to auto-detect.
    if (fbOutput.deviceId && outputs.some(d => d.deviceId) && !outputs.some(d => d.deviceId === fbOutput.deviceId)) {
      fbOutput.deviceId = '';
      fbOutput.userSelectedDevice = false;
    }
    if (!fbOutput.userSelectedDevice) {
      const preferred = fbPickPreferredDevice(outputs, 'output');
      const nextId = preferred ? preferred.deviceId : '';
      if (nextId !== fbOutput.deviceId) {
        // Also covers the unplugged-interface case: nextId '' drops back to
        // the OS default via setSinkId('').
        fbOutput.deviceId = nextId;
        fbApplySinkIdToAll();
      }
    }
    document.querySelectorAll('.fb-output-select').forEach(sel => {
      sel.innerHTML = outputs.map(d =>
        `<option value="${htmlEsc(d.deviceId)}" ${d.deviceId === fbOutput.deviceId ? 'selected' : ''}>${htmlEsc(d.label || 'Speaker')}</option>`
      ).join('');
    });
  } catch (_) { /* enumeration not available */ }
}

async function fbOutputDeviceChange(deviceId) {
  fbOutput.userSelectedDevice = true;
  fbOutput.deviceId = deviceId;
  document.querySelectorAll('.fb-output-select').forEach(sel => { sel.value = deviceId; });
  fbApplySinkIdToAll();
}

// Label of the currently selected output device, for the backend: Vamp/Jam
// play server-side via FluidSynth, which can't see browser deviceIds but does
// accept the CoreAudio device *name* (which matches the browser's label).
// '' means the system default — also returned when labels aren't readable yet
// (pre mic-permission), in which case the backend just uses the default too.
function fbOutputDeviceName() {
  if (!fbOutput.deviceId) return '';
  return fbLastOutputDevices.find(d => d.deviceId === fbOutput.deviceId)?.label || '';
}

async function fbMicStart(owner, onFrame, fftSize = 2048) {
  if (fbMic.listening) fbMicStop();
  const constraints = { audio: fbMic.deviceId ? { deviceId: { exact: fbMic.deviceId } } : true };
  try {
    fbMic.stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // The remembered/picked device vanished between detection and start
    // (unplugged interface, stale manual pick) — an exact-match request for
    // a gone device fails with Overconstrained/NotFound; retry on the OS
    // default and let auto-select re-pick from what's actually there.
    if (!fbMic.deviceId || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
    fbMic.deviceId = '';
    fbMic.userSelectedDevice = false;
    fbMic.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // throws if denied — caller handles it
  }
  await fbMicAutoSelectAndRefreshDevices();
  fbMic.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  fbMic.analyser = fbMic.audioCtx.createAnalyser();
  fbMic.analyser.fftSize = fftSize;
  fbMic.analyser.smoothingTimeConstant = 0.3;
  fbMic.audioCtx.createMediaStreamSource(fbMic.stream).connect(fbMic.analyser);
  fbMic.onFrame = onFrame;
  fbMic.owner = owner;
  fbMic.listening = true;
  fbMicTick();
}

function fbMicStop() {
  if (fbMic.rafId) cancelAnimationFrame(fbMic.rafId);
  fbMic.rafId = null;
  if (fbMic.stream) fbMic.stream.getTracks().forEach(t => t.stop());
  if (fbMic.audioCtx) fbMic.audioCtx.close();
  fbMic.stream = null; fbMic.audioCtx = null; fbMic.analyser = null;
  fbMic.listening = false; fbMic.onFrame = null; fbMic.owner = null;
}

function fbMicTick() {
  if (!fbMic.listening) return;
  // each consumer pulls whatever it needs (time-domain for autocorrelation,
  // frequency-domain for chroma) — avoids paying for both on every frame
  if (fbMic.onFrame) fbMic.onFrame(fbMic.analyser, fbMic.audioCtx.sampleRate);
  fbMic.rafId = requestAnimationFrame(fbMicTick);
}

// After permission is granted, device labels become readable. Auto-pick the
// best input (audio interface > USB mic > built-in; see fbPickPreferredDevice)
// unless the user has explicitly chosen a device themselves this tab.
async function fbMicAutoSelectAndRefreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = fbDedupDevices(devices.filter(d => d.kind === 'audioinput'));
    if (!inputs.length) return;
    // A manually picked device that has since been unplugged shouldn't pin
    // the selection forever — once it's gone from the enumeration, hand
    // control back to auto-detect. (Guard: pre-permission enumerations hide
    // all ids/labels, so skip the gone-check when nothing is identifiable.)
    if (fbMic.deviceId && inputs.some(d => d.deviceId) && !inputs.some(d => d.deviceId === fbMic.deviceId)) {
      fbMic.deviceId = '';
      fbMic.userSelectedDevice = false;
    }
    if (!fbMic.userSelectedDevice) {
      const preferred = fbPickPreferredDevice(inputs, 'input');
      const nextId = preferred ? preferred.deviceId : '';
      if (nextId !== fbMic.deviceId) {
        fbMic.deviceId = nextId;
        if (fbMic.listening) {
          // Device set changed mid-listening (e.g. interface just plugged in,
          // or the current one unplugged) — full stop/start so the analyser
          // ends up reading the new device, not a dead stream.
          const owner = fbMic.owner, cb = fbMic.onFrame, fftSize = fbMic.analyser.fftSize;
          fbMicStop();
          try { await fbMicStart(owner, cb, fftSize); } catch (_) {}
          fbSyncMicButtons(); // refresh the transport bar either way — a failed restart left us stopped
        } else if (fbMic.stream) {
          // Mid-startup (called from fbMicStart right after the permission
          // grant): swap the just-acquired default stream for the preferred
          // one before the analyser source gets built from it.
          fbMic.stream.getTracks().forEach(t => t.stop());
          try {
            fbMic.stream = await navigator.mediaDevices.getUserMedia({ audio: nextId ? { deviceId: { exact: nextId } } : true });
          } catch (_) {
            // Preferred device refused/vanished mid-swap — re-acquire the
            // default stream rather than leaving the stopped one behind
            // (an analyser built on a stopped stream reads silence forever).
            fbMic.deviceId = '';
            fbMic.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
        }
      }
    }
    document.querySelectorAll('.fb-device-select').forEach(sel => {
      sel.innerHTML = inputs.map(d =>
        `<option value="${htmlEsc(d.deviceId)}" ${d.deviceId === fbMic.deviceId ? 'selected' : ''}>${htmlEsc(d.label || 'Microphone')}</option>`
      ).join('');
    });
    // Granting mic permission is also what unlocks readable output-device
    // labels, so this is the natural point to refresh those too.
    await fbRefreshOutputDevices();
  } catch (_) { /* enumeration not available */ }
}

async function fbMicDeviceChange(deviceId) {
  fbMic.userSelectedDevice = true;
  fbMic.deviceId = deviceId;
  document.querySelectorAll('.fb-device-select').forEach(sel => { sel.value = deviceId; });
  if (fbMic.listening) {
    const owner = fbMic.owner, cb = fbMic.onFrame, fftSize = fbMic.analyser.fftSize;
    fbMicStop();
    try { await fbMicStart(owner, cb, fftSize); } catch (_) {}
    fbSyncMicButtons(); // success or failure, the transport bar must match reality
  }
}

// The four mic drills (Pitch / Tuner / Chord / Bend) no longer own an inline
// start/stop pair — their Start Listening / Stop toggle lives in the app-wide
// transport bar (fixed at the bottom, defined in app.js). Their start/stop
// functions still call fbSyncMicButtons() after toggling, so we keep the name
// and just push the listening state to that shared bar.
function fbSyncMicButtons() {
  if (typeof setTransportState === 'function') setTransportState(fbMic.listening ? 'listening' : 'stopped');
}

// Start/stop handlers for each mic drill. Functions are hoisted, so referencing
// them here (only ever called lazily) is safe despite definition order.
function fbMicDrillHandlers(mode) {
  switch (mode) {
    case 'pitch': return { start: fbPitchStart,   stop: fbPitchStop };
    case 'tuner': return { start: fbTunerStart,   stop: fbTunerStop };
    case 'chord': return { start: fbChordStart,   stop: fbChordStop };
    case 'bend':  return { start: fbBendMicStart, stop: fbBendMicStop };
    case 'seq':   return fbState.seq.mode === 'verify' ? { start: fbSeqStart, stop: fbSeqStop } : null;
    default:      return null;
  }
}

// Registers whichever mic drill is on screen as the app's active transport (so
// its Start Listening / Stop shows in the bottom bar), or clears the bar on
// non-mic modes and other pages. Called on page- and sub-mode switches.
const FB_MIC_DRILL_LABELS = { pitch: 'Pitch Match', tuner: 'Tuner', chord: 'Chord Match', bend: 'Bend & Vibrato', seq: 'Scale Sequences' };
function fbRenderControlAction() {
  if (typeof registerTransport !== 'function') return; // app.js not loaded (e.g. unit tests)
  // Chord Match is a separate page from Fretboard now, but still drives the
  // same mic-drill transport pattern — its mode is implied by which page is
  // active, not read from fbState.activeMode (that only ever varies across
  // Fretboard's own remaining tabs).
  const onChordMatch = document.getElementById('page-chordmatch')?.classList.contains('active');
  const onFretboard = document.getElementById('page-fretboard')?.classList.contains('active');
  const mode = onChordMatch ? 'chord' : (onFretboard ? fbState.activeMode : null);
  const handlers = mode ? fbMicDrillHandlers(mode) : null;
  if (!handlers) { clearTransport(); return; }
  registerTransport({
    kind: 'listen', label: FB_MIC_DRILL_LABELS[mode],
    play: handlers.start, stop: handlers.stop,
  });
  // reflect the live listening state (e.g. re-registered mid-session on a device change)
  setTransportState(fbMic.listening && fbMic.owner === mode ? 'listening' : 'stopped');
}

// Shared markup for the output-device picker — dropped into every options
// panel that has an input-device picker too (see fbOutput above).
function fbOutputDeviceSelectHtml() {
  return `
    <label>Output device:
      <select class="fb-output-select" onchange="fbOutputDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    </label>
    ${FB_SETSINKID_SUPPORTED ? '' : '<span class="text-fg-muted">(this browser can only play through the system default output)</span>'}
  `;
}

// Autocorrelation-based pitch detector (standard ACF2+ technique):
// trims low-amplitude edges, autocorrelates, finds the first strong peak
// after the initial downslope, then refines it via parabolic interpolation.
function fbAutoCorrelate(buf, sampleRate, rmsThreshold = 0.01) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < rmsThreshold) return -1; // too quiet / silence

  // Trim leading/trailing near-silence so autocorrelation focuses on signal.
  // Fallback to the full buffer when the signal is consistently quiet (e.g. a
  // decaying bent string whose amplitude is below 0.2 throughout) rather than
  // returning -1 and discarding a valid but soft note.
  const THRES = 0.2;
  let start = 0;
  while (start < SIZE / 2 && Math.abs(buf[start]) < THRES) start++;
  let end = SIZE - 1;
  while (end > SIZE / 2 && Math.abs(buf[end]) < THRES) end--;
  const trimmed = (end > start) ? buf.slice(start, end) : buf;
  const n = trimmed.length;
  if (n < 2) return -1;

  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag];
    c[lag] = sum;
  }

  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxPos = -1, maxVal = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  }
  if (maxPos <= 0) return -1;

  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = maxPos + 1 < n ? c[maxPos + 1] : c[maxPos];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  const refinedLag = a ? maxPos - b / (2 * a) : maxPos;
  if (refinedLag <= 0) return -1;
  return sampleRate / refinedLag;
}

function fbFreqToNote(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const noteName = FB_NOTE_NAMES[((midi % 12) + 12) % 12];
  return { noteName, cents, midi };
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fbMic, FB_MASTER_VOLUME_KEY, fbMasterVolume, fbMasterVolumeLoad, fbMasterVolumeChange, fbMasterGain,
    FB_SOUND_VOLUME_KEY, FB_SOUND_VOLUME_DEFAULT, FB_SOUND_VOLUME_MAX, FB_SOUND_CATEGORIES, fbSoundVolumes, fbSoundVolumesLoad,
    fbSoundVolumesSave, fbSoundGain, fbSetSoundVolume, fbRenderSoundVolumePrefs, FB_SETSINKID_SUPPORTED, fbOutput,
    fbLastOutputDevices, fbRegisteredAudioContexts, fbRegisterAudioContext, fbApplySinkId, FB_MEDIA_SETSINKID_SUPPORTED, fbRegisteredMediaElements,
    fbRegisterMediaElement, fbApplySinkIdToMedia, fbApplySinkIdToAll, fbRefreshOutputDevices, fbOutputDeviceChange, fbOutputDeviceName,
    fbMicStart, fbMicStop, fbMicTick, fbMicAutoSelectAndRefreshDevices, fbMicDeviceChange, fbSyncMicButtons,
    fbMicDrillHandlers, FB_MIC_DRILL_LABELS, fbRenderControlAction, fbOutputDeviceSelectHtml, fbAutoCorrelate, fbFreqToNote,
  };
}
