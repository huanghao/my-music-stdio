// ── Chord ID: reverse-lookup a chord shape you clicked on the fretboard into
// a chord name, then string several identified chords into a progression and
// get roman-numeral / functional-harmony analysis. A Fretboard sub-tab (see
// index.html's fb-tabs / fb-panel wiring) — shares fbState's global scope
// like every other fb* module, prefixed `fbCid` to stay collision-free.
//
// Deliberately self-contained: reuses fretboard.js's FB_CHORD_QUALITIES /
// FB_NOTE_NAMES / FB_STRING_OPEN / fbChordDisplaySymbol (loaded first, same
// script-scope trick progression-lab.js already relies on), but defines its
// own roman-numeral reference table (FB_CID_DEGREE_OFFSET) rather than
// reusing progression-lab.js's PL_MAJOR_SCALE_OFFSETS — this feature doesn't
// need the rest of that file (bar-weight parsing, playback), so pulling it
// in as a dependency would just be extra coupling for one constant.

// ── State ──
fbState.chordId = {
  input: ['x', 'x', 'x', 'x', 'x', 'x'],   // per string (low E..high e), 'x' or fret 0-24
  forceRootPc: null,   // user-clarified root override (cleared whenever input changes)
  forceQuality: null,  // user-clarified quality override
  bassClarifyChoice: null, // null | 'yes' | 'no' — whether the lowest sounding note was confirmed as root
  selected: null,      // { rootPc, quality } pre-picked from the candidate list before "+ 加入进行" (optional)
  // progression: [{ candidates, chosenIdx, locked, input }]. A shape you're
  // not sure about yet can still be added — `locked:false` means "figure
  // this one out from the key + the rest of the progression" (see
  // fbCidResolveProgression), `locked:true` means you (or an earlier
  // clarify) already pinned it down. `input` is the fret shape you actually
  // clicked, kept around so the progression can redraw the diagram you
  // fretted rather than just the resolved chord's name.
  chords: [],
  breaks: [],          // length chords.length-1; breaks[i] = true => bar break between chord i and i+1
  // What "+ 加入进行" does next: null = append a new chord at the end;
  // { mode: 'edit', idx } = replace chords[idx] in place (fbCidStartEdit);
  // { mode: 'insert', idx } = splice a new chord in before chords[idx]
  // (fbCidStartInsert). Set/cleared together with the grid input.
  pending: null,
  keyMode: 'auto',      // 'auto' | 'manual'
  manualTonicPc: 0,
  manualIsMinor: false,
};

// ── Pitch-class extraction from the clicked grid ──

function fbCidPitchClasses(input) {
  const pcs = [];
  let bassPc = null;
  for (let i = 0; i < 6; i++) {
    if (input[i] === 'x') continue;
    const pc = (FB_STRING_OPEN[i] + input[i]) % 12;
    pcs.push(pc);
    if (bassPc === null) bassPc = pc; // string 0 = low E; first non-muted string is the sounding bass note
  }
  return { pcSet: new Set(pcs), bassPc };
}

// ── Candidate matching: for every possible root (0-11) and every known
// quality, keep it if the played pitch classes are a SUBSET of that chord's
// full tone set — i.e. "the notes you played could be this chord with some
// tones omitted". Ranked so that: a candidate whose root you actually played
// beats one where the root is only implied; among those, fewer omitted notes
// beats more; among ties, fewer total chord tones (simpler chord) beats more;
// remaining ties fall back to a fixed "common chords first" order. ──

const FB_CID_QUALITY_PRIORITY = [
  '', 'm', '7', 'maj7', 'm7', 'sus4', 'sus2', '6', 'm6', 'add9', 'madd9',
  'dim', 'aug', 'dim7', 'm7b5', '9', 'm9', 'maj9', '7sus4', '6/9', 'mmaj7', '7b9', '7#9',
];

function fbCidCandidates(pcSet) {
  const played = [...pcSet];
  if (!played.length) return [];
  const out = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    Object.keys(FB_CHORD_QUALITIES).forEach(quality => {
      const intervals = FB_CHORD_QUALITIES[quality];
      const fullPcs = intervals.map(iv => (rootPc + iv) % 12);
      const fullSet = new Set(fullPcs);
      if (!played.every(pc => fullSet.has(pc))) return;
      out.push({
        rootPc, quality,
        rootPresent: pcSet.has(rootPc),
        coverage: played.length / fullPcs.length,
        notesTotal: fullPcs.length,
        missing: fullPcs.filter(pc => !pcSet.has(pc)),
      });
    });
  }
  out.sort((a, b) =>
    (b.rootPresent - a.rootPresent) ||
    (b.coverage - a.coverage) ||
    (a.notesTotal - b.notesTotal) ||
    (FB_CID_QUALITY_PRIORITY.indexOf(a.quality) - FB_CID_QUALITY_PRIORITY.indexOf(b.quality))
  );
  return out;
}

// Translates a candidate's omitted pitch classes back into degree labels
// ("5th", "b7", ...) using the same formula tables fretboard.js's Chord
// Match already uses to describe a chord's own tones.
function fbCidMissingLabels(rootPc, quality, missingPcs) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const labels = FB_CHORD_DEGREE_LABELS[quality];
  return missingPcs.map(pc => {
    const offset = ((pc - rootPc) % 12 + 12) % 12;
    const idx = intervals.indexOf(offset);
    return idx >= 0 ? labels[idx] : '?';
  });
}

