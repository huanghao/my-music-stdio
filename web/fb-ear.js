// ── Fretboard trainer — Ear Training drill ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Ear Training drill ──
// Interval recognition within a pentatonic/blues scale: the app plays 2 (or
// 3) notes drawn from the scale and asks which interval spans them. Every
// interval that can occur between any two scale tones is included as an
// answer choice — deriving that set from the scale itself (rather than a
// fixed list) is what makes adding a new scale (blues, or later modes) just
// a matter of adding a degrees array, no other code changes.

const FB_INTERVAL_NAMES = ['Unison', 'm2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];

// Degrees are semitone offsets from the root, spanning one octave (the last
// entry is always the root an octave up, included so intervals that cross
// the octave boundary — e.g. b7 to the next root — are reachable too).
const FB_EAR_SCALES = {
  minor: { label: 'Minor Pentatonic', degrees: [0, 3, 5, 7, 10, 12], labels: ['1', 'b3', '4', '5', 'b7', '1\''] },
  blues: { label: 'Blues Scale', degrees: [0, 3, 5, 6, 7, 10, 12], labels: ['1', 'b3', '4', 'b5', '5', 'b7', '1\''] },
  major: { label: 'Major (Ionian)', degrees: [0, 2, 4, 5, 7, 9, 11, 12], labels: ['1', '2', '3', '4', '5', '6', '7', '1\''] },
  naturalMinor: { label: 'Natural Minor (Aeolian)', degrees: [0, 2, 3, 5, 7, 8, 10, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', 'b7', '1\''] },
  harmonicMinor: { label: 'Harmonic Minor', degrees: [0, 2, 3, 5, 7, 8, 11, 12], labels: ['1', '2', 'b3', '4', '5', 'b6', '7', '1\''] },
};

// Classic "anchor song" mnemonics — the standard ear-training trick for
// intervals that are hard to place by raw size alone (fine for m2/m3/M3,
// much harder for P4 upward): recognizing the opening of a song you already
// know by heart is faster than judging distance in the abstract.
const FB_EAR_INTERVAL_HINTS = {
  m2: "Jaws theme",
  M2: "Happy Birthday (1st-2nd note)",
  m3: "Greensleeves (opening)",
  M3: "Kumbaya (1st-2nd note)",
  P4: "Here Comes the Bride / Auld Lang Syne",
  TT: "The Simpsons theme (opening)",
  P5: "Twinkle Twinkle Little Star / Star Wars theme",
  m6: "The Entertainer (opening) / Love Story theme",
  M6: "My Bonnie Lies Over the Ocean / NBC chimes",
  m7: "Star Trek (original series) theme",
  M7: "Take On Me (chorus leap)",
  P8: "Somewhere Over the Rainbow (opening)",
};

// Three registers to play notes in, so questions aren't always centered on
// the same octave — 'low' sits in typical guitar low-string range, 'mid' is
// the original default (roughly middle C ± an octave), 'high' shifts up an
// octave from that.
const FB_EAR_RANGE_BASE = { low: 36, mid: 48, high: 60 };
const FB_EAR_RANGE_LABELS = { low: 'Low (C2-B3ish)', mid: 'Mid (C3-B4ish, default)', high: 'High (C4-B5ish)' };

function fbEarIntervalName(semitones) {
  return FB_INTERVAL_NAMES[semitones];
}

// Every distinct interval (by semitone count) formed between any two of the
// scale's degrees, sorted small to large and named — this is exactly the
// answer-choice set for that scale.
function fbEarPossibleIntervals(degrees) {
  const semitones = new Set();
  for (let i = 0; i < degrees.length; i++) {
    for (let j = i + 1; j < degrees.length; j++) {
      semitones.add(degrees[j] - degrees[i]);
    }
  }
  return [...semitones].sort((a, b) => a - b).map(fbEarIntervalName);
}

// The two adjacent intervals actually heard in a 3-note question, in the
// order they're played — order is 3 scale-degree indices (e.g. [i, mid, j]
// ascending or [j, mid, i] descending); the interval between notes 1-2 and
// notes 2-3 is what's asked, regardless of which direction it's played.
function fbEarAdjacentIntervals(degrees, order) {
  return [
    Math.abs(degrees[order[1]] - degrees[order[0]]),
    Math.abs(degrees[order[2]] - degrees[order[1]]),
  ];
}

// Lazily created on first Play click (browsers require a user gesture before
// audio can start) and reused for every question after that.
let fbEarAudioCtx = null;
function fbEarGetAudioCtx() {
  if (!fbEarAudioCtx) {
    fbEarAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fbRegisterAudioContext(fbEarAudioCtx);
  }
  if (fbEarAudioCtx.state === 'suspended') fbEarAudioCtx.resume();
  return fbEarAudioCtx;
}

// Plays a sequence of MIDI notes according to fbState.ear.playbackStyle:
// 'melodic' (one after another, the default), 'harmonic' (all at once, like
// a chord), or 'both' (melodic run, then the same notes stacked together).
// Returns the total playback duration in ms so callers can debounce repeat
// clicks for exactly as long as the audio is actually playing.
function fbEarPlaySequence(midiNotes) {
  const ctx = fbEarGetAudioCtx();
  const noteDur = 0.9;
  const gap = fbState.ear.noteGapSec;
  const style = fbState.ear.playbackStyle;
  const start = ctx.currentTime + 0.05;

  const playOne = (midi, atTime) => {
    const osc = ctx.createOscillator();
    osc.type = fbState.ear.waveform;
    osc.frequency.value = fbFreqFromMidi(midi);
    // Square/sawtooth are harmonic-rich enough to sound harsh at full volume —
    // a gentle lowpass rounds off the edge without changing the waveform choice.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.7;
    const peak = 0.3 * fbMasterGain() * fbSoundGain('practiceTones');
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, atTime);
    gain.gain.linearRampToValueAtTime(peak, atTime + 0.015);
    gain.gain.setValueAtTime(peak, atTime + noteDur - 0.05);
    gain.gain.linearRampToValueAtTime(0, atTime + noteDur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(atTime);
    osc.stop(atTime + noteDur + 0.02);
  };

  let melodicEnd = start;
  if (style !== 'harmonic') {
    let t = start;
    midiNotes.forEach((midi, idx) => {
      playOne(midi, t);
      melodicEnd = t + noteDur;
      if (idx < midiNotes.length - 1) t += noteDur + gap;
    });
  }

  let totalEnd = melodicEnd;
  if (style === 'harmonic') {
    midiNotes.forEach(midi => playOne(midi, start));
    totalEnd = start + noteDur;
  } else if (style === 'both') {
    const chordStart = melodicEnd + 0.2;
    midiNotes.forEach(midi => playOne(midi, chordStart));
    totalEnd = chordStart + noteDur;
  }

  return Math.ceil((totalEnd - start) * 1000) + 150;
}

// Debounces repeat clicks (Play button, or clicking dots on the diagram) so
// a fast double-click can't overlap two copies of the same audio.
function fbEarPlayNotesFor(subMode, midiNotes) {
  const s = fbState.ear[subMode];
  const now = Date.now();
  if (s.playingUntil && now < s.playingUntil) return;
  s.playingUntil = now + fbEarPlaySequence(midiNotes);
}

function fbEarPlayCurrent(subMode) {
  fbEarPlayNotesFor(subMode, fbState.ear[subMode].current.notes);
}

// "Fill the gap": for a hard-to-place interval (e.g. a 6th or 7th), plays
// every scale step from the lower quiz note up to the higher one — not just
// the two endpoints — so it's heard as a short scale walk instead of one
// blind jump. Ascending regardless of which direction the quiz itself played.
function fbEarPlayScaffold(subMode) {
  const c = fbState.ear[subMode].current;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const notes = [];
  for (let idx = c.i; idx <= c.j; idx++) notes.push(c.rootMidi + degrees[idx]);
  fbEarPlayNotesFor(subMode, notes);
}

function fbRenderEarOptions() {
  document.getElementById('fb-ear-options').innerHTML = `
    <label>Scale:
      <select onchange="fbEarSetScale(this.value)">
        ${Object.entries(FB_EAR_SCALES).map(([key, s]) =>
          `<option value="${key}" ${fbState.ear.scale === key ? 'selected' : ''}>${s.label}</option>`).join('')}
      </select>
    </label>
    <label>Tone:
      <select onchange="fbState.ear.waveform=this.value; fbPrefsSave()">
        <option value="sine" ${fbState.ear.waveform === 'sine' ? 'selected' : ''}>Sine (soft)</option>
        <option value="triangle" ${fbState.ear.waveform === 'triangle' ? 'selected' : ''}>Triangle</option>
        <option value="square" ${fbState.ear.waveform === 'square' ? 'selected' : ''}>Square</option>
        <option value="sawtooth" ${fbState.ear.waveform === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
      </select>
    </label>
    <label>Playback:
      <select onchange="fbState.ear.playbackStyle=this.value; fbPrefsSave()">
        <option value="melodic" ${fbState.ear.playbackStyle === 'melodic' ? 'selected' : ''}>Melodic (one after another)</option>
        <option value="harmonic" ${fbState.ear.playbackStyle === 'harmonic' ? 'selected' : ''}>Harmonic (all together)</option>
        <option value="both" ${fbState.ear.playbackStyle === 'both' ? 'selected' : ''}>Both (melodic, then together)</option>
      </select>
    </label>
    <label>Note gap:
      <input type="number" min="0" max="2" step="0.05" value="${fbState.ear.noteGapSec}" class="w-[56px]!"
        onchange="fbState.ear.noteGapSec=Math.max(0, parseFloat(this.value)||0); fbPrefsSave()"> sec</label>
    <label>Direction:
      <select onchange="fbState.ear.direction=this.value; fbPrefsSave()">
        <option value="both" ${fbState.ear.direction === 'both' ? 'selected' : ''}>Both (random)</option>
        <option value="asc" ${fbState.ear.direction === 'asc' ? 'selected' : ''}>Ascending only</option>
        <option value="desc" ${fbState.ear.direction === 'desc' ? 'selected' : ''}>Descending only</option>
      </select>
    </label>
    <label>Range:
      <select onchange="fbState.ear.range=this.value; fbPrefsSave()">
        ${Object.keys(FB_EAR_RANGE_BASE).map(k => `<option value="${k}" ${fbState.ear.range === k ? 'selected' : ''}>${FB_EAR_RANGE_LABELS[k]}</option>`).join('')}
      </select>
    </label>
    <label>Practice:
      <select onchange="fbState.ear.practiceMode=this.value; fbPrefsSave()">
        <option value="all"  ${fbState.ear.practiceMode === 'all'  ? 'selected' : ''}>All intervals</option>
        <option value="weak" ${fbState.ear.practiceMode === 'weak' ? 'selected' : ''}>Focus on weak</option>
      </select>
    </label>
    <label><input type="checkbox" ${fbState.ear.autoAdvance ? 'checked' : ''}
      onchange="fbEarSetAutoAdvance(this.checked)"> Auto-advance</label>
    <label>Pause after wrong answer:
      <input type="number" min="0.5" max="15" step="0.5" value="${fbState.ear.wrongPauseSec}" class="w-[56px]!"
        onchange="fbState.ear.wrongPauseSec=parseFloat(this.value)||3; fbPrefsSave()"> sec</label>
    <label><input type="checkbox" ${fbState.ear.showDiagram ? 'checked' : ''}
      onchange="fbState.ear.showDiagram=this.checked; fbPrefsSave(); fbEarRefreshDiagrams()"> Show scale diagram</label>
  `;
}

// Notes laid out on an axis where 1 semitone = 1 unit of width, so interval
// sizes are visually honest (a whole tone really does look twice as wide as
// a half tone) — labels the gap between each pair of *adjacent* scale
// degrees by default. `current` (when given) draws one accent arc per entry
// in current.arcs (the interval(s) actually being tested, revealed after
// answering) and highlights current.dots. Every dot is always clickable,
// independent of any active question: click two dots to hear that pair
// played and see its interval drawn as a second "explore" arc.
function fbRenderEarScaleDiagram(containerEl, scaleKey, current, subMode) {
  const { degrees, labels } = FB_EAR_SCALES[scaleKey];
  const s = fbState.ear[subMode];
  const UNIT = 34, PAD_L = 24, PAD_R = 24;
  const width = PAD_L + 12 * UNIT + PAD_R;
  const height = 140;
  const baseY = 70;
  const x = semi => PAD_L + semi * UNIT;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    svg.appendChild(el);
  };
  const text = (tx, ty, str, cls) => {
    const el = document.createElementNS(ns, 'text');
    el.setAttribute('x', tx); el.setAttribute('y', ty);
    el.setAttribute('class', cls);
    el.setAttribute('text-anchor', 'middle');
    el.textContent = str;
    svg.appendChild(el);
  };
  const circle = (cx, cy, r, cls) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('class', cls);
    svg.appendChild(el);
    return el;
  };
  const arc = (i, j, y, lineCls, labelCls) => {
    const xa = x(degrees[i]), xb = x(degrees[j]);
    line(xa, y, xb, y, lineCls);
    line(xa, y - 5, xa, y + 5, lineCls);
    line(xb, y - 5, xb, y + 5, lineCls);
    text((xa + xb) / 2, y - 8, fbEarIntervalName(degrees[j] - degrees[i]), labelCls);
  };

  line(x(0), baseY, x(12), baseY, 'fb-ear-tick-minor');
  for (let semi = 0; semi <= 12; semi++) {
    const onScale = degrees.includes(semi);
    line(x(semi), baseY - (onScale ? 10 : 5), x(semi), baseY + (onScale ? 10 : 5), onScale ? 'fb-ear-tick-major' : 'fb-ear-tick-minor');
  }

  for (let k = 0; k < degrees.length - 1; k++) {
    const xa = x(degrees[k]), xb = x(degrees[k + 1]), y = baseY + 22;
    line(xa, y, xb, y, 'fb-ear-adj-line');
    line(xa, y - 4, xa, y + 4, 'fb-ear-adj-line');
    line(xb, y - 4, xb, y + 4, 'fb-ear-adj-line');
    text((xa + xb) / 2, y + 14, fbEarIntervalName(degrees[k + 1] - degrees[k]), 'fb-ear-adj-label');
  }

  degrees.forEach((semi, idx) => {
    let cls = 'fb-ear-dot';
    if (current && current.dots && current.dots.includes(idx)) cls += ' highlight';
    if (s.exploreFirstIdx === idx) cls += ' armed';
    const dot = circle(x(semi), baseY, 9, cls);
    dot.addEventListener('click', () => fbEarDotClicked(subMode, idx));
    text(x(semi), baseY - 16, labels[idx], 'fb-ear-dot-label');
  });

  if (current && current.arcs) {
    current.arcs.forEach(({ i, j }) => arc(i, j, baseY - 26, 'fb-ear-highlight-line', 'fb-ear-highlight-label'));
  }
  if (s.exploreArc) {
    arc(s.exploreArc.i, s.exploreArc.j, baseY - 42, 'fb-ear-explore-line', 'fb-ear-explore-label');
  }

  containerEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fb-board fb-ear-diagram';
  wrap.appendChild(svg);
  containerEl.appendChild(wrap);
}

