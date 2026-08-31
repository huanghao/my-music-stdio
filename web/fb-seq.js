// ── Fretboard trainer — Scale Sequences drill ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Scale Sequences drill (diatonic 3rds/6ths/triad/7th-arpeggio sequences,
// walked up/down a chosen scale) ──────────────────────────────────────────
// Reuses FB_EAR_SCALES as the single source of scale data — restricted to
// the three full 7-note diatonic scales, since a "sequence" (in the classic
// technical-exercise sense) needs a distinct note on every scale step; the
// pentatonic/blues entries don't have one.
const FB_SEQ_SCALE_KEYS = ['major', 'naturalMinor', 'harmonicMinor'];
// offsets are scale-STEP counts (not semitones) from each group's starting
// degree: thirds/sixths are dyads, triad/seventh are stacked-3rd arpeggios.
const FB_SEQ_PATTERNS = {
  thirds:  { label: 'Diatonic 3rds', offsets: [0, 2] },
  sixths:  { label: 'Diatonic 6ths', offsets: [0, 5] },
  triad:   { label: 'Triad Arpeggios', offsets: [0, 2, 4] },
  seventh: { label: '7th Arpeggios', offsets: [0, 2, 4, 6] },
};

// The 7 unique scale-step semitone offsets for a scale — drops FB_EAR_SCALES'
// trailing octave duplicate (e.g. major's 8-entry [0,2,4,5,7,9,11,12] -> the
// first 7).
function fbSeqScaleSteps(scaleKey) {
  return FB_EAR_SCALES[scaleKey].degrees.slice(0, 7);
}

// One ascending pass, one octave (7 diatonic groups), as absolute semitone
// offsets from the tonic — not yet transposed to a key or fretted. E.g.
// thirds in major: groups start on scale-steps 0..6, each group being
// [step, step+2] read through the octave-extended scale, giving the classic
// "up two, back one" sawtooth contour of a real diatonic 3rds sequence.
function fbSeqBuildAscending(scaleKey, patternKey) {
  const steps = fbSeqScaleSteps(scaleKey);
  const offsets = FB_SEQ_PATTERNS[patternKey].offsets;
  const extended = i => steps[i % 7] + 12 * Math.floor(i / 7);
  const notes = [];
  for (let g = 0; g < 7; g++) offsets.forEach(off => notes.push(extended(g + off)));
  return notes;
}

// direction: 'asc' | 'desc' | 'both'. 'desc' reverses the whole ascending
// pass (groups and the notes within them); 'both' plays the ascending pass
// then the same pass in reverse — the turnaround note repeats once, which is
// normal in real technical-exercise practice.
function fbSeqBuildSemitoneOffsets(scaleKey, patternKey, direction) {
  const asc = fbSeqBuildAscending(scaleKey, patternKey);
  if (direction === 'asc') return asc;
  const desc = asc.slice().reverse();
  return direction === 'desc' ? desc : asc.concat(desc);
}

// Width (in frets) of the single hand position the whole sequence is
// confined to — matches how real "one octave, one position" scale-box
// exercises are taught (a comfortable span using all 6 strings, no shifting
// mid-sequence). For a window of this width starting at fret F, the 6
// strings' reachable pitches ([open+F, open+F+4] each) join into one
// *contiguous* range [40+F, 68+F] regardless of which string anchors it —
// open strings are 5,5,5,4,5 semitones apart, so each string's span links
// seamlessly to the next.
const FB_SEQ_WINDOW_WIDTH = 5;

// Picks which string the tonic (semitone offset 0) sits on, and at which
// fret. Two constraints: (1) the fret should be the nearest occurrence of
// the key at or after startFret (search only ever moves up the neck, never
// below the requested fret), and (2) the whole sequence (up to maxOffset
// semitones above the tonic) must still fit inside one FB_SEQ_WINDOW_WIDTH
// window — per the coverage note above, that requires
// FB_STRING_OPEN_MIDI[stringIdx] + maxOffset <= (open high-e) + width - 1.
// Only strings satisfying that are considered, so wide patterns (7th
// arpeggios, "both" directions) naturally fall back to the low E/A strings
// where there's enough headroom, while narrower patterns (3rds, one octave)
// get to use any string and can land closer to the requested startFret.
function fbSeqAnchorPosition(keyRootPc, startFret, maxOffset) {
  const headroomCeiling = FB_STRING_OPEN_MIDI[5] + FB_SEQ_WINDOW_WIDTH - 1;
  let best = null;
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    if (FB_STRING_OPEN_MIDI[stringIdx] + maxOffset > headroomCeiling) continue;
    let fret = startFret;
    while (((FB_STRING_OPEN[stringIdx] + fret) % 12 + 12) % 12 !== keyRootPc) fret++;
    const dist = Math.abs(fret - startFret);
    if (!best || dist < best.dist) best = { stringIdx, fret, midi: FB_STRING_OPEN_MIDI[stringIdx] + fret, dist };
  }
  return { stringIdx: best.stringIdx, fret: best.fret, midi: best.midi };
}