// Detects the two situations where the played notes genuinely don't
// determine a unique answer, so the UI can ask instead of silently guessing:
//  - `tooFew`: only one pitch class played (not even enough for a 3rd)
//  - `qualityAmbiguous`: root + 5th only (a "power chord") — major, minor,
//    sus2 and sus4 all match equally since none of them is contradicted
//  - `bassAmbiguous`: the best-ranked candidate's root isn't the lowest
//    note actually played (possible inversion / added bass note)
function fbCidComputeAmbiguity(pcSet, bassPc, candidates, s) {
  const played = [...pcSet];
  const tooFew = played.length <= 1;
  let qualityAmbiguous = null;
  if (!tooFew && s.forceQuality == null) {
    for (const rootPc of played) {
      const rest = played.filter(pc => pc !== rootPc).map(pc => ((pc - rootPc) % 12 + 12) % 12);
      if (rest.length === 1 && rest[0] === 7) { qualityAmbiguous = rootPc; break; }
    }
  }
  let bassAmbiguous = null;
  if (!tooFew && s.forceRootPc == null && s.bassClarifyChoice == null &&
      candidates.length && candidates[0].rootPc !== bassPc) {
    bassAmbiguous = bassPc;
  }
  return { tooFew, qualityAmbiguous, bassAmbiguous };
}

// ── Progression bar grouping (display only — see CLAUDE.md-adjacent design
// notes: a bar is either one whole-bar chord, two half-bar chords, or three
// chords split 2+1+1 beats. Harmonic analysis below works off the flat chord
// order and never needs these bar weights.) ──

function fbCidBarsFromChords(chords, breaks) {
  const bars = [];
  let cur = [];
  chords.forEach((ch, i) => {
    cur.push(ch);
    if (i === chords.length - 1 || breaks[i]) { bars.push(cur); cur = []; }
  });
  return bars;
}

function fbCidCanMergeAt(chords, breaks, i) {
  const trial = breaks.slice();
  trial[i] = false;
  return fbCidBarsFromChords(chords, trial).every(b => b.length <= 3);
}

// Computes the new `breaks` array for inserting a chord before position
// `idx` (0..chords.length, pre-insert). The boundary that idx splits (if
// any) is forced to `true` on both sides — the inserted chord always starts
// its own bar — while every boundary NOT touched by the insertion is left
// exactly as it was. Also covers plain append for free: idx === chords.length
// degenerates to "push a new trailing true", same as the old dedicated code.
function fbCidBreaksAfterInsert(breaks, idx) {
  const out = breaks.slice();
  if (idx > 0 && idx <= out.length) out[idx - 1] = true; // old boundary at idx-1 now separates the previous chord from the new one
  out.splice(idx, 0, true); // new boundary between the inserted chord and whatever now follows it
  return out;
}

// ── Key inference: score every (tonic, major/minor) pair by how many played
// chord roots land on that key's diatonic scale degrees (+1 more if the
// chord's own major/minor/dim quality also matches what that degree expects
// natively). Picking the best-scoring key this way needs no separate
// "circle of fifths" table — it falls straight out of comparing 24
// candidates. ──

const FB_CID_MAJOR_DIATONIC = { 0: '', 2: 'm', 4: 'm', 5: '', 7: '', 9: 'm', 11: 'dim' };
const FB_CID_MINOR_DIATONIC = { 0: 'm', 2: 'dim', 3: '', 5: 'm', 7: 'm', 8: '', 10: '' };

function fbCidQualityFamily(quality) {
  if (['m', 'm7', 'm6', 'madd9', 'm9', 'mmaj7'].includes(quality)) return 'm';
  if (['dim', 'dim7', 'm7b5'].includes(quality)) return 'dim';
  return '';
}

function fbCidScoreKey(chords, tonicPc, isMinor) {
  const table = isMinor ? FB_CID_MINOR_DIATONIC : FB_CID_MAJOR_DIATONIC;
  let score = 0;
  chords.forEach(ch => {
    const offset = ((ch.rootPc - tonicPc) % 12 + 12) % 12;
    if (offset in table) {
      score += 2;
      if (fbCidQualityFamily(ch.quality) === table[offset]) score += 1;
    }
  });
  // A relative-major/relative-minor pair (e.g. C major vs A minor) scores
  // identically on pitch content alone — break that tie the way ears do:
  // a progression usually starts and/or ends on its tonic.
  if (chords[0].rootPc === tonicPc) score += 2;
  if (chords[chords.length - 1].rootPc === tonicPc) score += 2;
  return score;
}

function fbCidInferKey(chords) {
  let best = { tonicPc: 0, isMinor: false, score: -1 };
  for (let t = 0; t < 12; t++) {
    [false, true].forEach(isMinor => {
      const score = fbCidScoreKey(chords, t, isMinor);
      // tie-break: prefer major over minor (more common), otherwise first found (lowest tonicPc) wins
      if (score > best.score || (score === best.score && !isMinor && best.isMinor)) {
        best = { tonicPc: t, isMinor, score };
      }
    });
  }
  return best;
}

// A progression slot's "best guess so far": your explicit pick if you made
// one (locked), otherwise whatever the shape-matcher ranked first.
function fbCidRepresentativeChord(slot) {
  if (!slot || !slot.candidates || !slot.candidates.length) return null;
  if (slot.chosenIdx != null && slot.candidates[slot.chosenIdx]) return slot.candidates[slot.chosenIdx];
  return slot.candidates[0];
}