// Click-to-explore: first click arms a note (waiting for a second pick),
// second click plays that pair (in the order clicked — direction doesn't
// change the interval) and draws it as a blue arc. Purely exploratory, not
// part of question scoring, and works whether or not a question has been
// answered yet.
function fbEarDotClicked(subMode, idx) {
  const s = fbState.ear[subMode];
  if (s.exploreFirstIdx === null) {
    s.exploreFirstIdx = idx;
    fbEarRenderDiagramFor(subMode);
    return;
  }
  const first = s.exploreFirstIdx;
  s.exploreFirstIdx = null;
  if (first === idx) { fbEarRenderDiagramFor(subMode); return; }
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  fbEarPlayNotesFor(subMode, [first, idx].map(i => s.current.rootMidi + degrees[i]));
  s.exploreArc = { i: Math.min(first, idx), j: Math.max(first, idx) };
  fbEarRenderDiagramFor(subMode);
}

function fbEarRenderDiagramFor(subMode, current) {
  const s = fbState.ear[subMode];
  if (current !== undefined) s.diagramCurrent = current;
  const el = document.getElementById(`fb-ear-${subMode}-diagram`);
  if (!fbState.ear.showDiagram) { el.innerHTML = ''; return; }
  fbRenderEarScaleDiagram(el, fbState.ear.scale, s.diagramCurrent, subMode);
}