// Frets every target semitone offset (from the anchor) strictly within the
// single-position window [anchor.fret, anchor.fret + FB_SEQ_WINDOW_WIDTH - 1]
// across all 6 strings — the whole point being that the player never has to
// shift hand position mid-sequence. When a pitch is reachable on more than
// one string within the window (happens at the window's string-overlap
// points), prefer whichever string is closest to the previous note's string,
// so the line still reads as smooth left-to-right motion rather than
// jumping around within the position.
function fbSeqAssignFretting(anchor, semitoneOffsets) {
  const windowStart = anchor.fret;
  const windowEnd = windowStart + FB_SEQ_WINDOW_WIDTH - 1;
  const positions = [];
  let prevString = anchor.stringIdx;
  for (const offset of semitoneOffsets) {
    const targetMidi = anchor.midi + offset;
    let best = null;
    for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
      const fret = targetMidi - FB_STRING_OPEN_MIDI[stringIdx];
      if (fret < windowStart || fret > windowEnd) continue;
      const cost = Math.abs(stringIdx - prevString);
      if (!best || cost < best.cost) best = { stringIdx, fret, midi: targetMidi, cost };
    }
    if (!best) continue; // shouldn't happen — the window is sized to cover every offset the UI can produce
    positions.push({ stringIdx: best.stringIdx, fret: best.fret, midi: best.midi });
    prevString = best.stringIdx;
  }
  return positions;
}

