// ── Fretboard trainer — Pitch Match drill ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Pitch Match drill (mic-based ear training) ──

const FB_MATCH_CENTS_TOLERANCE = 15;
const FB_MATCH_HOLD_FRAMES = 12;  // ~0.2s at 60fps — avoids false triggers on transients
const FB_WRONG_HOLD_FRAMES = 10;  // ~0.17s of a stable wrong note before we say something
const FB_WRONG_MSG_COOLDOWN_MS = 700;
const FB_METER_HOLD_MS = 1200; // how long a reading lingers after the note decays into silence
const FB_PITCH_STATS_KEY = 'fb_pitch_note_stats';

function fbRenderPitchMeter(r, held) {
  const meter = document.getElementById('fb-pitch-meter');
  meter.innerHTML = `
    <div class="fb-pitch-detected${r.isMatch ? ' match' : ''}${held ? ' held' : ''}">${r.noteName}<span class="fb-pitch-octave">${fbOctaveOf(r.midi)}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents} cents</div>
  `;
}

// Tracks time the tab spends hidden (switched away) so it can be excluded
// from reaction-time measurements — otherwise tabbing away mid-question
// inflates that note's recorded "time to find it".
document.addEventListener('visibilitychange', () => {
  [fbState.pitch, fbState.chord].forEach(s => {
    if (document.hidden) {
      s._hiddenSince = performance.now();
    } else if (s._hiddenSince != null) {
      s._hiddenMs = (s._hiddenMs || 0) + (performance.now() - s._hiddenSince);
      s._hiddenSince = null;
    }
  });
});

function fbPitchLoadStats() {
  try { fbState.pitch.stats = JSON.parse(localStorage.getItem(FB_PITCH_STATS_KEY)) || {}; }
  catch (_) { fbState.pitch.stats = {}; }
}
function fbPitchSaveStats() {
  localStorage.setItem(FB_PITCH_STATS_KEY, JSON.stringify(fbState.pitch.stats));
}