// Resolves every un-locked progression slot using the *rest of the
// progression plus the key*: infers the key from each slot's current best
// guess, then re-picks every un-locked slot's candidate to whichever one
// fits that key best (falling back to the shape-matcher's own ranking as a
// tie-break) — this is the "you tell me the chords and the key, I'll work
// out the harmony" pass. Locked slots (either you picked one, or a clarify
// question pinned it down) are never touched. Safe to call repeatedly —
// idempotent given the same locked choices and key.
function fbCidResolveProgression(chords, keyMode, manualTonicPc, manualIsMinor) {
  if (!chords.length) return { key: { tonicPc: 0, isMinor: false }, inferred: { tonicPc: 0, isMinor: false } };
  const repChords = chords.map(fbCidRepresentativeChord).filter(Boolean).map(c => ({ rootPc: c.rootPc, quality: c.quality }));
  const inferred = fbCidInferKey(repChords.length ? repChords : [{ rootPc: 0, quality: '' }]);
  const key = keyMode === 'manual' ? { tonicPc: manualTonicPc, isMinor: manualIsMinor } : inferred;
  chords.forEach(slot => {
    if (slot.locked || !slot.candidates || !slot.candidates.length) return;
    let bestIdx = 0, bestScore = -Infinity;
    slot.candidates.forEach((c, idx) => {
      const fit = fbCidScoreKey([{ rootPc: c.rootPc, quality: c.quality }], key.tonicPc, key.isMinor);
      const score = fit * 10 - idx; // key fit dominates; original rank breaks remaining ties
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    slot.chosenIdx = bestIdx;
  });
  return { key, inferred };
}

// ── Roman-numeral labeling. Reference frame: degree 1-7 sit at semitone
// offsets [0,2,4,5,7,9,11] from the tonic (the major scale), same convention
// progression-lab.js uses — a minor key's chords are just expressed with
// accidentals against that same frame (e.g. natural minor's III is "bIII"
// here), so one table covers both modes. ──

const FB_CID_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const FB_CID_DEGREE_OFFSET = [0, 2, 4, 5, 7, 9, 11];
// native quality family of each degree in a plain major key — used to decide
// upper/lower case for *diatonic* display, and for the same-function-group
// suggestions ('' = major-ish, 'm' = minor, 'dim' = diminished)
const FB_CID_DIATONIC_FAMILY = ['', 'm', 'm', '', '', 'm', 'dim'];
const FB_CID_FUNCTION = ['T', 'S', 'T', 'S', 'D', 'T', 'D'];
const FB_CID_MINOR_FAMILY_QUALITIES = new Set(['m', 'm7', 'm6', 'madd9', 'm9', 'mmaj7']);
const FB_CID_DIM_FAMILY_QUALITIES = new Set(['dim', 'dim7', 'm7b5']);
// extension suffix per quality for roman-numeral display (case already
// carries major/minor, so unlike FB_CHORD_NOTATION_STYLES this omits the
// leading "m"/"-")
const FB_CID_ROMAN_SUFFIX = {
  '': '', m: '', maj7: 'maj7', '7': '7', m7: '7', dim7: '°7', m7b5: 'ø7', sus2: 'sus2', sus4: 'sus4',
  '6': '6', m6: '6', add9: 'add9', madd9: 'add9', '9': '9', m9: '9', maj9: 'maj9',
  dim: '°', aug: '+', '7sus4': '7sus4', '6/9': '6/9', mmaj7: '(maj7)', '7b9': '7b9', '7#9': '7#9',
};

function fbCidDegreeAndAccidental(offset) {
  for (const acc of [0, -1, 1]) { // prefer natural, then flat (bII/bIII/bVI/bVII borrowed-chord convention), then sharp
    for (let d = 0; d < 7; d++) {
      if (((FB_CID_DEGREE_OFFSET[d] + acc) % 12 + 12) % 12 === offset) return { degreeIdx: d, accidental: acc };
    }
  }
  return { degreeIdx: 0, accidental: 0 }; // unreachable — every offset 0-11 is covered above
}

function fbCidDegreeLabel(d) {
  const fam = FB_CID_DIATONIC_FAMILY[d];
  return fam ? FB_CID_ROMAN[d].toLowerCase() + (fam === 'dim' ? '°' : '') : FB_CID_ROMAN[d];
}

function fbCidRomanForChord(rootPc, quality, tonicPc) {
  const offset = ((rootPc - tonicPc) % 12 + 12) % 12;
  const { degreeIdx, accidental } = fbCidDegreeAndAccidental(offset);
  // "Diatonic" here means both the root's scale position AND the chord's
  // own major/minor/dim family match what that degree naturally is —
  // a root that sits on scale degree vi but is voiced as a major/dominant
  // chord (e.g. A7 in the key of C) is not really "VI7", it's borrowed/
  // functioning as a secondary dominant, even though its root is a
  // in-scale note.
  const isDiatonic = accidental === 0 && fbCidQualityFamily(quality) === FB_CID_DIATONIC_FAMILY[degreeIdx];

  // Secondary dominant: a non-diatonic dominant-family chord a 5th above
  // another scale degree resolves to (and is notated relative to) that
  // degree — "A7" in C is "V7/ii" (resolves to Dm), not "VI7".
  if (!isDiatonic && ['7', '9', '7b9', '7#9'].includes(quality)) {
    const targetOffset = (offset + 5) % 12;
    const td = FB_CID_DEGREE_OFFSET.indexOf(targetOffset);
    if (td !== -1) {
      const secondaryOf = fbCidDegreeLabel(td);
      return { label: 'V' + (FB_CID_ROMAN_SUFFIX[quality] || '') + '/' + secondaryOf, degreeIdx, accidental, functionGroup: null, secondaryOf };
    }
  }

  const isMinorFam = FB_CID_MINOR_FAMILY_QUALITIES.has(quality);
  const isDimFam = FB_CID_DIM_FAMILY_QUALITIES.has(quality);
  let numeral = FB_CID_ROMAN[degreeIdx];
  if (isMinorFam || isDimFam) numeral = numeral.toLowerCase();
  const prefix = accidental === -1 ? 'b' : accidental === 1 ? '#' : '';
  const label = prefix + numeral + (FB_CID_ROMAN_SUFFIX[quality] || '');
  return { label, degreeIdx, accidental, functionGroup: isDiatonic ? FB_CID_FUNCTION[degreeIdx] : null, secondaryOf: null };
}

// ── Cadence detection: scan the resolved roman numerals for the handful of
// standard closing patterns — purely a pattern match on degree numbers,
// only counts a pair/triple when every chord involved is diatonic. ──

function fbCidDetectCadences(roman) {
  const out = [];
  for (let i = 0; i < roman.length - 1; i++) {
    const a = roman[i], b = roman[i + 1];
    if (a.accidental === 0 && b.accidental === 0) {
      if (a.degreeIdx === 4 && b.degreeIdx === 0) out.push({ type: '正格终止 V→I', at: i, span: 2 });
      else if (a.degreeIdx === 3 && b.degreeIdx === 0) out.push({ type: '变格终止 IV→I', at: i, span: 2 });
    }
    if (i < roman.length - 2) {
      const c = roman[i + 2];
      if (a.accidental === 0 && b.accidental === 0 && c.accidental === 0 &&
          a.degreeIdx === 1 && b.degreeIdx === 4 && c.degreeIdx === 0) {
        out.push({ type: 'ii-V-I', at: i, span: 3 });
      }
    }
  }
  return out;
}

// ── Same-function-group substitution suggestions (docs/chord-progressions-guide.md
// §3): at most one line per function group actually present in the
// progression, naming the group's other diatonic member(s). ──

const FB_CID_FUNCTION_GROUPS = { T: [0, 5, 2], S: [3, 1], D: [4, 6] };
const FB_CID_FUNCTION_LABEL = { T: '主 T', S: '下属 S', D: '属 D' };

function fbCidSuggestAlts(roman) {
  const present = new Set();
  roman.forEach(r => { if (r.accidental === 0) present.add(r.degreeIdx); });
  const out = [];
  ['T', 'S', 'D'].forEach(fn => {
    const group = FB_CID_FUNCTION_GROUPS[fn];
    const inProg = group.filter(d => present.has(d));
    if (!inProg.length) return;
    const alts = group.filter(d => d !== inProg[0]);
    if (alts.length) out.push({ fn, anchor: inProg[0], alts });
  });
  return out;
}

// ── Input mutation ──

function fbCidResetClarify() {
  const s = fbState.chordId;
  s.forceRootPc = null;
  s.forceQuality = null;
  s.bassClarifyChoice = null;
  s.selected = null;
}

function fbCidSetFret(stringIdx, fret) {
  const s = fbState.chordId;
  s.input[stringIdx] = (s.input[stringIdx] === fret) ? 'x' : fret;
  fbCidResetClarify();
  fbCidRenderAll();
}

function fbCidToggleMute(stringIdx) {
  const s = fbState.chordId;
  s.input[stringIdx] = (s.input[stringIdx] === 'x') ? 0 : 'x';
  fbCidResetClarify();
  fbCidRenderAll();
}

function fbCidClearInput() {
  fbState.chordId.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  fbCidResetClarify();
  fbCidRenderAll();
}

function fbCidScrollToGrid() {
  const grid = document.getElementById('cid-grid');
  if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Loads an existing progression chord's fretted shape back into the grid so
// it can be re-fretted or re-picked — "+ 加入进行" becomes "update this
// chord" instead of appending a new one (see fbCidAddToProgression) until
// fbCidCancelPending or a successful update clears s.pending.
function fbCidStartEdit(i) {
  const s = fbState.chordId;
  const slot = s.chords[i];
  if (!slot) return;
  fbCidResetClarify();
  s.input = slot.input.slice();
  s.pending = { mode: 'edit', idx: i };
  const resolved = fbCidRepresentativeChord(slot);
  if (resolved) s.selected = { rootPc: resolved.rootPc, quality: resolved.quality };
  fbCidRenderAll();
  fbCidScrollToGrid();
}

// Starts a fresh (blank) shape that will be spliced in before chords[i] —
// "+ 加入进行" becomes "insert here" instead of appending at the end.
function fbCidStartInsert(i) {
  const s = fbState.chordId;
  fbCidResetClarify();
  s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  s.pending = { mode: 'insert', idx: i };
  fbCidRenderAll();
  fbCidScrollToGrid();
}

function fbCidCancelPending() {
  const s = fbState.chordId;
  s.pending = null;
  s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  fbCidResetClarify();
  fbCidRenderAll();
}

function fbCidClarifyQuality(rootPc, quality) {
  const s = fbState.chordId;
  s.forceRootPc = rootPc;
  s.forceQuality = quality;
  s.bassClarifyChoice = 'yes';
  fbCidRenderAll();
}

function fbCidClarifyBass(isRoot) {
  const s = fbState.chordId;
  s.bassClarifyChoice = isRoot ? 'yes' : 'no';
  if (isRoot) s.forceRootPc = s._lastBassPc;
  fbCidRenderAll();
}

function fbCidSelectCandidate(rootPc, quality) {
  fbState.chordId.selected = { rootPc, quality };
  fbCidRenderCandidates();
}

// ── Progression mutation ──

// Builds a progression slot from whatever's currently on the grid, or
// returns null if nothing's been played. If you pre-picked a candidate (via
// fbCidSelectCandidate) that pick is locked in; otherwise the slot is left
// unresolved for fbCidResolveProgression to work out later from the key +
// the rest of the progression.
function fbCidBuildSlotFromInput() {
  const s = fbState.chordId;
  const { pcSet } = fbCidPitchClasses(s.input);
  if (!pcSet.size) return null;

  let candidates = fbCidCandidates(pcSet);
  if (s.forceRootPc != null) candidates = candidates.filter(c => c.rootPc === s.forceRootPc);
  if (s.forceQuality != null) candidates = candidates.filter(c => c.quality === s.forceQuality);
  if (!candidates.length) candidates = fbCidCandidates(pcSet);
  candidates = candidates.slice(0, 6);

  let chosenIdx = null, locked = false;
  if (s.selected) {
    const idx = candidates.findIndex(c => c.rootPc === s.selected.rootPc && c.quality === s.selected.quality);
    if (idx !== -1) { chosenIdx = idx; locked = true; }
  }
  return { candidates, chosenIdx, locked, input: s.input.slice() };
}

// Appends the current grid shape as a new progression slot — or, per
// s.pending (see fbCidStartEdit/fbCidStartInsert), replaces an existing slot
// in place or splices a new one in at a specific position instead.
function fbCidAddToProgression() {
  const s = fbState.chordId;
  const slot = fbCidBuildSlotFromInput();
  if (!slot) return;

  if (s.pending && s.pending.mode === 'edit' && s.chords[s.pending.idx]) {
    s.chords[s.pending.idx] = slot;
  } else if (s.pending && s.pending.mode === 'insert' && s.pending.idx >= 0 && s.pending.idx <= s.chords.length) {
    const idx = s.pending.idx;
    s.chords.splice(idx, 0, slot);
    s.breaks = fbCidBreaksAfterInsert(s.breaks, idx);
  } else {
    s.chords.push(slot);
    if (s.chords.length > 1) s.breaks.push(true);
  }
  s.pending = null;
  s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  fbCidResetClarify();
  fbCidRenderAll();
}
fbCidAddToProgression = guarded(fbCidAddToProgression);

function fbCidRemoveChord(i) {
  const s = fbState.chordId;
  s.chords.splice(i, 1);
  if (i === 0) s.breaks.shift();
  else s.breaks.splice(i - 1, 1);
  if (s.pending) {
    if (s.pending.mode === 'edit' && s.pending.idx === i) { fbCidCancelPending(); return; } // the slot being edited no longer exists
    if (s.pending.idx > i) s.pending.idx -= 1; // keep pointing at the same logical position
  }
  fbCidRenderAll();
}

// Swaps two adjacent chords — bar boundaries are positional (see
// fbCidBarsFromChords), so `breaks` doesn't need touching, only the chords
// themselves move. Cancels any in-progress edit/insert to avoid it silently
// pointing at the wrong (now-shifted) slot.
function fbCidMoveChord(i, dir) {
  const s = fbState.chordId;
  const j = i + dir;
  if (j < 0 || j >= s.chords.length) return;
  [s.chords[i], s.chords[j]] = [s.chords[j], s.chords[i]];
  if (s.pending) { s.pending = null; s.input = ['x', 'x', 'x', 'x', 'x', 'x']; fbCidResetClarify(); }
  fbCidRenderAll();
}

function fbCidToggleBreak(i) {
  const s = fbState.chordId;
  if (s.breaks[i]) {
    s.breaks[i] = false;
  } else {
    if (!fbCidCanMergeAt(s.chords, s.breaks, i)) {
      const msg = document.getElementById('cid-bar-msg');
      if (msg) { msg.textContent = '一小节最多 3 个和弦'; setTimeout(() => { if (msg.textContent === '一小节最多 3 个和弦') msg.textContent = ''; }, 2000); }
      return;
    }
    s.breaks[i] = true;
  }
  fbCidRenderAll();
}

function fbCidClearProgression() {
  fbState.chordId.chords = [];
  fbState.chordId.breaks = [];
  fbState.chordId.pending = null;
  fbCidRenderAll();
}

function fbCidSetKeyMode(mode) {
  fbState.chordId.keyMode = mode;
  fbCidRenderAnalysis();
  fbCidPrefsSave();
}
function fbCidSetManualTonic(v) {
  fbState.chordId.manualTonicPc = +v;
  fbCidRenderAnalysis();
  fbCidPrefsSave();
}
function fbCidSetManualMode(v) {
  fbState.chordId.manualIsMinor = (v === '1');
  fbCidRenderAnalysis();
  fbCidPrefsSave();
}

// ── Rendering ──

// Standard fretboard inlay positions (single dot; 12 doubles up, like a real
// neck) — purely a visual landmark to count frets by at a glance, no effect
// on input.
const FB_CID_INLAY_FRETS = new Set([5, 7, 9, 12]);

function fbCidRenderGrid() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-grid');
  if (!el) return;
  const rowOrder = [5, 4, 3, 2, 1, 0]; // high e at top, low E at bottom — matches standard tab layout
  let html = '<div class="cid-grid-row cid-grid-header"><span class="cid-string-label"></span>';
  for (let f = 0; f <= 12; f++) {
    const inlay = FB_CID_INLAY_FRETS.has(f) ? ' cid-fret-inlay' : '';
    html += `<span class="cid-fret-head${inlay}">${f === 0 ? '○' : f}</span>`;
  }
  html += '</div>';
  rowOrder.forEach(i => {
    const muted = s.input[i] === 'x';
    html += `<div class="cid-grid-row"><span class="cid-string-label${muted ? ' muted' : ''}" onclick="fbCidToggleMute(${i})">${FB_STRING_NAMES[i]}${muted ? ' ✕' : ''}</span>`;
    for (let f = 0; f <= 12; f++) {
      const sel = !muted && s.input[i] === f;
      const inlay = FB_CID_INLAY_FRETS.has(f) ? ' cid-fret-inlay' : '';
      // the fretted note's own name, right on the cell — no need to cross-reference the "组成音" line to know what you just clicked
      const label = sel ? FB_NOTE_NAMES[(FB_STRING_OPEN[i] + f) % 12] : '';
      html += `<button type="button" class="cid-fret-cell${sel ? ' sel' : ''}${f === 0 ? ' cid-fret-open' : ''}${inlay}" onclick="fbCidSetFret(${i},${f})">${label}</button>`;
    }
    html += '</div>';
  });
  el.innerHTML = html;
}

// Converts an absolute fret-per-string input (this file's own format:
// 'x'/0-24 per string, low E first) into svguitar's finger list — a normal
// vertical chord-box diagram (strings vertical, frets horizontal, nut at
// top), the same convention fretboard.js's fbShapeToSvguitarChord draws for
// CAGED shapes. That function is keyed to *movable-shape* offsets though
// (relative to a barre position); this one is simpler because the input
// here is always already absolute frets.
//
// The window always starts at the nut (position 1) if any string is played
// open — an open string can only be drawn when the nut row is visible — or
// otherwise at the lowest fret actually played (svguitar then draws the
// usual "Nfr" position label), so a shape fretted entirely up at 7-8-9
// doesn't render as a mostly-empty diagram starting from fret 1.
function fbCidShapeToSvguitarChord(input) {
  const fretted = input.filter(v => typeof v === 'number' && v > 0);
  const hasOpen = input.some(v => v === 0);
  const position = (!hasOpen && fretted.length) ? Math.min(...fretted) : 1;

  const fingers = [];
  let maxRelFret = 1;
  for (let i = 0; i < 6; i++) {
    const svString = 6 - i; // low E (index 0) -> string 6, high e (index 5) -> string 1
    const v = input[i];
    if (v === 'x') { fingers.push([svString, svguitar.SILENT]); continue; }
    if (v === 0) { fingers.push([svString, svguitar.OPEN]); continue; }
    const relFret = v - position + 1;
    fingers.push([svString, relFret, { color: '#4a7c4a' }]);
    if (relFret > maxRelFret) maxRelFret = relFret;
  }
  return { fingers, position, fretsToShow: Math.max(2, maxRelFret) };
}

// Draws the standard chord-box diagram for the shape you actually clicked
// into `containerEl` (a real DOM node — svguitar draws into it directly, so
// this can't be part of an innerHTML string like the rest of this file's
// rendering; callers insert a placeholder div first, see fbCidRenderProgression).
function fbCidRenderChordDiagram(containerEl, input) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fb-board fb-svguitar-box';
  containerEl.appendChild(box);
  const { fingers, position, fretsToShow } = fbCidShapeToSvguitarChord(input);
  new svguitar.SVGuitarChord(box)
    .configure({
      strings: 6, frets: fretsToShow,
      tuning: FB_STRING_NAMES,
      color: '#8a8578',
      fingerColor: '#4a7c4a',
      fingerTextColor: '#fff',
      barreChordStrokeWidth: 0,
      fretLabelFontSize: 32,
      tuningsFontSize: 24,
    })
    .chord({ fingers, barres: [], position })
    .draw();
}

// Shared "what's missing from this candidate" label, used both by the
// input-time candidate list and each progression card's re-pick row.
function fbCidCandidateNote(c) {
  if (!c.rootPresent) return '省略根音';
  return c.missing.length ? '省略 ' + fbCidMissingLabels(c.rootPc, c.quality, c.missing).join('、') : '完整';
}

function fbCidRenderCandidates() {
  const s = fbState.chordId;
  const bannerEl = document.getElementById('cid-edit-banner');
  const notesEl = document.getElementById('cid-notes');
  const clarifyEl = document.getElementById('cid-clarify');
  const listEl = document.getElementById('cid-candidate-list');
  const addBtn = document.getElementById('cid-add-btn');
  const cancelBtn = document.getElementById('cid-cancel-edit-btn');
  if (!notesEl || !clarifyEl || !listEl || !addBtn || !bannerEl || !cancelBtn) return;

  const editing = s.pending && s.pending.mode === 'edit' && s.chords[s.pending.idx];
  const inserting = s.pending && s.pending.mode === 'insert';
  bannerEl.textContent = editing ? `正在修改第 ${s.pending.idx + 1} 个和弦 — 重新点指板后点"更新"`
    : inserting ? `将插入为第 ${s.pending.idx + 1} 个和弦 — 点指板后点"插入到此处"`
    : '';
  addBtn.textContent = editing ? '✔ 更新' : inserting ? '✔ 插入到此处' : '+ 加入进行';
  cancelBtn.style.display = (editing || inserting) ? '' : 'none';

  const { pcSet, bassPc } = fbCidPitchClasses(s.input);
  s._lastBassPc = bassPc;

  if (!pcSet.size) {
    notesEl.textContent = '点指板输入音符';
  } else {
    notesEl.textContent = `组成音：${[...pcSet].map(pc => FB_NOTE_NAMES[pc]).join('  ')}（最低音：${FB_NOTE_NAMES[bassPc]}）`;
  }

  const allCandidates = fbCidCandidates(pcSet);
  const amb = fbCidComputeAmbiguity(pcSet, bassPc, allCandidates, s);

  let candidates = allCandidates;
  if (s.forceRootPc != null) candidates = candidates.filter(c => c.rootPc === s.forceRootPc);
  if (s.forceQuality != null) candidates = candidates.filter(c => c.quality === s.forceQuality);
  if (!candidates.length) candidates = allCandidates;

  let clarifyHtml = '';
  if (pcSet.size > 0 && amb.tooFew) {
    clarifyHtml = '<div class="cid-clarify">音符太少，至少按出根音 + 三音才能判断和弦性质</div>';
  } else if (amb.qualityAmbiguous != null) {
    const r = amb.qualityAmbiguous;
    clarifyHtml = `<div class="cid-clarify">⚠️ 只按出了根音和 5th，无法判断大三/小三/挂留，请确认：
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyQuality(${r},'')">大三</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyQuality(${r},'m')">小三</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyQuality(${r},'sus2')">sus2</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyQuality(${r},'sus4')">sus4</button></div>`;
  } else if (amb.bassAmbiguous != null && candidates.length) {
    clarifyHtml = `<div class="cid-clarify">最低音是 ${FB_NOTE_NAMES[bassPc]}，最像的候选根音是 ${FB_NOTE_NAMES[candidates[0].rootPc]}——最低音就是根音吗？
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyBass(true)">是根音</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidClarifyBass(false)">不是（转位/加了别的低音）</button></div>`;
  }
  clarifyEl.innerHTML = clarifyHtml;

  if (!candidates.length) {
    listEl.innerHTML = pcSet.size ? '<div class="cid-candidate-empty">没有匹配的和弦</div>' : '';
  } else {
    listEl.innerHTML = candidates.slice(0, 6).map(c => {
      const sel = s.selected && s.selected.rootPc === c.rootPc && s.selected.quality === c.quality;
      return `<button type="button" class="cid-candidate${sel ? ' sel' : ''}" onclick="fbCidSelectCandidate(${c.rootPc},'${c.quality}')">
        <span class="cid-candidate-name">${fbChordDisplaySymbol(c.rootPc, c.quality)}</span>
        <span class="cid-candidate-note">${fbCidCandidateNote(c)}</span>
      </button>`;
    }).join('');
  }

  addBtn.disabled = !pcSet.size;
}

// One progression entry: a compact tile — small diagram + resolved name,
// nothing else. Click it to reload its shape into the grid for correction
// (fbCidStartEdit); the always-visible candidate list this used to carry
// moved there too, since editing is now a deliberate action rather than a
// permanent fixture on every card (keeps ~10 chords visible without
// scrolling — see fbCidRenderProgression).
function fbCidRenderChordCard(slot, idx, total) {
  const resolved = fbCidRepresentativeChord(slot);
  const label = resolved ? fbChordDisplaySymbol(resolved.rootPc, resolved.quality) : '?';
  const title = slot.locked ? '你选定的读法 — 点击修改' : '还不确定，已按当前调号自动判断 — 点击修改';
  return `<div class="cid-prog-card${slot.locked ? '' : ' unresolved'}" onclick="fbCidStartEdit(${idx})" title="${title}">
      <button type="button" class="cid-prog-chip-ins" onclick="event.stopPropagation();fbCidStartInsert(${idx})" title="在此之前插入新和弦">+</button>
      <button type="button" class="cid-prog-chip-del" onclick="event.stopPropagation();fbCidRemoveChord(${idx})" title="删除">✕</button>
      <div class="cid-prog-card-diagram" id="cid-diagram-${idx}"></div>
      <span class="cid-prog-card-label">${label}${slot.locked ? '' : '<sup>?</sup>'}</span>
      <div class="cid-prog-card-moves">
        <button type="button" class="cid-move-btn" onclick="event.stopPropagation();fbCidMoveChord(${idx},-1)" ${idx === 0 ? 'disabled' : ''} title="左移">‹</button>
        <button type="button" class="cid-move-btn" onclick="event.stopPropagation();fbCidMoveChord(${idx},1)" ${idx === total - 1 ? 'disabled' : ''} title="右移">›</button>
      </div>
    </div>`;
}

function fbCidRenderProgression() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-progression');
  if (!el) return;
  if (!s.chords.length) { el.innerHTML = '<div class="cid-progression-empty">还没有加入和弦</div>'; return; }

  fbCidResolveProgression(s.chords, s.keyMode, s.manualTonicPc, s.manualIsMinor);

  // Bar-blocks flow left-to-right and wrap, like a real chord chart's
  // multiple-bars-per-line layout, rather than one bar per row — with tiny
  // diagrams a whole 10-chord progression fits without scrolling.
  const bars = fbCidBarsFromChords(s.chords, s.breaks);
  const total = s.chords.length;
  let idx = 0;
  let html = '<div class="cid-prog-flow">';
  bars.forEach((bar, bi) => {
    const beatNote = bar.length === 2 ? '各半小节' : bar.length === 3 ? '2+1+1 拍' : '整小节';
    html += `<div class="cid-bar-block" title="第 ${bi + 1} 小节 · ${beatNote}"><div class="cid-bar-cards">`;
    bar.forEach((slot, ci) => {
      const myIdx = idx;
      html += fbCidRenderChordCard(slot, myIdx, total);
      if (ci < bar.length - 1) html += `<button type="button" class="cid-bar-tie" onclick="fbCidToggleBreak(${myIdx})" title="这两个和弦同属一小节，点击拆分">拆分</button>`;
      idx++;
    });
    html += '</div></div>';
    if (bi < bars.length - 1) html += `<button type="button" class="cid-bar-break" onclick="fbCidToggleBreak(${idx - 1})" title="点击把相邻两个小节合并成一个">合并</button>`;
  });
  html += '</div>';
  el.innerHTML = html;

  // svguitar draws into real DOM nodes, so the diagrams can't be part of the
  // innerHTML string above — fill each placeholder now that it exists in the DOM.
  s.chords.forEach((slot, i) => fbCidRenderChordDiagram(document.getElementById('cid-diagram-' + i), slot.input));
}