function fbEarRefreshDiagrams() {
  fbEarRenderDiagramFor('two');
  fbEarRenderDiagramFor('three');
}

// ── Ear Training per-interval stats ──────────────────────────────────────

const FB_EAR_STATS_KEY = 'fb_ear_stats';

function fbEarLoadStats() {
  try { fbState.ear.stats = JSON.parse(localStorage.getItem(FB_EAR_STATS_KEY)) || {}; }
  catch (_) { fbState.ear.stats = {}; }
}

function fbEarSaveStats() {
  localStorage.setItem(FB_EAR_STATS_KEY, JSON.stringify(fbState.ear.stats));
}

// ── Scale / mode switches ──────────────────────────────────────────────────

function fbEarSetScale(scale) {
  fbState.ear.scale = scale;
  fbPrefsSave();
  // Both submode panels exist in the DOM at once, so both need a fresh
  // question now.
  fbEarTwoNext();
  fbEarThreeNext();
}

function fbEarSetMode(mode) {
  fbState.ear.mode = mode;
  fbPrefsSave();
  document.querySelectorAll('#fb-ear-mode-tabs .fb-subtab').forEach(b => b.classList.toggle('active', b.dataset.earmode === mode));
  document.getElementById('fb-ear-two-panel').classList.toggle('hidden', mode !== 'two');
  document.getElementById('fb-ear-three-panel').classList.toggle('hidden', mode !== 'three');
}

