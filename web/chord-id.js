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
  fretWindowStart: 0, // leftmost fret currently visible on the grid (see fbCidRenderGrid) — 0 = open position
  forceRootPc: null,   // user-clarified root override (cleared whenever input changes)
  forceQuality: null,  // user-clarified quality override
  bassClarifyChoice: null, // null | 'yes' | 'no' — whether the lowest sounding note was confirmed as root
  selected: null,      // { rootPc, quality } pre-picked from the candidate list before "+ 加入进行" (optional)
  // Multiple progression *lines* — for the common "mostly the same
  // progression, repeated with a small variation" case: duplicate a line
  // (fbCidDuplicateLine) and only touch the handful of chords that actually
  // differ, instead of rebuilding the whole thing from scratch.
  //
  // Each line is { measures, baseline }. `measures` is an array of 4-beat
  // measures — always real, always-visible boxes, never an inferred
  // grouping. Each measure is a fixed-length-4 array of beat slots:
  //   null       — empty beat, click it to place a chord there
  //   'occupied' — continuation of the chord starting at an earlier slot
  //   slot object — { candidates, chosenIdx, locked, input, span }
  // `span` (1-4) is how many beats the chord holds; the following span-1
  // slots are 'occupied'. A shape you're not sure about yet can still be
  // added — `locked:false` means "figure this one out from the key + the
  // rest of the line" (see fbCidResolveProgression), `locked:true` means
  // you (or an earlier clarify) already pinned it down. `input` is the fret
  // shape actually clicked, kept so re-editing loads the real shape back.
  //
  // `baseline` (nullable) is a deep snapshot of `measures` taken at the
  // moment this line was created via fbCidDuplicateLine — diffed against on
  // render so unedited chips can fade back and only real edits stay bold
  // (see fbCidRenderChordCard). null for a line that wasn't a duplicate.
  lines: [{ measures: [fbCidMakeEmptyMeasure()], baseline: null }],
  activeLine: 0, // which line a plain "+ 加入进行" (no s.pending below) targets
  // What "+ 加入进行" writes into next: null = the first empty beat in
  // lines[activeLine] (or a new measure if there isn't one); { lineIdx, mi,
  // si } = that exact measure/slot — set by fbCidClickSlot when you click
  // an empty beat (place here) or an existing chip (re-fret it in place).
  // Cleared together with the grid input.
  pending: null,
  keyMode: 'auto',      // 'auto' | 'manual' — shared across all lines: a variation is still the same song in the same key
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

// ── Measures: a line is an array of fixed-length-4 beat arrays (see the
// `lines` doc comment in fbState.chordId above). Harmonic analysis below
// works off the flat chord order and never needs measure/beat positions —
// fbCidChordsOfLine bridges the two. ──

function fbCidMakeEmptyMeasure() { return [null, null, null, null]; }

function fbCidChordsOfLine(line) {
  const out = [];
  line.measures.forEach(m => m.forEach(v => { if (v && v !== 'occupied') out.push(v); }));
  return out;
}