function fbRenderPitchOptions() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-options').innerHTML = `
    <span>Strings:</span>
    ${FB_STRING_NAMES.map((n, i) => `
      <label><input type="checkbox" ${s.strings[i] ? 'checked' : ''} onchange="fbPitchToggleString(${i})"> ${n}${i===0?'(low)':i===5?'(high)':''}</label>
    `).join('')}
    <span class="ml-3">Practice:</span>
    <select onchange="fbState.pitch.practiceMode=this.value; fbPrefsSave()">
      <option value="all" ${s.practiceMode==='all'?'selected':''}>All notes</option>
      <option value="weak" ${s.practiceMode==='weak'?'selected':''}>Focus on weak notes</option>
    </select>
    <label class="ml-3"><input type="checkbox" ${s.showBoard ? 'checked' : ''}
      onchange="fbState.pitch.showBoard=this.checked; fbPrefsSave(); fbRenderPitchBoard()"> Show fretboard diagram</label>
    <label class="ml-3"><input type="checkbox" ${s.naturalsOnly ? 'checked' : ''}
      onchange="fbState.pitch.naturalsOnly=this.checked; fbPrefsSave()"> Naturals only (A-G, no #/b)</label>
  `;
}

// Marks every position where the current target note occurs on the enabled
// strings (unlike the Note Names drill, which marks one specific spot — here
// the target is a note *name*, playable at several positions, so all of them
// light up). Off by default: most people practicing pitch matching by ear
// don't want the answer already drawn on the neck.
function fbRenderPitchBoard() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-board');
  if (!el) return;
  if (!s.showBoard || !s.target) { el.innerHTML = ''; return; }

  const b = fbBuildBoard(12, 0);
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    if (!s.strings[stringIdx]) continue;
    for (let fret = 0; fret <= 12; fret++) {
      if (fbNoteAt(stringIdx, fret) !== s.target) continue;
      const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', fbMarkerX(b, fret));
      circ.setAttribute('cy', b.yString(stringIdx));
      circ.setAttribute('r', fret === 0 ? 10 : 11);
      circ.setAttribute('class', fret === 0 ? 'fb-open-marker' : 'fb-quiz-dot');
      b.svg.appendChild(circ);
    }
  }
  el.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  el.appendChild(wrap);
}

function fbPitchToggleString(i) {
  const s = fbState.pitch;
  s.strings[i] = !s.strings[i];
  if (!s.strings.some(Boolean)) s.strings[i] = true; // keep at least one
  fbPrefsSave();
}

function fbPitchResetStats() {
  fbState.pitch.stats = {};
  fbPitchSaveStats();
  fbRenderPitchStatsTable();
}

// All open+fret(0..12) MIDI notes on one string.
function fbStringMidis(stringIdx) {
  const base = FB_STRING_OPEN_MIDI[stringIdx];
  const arr = [];
  for (let fret = 0; fret <= 12; fret++) arr.push(base + fret);
  return arr;
}

// Which absolute MIDI notes count as "correct" for a target note name, given
// the selected string filter. With all 6 strings selected (default) this
// spans several octaves — effectively unrestricted. Narrowing to one or two
// strings pins down which octave(s) are accepted, since we can't tell from
// audio alone which physical string was actually played (a given pitch can
// exist on several strings at once) — restricting strings instead restricts
// which octave is accepted as "found on that string".
function fbPitchAllowedMidis(noteName) {
  const s = fbState.pitch;
  const idx = FB_NOTE_NAMES.indexOf(noteName);
  const midis = new Set();
  for (let i = 0; i < 6; i++) {
    if (!s.strings[i]) continue;
    fbStringMidis(i).forEach(m => { if (((m % 12) + 12) % 12 === idx) midis.add(m); });
  }
  return midis;
}

// A-G only, no sharps — used when fbState.pitch.naturalsOnly is checked.
const FB_NATURAL_NOTE_NAMES = FB_NOTE_NAMES.filter(n => !n.includes('#'));

function fbPitchPickTarget() {
  const s = fbState.pitch;
  const pool = s.naturalsOnly ? FB_NATURAL_NOTE_NAMES : FB_NOTE_NAMES;
  if (s.practiceMode !== 'weak') return pool[Math.floor(Math.random() * pool.length)];
  const weights = pool.map(n => {
    const st = s.stats[n];
    if (!st || !st.presented) return 3; // unseen notes get decent priority too
    const acc = st.matched / st.presented;
    const avgMs = st.matched ? st.totalMs / st.matched : 4000;
    return Math.max(0.2, (1 - acc) * 4 + avgMs / 1500 + (st.wrongHits || 0) * 0.5);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

function fbRenderPitchStats() {
  const s = fbState.pitch;
  document.getElementById('fb-pitch-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderPitchStatsTable() {
  const s = fbState.pitch;
  const el = document.getElementById('fb-pitch-stats-table');
  if (!el) return;
  const rows = FB_NOTE_NAMES.map(n => {
    const st = s.stats[n];
    const presented = st?.presented || 0;
    const matched = st?.matched || 0;
    const acc = presented ? Math.round((matched / presented) * 100) : null;
    const avg = matched ? (st.totalMs / matched / 1000).toFixed(1) : null;
    return { n, presented, acc, avg, wrong: st?.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span class="text-fg-faint text-sm">No attempts yet — start listening and play some notes.</span>';
    return;
  }
  el.innerHTML = fbStatsTableHead('Per-note accuracy', 'fbPitchResetStats') + `
    <table class="fb-stats-table">
      <tr><th>Note</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.n}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbPitchNewNote() {
  const s = fbState.pitch;
  s.target = fbPitchPickTarget();
  s.matched = false;
  s._holdCount = 0;
  s._wrongNote = null;
  s._wrongHoldCount = 0;
  s._lastReading = null;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[s.target] || (s.stats[s.target] = { presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbPitchSaveStats();

  document.getElementById('fb-pitch-target').textContent = s.target;
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  fbRenderPitchBoard();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

async function fbPitchStart() {
  try {
    await fbMicStart('pitch', fbPitchOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-pitch-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('pitch');
}

function fbPitchStop() {
  fbMicStop();
  fbSyncMicButtons('pitch');
  document.getElementById('fb-pitch-meter').innerHTML = '';
}

function fbPitchOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.pitch;
  const meter = document.getElementById('fb-pitch-meter');
  const now = performance.now();

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    // A plucked string decays below the silence threshold well before you've
    // had time to read the meter — hold the last reading for a bit instead
    // of snapping straight back to "listening…".
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderPitchMeter(s._lastReading, true);
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">listening…</div>`;
    }
    s._holdCount = 0;
    return;
  }

  const { noteName, cents, midi } = fbFreqToNote(freq);
  const allowed = fbPitchAllowedMidis(s.target);
  const isMatch = noteName === s.target && allowed.has(midi) && Math.abs(cents) <= FB_MATCH_CENTS_TOLERANCE;
  s._lastReading = { noteName, cents, midi, freq, isMatch, ts: now };
  fbRenderPitchMeter(s._lastReading, false);
  if (s.matched) return;

  if (isMatch) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_MATCH_HOLD_FRAMES) fbPitchOnMatch();
    return;
  }
  s._holdCount = 0;
  if (noteName === s._wrongNote) s._wrongHoldCount++;
  else { s._wrongNote = noteName; s._wrongHoldCount = 1; }
  if (s._wrongHoldCount === FB_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_WRONG_MSG_COOLDOWN_MS) {
    fbPitchOnWrong(noteName, midi);
  }
}

function fbPitchOnWrong(noteName, midi) {
  const s = fbState.pitch;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target];
  if (st) { st.wrongHits++; fbPitchSaveStats(); }
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Not quite — heard ${noteName}${fbOctaveOf(midi)}, target is ${s.target}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbPitchOnMatch() {
  const s = fbState.pitch;
  s.matched = true;
  // exclude time the tab spent in the background (switched away, etc.) so a
  // distracted pause doesn't get counted as "slow to find the note"
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target];
  st.matched++; st.totalMs += elapsedMs;
  fbPitchSaveStats();
  fbRenderPitchStats();
  fbRenderPitchStatsTable();
  const fb = document.getElementById('fb-pitch-feedback');
  fb.textContent = `Matched ${s.target} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbPitchNewNote, 900);
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_MATCH_CENTS_TOLERANCE, FB_MATCH_HOLD_FRAMES, FB_WRONG_HOLD_FRAMES, FB_WRONG_MSG_COOLDOWN_MS, FB_METER_HOLD_MS, FB_PITCH_STATS_KEY,
    fbRenderPitchMeter, fbPitchLoadStats, fbPitchSaveStats, fbRenderPitchOptions, fbRenderPitchBoard, fbPitchToggleString,
    fbPitchResetStats, fbStringMidis, fbPitchAllowedMidis, FB_NATURAL_NOTE_NAMES, fbPitchPickTarget, fbRenderPitchStats,
    fbRenderPitchStatsTable, fbPitchNewNote, fbPitchStart, fbPitchStop, fbPitchOnFrame, fbPitchOnWrong,
    fbPitchOnMatch,
  };
}