function fbRenderEarStats(subMode) {
  const s = fbState.ear[subMode];
  // Per-interval weaknesses: show the 3 weakest intervals once we have enough data
  const weakList = Object.entries(fbState.ear.stats)
    .filter(([, v]) => v.presented >= 3)
    .sort(([, a], [, b]) => (a.correct / a.presented) - (b.correct / b.presented))
    .slice(0, 3)
    .map(([name, v]) => {
      const pct = Math.round(100 * v.correct / v.presented);
      const col = pct < 60 ? 'var(--danger)' : pct < 80 ? 'var(--warn)' : 'var(--primary)';
      return `<span style="color:${col}">${name} ${pct}%</span>`;
    });
  const weakLine = weakList.length
    ? `<span class="basis-full text-xs text-fg-faint">Weak: ${weakList.join(' · ')}</span>`
    : '';
  document.getElementById(`fb-ear-${subMode}-stats`).innerHTML = `
    <span class="fb-stat-ok">Correct <b>${s.correct}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
    ${weakLine}
  `;
}

// Cancels any pending auto-advance timer for a submode — needed whenever a
// fresh question is generated some other way (manual Next, changing the
// scale) so the old timer doesn't also fire later and skip a question.
function fbEarClearTimeout(subMode) {
  const s = fbState.ear[subMode];
  if (s.timeoutId) { clearTimeout(s.timeoutId); s.timeoutId = null; }
}

