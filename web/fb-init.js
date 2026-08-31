// ── Fretboard trainer — device auto-detection + page lifecycle; guarded() wrappers (must load last) ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Device auto-detection ────────────────────────────────────────────────
// Nothing about device choice is persisted on purpose: what's plugged in
// changes from session to session, and a remembered deviceId may not even
// exist any more. Instead we re-detect on startup and on every
// 'devicechange' event (event-driven, no polling — costs nothing while
// nothing changes). A manual pick in the dropdown still wins, but only
// in-memory for the rest of the tab.
//
// Whitelist, not blacklist: this machine's setup is stable (a Focusrite
// Scarlett interface + the built-in mic/speakers), so instead of chasing an
// ever-growing list of virtual junk drivers to exclude (BlackHole, Zoom's
// driver, ...), we auto-pick ONLY devices we positively recognize. Anything
// unknown — including virtual cables and meeting-software drivers — is
// never auto-selected, by construction and with zero maintenance. New gear
// that should auto-pick gets one word added to FB_INTERFACE_RE.
const FB_INTERFACE_RE = /scarlett|focusrite/i;
const FB_BUILTIN_RE = /built-in|internal|macbook|imac|内置|内建/i;

// Browsers list the OS default device twice: once as the real hardware and
// once as a 'default'/'communications' alias whose label is the real label
// with a "Default - " prefix. Collapse the alias into the real entry so the
// dropdown doesn't show the same hardware as two rows. An alias that matches
// nothing (rare) is kept as-is.
function fbDedupDevices(devices) {
  const realLabels = new Set(devices
    .filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => d.label));
  return devices.filter(d => {
    if (d.deviceId !== 'default' && d.deviceId !== 'communications') return true;
    return !realLabels.has(d.label.replace(/^default\s*-\s*/i, ''));
  });
}

function fbDeviceScore(d) {
  if (FB_INTERFACE_RE.test(d.label)) return 2; // known audio interface
  if (FB_BUILTIN_RE.test(d.label)) return 1;   // built-in mic/speakers
  return 0;                                    // unknown/external/virtual — never auto-picked
}

// Returns the best device for auto-use, or null to stick with the OS default.
// Input explicitly picks even the built-in mic, so a connected bluetooth
// headset can't silently become the practice mic via the OS default. Output
// only overrides the OS default for a recognized interface — the OS already
// routes to headphones on its own when you plug them in.
function fbPickPreferredDevice(devices, kind) {
  let best = null, bestScore = -1;
  for (const d of devices) {
    if (!d.deviceId) continue; // pre-permission enumeration hides ids — nothing actionable
    const s = fbDeviceScore(d);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  const minScore = kind === 'output' ? 2 : 1;
  return best && bestScore >= minScore ? best : null;
}

// Re-detect whenever the device set changes (interface plugged/unplugged
// mid-session). Debounced: hot-plug often fires a burst of devicechange
// events, and the mic path may re-acquire a stream per run.
let fbDeviceWatchInited = false;
function fbWatchDeviceChanges() {
  if (fbDeviceWatchInited || !navigator.mediaDevices?.addEventListener) return;
  fbDeviceWatchInited = true;
  let timer = null;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fbMicAutoSelectAndRefreshDevices(); }, 300);
  });
}

// Global, not scoped to the Fretboard page — every mic-based drill here and
// Speed Trainer's metronome all share the same fbMic/fbOutput singletons, so
// this is rendered once at app startup (see init() in app.js), not gated
// behind visiting any particular page.
function fbRenderDeviceBar() {
  fbWatchDeviceChanges();
  fbMasterVolumeLoad();
  fbSoundVolumesLoad();
  document.getElementById('fb-device-bar').innerHTML = `
    <span>Input device:</span>
    <select class="fb-device-select" onchange="fbMicDeviceChange(this.value)"><option value="">Default (grant mic access first)</option></select>
    ${fbOutputDeviceSelectHtml()}
  `;
  // The one master-volume slider lives in the transport pill now (static
  // markup in index.html) — push the loaded value into it here.
  document.querySelectorAll('.fb-master-volume-slider').forEach(el => { el.value = fbMasterVolume; });
  fbRefreshOutputDevices();
}