function fbRenderSeqOptions() {
  const s = fbState.seq;
  document.getElementById('fb-seq-options').innerHTML = `
    <span>Key:</span>
    <select onchange="fbState.seq.keyRoot=parseInt(this.value); fbPrefsSave(); fbSeqBuild()">
      ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.keyRoot === i ? 'selected' : ''}>${n}</option>`).join('')}
    </select>
    <span class="ml-3">Scale:</span>
    <select onchange="fbState.seq.scale=this.value; fbPrefsSave(); fbSeqBuild()">
      ${FB_SEQ_SCALE_KEYS.map(k => `<option value="${k}" ${s.scale === k ? 'selected' : ''}>${FB_EAR_SCALES[k].label}</option>`).join('')}
    </select>
    <span class="ml-3">Pattern:</span>
    <select onchange="fbState.seq.pattern=this.value; fbPrefsSave(); fbSeqBuild()">
      ${Object.keys(FB_SEQ_PATTERNS).map(k => `<option value="${k}" ${s.pattern === k ? 'selected' : ''}>${FB_SEQ_PATTERNS[k].label}</option>`).join('')}
    </select>
    <span class="ml-3">Direction:</span>
    <select onchange="fbState.seq.direction=this.value; fbPrefsSave(); fbSeqBuild()">
      <option value="asc"  ${s.direction === 'asc'  ? 'selected' : ''}>Ascending</option>
      <option value="desc" ${s.direction === 'desc' ? 'selected' : ''}>Descending</option>
      <option value="both" ${s.direction === 'both' ? 'selected' : ''}>Both</option>
    </select>
    <span class="ml-3">Start near fret:</span>
    <input type="number" min="0" max="12" value="${s.startFret}" class="w-[56px]!"
      onchange="fbState.seq.startFret=Math.max(0, Math.min(12, parseInt(this.value) || 0)); fbPrefsSave(); fbSeqBuild()">
  `;
}

// Renders a set of fretted positions on the shared linear fretboard SVG.
// opts.highlightIdx marks one position in the "quiz" color; opts.clickable +
// opts.onClick wires click handlers on every position; opts.revealAll prints
// each position's degree/order label as text.
function fbRenderShapeDegreeBoard(containerEl, positions, opts = {}) {
  const frets = positions.map(p => p.fret);
  const startFret = Math.max(0, Math.min(...frets) - 1);
  const numFrets = Math.max(5, Math.max(...frets) - startFret + 1);
  const b = fbBuildBoard(numFrets, startFret);

  positions.forEach((p, idx) => {
    const cx = fbMarkerX(b, p.fret - startFret);
    const cy = b.yString(p.stringIdx);
    const circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circ.setAttribute('cx', cx); circ.setAttribute('cy', cy); circ.setAttribute('r', 11);
    circ.setAttribute('class', opts.highlightIdx === idx ? 'fb-quiz-dot' : 'fb-shape-dot');
    b.svg.appendChild(circ);
    if (opts.clickable) {
      circ.classList.add('clickable');
      circ.addEventListener('click', () => opts.onClick(p, circ));
    }
    if (opts.revealAll) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy + 4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'fb-shape-degree-label');
      t.textContent = p.degree;
      b.svg.appendChild(t);
    }
  });

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board';
  wrap.appendChild(b.svg);
  containerEl.appendChild(wrap);
}

// Rebuilds fbState.seq.sequence from the current options and re-renders
// whichever subtab panel is visible (called on every option change and on
// page init — both subtabs' panels exist in the DOM at once, so both get a
// fresh render).
function fbSeqBuild() {
  const s = fbState.seq;
  const offsets = fbSeqBuildSemitoneOffsets(s.scale, s.pattern, s.direction);
  const anchor = fbSeqAnchorPosition(s.keyRoot, s.startFret, Math.max(...offsets));
  const positions = fbSeqAssignFretting(anchor, offsets);
  s.sequence = positions.map((p, i) => ({
    stringIdx: p.stringIdx, fret: p.fret, midi: p.midi,
    noteName: FB_NOTE_NAMES[((p.midi % 12) + 12) % 12], octave: fbOctaveOf(p.midi),
    order: i + 1,
  }));
  s.idx = 0;
  s._holdCount = 0;
  s._wrongNote = null;
  s._wrongHoldCount = 0;
  s._lastReading = null;
  fbRenderSeqReference();
  fbRenderSeqVerify();
}

function fbRenderSeqReference() {
  const s = fbState.seq;
  const listEl = document.getElementById('fb-seq-reference-list');
  if (!listEl) return;
  listEl.textContent = s.sequence.map(p => `${p.noteName}${p.octave}`).join('  ');
  const boardPositions = s.sequence.map(p => ({ stringIdx: p.stringIdx, fret: p.fret, degree: String(p.order) }));
  fbRenderShapeDegreeBoard(document.getElementById('fb-seq-reference-board'), boardPositions, { revealAll: true });
}

function fbRenderSeqVerify() {
  const s = fbState.seq;
  const statsEl = document.getElementById('fb-seq-verify-stats');
  if (!statsEl) return;
  statsEl.innerHTML = `<span class="fb-stat-ok">Sequences completed <b>${s.completed}</b></span>`;
  const step = s.sequence[s.idx];
  document.getElementById('fb-seq-verify-target').textContent =
    step ? `${step.noteName}${step.octave}  (note ${step.order}/${s.sequence.length})` : '';
  document.getElementById('fb-seq-hint-cb').checked = s.showPositionHint;
  const boardEl = document.getElementById('fb-seq-verify-board');
  if (s.showPositionHint) {
    const boardPositions = s.sequence.map(p => ({ stringIdx: p.stringIdx, fret: p.fret, degree: String(p.order) }));
    fbRenderShapeDegreeBoard(boardEl, boardPositions, { highlightIdx: s.idx });
  } else {
    boardEl.innerHTML = '';
  }
}

function fbSeqSetMode(mode) {
  if (fbMic.listening && fbMic.owner === 'seq' && mode !== 'verify') fbSeqStop();
  fbState.seq.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-seq-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.seqmode === mode));
  document.getElementById('fb-seq-reference-panel').classList.toggle('hidden', mode !== 'reference');
  document.getElementById('fb-seq-verify-panel').classList.toggle('hidden', mode !== 'verify');
  fbRenderSeqReference();
  fbRenderSeqVerify();
  fbRenderControlAction();
}

function fbSeqNewSequence() {
  fbState.seq.keyRoot = Math.floor(Math.random() * 12);
  fbPrefsSave();
  fbSeqBuild();
}

const FB_SEQ_MATCH_CENTS_TOLERANCE = 15;
const FB_SEQ_MATCH_HOLD_FRAMES = 12;
const FB_SEQ_WRONG_HOLD_FRAMES = 10;
const FB_SEQ_WRONG_MSG_COOLDOWN_MS = 700;

function fbRenderSeqMeter(r, held) {
  const meter = document.getElementById('fb-seq-verify-meter');
  meter.innerHTML = `
    <div class="fb-pitch-detected${r.isMatch ? ' match' : ''}${held ? ' held' : ''}">${r.noteName}<span class="fb-pitch-octave">${fbOctaveOf(r.midi)}</span></div>
    <div class="fb-pitch-cents-bar"><div class="fb-pitch-cents-needle" style="left:${50 + Math.max(-50, Math.min(50, r.cents))}%"></div></div>
    <div class="fb-pitch-hz">${r.freq.toFixed(1)} Hz &nbsp;·&nbsp; ${r.cents > 0 ? '+' : ''}${r.cents} cents</div>
  `;
}

async function fbSeqStart() {
  try {
    await fbMicStart('seq', fbSeqOnFrame);
  } catch (e) {
    const fb = document.getElementById('fb-seq-verify-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('seq');
}

function fbSeqStop() {
  fbMicStop();
  fbSyncMicButtons('seq');
  document.getElementById('fb-seq-verify-meter').innerHTML = '';
}

function fbSeqOnFrame(analyser, sampleRate) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  const freq = fbAutoCorrelate(buf, sampleRate);

  const s = fbState.seq;
  const meter = document.getElementById('fb-seq-verify-meter');
  const now = performance.now();
  const step = s.sequence[s.idx];
  if (!step) return;

  if (!(freq > 0 && freq >= 60 && freq <= 1500)) {
    if (s._lastReading && now - s._lastReading.ts < FB_METER_HOLD_MS) {
      fbRenderSeqMeter(s._lastReading, true);
    } else {
      meter.innerHTML = `<div class="fb-pitch-detected">—</div><div class="fb-pitch-hz">listening…</div>`;
    }
    s._holdCount = 0;
    return;
  }

  const { noteName, cents, midi } = fbFreqToNote(freq);
  const isMatch = midi === step.midi && Math.abs(cents) <= FB_SEQ_MATCH_CENTS_TOLERANCE;
  s._lastReading = { noteName, cents, midi, freq, isMatch, ts: now };
  fbRenderSeqMeter(s._lastReading, false);

  if (isMatch) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_SEQ_MATCH_HOLD_FRAMES) fbSeqOnStepMatch();
    return;
  }
  s._holdCount = 0;
  if (noteName === s._wrongNote) s._wrongHoldCount++;
  else { s._wrongNote = noteName; s._wrongHoldCount = 1; }
  if (s._wrongHoldCount === FB_SEQ_WRONG_HOLD_FRAMES && now - s._lastWrongMsgAt > FB_SEQ_WRONG_MSG_COOLDOWN_MS) {
    s._lastWrongMsgAt = now;
    const fb = document.getElementById('fb-seq-verify-feedback');
    fb.textContent = `Not quite — heard ${noteName}${fbOctaveOf(midi)}, need ${step.noteName}${step.octave}. Keep trying…`;
    fb.className = 'fb-feedback err';
  }
}

function fbSeqOnStepMatch() {
  const s = fbState.seq;
  s.idx++;
  s._holdCount = 0;
  s._wrongHoldCount = 0;
  s._wrongNote = null;
  fbRenderSeqVerify();
  const fb = document.getElementById('fb-seq-verify-feedback');
  if (s.idx >= s.sequence.length) {
    s.completed++;
    fb.textContent = `Sequence complete! (${s.completed} total)`;
    fb.className = 'fb-feedback ok';
    setTimeout(fbSeqNewSequence, 1200);
  } else {
    fb.textContent = '';
    fb.className = 'fb-feedback';
  }
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_SEQ_SCALE_KEYS, FB_SEQ_PATTERNS, fbSeqScaleSteps, fbSeqBuildAscending, fbSeqBuildSemitoneOffsets, FB_SEQ_WINDOW_WIDTH,
    fbSeqAnchorPosition, fbSeqAssignFretting, fbRenderSeqOptions, fbRenderShapeDegreeBoard, fbSeqBuild, fbRenderSeqReference,
    fbRenderSeqVerify, fbSeqSetMode, fbSeqNewSequence, FB_SEQ_MATCH_CENTS_TOLERANCE, FB_SEQ_MATCH_HOLD_FRAMES, FB_SEQ_WRONG_HOLD_FRAMES,
    FB_SEQ_WRONG_MSG_COOLDOWN_MS, fbRenderSeqMeter, fbSeqStart, fbSeqStop, fbSeqOnFrame, fbSeqOnStepMatch,
  };
}