function fbEarSetAutoAdvance(checked) {
  fbState.ear.autoAdvance = checked;
  fbPrefsSave();
  // A timer scheduled before this toggle flipped off would otherwise still
  // fire later and silently skip whatever question the player is looking at.
  if (!checked) { fbEarClearTimeout('two'); fbEarClearTimeout('three'); }
}

function fbEarManualNext(subMode) {
  fbEarClearTimeout(subMode);
  if (subMode === 'two') fbEarTwoNext(); else fbEarThreeNext();
  fbEarPlayCurrent(subMode);
}

// fbState.ear.direction controls whether questions play low-to-high,
// high-to-low, or (default) a random mix of both every time.
function fbEarPickOrder(ascOrder, descOrder) {
  const dir = fbState.ear.direction;
  if (dir === 'asc') return ascOrder;
  if (dir === 'desc') return descOrder;
  return Math.random() < 0.5 ? descOrder : ascOrder;
}

// Weighted pair selection: all pairs have at least 10% chance even if perfect,
// and weak intervals are up-weighted by (1 – accuracy). Falls back to uniform
// random when no stats exist or practiceMode is 'all'.
function fbEarPickPair(degrees) {
  const pairs = [];
  for (let a = 0; a < degrees.length; a++) {
    for (let b = a + 1; b < degrees.length; b++) {
      pairs.push([a, b]);
    }
  }
  if (fbState.ear.practiceMode !== 'weak') {
    return pairs[Math.floor(Math.random() * pairs.length)];
  }
  // Weighted selection
  const weights = pairs.map(([a, b]) => {
    const name = fbEarIntervalName(degrees[b] - degrees[a]);
    const st = fbState.ear.stats[name];
    const acc = st && st.presented > 0 ? st.correct / st.presented : 0.5;
    return Math.max(0.1, 1 - acc);  // floor at 0.1 so perfect intervals still appear
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let k = 0; k < pairs.length; k++) {
    r -= weights[k];
    if (r <= 0) return pairs[k];
  }
  return pairs[pairs.length - 1];
}

function fbEarTwoNext() {
  const s = fbState.ear.two;
  fbEarClearTimeout('two');
  s.answered = false;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const [i, j] = fbEarPickPair(degrees);
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  // i/j stay low-to-high (for the diagram and interval math); `order` is the
  // actual playback/reveal direction, which is independent — an interval
  // sounds the same size whether it's played ascending or descending.
  const order = fbEarPickOrder([i, j], [j, i]);
  s.current = { i, j, order, rootMidi, notes: order.map(idx => rootMidi + degrees[idx]), interval: degrees[j] - degrees[i] };

  fbRenderEarStats('two');
  document.getElementById('fb-ear-two-prompt').textContent = 'Listen — what interval spans the two notes?';
  document.getElementById('fb-ear-two-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarTwoAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbEarRenderDiagramFor('two', null);
}

function fbEarTwoAnswer(name, btnEl) {
  const s = fbState.ear.two;
  if (s.answered) return;
  s.answered = true;
  s.total++;
  const target = fbEarIntervalName(s.current.interval);
  const correct = name === target;
  if (correct) { s.correct++; s.streak++; } else { s.streak = 0; }
  btnEl.classList.add(correct ? 'correct' : 'wrong');
  // Per-interval accuracy tracking
  const st = fbState.ear.stats[target] || (fbState.ear.stats[target] = { presented: 0, correct: 0 });
  st.presented++;
  if (correct) st.correct++;
  fbEarSaveStats();

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const hint = FB_EAR_INTERVAL_HINTS[target] ? ` — like "${FB_EAR_INTERVAL_HINTS[target]}"` : '';
  const fb = document.getElementById('fb-ear-two-feedback');
  fb.textContent = correct ? `Correct — ${target} (${noteDesc})${hint}` : `${target} (${noteDesc}) — you said ${name}${hint}`;
  fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
  fbRenderEarStats('two');
  fbEarRenderDiagramFor('two', { dots: [s.current.i, s.current.j], arcs: [{ i: s.current.i, j: s.current.j }] });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarTwoNext, correct ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// 3-note drill: asks the two *adjacent* intervals (1st-2nd, 2nd-3rd) rather
// than the outer 1st-3rd span, so the middle note is a real quiz target
// instead of just a passing tone — one question, answered in two steps.
function fbEarThreeNext() {
  const s = fbState.ear.three;
  fbEarClearTimeout('three');
  s.answered = false;
  s.step = 1;
  s.step1Correct = null;
  s.exploreFirstIdx = null;
  s.exploreArc = null;
  s.playingUntil = 0;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  let idxs;
  do {
    idxs = [Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length), Math.floor(Math.random() * degrees.length)];
  } while (new Set(idxs).size < 3);
  idxs.sort((a, b) => a - b);
  const [i, mid, j] = idxs;
  const rootMidi = FB_EAR_RANGE_BASE[fbState.ear.range] + Math.floor(Math.random() * 12);
  const order = fbEarPickOrder([i, mid, j], [j, mid, i]);
  const [interval1, interval2] = fbEarAdjacentIntervals(degrees, order);
  s.current = { i, mid, j, order, rootMidi, interval1, interval2, notes: order.map(idx => rootMidi + degrees[idx]) };

  fbRenderEarStats('three');
  fbEarRenderThreeStep();
  fbEarRenderDiagramFor('three', null);
}

function fbEarRenderThreeStep() {
  const s = fbState.ear.three;
  const degrees = FB_EAR_SCALES[fbState.ear.scale].degrees;
  const stepLabel = s.step === 1 ? '1st and 2nd' : '2nd and 3rd';
  document.getElementById('fb-ear-three-prompt').textContent = `Listen — what interval spans the ${stepLabel} notes?`;
  document.getElementById('fb-ear-three-answers').innerHTML =
    fbEarPossibleIntervals(degrees).map(name => `<button class="fb-answer-btn" onclick="fbEarThreeAnswer('${name}', this)">${name}</button>`).join('');
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
}

function fbEarThreeAnswer(name, btnEl) {
  const s = fbState.ear.three;
  if (s.answered) return;
  const target = s.step === 1 ? s.current.interval1 : s.current.interval2;
  const correct = name === fbEarIntervalName(target);
  btnEl.classList.add(correct ? 'correct' : 'wrong');

  if (s.step === 1) {
    s.step1Correct = correct;
    const targetName = fbEarIntervalName(target);
    const hint1 = FB_EAR_INTERVAL_HINTS[targetName] ? ` — like "${FB_EAR_INTERVAL_HINTS[targetName]}"` : '';
    const fb = document.getElementById('fb-ear-three-feedback');
    fb.textContent = correct ? `Correct — ${targetName}${hint1}` : `${targetName} — you said ${name}${hint1}`;
    fb.className = 'fb-feedback ' + (correct ? 'ok' : 'err');
    setTimeout(() => { s.step = 2; fbEarRenderThreeStep(); }, 900);
    return;
  }

  s.answered = true;
  s.total++;
  const overallCorrect = s.step1Correct && correct;
  if (overallCorrect) { s.correct++; s.streak++; } else { s.streak = 0; }

  const labels = FB_EAR_SCALES[fbState.ear.scale].labels;
  const noteDesc = s.current.order.map(idx => labels[idx]).join(' → ');
  const int1 = fbEarIntervalName(s.current.interval1), int2 = fbEarIntervalName(s.current.interval2);
  const hint2 = FB_EAR_INTERVAL_HINTS[int2] ? ` — like "${FB_EAR_INTERVAL_HINTS[int2]}"` : '';
  const fb = document.getElementById('fb-ear-three-feedback');
  fb.textContent = overallCorrect
    ? `Correct — ${int1} then ${int2} (${noteDesc})${hint2}`
    : `${int1} then ${int2} (${noteDesc}) — you said ${name}${hint2}`;
  fb.className = 'fb-feedback ' + (overallCorrect ? 'ok' : 'err');
  fbRenderEarStats('three');
  fbEarRenderDiagramFor('three', {
    dots: [s.current.i, s.current.mid, s.current.j],
    arcs: [{ i: s.current.i, j: s.current.mid }, { i: s.current.mid, j: s.current.j }],
  });
  if (fbState.ear.autoAdvance) {
    s.timeoutId = setTimeout(fbEarThreeNext, overallCorrect ? 900 : fbState.ear.wrongPauseSec * 1000);
  }
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_INTERVAL_NAMES, FB_EAR_SCALES, FB_EAR_INTERVAL_HINTS, FB_EAR_RANGE_BASE, FB_EAR_RANGE_LABELS, fbEarIntervalName,
    fbEarPossibleIntervals, fbEarAdjacentIntervals, fbEarAudioCtx, fbEarGetAudioCtx, fbEarPlaySequence, fbEarPlayNotesFor,
    fbEarPlayCurrent, fbEarPlayScaffold, fbRenderEarOptions, fbRenderEarScaleDiagram, fbEarDotClicked, fbEarRenderDiagramFor,
    fbEarRefreshDiagrams, FB_EAR_STATS_KEY, fbEarLoadStats, fbEarSaveStats, fbEarSetScale, fbEarSetMode,
    fbRenderEarStats, fbEarClearTimeout, fbEarSetAutoAdvance, fbEarManualNext, fbEarPickOrder, fbEarPickPair,
    fbEarTwoNext, fbEarTwoAnswer, fbEarThreeNext, fbEarRenderThreeStep, fbEarThreeAnswer,
  };
}