function fbCidRenderAnalysis() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-analysis');
  if (!el) return;
  if (!s.chords.length) { el.innerHTML = ''; return; }

  const { key, inferred } = fbCidResolveProgression(s.chords, s.keyMode, s.manualTonicPc, s.manualIsMinor);
  const items = s.chords.map(slot => {
    const chord = fbCidRepresentativeChord(slot);
    return chord ? { slot, roman: fbCidRomanForChord(chord.rootPc, chord.quality, key.tonicPc) } : null;
  }).filter(Boolean);
  const roman = items.map(it => it.roman);
  const cadences = fbCidDetectCadences(roman);
  const suggestions = fbCidSuggestAlts(roman);

  const keyLabel = `${FB_NOTE_NAMES[inferred.tonicPc]} ${inferred.isMinor ? '小调' : '大调'}`;
  const keyRow = `<div class="cid-key-row">
    调号：
    <label><input type="radio" name="cid-keymode" ${s.keyMode === 'auto' ? 'checked' : ''} onchange="fbCidSetKeyMode('auto')"> 自动（${keyLabel}）</label>
    <label><input type="radio" name="cid-keymode" ${s.keyMode === 'manual' ? 'checked' : ''} onchange="fbCidSetKeyMode('manual')"> 手动</label>
    ${s.keyMode === 'manual' ? `
      <select onchange="fbCidSetManualTonic(this.value)">${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.manualTonicPc === i ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select onchange="fbCidSetManualMode(this.value)">
        <option value="0" ${!s.manualIsMinor ? 'selected' : ''}>大调</option>
        <option value="1" ${s.manualIsMinor ? 'selected' : ''}>小调</option>
      </select>` : ''}
  </div>`;

  const romanRow = `<div class="cid-roman-row">${items.map(it =>
    `<span class="cid-roman-chip fn-${it.roman.functionGroup || 'chromatic'}${it.slot.locked ? '' : ' unresolved'}">${it.roman.label}${it.slot.locked ? '' : '<sup>?</sup>'}</span>`
  ).join('')}</div>`;

  const fnLegend = `<div class="cid-fn-legend">
    <span class="fn-T">■ 主 T</span><span class="fn-S">■ 下属 S</span><span class="fn-D">■ 属 D</span><span class="fn-chromatic">■ 半音/离调</span>
  </div>`;

  const cadenceHtml = cadences.length
    ? `<ul class="cid-cadence-list">${cadences.map(c => `<li>第 ${c.at + 1}-${c.at + c.span} 个和弦：${c.type}</li>`).join('')}</ul>`
    : '';

  const sugHtml = suggestions.length
    ? `<ul class="cid-sug-list">${suggestions.map(sg =>
        `<li>${fbCidDegreeLabel(sg.anchor)}（${FB_CID_FUNCTION_LABEL[sg.fn]}）同组还有 ${sg.alts.map(fbCidDegreeLabel).join(' / ')}，可互换制造不同色彩</li>`
      ).join('')}</ul>`
    : '';

  el.innerHTML = keyRow + romanRow + fnLegend + cadenceHtml + sugHtml;
}