// Can a chord of `span` beats starting at `si` fit in `measure`? Cells
// occupied by the chord's own current position (ignoreFrom) don't block —
// that's what lets a resize or a same-measure move land back on itself.
function fbCidCanPlaceSpan(measure, si, span, ignoreFrom) {
  if (si < 0 || si + span > 4) return false;
  for (let k = 0; k < span; k++) {
    const idx = si + k;
    const cell = measure[idx];
    if (cell == null) continue;
    if (ignoreFrom && idx >= ignoreFrom.si && idx < ignoreFrom.si + ignoreFrom.span) continue;
    return false;
  }
  return true;
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

// How well a single chord fits a candidate key — diatonic root position
// (+2) plus its own quality matching what that scale degree natively is
// (+1 more). No tonic-first/last bonus here; that's a whole-*progression*
// tie-break (see fbCidScoreKey below) and doesn't mean anything for one
// chord in isolation — folding it in here once caused fbCidResolveProgression
// to prefer whichever candidate's root simply equalled the tonic (e.g.
// picking "C6" over "Am" for an A-C-E shape in the key of C, just because
// C6's root is C) regardless of which one actually fit better.
function fbCidScoreChordInKey(rootPc, quality, tonicPc, isMinor) {
  const table = isMinor ? FB_CID_MINOR_DIATONIC : FB_CID_MAJOR_DIATONIC;
  const offset = ((rootPc - tonicPc) % 12 + 12) % 12;
  if (!(offset in table)) return 0;
  return 2 + (fbCidQualityFamily(quality) === table[offset] ? 1 : 0);
}

function fbCidScoreKey(chords, tonicPc, isMinor) {
  let score = 0;
  chords.forEach(ch => { score += fbCidScoreChordInKey(ch.rootPc, ch.quality, tonicPc, isMinor); });
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
      const fit = fbCidScoreChordInKey(c.rootPc, c.quality, key.tonicPc, key.isMinor);
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
  fbCidSyncFretWindow();
  fbCidRenderAll();
}

function fbCidScrollToGrid() {
  const grid = document.getElementById('cid-grid');
  if (grid && grid.scrollIntoView) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Click anywhere in the progression grid — an empty beat or an existing
// chip — and the identify panel becomes the editor for that exact slot:
// "+ 加入进行" writes there instead of appending. Clicking an existing chip
// also reloads its actual fretted shape into the grid (and its diagram, via
// fbCidRenderCandidates) so it can be re-fretted or re-picked in place;
// clicking an empty beat just aims the next new shape at that position,
// leaving the grid as-is for fresh entry.
function fbCidClickSlot(lineIdx, mi, si) {
  const s = fbState.chordId;
  const line = s.lines[lineIdx];
  const slot = line && line.measures[mi] && line.measures[mi][si];
  fbCidResetClarify();
  if (slot && slot !== 'occupied') {
    s.input = slot.input.slice();
    const resolved = fbCidRepresentativeChord(slot);
    if (resolved) s.selected = { rootPc: resolved.rootPc, quality: resolved.quality };
  } else if (!slot) {
    s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  } else {
    return; // clicked the tail ('occupied') of a chip spanning multiple beats — no-op
  }
  s.pending = { lineIdx, mi, si };
  s.activeLine = lineIdx;
  fbCidSyncFretWindow();
  fbCidRenderAll();
  fbCidScrollToGrid();
}

function fbCidCancelPending() {
  const s = fbState.chordId;
  s.pending = null;
  s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  fbCidResetClarify();
  fbCidSyncFretWindow();
  fbCidRenderAll();
}

// Explicit delete while editing a chord in the identify panel — the same
// removal fbCidRemoveChordAt does from the ✕ on the card itself, exposed
// here too so "remove this" doesn't require going back to hunt for the tiny
// corner button on the card you're already looking at.
function fbCidRemoveEditing() {
  const s = fbState.chordId;
  if (!s.pending) return;
  const { lineIdx, mi, si } = s.pending;
  fbCidRemoveChordAt(lineIdx, mi, si);
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

// First empty beat in `line`, scanning measures in order; pushes a new
// empty measure (rather than ever inferring one implicitly) if every
// existing measure is full.
function fbCidFindOpenSlot(line) {
  for (let mi = 0; mi < line.measures.length; mi++) {
    const si = line.measures[mi].indexOf(null);
    if (si !== -1) return { mi, si };
  }
  line.measures.push(fbCidMakeEmptyMeasure());
  return { mi: line.measures.length - 1, si: 0 };
}

// Writes `built` (from fbCidBuildSlotFromInput) into line.measures[mi]
// starting at si, holding `span` beats. Caller guarantees those beats are
// free (fbCidFindOpenSlot / fbCidCanPlaceSpan) or is intentionally
// overwriting the chord already occupying exactly that span (re-fretting in
// place via fbCidClickSlot).
function fbCidPlaceChordAt(line, mi, si, span, built) {
  const measure = line.measures[mi];
  measure[si] = Object.assign({}, built, { span });
  for (let k = 1; k < span; k++) measure[si + k] = 'occupied';
}

// Writes the current grid shape into the progression: at s.pending's exact
// slot if a click aimed one there (fbCidClickSlot — an empty beat you
// clicked, or a chord you clicked to re-fret, whose span is preserved), or
// otherwise into the first open beat in lines[activeLine].
function fbCidAddToProgression() {
  const s = fbState.chordId;
  const built = fbCidBuildSlotFromInput();
  if (!built) return;
  const lineIdx = s.pending ? s.pending.lineIdx : s.activeLine;
  const line = s.lines[lineIdx];
  if (!line) return;

  let mi, si, span = 1;
  if (s.pending && s.pending.lineIdx === lineIdx) {
    ({ mi, si } = s.pending);
    const existing = line.measures[mi] && line.measures[mi][si];
    if (existing && existing !== 'occupied') span = existing.span; // re-fretting in place keeps its duration
  } else {
    ({ mi, si } = fbCidFindOpenSlot(line));
  }
  fbCidPlaceChordAt(line, mi, si, span, built);

  s.activeLine = lineIdx;
  s.pending = null;
  s.input = ['x', 'x', 'x', 'x', 'x', 'x'];
  fbCidResetClarify();
  fbCidSyncFretWindow();
  fbCidRenderAll();
}
fbCidAddToProgression = guarded(fbCidAddToProgression);

function fbCidRemoveChordAt(lineIdx, mi, si) {
  const s = fbState.chordId;
  const line = s.lines[lineIdx];
  const measure = line && line.measures[mi];
  const slot = measure && measure[si];
  if (!slot || slot === 'occupied') return;
  for (let k = 0; k < slot.span; k++) measure[si + k] = null;
  if (s.pending && s.pending.lineIdx === lineIdx && s.pending.mi === mi && s.pending.si === si) {
    fbCidCancelPending();
    return;
  }
  fbCidRenderAll();
}

// ── Drag-and-drop: pick up a chip, drop it on any empty beat (this
// measure, another measure, or another line) to move it there. A drop that
// doesn't fit — not enough consecutive empty beats — rejects visibly
// (fbCidRenderChordCard's caller adds a brief shake) instead of silently
// doing nothing. ──

function fbCidDragStart(ev, lineIdx, mi, si) {
  fbState.chordId._drag = { lineIdx, mi, si };
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', ''); // Firefox refuses to start a drag without data set
}

function fbCidDragEnd() {
  fbState.chordId._drag = null;
  document.querySelectorAll('.cid-slot.drop-target').forEach(el => el.classList.remove('drop-target'));
}

function fbCidSlotDragOver(ev) {
  if (!fbState.chordId._drag) return;
  ev.preventDefault(); // required for the element to accept a drop at all
  ev.currentTarget.classList.add('drop-target');
}

function fbCidSlotDragLeave(ev) {
  ev.currentTarget.classList.remove('drop-target');
}

function fbCidSlotDrop(ev, toLine, toMi, toSi) {
  ev.preventDefault();
  const el = ev.currentTarget;
  el.classList.remove('drop-target');
  const drag = fbState.chordId._drag;
  fbState.chordId._drag = null;
  if (!drag) return;
  const ok = fbCidMoveChordTo(drag.lineIdx, drag.mi, drag.si, toLine, toMi, toSi);
  if (!ok) {
    el.classList.remove('reject'); void el.offsetWidth; el.classList.add('reject'); // restart the shake even if it's still mid-animation
    setTimeout(() => el.classList.remove('reject'), 400);
  }
}

// Returns true on success, false if the target has no room — callers
// surface that as a visible reject rather than a silent no-op.
function fbCidMoveChordTo(fromLine, fromMi, fromSi, toLine, toMi, toSi) {
  const s = fbState.chordId;
  const src = s.lines[fromLine];
  const dst = s.lines[toLine];
  if (!src || !dst) return false;
  const srcMeasure = src.measures[fromMi];
  const slot = srcMeasure && srcMeasure[fromSi];
  if (!slot || slot === 'occupied') return false;
  const span = slot.span;
  const dstMeasure = dst.measures[toMi];
  if (!dstMeasure) return false;
  const ignoreFrom = (dstMeasure === srcMeasure) ? { si: fromSi, span } : null;
  if (!fbCidCanPlaceSpan(dstMeasure, toSi, span, ignoreFrom)) return false;

  for (let k = 0; k < span; k++) srcMeasure[fromSi + k] = null;
  dstMeasure[toSi] = slot;
  for (let k = 1; k < span; k++) dstMeasure[toSi + k] = 'occupied';

  if (s.pending && s.pending.lineIdx === fromLine && s.pending.mi === fromMi && s.pending.si === fromSi) {
    s.pending = { lineIdx: toLine, mi: toMi, si: toSi };
  }
  fbCidRenderAll();
  return true;
}

// Drag a chip's own right edge to change its duration (1-4 beats), capped
// by however much room is left in its measure. A live drag rather than a
// stepper because "how long does this chord hold" is exactly what the
// chip's width already means visually — dragging the edge is the same
// gesture as resizing it. Re-renders the progression (not the whole panel —
// the identify grid isn't involved) on every beat-width crossed for direct
// visual feedback while dragging.
const FB_CID_SLOT_PX = 44; // must match .cid-slot's CSS width
const FB_CID_MEASURE_GAP_PX = 4; // must match .cid-measure's CSS gap
function fbCidBeginResize(ev, lineIdx, mi, si) {
  ev.preventDefault();
  ev.stopPropagation();
  const line = fbState.chordId.lines[lineIdx];
  const measure = line && line.measures[mi];
  const slot = measure && measure[si];
  if (!slot || slot === 'occupied') return;
  const startX = ev.clientX;
  const startSpan = slot.span;

  function onMove(e) {
    const deltaSlots = Math.round((e.clientX - startX) / FB_CID_SLOT_PX);
    const newSpan = Math.max(1, Math.min(4, 4 - si, startSpan + deltaSlots));
    if (newSpan === slot.span) return;
    // Shrinking only ever frees cells (always safe); growing must not run
    // into whatever chord already occupies the next beat.
    if (!fbCidCanPlaceSpan(measure, si, newSpan, { si, span: slot.span })) return;
    for (let k = 0; k < slot.span; k++) measure[si + k] = null;
    slot.span = newSpan;
    measure[si] = slot;
    for (let k = 1; k < newSpan; k++) measure[si + k] = 'occupied';
    fbCidRenderProgression();
    fbCidRenderAnalysis();
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    fbCidPrefsSave();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Deep-clones a line's measures — used both to duplicate a line and to take
// its `baseline` snapshot (a second, independent clone) at that same
// moment, so later edits to either copy never touch the other.
function fbCidCloneMeasures(measures) {
  return measures.map(m => m.map(v => (v && v !== 'occupied')
    ? { candidates: v.candidates.slice(), chosenIdx: v.chosenIdx, locked: v.locked, input: v.input.slice(), span: v.span }
    : v));
}

// Duplicates a whole line right below itself — the "same progression, one
// chord different" workflow: duplicate, then only edit the handful of
// chips that actually change instead of rebuilding from scratch. The new
// line's `baseline` freezes how it looked at this instant, so
// fbCidRenderChordCard can fade whatever you never touch.
function fbCidDuplicateLine(lineIdx) {
  const s = fbState.chordId;
  const line = s.lines[lineIdx];
  if (!line) return;
  const copy = { measures: fbCidCloneMeasures(line.measures), baseline: fbCidCloneMeasures(line.measures) };
  s.lines.splice(lineIdx + 1, 0, copy);
  if (s.pending && s.pending.lineIdx > lineIdx) s.pending.lineIdx += 1;
  s.activeLine = lineIdx + 1;
  fbCidRenderAll();
}

function fbCidAddLine() {
  const s = fbState.chordId;
  s.lines.push({ measures: [fbCidMakeEmptyMeasure()], baseline: null });
  s.activeLine = s.lines.length - 1;
  fbCidRenderAll();
}

function fbCidAddMeasure(lineIdx) {
  const s = fbState.chordId;
  const line = s.lines[lineIdx];
  if (!line) return;
  line.measures.push(fbCidMakeEmptyMeasure());
  fbCidRenderAll();
}

function fbCidRemoveLine(lineIdx) {
  const s = fbState.chordId;
  if (s.lines.length <= 1) { fbCidClearProgression(); return; } // always keep at least one line to add into
  s.lines.splice(lineIdx, 1);
  if (s.activeLine >= s.lines.length) s.activeLine = s.lines.length - 1;
  if (s.pending) {
    if (s.pending.lineIdx === lineIdx) { s.pending = null; s.input = ['x', 'x', 'x', 'x', 'x', 'x']; fbCidResetClarify(); }
    else if (s.pending.lineIdx > lineIdx) s.pending.lineIdx -= 1;
  }
  fbCidRenderAll();
}

function fbCidClearProgression() {
  const s = fbState.chordId;
  s.lines = [{ measures: [fbCidMakeEmptyMeasure()], baseline: null }];
  s.activeLine = 0;
  s.pending = null;
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

// The grid shows a movable 5-fret window (see fbCidRenderGrid) rather than
// frets 0-12 all at once — at any reasonable column width that crammed
// cells too narrow to tap comfortably. fbCidSyncFretWindow jumps the window
// to wherever the current input actually is, same "position" convention
// fbCidShapeToSvguitarChord already uses for the diagram (nut visible only
// if some string is open, else the lowest fretted note).
const FB_CID_WINDOW_ROWS = 5;
const FB_CID_MAX_FRET_WINDOW_START = 19;

function fbCidSyncFretWindow() {
  const input = fbState.chordId.input;
  const fretted = input.filter(v => typeof v === 'number' && v > 0);
  const hasOpen = input.some(v => v === 0);
  const position = (!hasOpen && fretted.length) ? Math.min(...fretted) : 1;
  fbState.chordId.fretWindowStart = position - 1;
}

function fbCidFretWindowPrev() {
  fbState.chordId.fretWindowStart = Math.max(0, fbState.chordId.fretWindowStart - 1);
  fbCidRenderGrid();
  fbCidPrefsSave();
}

function fbCidFretWindowNext() {
  fbState.chordId.fretWindowStart = Math.min(FB_CID_MAX_FRET_WINDOW_START, fbState.chordId.fretWindowStart + 1);
  fbCidRenderGrid();
  fbCidPrefsSave();
}

function fbCidRenderGrid() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-grid');
  if (!el) return;
  const start = s.fretWindowStart;
  const rowOrder = [5, 4, 3, 2, 1, 0]; // high e at top, low E at bottom — matches standard tab layout

  let html = `<div class="cid-fret-window-control">
      <button type="button" onclick="fbCidFretWindowPrev()" ${start === 0 ? 'disabled' : ''} title="向琴头方向移动">◀</button>
      <span class="cid-fret-window-label">${start === 0 ? '空弦 – ' + (FB_CID_WINDOW_ROWS - 1) + ' 品' : start + ' – ' + (start + FB_CID_WINDOW_ROWS - 1) + ' 品'}</span>
      <button type="button" onclick="fbCidFretWindowNext()" title="向琴身方向移动">▶</button>
    </div>`;

  html += '<div class="cid-grid-row cid-grid-header"><span class="cid-string-label"></span>';
  for (let c = 0; c < FB_CID_WINDOW_ROWS; c++) {
    const f = start + c;
    const inlay = FB_CID_INLAY_FRETS.has(f) ? ' cid-fret-inlay' : '';
    html += `<span class="cid-fret-head${inlay}">${f === 0 ? '○' : f}</span>`;
  }
  html += '</div>';
  rowOrder.forEach(i => {
    const muted = s.input[i] === 'x';
    html += `<div class="cid-grid-row"><span class="cid-string-label${muted ? ' muted' : ''}" onclick="fbCidToggleMute(${i})">${FB_STRING_NAMES[i]}${muted ? ' ✕' : ''}</span>`;
    for (let c = 0; c < FB_CID_WINDOW_ROWS; c++) {
      const f = start + c;
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
  // Floor of 4 rows (not the minimum 2 a single-fret shape would otherwise
  // get) so every card in a progression renders at the same height in the
  // common case — svguitar sizes its SVG by row count, so a 2-row diagram
  // next to a 4-row one made the progression look uneven/misaligned even
  // though every card's CSS width was already identical.
  return { fingers, position, fretsToShow: Math.max(4, maxRelFret) };
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
  const removeBtn = document.getElementById('cid-remove-btn');
  const diagramEl = document.getElementById('cid-identify-diagram');
  if (!notesEl || !clarifyEl || !listEl || !addBtn || !bannerEl || !cancelBtn || !removeBtn) return;

  let editingSlot = null;
  if (s.pending) {
    const line = s.lines[s.pending.lineIdx];
    const cell = line && line.measures[s.pending.mi] && line.measures[s.pending.mi][s.pending.si];
    if (cell && cell !== 'occupied') editingSlot = cell;
  }
  const placing = !!s.pending && !editingSlot; // pending points at an empty beat you clicked
  bannerEl.textContent = editingSlot ? `正在修改第 ${s.pending.lineIdx + 1} 行第 ${s.pending.mi + 1} 小节的和弦 — 重新点指板后点"更新"`
    : placing ? `将加入第 ${s.pending.lineIdx + 1} 行第 ${s.pending.mi + 1} 小节 — 点指板后点"加入到此处"`
    : '';
  addBtn.textContent = editingSlot ? '✔ 更新' : placing ? '✔ 加入到此处' : '+ 加入进行';
  cancelBtn.style.display = s.pending ? '' : 'none';
  removeBtn.style.display = editingSlot ? '' : 'none';

  const { pcSet, bassPc } = fbCidPitchClasses(s.input);
  s._lastBassPc = bassPc;

  if (diagramEl) {
    if (pcSet.size) fbCidRenderChordDiagram(diagramEl, s.input);
    else diagramEl.innerHTML = ''; // nothing fretted yet — nothing to draw (see .cid-identify-diagram:empty)
  }

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

// A chord already placed in the progression: a compact chip — name only, no
// diagram (that lives in the identify panel, see fbCidRenderCandidates, one
// at a time rather than duplicated onto every chip — a real chord chart is
// symbols, not a diagram per chord). Click it to reload its shape into the
// identify panel for correction (fbCidClickSlot); drag it onto any empty
// beat to move it, in this measure, another measure, or another line; drag
// its own right edge to change how many beats it holds.
function fbCidRenderChordCard(lineIdx, mi, si, slot, baselineCell) {
  const resolved = fbCidRepresentativeChord(slot);
  const label = resolved ? fbChordDisplaySymbol(resolved.rootPc, resolved.quality) : '?';
  const title = slot.locked ? '你选定的读法 — 点击修改，或拖拽移动/调整拍数' : '还不确定，已按当前调号自动判断 — 点击修改，或拖拽移动/调整拍数';

  let diffClass = '';
  if (baselineCell !== undefined) {
    const changed = !baselineCell || baselineCell === 'occupied' ||
      baselineCell.span !== slot.span ||
      !fbCidRepresentativeChord(baselineCell) || !resolved ||
      fbCidRepresentativeChord(baselineCell).rootPc !== resolved.rootPc ||
      fbCidRepresentativeChord(baselineCell).quality !== resolved.quality;
    diffClass = changed ? ' var-changed' : ' var-unchanged';
  }

  // Explicit pixel width (span slots + the gaps a real neighboring slot
  // would've had between them) rather than a flex-grow ratio — .cid-measure
  // has no fixed width of its own to distribute, so flex-grow alone has
  // nothing to grow into and every chip would render at the same width
  // regardless of span.
  const width = slot.span * FB_CID_SLOT_PX + (slot.span - 1) * FB_CID_MEASURE_GAP_PX;
  return `<div class="cid-slot chip-slot" style="width:${width}px"
      ondragover="fbCidSlotDragOver(event)" ondragleave="fbCidSlotDragLeave(event)" ondrop="fbCidSlotDrop(event,${lineIdx},${mi},${si})">
    <div class="cid-prog-card${slot.locked ? '' : ' unresolved'}${diffClass}" draggable="true"
        onclick="fbCidClickSlot(${lineIdx},${mi},${si})"
        ondragstart="fbCidDragStart(event,${lineIdx},${mi},${si})" ondragend="fbCidDragEnd()"
        title="${title}">
      <button type="button" class="cid-prog-chip-del" onclick="event.stopPropagation();fbCidRemoveChordAt(${lineIdx},${mi},${si})" title="删除">✕</button>
      <span class="cid-prog-card-label">${label}${slot.locked ? '' : '<sup>?</sup>'}</span>
      <span class="cid-prog-card-resize" onmousedown="fbCidBeginResize(event,${lineIdx},${mi},${si})" title="拖拽调整拍数"></span>
    </div>
  </div>`;
}

function fbCidRenderEmptySlot(lineIdx, mi, si) {
  return `<div class="cid-slot cid-slot-empty"
      onclick="fbCidClickSlot(${lineIdx},${mi},${si})"
      ondragover="fbCidSlotDragOver(event)" ondragleave="fbCidSlotDragLeave(event)" ondrop="fbCidSlotDrop(event,${lineIdx},${mi},${si})"
      title="点击在此加入和弦">+</div>`;
}

function fbCidRenderLineHeader(li, totalLines) {
  const delBtn = totalLines > 1
    ? `<button type="button" class="btn btn-ghost btn-sm" onclick="fbCidRemoveLine(${li})">✕ 删除本行</button>` : '';
  return `<div class="cid-line-head">
      <span class="cid-line-title">第 ${li + 1} 行</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="fbCidDuplicateLine(${li})">⎘ 复制这一行，改动个别和弦</button>
      ${delBtn}
    </div>`;
}

// Measures are real 4-beat boxes, always visible — never an inferred
// grouping. A measure's slots render left-to-right: an empty beat is a
// dashed "+", an occupied one is the chord's chip stretched to its span (a
// chord's width literally is its duration). Rows of measures wrap like a
// real chord chart's "several bars per line" layout.
function fbCidRenderLineBody(line, li) {
  const s = fbState.chordId;
  const chords = fbCidChordsOfLine(line);
  fbCidResolveProgression(chords, s.keyMode, s.manualTonicPc, s.manualIsMinor);

  let html = '<div class="cid-prog-flow">';
  line.measures.forEach((measure, mi) => {
    html += '<div class="cid-measure">';
    let si = 0;
    while (si < 4) {
      const cell = measure[si];
      if (cell === 'occupied') { si++; continue; }
      if (cell === null) { html += fbCidRenderEmptySlot(li, mi, si); si++; continue; }
      const baselineCell = line.baseline && line.baseline[mi] ? line.baseline[mi][si] : undefined;
      html += fbCidRenderChordCard(li, mi, si, cell, baselineCell);
      si += cell.span;
    }
    html += '</div>';
  });
  html += `<button type="button" class="cid-measure-add" onclick="fbCidAddMeasure(${li})" title="新增一小节">+</button>`;
  html += '</div>';
  if (!chords.length) html += '<div class="cid-progression-empty">还没有加入和弦</div>';
  return html;
}

function fbCidRenderProgression() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-progression');
  if (!el) return;

  let html = '';
  s.lines.forEach((line, li) => {
    html += `<div class="cid-line">${fbCidRenderLineHeader(li, s.lines.length)}${fbCidRenderLineBody(line, li)}</div>`;
  });
  html += '<button type="button" class="btn btn-ghost btn-sm cid-add-line-btn" onclick="fbCidAddLine()">+ 新建一行</button>';
  el.innerHTML = html;
}

function fbCidRenderAnalysisForLine(line, li) {
  const s = fbState.chordId;
  const chords = fbCidChordsOfLine(line);
  if (!chords.length) return '';
  const { key, inferred } = fbCidResolveProgression(chords, s.keyMode, s.manualTonicPc, s.manualIsMinor);
  const items = chords.map(slot => {
    const chord = fbCidRepresentativeChord(slot);
    return chord ? { slot, roman: fbCidRomanForChord(chord.rootPc, chord.quality, key.tonicPc) } : null;
  }).filter(Boolean);
  const roman = items.map(it => it.roman);
  const cadences = fbCidDetectCadences(roman);
  const suggestions = fbCidSuggestAlts(roman);

  // Auto-inferred key is shown per line (rather than once globally) since
  // two variation lines can genuinely differ enough to imply different
  // keys; the manual override (see fbCidRenderAnalysis) is shared, though.
  const autoKeyNote = s.keyMode === 'auto'
    ? `<span class="cid-line-key">自动判断为 ${FB_NOTE_NAMES[inferred.tonicPc]} ${inferred.isMinor ? '小调' : '大调'}</span>` : '';

  const romanRow = `<div class="cid-roman-row">${items.map(it =>
    `<span class="cid-roman-chip fn-${it.roman.functionGroup || 'chromatic'}${it.slot.locked ? '' : ' unresolved'}">${it.roman.label}${it.slot.locked ? '' : '<sup>?</sup>'}</span>`
  ).join('')}</div>`;

  const cadenceHtml = cadences.length
    ? `<ul class="cid-cadence-list">${cadences.map(c => `<li>第 ${c.at + 1}-${c.at + c.span} 个和弦：${c.type}</li>`).join('')}</ul>`
    : '';

  const sugHtml = suggestions.length
    ? `<ul class="cid-sug-list">${suggestions.map(sg =>
        `<li>${fbCidDegreeLabel(sg.anchor)}（${FB_CID_FUNCTION_LABEL[sg.fn]}）同组还有 ${sg.alts.map(fbCidDegreeLabel).join(' / ')}，可互换制造不同色彩</li>`
      ).join('')}</ul>`
    : '';

  return `<div class="cid-line-analysis"><div class="cid-line-title">第 ${li + 1} 行 ${autoKeyNote}</div>${romanRow}${cadenceHtml}${sugHtml}</div>`;
}

function fbCidRenderAnalysis() {
  const s = fbState.chordId;
  const el = document.getElementById('cid-analysis');
  if (!el) return;
  if (!s.lines.some(l => fbCidChordsOfLine(l).length)) { el.innerHTML = ''; return; }

  const keyRow = `<div class="cid-key-row">
    调号：
    <label><input type="radio" name="cid-keymode" ${s.keyMode === 'auto' ? 'checked' : ''} onchange="fbCidSetKeyMode('auto')"> 自动</label>
    <label><input type="radio" name="cid-keymode" ${s.keyMode === 'manual' ? 'checked' : ''} onchange="fbCidSetKeyMode('manual')"> 手动</label>
    ${s.keyMode === 'manual' ? `
      <select onchange="fbCidSetManualTonic(this.value)">${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.manualTonicPc === i ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select onchange="fbCidSetManualMode(this.value)">
        <option value="0" ${!s.manualIsMinor ? 'selected' : ''}>大调</option>
        <option value="1" ${s.manualIsMinor ? 'selected' : ''}>小调</option>
      </select>` : ''}
  </div>`;

  const fnLegend = `<div class="cid-fn-legend">
    <span class="fn-T">■ 主 T</span><span class="fn-S">■ 下属 S</span><span class="fn-D">■ 属 D</span><span class="fn-chromatic">■ 半音/离调</span>
  </div>`;

  const perLine = s.lines.map((line, li) => fbCidRenderAnalysisForLine(line, li)).join('');
  el.innerHTML = keyRow + fnLegend + perLine;
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

const FB_CID_VALID_CHORD_REF = c => c && Number.isInteger(c.rootPc) && c.rootPc >= 0 && c.rootPc < 12 && FB_CHORD_QUALITIES[c.quality];

// Normalizes one stored slot (or rejects it as null/'occupied'/corrupt).
// Accepts both the current per-slot format and the pre-measures bare
// {rootPc,quality} format (which was always locked).
function fbCidValidSlot(c) {
  if (!c || c === 'occupied') return null;
  if (Array.isArray(c.candidates) && c.candidates.every(FB_CID_VALID_CHORD_REF)) {
    const chosenIdx = Number.isInteger(c.chosenIdx) && c.candidates[c.chosenIdx] ? c.chosenIdx : null;
    const input = fbCidValidInputArr(c.input) ? c.input : FB_CID_BLANK_INPUT.slice();
    const span = Number.isInteger(c.span) && c.span >= 1 && c.span <= 4 ? c.span : 1;
    return { candidates: c.candidates, chosenIdx, locked: !!c.locked && chosenIdx != null, input, span };
  }
  if (FB_CID_VALID_CHORD_REF(c)) {
    return { candidates: [c], chosenIdx: 0, locked: true, input: FB_CID_BLANK_INPUT.slice(), span: 1 };
  }
  return null;
}

// A stored measure's real slot objects already sit at their true beat index
// (everything else is null or a redundant 'occupied' continuation marker we
// regenerate rather than trust) — so parsing just validates whatever's at
// each index and re-derives the 'occupied' fill from its span.
function fbCidParseMeasure(rawMeasure) {
  const measure = fbCidMakeEmptyMeasure();
  if (!Array.isArray(rawMeasure)) return measure;
  for (let i = 0; i < Math.min(4, rawMeasure.length); i++) {
    if (measure[i] !== null) continue; // already claimed by an earlier slot's span
    const slot = fbCidValidSlot(rawMeasure[i]);
    if (!slot) continue;
    const span = Math.min(slot.span, 4 - i);
    measure[i] = Object.assign({}, slot, { span });
    for (let k = 1; k < span; k++) measure[i + k] = 'occupied';
  }
  return measure;
}

function fbCidParseMeasures(rawMeasures) {
  if (!Array.isArray(rawMeasures) || !rawMeasures.length) return [fbCidMakeEmptyMeasure()];
  return rawMeasures.map(fbCidParseMeasure);
}

// Migrates the pre-measures bar/break representation (a flat chord list +
// which boundaries were bar breaks) into measures: each old bar becomes one
// measure, its chords given the same beat split its own display used to
// imply — 1 chord = the whole bar, 2 = half each, 3 = 2+1+1 — so a
// progression saved before this rewrite keeps the same shape rather than
// silently losing its bar structure.
function fbCidLegacyChordsToMeasures(rawChords, rawBreaks) {
  const chords = (Array.isArray(rawChords) ? rawChords : []).map(fbCidValidSlot).filter(Boolean);
  if (!chords.length) return [fbCidMakeEmptyMeasure()];
  const breaks = (Array.isArray(rawBreaks) && rawBreaks.every(b => typeof b === 'boolean') && rawBreaks.length === chords.length - 1)
    ? rawBreaks : new Array(Math.max(0, chords.length - 1)).fill(true);
  const bars = [];
  let cur = [];
  chords.forEach((ch, i) => { cur.push(ch); if (i === chords.length - 1 || breaks[i]) { bars.push(cur); cur = []; } });
  return bars.map(bar => {
    const spans = bar.length === 1 ? [4] : bar.length === 2 ? [2, 2] : bar.length === 3 ? [2, 1, 1] : bar.map(() => 1);
    const measure = fbCidMakeEmptyMeasure();
    let si = 0;
    bar.forEach((slot, i) => {
      if (si >= 4) return;
      const span = Math.min(spans[i] || 1, 4 - si);
      measure[si] = Object.assign({}, slot, { span });
      for (let k = 1; k < span; k++) measure[si + k] = 'occupied';
      si += span;
    });
    return measure;
  });
}

function fbCidPrefsLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FB_CID_PREFS_KEY)) || {}; } catch (_) { saved = {}; }
  const s = fbState.chordId;
  if (fbCidValidInputArr(saved.input)) s.input = saved.input;
  if (Number.isInteger(saved.fretWindowStart) && saved.fretWindowStart >= 0 && saved.fretWindowStart <= FB_CID_MAX_FRET_WINDOW_START) {
    s.fretWindowStart = saved.fretWindowStart;
  }

  if (Array.isArray(saved.lines) && saved.lines.length) {
    s.lines = saved.lines.map(l => {
      if (l && Array.isArray(l.measures)) {
        return { measures: fbCidParseMeasures(l.measures), baseline: Array.isArray(l.baseline) ? fbCidParseMeasures(l.baseline) : null };
      }
      return { measures: fbCidLegacyChordsToMeasures(l && l.chords, l && l.breaks), baseline: null }; // pre-measures bar/break line
    });
  } else if (Array.isArray(saved.chords)) {
    // migrate pre-multi-line format: the old flat chords/breaks becomes line 0
    s.lines = [{ measures: fbCidLegacyChordsToMeasures(saved.chords, saved.breaks), baseline: null }];
  }
  if (!s.lines.length) s.lines = [{ measures: [fbCidMakeEmptyMeasure()], baseline: null }];

  if (Number.isInteger(saved.activeLine) && saved.activeLine >= 0 && saved.activeLine < s.lines.length) {
    s.activeLine = saved.activeLine;
  }
  if (saved.keyMode === 'auto' || saved.keyMode === 'manual') s.keyMode = saved.keyMode;
  if (Number.isInteger(saved.manualTonicPc) && saved.manualTonicPc >= 0 && saved.manualTonicPc < 12) s.manualTonicPc = saved.manualTonicPc;
  if (typeof saved.manualIsMinor === 'boolean') s.manualIsMinor = saved.manualIsMinor;
}

function fbCidPrefsSave() {
  const s = fbState.chordId;
  localStorage.setItem(FB_CID_PREFS_KEY, JSON.stringify({
    input: s.input, fretWindowStart: s.fretWindowStart, lines: s.lines, activeLine: s.activeLine,
    keyMode: s.keyMode, manualTonicPc: s.manualTonicPc, manualIsMinor: s.manualIsMinor,
  }));
}

function fbCidInit() {
  fbCidPrefsLoad();
  fbCidRenderAll();
}

// ── Agent context (see web/agent-assistant.js) ──
// A structured snapshot of the current progression for the floating agent
// assistant — reuses the exact same theory-engine functions the UI itself
// calls, so the agent reasons over the same roman numerals, cadences and
// substitution suggestions the page is showing, not a re-derivation of its
// own. Includes each chord's alternate readings (what it omits, whether the
// root was actually played) — the "various possibilities" a question like
// "why is this one more reasonable" needs to be answered concretely instead
// of with generic theory.
function fbCidAgentContext() {
  const s = fbState.chordId;
  const lineContext = (line, li) => {
    const chords = fbCidChordsOfLine(line);
    if (!chords.length) return { line: li + 1, chords: [] };
    const { key, inferred } = fbCidResolveProgression(chords, s.keyMode, s.manualTonicPc, s.manualIsMinor);
    const romanByChord = chords.map(slot => {
      const chord = fbCidRepresentativeChord(slot);
      return chord ? fbCidRomanForChord(chord.rootPc, chord.quality, key.tonicPc) : null;
    });
    const presentRoman = romanByChord.filter(Boolean);
    const cadences = fbCidDetectCadences(presentRoman);
    const suggestions = fbCidSuggestAlts(presentRoman);
    return {
      line: li + 1,
      key: `${FB_NOTE_NAMES[key.tonicPc]} ${key.isMinor ? '小调' : '大调'}`,
      keySource: s.keyMode === 'manual' ? '手动指定' : `自动判断（若无手动覆盖会是 ${FB_NOTE_NAMES[inferred.tonicPc]} ${inferred.isMinor ? '小调' : '大调'}）`,
      chords: chords.map((slot, idx) => {
        const chord = fbCidRepresentativeChord(slot);
        return {
          name: chord ? fbChordDisplaySymbol(chord.rootPc, chord.quality) : '?',
          roman: romanByChord[idx] ? romanByChord[idx].label : '?',
          beats: slot.span,
          resolved: !!slot.locked, // false = auto-picked from context, not user-confirmed
          alternates: (slot.candidates || []).slice(0, 5).map(c => ({
            name: fbChordDisplaySymbol(c.rootPc, c.quality),
            note: fbCidCandidateNote(c), // "省略根音" / "省略 5th" / "完整" etc.
          })),
        };
      }),
      cadences: cadences.map(c => c.type),
      substitutionHints: suggestions.map(sg =>
        `${fbCidDegreeLabel(sg.anchor)} 同组还有 ${sg.alts.map(fbCidDegreeLabel).join('/')}`),
    };
  };
  return {
    lines: s.lines.map(lineContext),
    editing: (s.pending && s.lines[s.pending.lineIdx])
      ? { line: s.pending.lineIdx + 1, measure: s.pending.mi + 1 }
      : null,
  };
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fbCidPitchClasses, fbCidCandidates, fbCidMissingLabels, fbCidComputeAmbiguity,
    fbCidMakeEmptyMeasure, fbCidChordsOfLine, fbCidCanPlaceSpan,
    fbCidInferKey, fbCidScoreKey, fbCidScoreChordInKey,
    fbCidRepresentativeChord, fbCidResolveProgression,
    fbCidRomanForChord, fbCidDegreeLabel, fbCidDetectCadences, fbCidSuggestAlts,
    fbCidLegacyChordsToMeasures, fbCidParseMeasures,
  };
}