// fb_prefs bundles every drill's settings (pitch/chord/ear/bend/seq) into one
// blob, but Fretboard and Chord Match are now separate pages that can be
// visited in either order — this makes sure the blob loads exactly once
// regardless of which page gets there first, so a later visit to the other
// page doesn't re-run fbPrefsLoad() and clobber any in-memory state (stats,
// unsaved option changes) accumulated since the first load.
function fbEnsurePrefsLoaded() {
  if (fbState.prefsLoaded) return;
  fbState.prefsLoaded = true;
  fbPrefsLoad();
  fbApplyDiagramSize();  // apply saved diagram size as CSS variable
}

function initFretboardPage() {
  if (fbState.inited) return;
  fbState.inited = true;
  fbEnsurePrefsLoaded();
  fbPitchLoadStats();
  fbRenderEarOptions();
  fbEarLoadStats();
  fbEarTwoNext();
  fbEarThreeNext();
  fbEarSetMode(fbState.ear.mode);
  fbRenderPitchOptions();
  fbPitchNewNote();
  fbRenderPitchStatsTable();
  fbRenderTunerStrings();
  fbBendInit();
  fbRenderSeqOptions();
  fbSeqBuild();
  fbSeqSetMode(fbState.seq.mode);
  fbCidInit();
  fbShowMode(fbState.activeMode);
}

// Chord Match used to be one of Fretboard's tabs (fbShowMode('chord')); it's
// now a standalone top-level page so it isn't also nested a level down —
// same fbState.chord / fbMic underneath, just its own page lifecycle.
function initChordMatchPage() {
  if (fbState.chordInited) return;
  fbState.chordInited = true;
  fbEnsurePrefsLoaded();
  fbChordLoadStats();
  fbRenderChordOptions();
  fbChordNewChord();
  fbRenderChordStatsTable();
  fbRenderControlAction(); // register this page's mic drill on the shared transport bar
}

function fbShowMode(mode) {
  if (fbMic.listening) {
    fbMicStop();
    document.getElementById('fb-pitch-meter').innerHTML = '';
    document.getElementById('fb-tuner-meter').innerHTML = '';
    document.getElementById('fb-seq-verify-meter').innerHTML = '';
    fbRenderChroma(new Array(12).fill(0), null);
  }
  document.querySelectorAll('.fb-tab').forEach(b => b.classList.toggle('active', b.dataset.fbmode === mode));
  document.querySelectorAll('.fb-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('fb-' + mode).classList.add('active');
  fbState.activeMode = mode;
  fbRenderControlAction();
  fbPrefsSave();
}

// releases the mic when navigating away from Fretboard or Chord Match
// entirely (see showPage()'s leavingMicPage check in app.js)
function fbLeavePage() {
  if (fbMic.listening) fbMicStop();
}

// ── Guard action buttons against rapid double-click ──
// Answer functions (fbEarTwoAnswer, etc.) already have an
// internal `locked`/`answered` flag — only the bare "Next" and "Play"
// functions need wrapping here.
fbBendNext                = guarded(fbBendNext);
fbEarManualNext           = guarded(fbEarManualNext);
fbEarPlayCurrent          = guarded(fbEarPlayCurrent);
fbEarPlayScaffold         = guarded(fbEarPlayScaffold);
fbPitchNewNote            = guarded(fbPitchNewNote);
fbChordNewChord           = guarded(fbChordNewChord);
fbSeqNewSequence          = guarded(fbSeqNewSequence);

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_INTERFACE_RE, FB_BUILTIN_RE, fbDedupDevices, fbDeviceScore, fbPickPreferredDevice, fbDeviceWatchInited,
    fbWatchDeviceChanges, fbRenderDeviceBar, fbEnsurePrefsLoaded, initFretboardPage, initChordMatchPage, fbShowMode,
    fbLeavePage,
  };
}