function fbCidRenderAll() {
  fbCidRenderGrid();
  fbCidRenderCandidates();
  fbCidRenderProgression();
  fbCidRenderAnalysis();
  fbCidPrefsSave();
}

// ── Persistence (see project CLAUDE.md: every user-facing option must
// survive a refresh) ──

const FB_CID_PREFS_KEY = 'fb_chordid_prefs';

const FB_CID_BLANK_INPUT = ['x', 'x', 'x', 'x', 'x', 'x'];
function fbCidValidInputArr(v) {
  return Array.isArray(v) && v.length === 6 && v.every(f => f === 'x' || (Number.isInteger(f) && f >= 0 && f <= 24));
}

function fbCidPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_CID_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  const s = fbState.chordId;
  if (fbCidValidInputArr(saved.input)) s.input = saved.input;
  const validChordRef = c => c && Number.isInteger(c.rootPc) && c.rootPc >= 0 && c.rootPc < 12 && FB_CHORD_QUALITIES[c.quality];
  if (Array.isArray(saved.chords)) {
    s.chords = saved.chords.map(c => {
      if (c && Array.isArray(c.candidates) && c.candidates.every(validChordRef)) {
        // current format
        const chosenIdx = Number.isInteger(c.chosenIdx) && c.candidates[c.chosenIdx] ? c.chosenIdx : null;
        const input = fbCidValidInputArr(c.input) ? c.input : FB_CID_BLANK_INPUT.slice();
        return { candidates: c.candidates, chosenIdx, locked: !!c.locked && chosenIdx != null, input };
      }
      if (validChordRef(c)) {
        // migrate pre-"unresolved slot" format: a bare {rootPc,quality} was always
        // locked, and predates per-slot diagrams — nothing to draw for it.
        return { candidates: [c], chosenIdx: 0, locked: true, input: FB_CID_BLANK_INPUT.slice() };
      }
      return null;
    }).filter(Boolean);
  }
  if (Array.isArray(saved.breaks) && saved.breaks.every(b => typeof b === 'boolean') &&
      saved.breaks.length === Math.max(0, s.chords.length - 1)) {
    s.breaks = saved.breaks;
  } else {
    s.breaks = s.chords.slice(1).map(() => true);
  }
  if (saved.keyMode === 'auto' || saved.keyMode === 'manual') s.keyMode = saved.keyMode;
  if (Number.isInteger(saved.manualTonicPc) && saved.manualTonicPc >= 0 && saved.manualTonicPc < 12) s.manualTonicPc = saved.manualTonicPc;
  if (typeof saved.manualIsMinor === 'boolean') s.manualIsMinor = saved.manualIsMinor;
}

function fbCidPrefsSave() {
  const s = fbState.chordId;
  localStorage.setItem(FB_CID_PREFS_KEY, JSON.stringify({
    input: s.input, chords: s.chords, breaks: s.breaks,
    keyMode: s.keyMode, manualTonicPc: s.manualTonicPc, manualIsMinor: s.manualIsMinor,
  }));
}

function fbCidInit() {
  fbCidPrefsLoad();
  fbCidRenderAll();
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fbCidPitchClasses, fbCidCandidates, fbCidMissingLabels, fbCidComputeAmbiguity,
    fbCidBarsFromChords, fbCidCanMergeAt, fbCidBreaksAfterInsert,
    fbCidInferKey, fbCidScoreKey,
    fbCidRepresentativeChord, fbCidResolveProgression,
    fbCidRomanForChord, fbCidDegreeLabel, fbCidDetectCadences, fbCidSuggestAlts,
  };
}
