// ── Fretboard trainer — Chord Match drill ──
// Split out of web/fretboard.js (pure code move, no logic changes).

// ── Chord Match drill (mic-based chord sight-reading) ──
//
// Chords are polyphonic, so monophonic autocorrelation doesn't apply here.
// Instead this uses a chroma / pitch-class profile (PCP): FFT the signal,
// fold spectral energy from every bin into one of 12 pitch-class buckets
// (ignoring octave), then compare that 12-value "which notes are ringing"
// vector against a template for the target chord via cosine similarity.
// This only checks pitch content, not voicing — any shape/inversion that
// contains the right notes will match, which is what "sight-reading a
// chord symbol" should reward. It's inherently less precise than single-note
// detection (strum noise, muted strings, room noise all leak in), so the
// match threshold is deliberately conservative.

// interval sets in semitones from the root
const FB_CHORD_QUALITIES = {
  '':     [0, 4, 7],      // major
  'm':    [0, 3, 7],      // minor
  'maj7': [0, 4, 7, 11],  // major 7
  '7':    [0, 4, 7, 10],  // dominant 7
  'm7':   [0, 3, 7, 10],  // minor 7
  'dim7': [0, 3, 6, 9],   // fully diminished 7
  'm7b5': [0, 3, 6, 10],  // half-diminished 7 (minor 7 flat 5)
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  '6':     [0, 4, 7, 9],   // major 6
  'm6':    [0, 3, 7, 9],   // minor 6
  'add9':  [0, 4, 7, 2],   // major triad + 9 (no 7th)
  'madd9': [0, 3, 7, 2],   // minor triad + 9 (no 7th)
  '9':     [0, 4, 7, 10, 2], // dominant 9
  'm9':    [0, 3, 7, 10, 2], // minor 9
  'maj9':  [0, 4, 7, 11, 2], // major 9
  'dim':   [0, 3, 6],        // diminished triad
  'aug':   [0, 4, 8],        // augmented triad
  '7sus4': [0, 5, 7, 10],    // dominant 7 sus4
  '6/9':   [0, 4, 7, 9, 2],  // major 6/9
  'mmaj7': [0, 3, 7, 11],    // minor-major 7
  '7b9':   [0, 4, 7, 10, 1], // altered dominant, flat 9
  '7#9':   [0, 4, 7, 10, 3], // altered dominant, sharp 9 ("Hendrix chord")
};
const FB_CHORD_QUALITY_LABELS = {
  '': 'Major', 'm': 'Minor', 'maj7': 'Maj7', '7': 'Dominant 7', 'm7': 'Minor 7',
  'dim7': 'Diminished 7', 'm7b5': 'Half-dim 7 (m7♭5)', 'sus2': 'Sus2', 'sus4': 'Sus4',
  '6': 'Major 6', 'm6': 'Minor 6', 'add9': 'Add9', 'madd9': 'Minor add9',
  '9': 'Dominant 9', 'm9': 'Minor 9', 'maj9': 'Major 9',
  'dim': 'Diminished', 'aug': 'Augmented', '7sus4': '7sus4', '6/9': 'Major 6/9',
  'mmaj7': 'Minor-Major 7', '7b9': 'Dominant 7♭9', '7#9': 'Dominant 7♯9',
};
// scale-degree formula for each quality, in the same order as FB_CHORD_QUALITIES[quality]
const FB_CHORD_DEGREE_LABELS = {
  '':     ['1', '3', '5'],
  'm':    ['1', 'b3', '5'],
  'maj7': ['1', '3', '5', '7'],
  '7':    ['1', '3', '5', 'b7'],
  'm7':   ['1', 'b3', '5', 'b7'],
  'dim7': ['1', 'b3', 'b5', 'bb7'],
  'm7b5': ['1', 'b3', 'b5', 'b7'],
  'sus2': ['1', '2', '5'],
  'sus4': ['1', '4', '5'],
  '6':     ['1', '3', '5', '6'],
  'm6':    ['1', 'b3', '5', '6'],
  'add9':  ['1', '3', '5', '9'],
  'madd9': ['1', 'b3', '5', '9'],
  '9':     ['1', '3', '5', 'b7', '9'],
  'm9':    ['1', 'b3', '5', 'b7', '9'],
  'maj9':  ['1', '3', '5', '7', '9'],
  'dim':   ['1', 'b3', 'b5'],
  'aug':   ['1', '3', '#5'],
  '7sus4': ['1', '4', '5', 'b7'],
  '6/9':   ['1', '3', '5', '6', '9'],
  'mmaj7': ['1', 'b3', '5', '7'],
  '7b9':   ['1', '3', '5', 'b7', 'b9'],
  '7#9':   ['1', '3', '5', 'b7', '#9'],
};
function fbChordFormula(quality) {
  return FB_CHORD_QUALITIES[quality].map((iv, idx) => FB_CHORD_DEGREE_LABELS[quality][idx]).join('  ');
}
// Two ways to spell a chord symbol: plain/standard, or classic jazz notation
// (as used by iReal Pro and jazz lead sheets: "-" for minor, "Δ7" for major7,
// "°7" for diminished7, "ø7" for half-diminished). Purely a display choice —
// the internal `quality` key (used for matching/stats) never changes.
const FB_CHORD_NOTATION_STYLES = {
  standard: { label: 'Standard (Cm, Cmaj7, Cm7b5)',
    suffixes: { '': '', m: 'm', maj7: 'maj7', '7': '7', m7: 'm7', dim7: 'dim7', m7b5: 'm7b5', sus2: 'sus2', sus4: 'sus4',
                '6': '6', m6: 'm6', add9: 'add9', madd9: 'm(add9)', '9': '9', m9: 'm9', maj9: 'maj9',
                dim: 'dim', aug: 'aug', '7sus4': '7sus4', '6/9': '6/9', mmaj7: 'm(maj7)', '7b9': '7b9', '7#9': '7#9' } },
  jazz: { label: 'Jazz / iReal Pro (C-, CΔ7, Cø7)',
    suffixes: { '': '', m: '-', maj7: 'Δ7', '7': '7', m7: '-7', dim7: '°7', m7b5: 'ø7', sus2: 'sus2', sus4: 'sus4',
                '6': '6', m6: '-6', add9: 'add9', madd9: '-(add9)', '9': '9', m9: '-9', maj9: 'Δ9',
                dim: '°', aug: '+', '7sus4': '7sus4', '6/9': '6/9', mmaj7: '-Δ7', '7b9': '7♭9', '7#9': '7♯9' } },
};
function fbChordDisplaySymbol(root, quality) {
  const style = FB_CHORD_NOTATION_STYLES[fbState.chord.notationStyle] || FB_CHORD_NOTATION_STYLES.standard;
  return FB_NOTE_NAMES[root] + style.suffixes[quality];
}

// Per-string scale-degree label for a shape (e.g. the classic "1 5 1 3 5 1"
// used to memorize the E-shape major barre chord). Computed from the shape's
// own string offsets, independent of which actual root/fret it's barred at.
function fbShapeDegreeLabels(shape, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const degreeLabels = FB_CHORD_DEGREE_LABELS[quality];
  const intervalToLabel = {};
  intervals.forEach((iv, idx) => { intervalToLabel[iv] = degreeLabels[idx]; });
  const rootBase = FB_STRING_OPEN[shape.rootString] + shape.rootFret;
  return shape.frets.map((v, i) => {
    if (v === 'x') return null;
    const offset = ((FB_STRING_OPEN[i] + v - rootBase) % 12 + 12) % 12;
    return intervalToLabel[offset] || '?';
  });
}
// Two-tier selection: the group checkbox is a bulk toggle for every quality
// inside it (all-on/all-off), but each quality underneath can still be
// switched individually — group checkbox shows an indeterminate dash when
// the group is only partly selected.
const FB_CHORD_GROUPS = {
  triad:   { label: 'Triads', qualities: ['', 'm', 'dim', 'aug'] },
  seventh: { label: '7th Chords', qualities: ['maj7', '7', 'm7', 'dim7', 'm7b5', 'mmaj7'] },
  sus:     { label: 'Sus Chords', qualities: ['sus2', 'sus4', '7sus4'] },
  sixth:   { label: '6th Chords', qualities: ['6', 'm6', '6/9'] },
  ninth:   { label: '9th / add9 Chords (pop, R&B, neo-soul)', qualities: ['add9', 'madd9', '9', 'm9', 'maj9'] },
  altered: { label: 'Altered Dominants (jazz/blues)', qualities: ['7b9', '7#9'] },
};
const FB_CHORD_MATCH_SIM = 0.82;
const FB_CHORD_WRONG_SIM = 0.68;
const FB_CHORD_MATCH_HOLD_FRAMES = 15;   // ~0.25s sustained — chords need a beat to ring out
const FB_CHORD_WRONG_HOLD_FRAMES = 15;
const FB_CHORD_WRONG_MSG_COOLDOWN_MS = 900;
const FB_CHORD_STATS_KEY = 'fb_chord_stats';
const FB_CHORD_MIN_HZ = 70, FB_CHORD_MAX_HZ = 1200, FB_CHORD_NOISE_FLOOR_DB = -70;

// Movable barre-chord voicings for Learn Mode, keyed by shape family then
// quality. These are the standard E/A/D "CAGED" families — the three shapes
// guitarists actually use as movable barre chords (unlike the C/A/G/E/D
// open-position set, C and G aren't practical barre shapes past the nut).
// Each pattern is { frets, rootFret }: rootFret is which fret (within the
// pattern's own numbering) carries the root note — usually 0, but dim7/m7b5
// shapes below need it >0 because the lowest fretted note in the barre isn't
// always the root.
//
// Major/minor/7th/maj7/sus2/sus4 patterns are derived directly from the
// well-known open chord of that name (e.g. E-shape 'm7' is literally open
// Em7: 0,2,0,0,0,0). dim7 and m7b5 aren't open-chord derivatives — they're
// sourced from published movable fingerings and verified here against the
// chord's own interval formula before use:
//   - dim7 E-shape from Gdim7 "3x232x" (guitarcommand.com / fachords.com)
//   - dim7 A-shape from Cdim7 "x3424x" (fachords.com)
//   - dim7 D-shape derived analytically (E/A "root-below-barre" pattern
//     extended to the D-string family), verified against the formula
//   - m7b5 E-shape from Am7b5 "5x554x" (guitarcommand.com)
//   - m7b5 A-shape from Bm7b5 "x2323x" (fachords.com)
//   - m7b5 D-shape from Em7b5 "xx2333" (fachords.com)
// 6/m6/add9/madd9/9/m9/maj9 shapes below are derived the same way as the
// sus2/sus4 shapes above: real open-position chords (E6, Em6, E9, Em9,
// Emaj9, Eadd9, Em(add9) and their A-shape equivalents) verified against
// each quality's own interval formula (see verify_shapes.js reasoning —
// pitch-class of every fretted string minus root pitch-class must cover
// the formula's interval set). No D-shape voicing is included for
// add9/madd9/9/m9/maj9 — the only fingerings that hit every required tone
// need an awkward 5-fret reach on the D-string family, so those are
// intentionally left out rather than shipping an impractical shape.
// dim/aug/7sus4/6-9/mmaj7 shapes are likewise sourced from real open chords
// (Edim/Adim/Ddim, Eaug/Aaug/Daug, E7sus4/A7sus4/D7sus4, E6-9/A6-9,
// Em(maj7)/Am(maj7)/Dm(maj7)) and verified the same way against each
// quality's interval formula.
const FB_MOVABLE_SHAPES = {
  E: { rootString: 0, patterns: {
    '':     { frets: [0, 2, 2, 1, 0, 0], rootFret: 0 },
    'm':    { frets: [0, 2, 2, 0, 0, 0], rootFret: 0 },
    '7':    { frets: [0, 2, 0, 1, 0, 0], rootFret: 0 },
    'm7':   { frets: [0, 2, 0, 0, 0, 0], rootFret: 0 },
    'maj7': { frets: [0, 2, 1, 1, 0, 0], rootFret: 0 },
    'dim7': { frets: [1, 'x', 0, 1, 0, 'x'], rootFret: 1 },
    'm7b5': { frets: [1, 'x', 1, 1, 0, 'x'], rootFret: 1 },
    'sus2': { frets: [0, 2, 4, 4, 0, 0], rootFret: 0 },
    'sus4': { frets: [0, 2, 2, 2, 0, 0], rootFret: 0 },
    '6':     { frets: [0, 2, 2, 1, 2, 0], rootFret: 0 },
    'm6':    { frets: [0, 2, 2, 0, 2, 0], rootFret: 0 },
    'add9':  { frets: [0, 2, 2, 1, 0, 2], rootFret: 0 },
    'madd9': { frets: [0, 2, 2, 0, 0, 2], rootFret: 0 },
    '9':     { frets: [0, 2, 0, 1, 0, 2], rootFret: 0 },
    'm9':    { frets: [0, 2, 0, 0, 0, 2], rootFret: 0 },
    'maj9':  { frets: [0, 2, 1, 1, 0, 2], rootFret: 0 },
    'dim':   { frets: [1, 'x', 'x', 1, 0, 'x'], rootFret: 1 },
    'aug':   { frets: [0, 3, 2, 1, 1, 0], rootFret: 0 },
    '7sus4': { frets: [0, 2, 0, 2, 0, 0], rootFret: 0 },
    '6/9':   { frets: [0, 'x', 2, 1, 2, 2], rootFret: 0 },
    'mmaj7': { frets: [0, 2, 1, 0, 0, 0], rootFret: 0 },
  }},
  A: { rootString: 1, patterns: {
    '':     { frets: ['x', 0, 2, 2, 2, 0], rootFret: 0 },
    'm':    { frets: ['x', 0, 2, 2, 1, 0], rootFret: 0 },
    '7':    { frets: ['x', 0, 2, 0, 2, 0], rootFret: 0 },
    'm7':   { frets: ['x', 0, 2, 0, 1, 0], rootFret: 0 },
    'maj7': { frets: ['x', 0, 2, 1, 2, 0], rootFret: 0 },
    'dim7': { frets: ['x', 1, 2, 0, 2, 'x'], rootFret: 1 },
    'm7b5': { frets: ['x', 0, 1, 0, 1, 'x'], rootFret: 0 },
    'sus2': { frets: ['x', 0, 2, 2, 0, 0], rootFret: 0 },
    'sus4': { frets: ['x', 0, 2, 2, 3, 0], rootFret: 0 },
    '6':     { frets: ['x', 0, 2, 2, 2, 2], rootFret: 0 },
    'm6':    { frets: ['x', 0, 2, 2, 1, 2], rootFret: 0 },
    'add9':  { frets: ['x', 0, 2, 4, 2, 'x'], rootFret: 0 },
    'madd9': { frets: ['x', 0, 2, 4, 1, 'x'], rootFret: 0 },
    '9':     { frets: ['x', 0, 2, 4, 2, 3], rootFret: 0 },
    'm9':    { frets: ['x', 0, 2, 4, 1, 3], rootFret: 0 },
    'maj9':  { frets: ['x', 0, 2, 4, 2, 4], rootFret: 0 },
    'dim':   { frets: ['x', 1, 2, 'x', 2, 'x'], rootFret: 1 },
    'aug':   { frets: ['x', 0, 3, 2, 2, 1], rootFret: 0 },
    '7sus4': { frets: ['x', 0, 2, 0, 3, 0], rootFret: 0 },
    '6/9':   { frets: ['x', 0, 'x', 4, 2, 2], rootFret: 0 },
    'mmaj7': { frets: ['x', 0, 2, 1, 1, 0], rootFret: 0 },
  }},
  D: { rootString: 2, patterns: {
    '':     { frets: ['x', 'x', 0, 2, 3, 2], rootFret: 0 },
    'm':    { frets: ['x', 'x', 0, 2, 3, 1], rootFret: 0 },
    '7':    { frets: ['x', 'x', 0, 2, 1, 2], rootFret: 0 },
    'm7':   { frets: ['x', 'x', 0, 2, 1, 1], rootFret: 0 },
    'maj7': { frets: ['x', 'x', 0, 2, 2, 2], rootFret: 0 },
    'dim7': { frets: ['x', 'x', 0, 1, 0, 1], rootFret: 0 },
    'm7b5': { frets: ['x', 'x', 0, 1, 1, 1], rootFret: 0 },
    'sus2': { frets: ['x', 'x', 0, 2, 3, 0], rootFret: 0 },
    'sus4': { frets: ['x', 'x', 0, 2, 3, 3], rootFret: 0 },
    '6':     { frets: ['x', 'x', 0, 2, 0, 2], rootFret: 0 },
    'm6':    { frets: ['x', 'x', 0, 2, 0, 1], rootFret: 0 },
    'dim':   { frets: ['x', 'x', 0, 1, 'x', 1], rootFret: 0 },
    'aug':   { frets: ['x', 'x', 0, 3, 3, 2], rootFret: 0 },
    '7sus4': { frets: ['x', 'x', 0, 2, 1, 3], rootFret: 0 },
    'mmaj7': { frets: ['x', 'x', 0, 2, 2, 1], rootFret: 0 },
    // No D-shape 6/9 — only 4 strings are available on this family (E/A
    // already muted), not enough to fit root+3rd+6th+9th without dropping
    // a tone that matters; same reasoning as the missing D-shape 9/m9/maj9.
  }},
};

// E-shape sus2 spans 5 frets and is rarely playable; skip it to match the
// reference sheet which also excludes it.
const FB_SKIP_E_SHAPE = new Set(['sus2']);
// E-shape 7th chords have a practical no-barre variant (mute A and high-e).
const FB_NOBARRE_QUALITIES = new Set(['7', 'm7', 'maj7']);
// Shell chords: root + 3rd + 7th (no 5th).  Fret offsets relative to barre.
// Verified: E root str0 open=4 → Dstr@0=b7, Gstr@1=maj3; Astr@0=b7 (for D-shape root)...
const FB_SHELL_PATTERNS = {
  E: { '7': [0,'x',0,1,'x','x'], 'm7': [0,'x',0,0,'x','x'], 'maj7': [0,'x',1,1,'x','x'] },
  A: { '7': ['x',0,'x',0,2,'x'], 'm7': ['x',0,'x',0,1,'x'], 'maj7': ['x',0,'x',1,2,'x'] },
  D: { '7': ['x','x',0,'x',1,2], 'm7': ['x','x',0,'x',1,1], 'maj7': ['x','x',0,'x',2,2] },
};
// 4-note "shell + 9" voicings: root-3rd(or b3)-7th(or maj7)-9th, 5th dropped,
// on 4 adjacent strings (outer strings muted). This is the classic movable
// R&B/funk/jazz 9-chord shape (e.g. the common "x-10-9-10-10-x" G9 grip) —
// a distinct fingering family from FB_MOVABLE_SHAPES/FB_SHELL_PATTERNS above,
// not a CAGED-derived barre shape. Every note verified by interval math
// against FB_CHORD_QUALITIES before being added here.
// 7b9/7#9 (altered dominants) are the same 4-note "shell+9" shape family,
// just with the top note nudged one fret to flat/sharpen the 9th. A-shape
// '7#9' at fret 7 (root E) is literally the famous "Hendrix chord" grip
// (x-7-6-7-8-x). No D-shape — same reach problem as the plain 9-chords.
const FB_SHELL9_PATTERNS = {
  E: {
    '9':   { frets: [1, 0, 1, 0, 'x', 'x'], rootFret: 1 },
    m9:    { frets: [2, 0, 2, 1, 'x', 'x'], rootFret: 2 },
    maj9:  { frets: [1, 0, 2, 0, 'x', 'x'], rootFret: 1 },
    '7b9': { frets: [2, 1, 2, 0, 'x', 'x'], rootFret: 2 },
    '7#9': { frets: [1, 0, 1, 1, 'x', 'x'], rootFret: 1 },
  },
  A: {
    '9':   { frets: ['x', 1, 0, 1, 1, 'x'], rootFret: 1 },
    m9:    { frets: ['x', 2, 0, 2, 2, 'x'], rootFret: 2 },
    maj9:  { frets: ['x', 1, 0, 2, 1, 'x'], rootFret: 1 },
    '7b9': { frets: ['x', 1, 0, 1, 0, 'x'], rootFret: 1 },
    '7#9': { frets: ['x', 1, 0, 1, 2, 'x'], rootFret: 1 },
  },
};
const FB_SHELL9_QUALITIES = new Set(['9', 'm9', 'maj9', '7b9', '7#9']);

function fbRenderChordShapeDiagrams(chord) {
  const el = document.getElementById('fb-chord-diagrams');
  el.innerHTML = '';
  ['E', 'A', 'D'].forEach(letter => {
    // Skip impractical E-shape voicings
    if (letter === 'E' && FB_SKIP_E_SHAPE.has(chord.quality)) return;

    const family = FB_MOVABLE_SHAPES[letter];
    const pattern = family.patterns[chord.quality];
    const card = document.createElement('div');
    card.className = 'fb-shape-card';
    const title = document.createElement('div');
    title.className = 'fb-shape-card-title';
    title.textContent = `${letter}-shape`;
    card.appendChild(title);

    if (!pattern) {
      const empty = document.createElement('div');
      empty.className = 'fb-shape-card-empty';
      empty.textContent = `No standard ${letter}-shape voicing for this chord type.`;
      card.appendChild(empty);
    } else {
      const shape = { frets: pattern.frets, rootString: family.rootString, rootFret: pattern.rootFret };
      const barreFret = fbBarreFretForShape(chord.root, shape);
      const degreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shape, chord.quality) : null;
      const boardWrap = document.createElement('div');
      card.appendChild(boardWrap);
      fbRenderShapeBox(boardWrap, shape, barreFret, degreeLabels);
    }
    el.appendChild(card);

    // For E-shape 7th chords, append the no-barre variant right after.
    // Mute string index 1 (A) and index 5 (high-e) so no barre is required.
    if (letter === 'E' && FB_NOBARRE_QUALITIES.has(chord.quality) && pattern) {
      const nobarreFrets = pattern.frets.map((v, i) => (i === 1 || i === 5) ? 'x' : v);
      const nobarreShape = { frets: nobarreFrets, rootString: family.rootString, rootFret: pattern.rootFret };
      const nbBarreFret = fbBarreFretForShape(chord.root, nobarreShape);
      const nbDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(nobarreShape, chord.quality) : null;
      const nbCard = document.createElement('div');
      nbCard.className = 'fb-shape-card';
      const nbTitle = document.createElement('div');
      nbTitle.className = 'fb-shape-card-title';
      nbTitle.textContent = 'E-shape（免横按）';
      nbCard.appendChild(nbTitle);
      const nbWrap = document.createElement('div');
      nbCard.appendChild(nbWrap);
      fbRenderShapeBox(nbWrap, nobarreShape, nbBarreFret, nbDegreeLabels, true);
      el.appendChild(nbCard);
    }
  });

  // Shell chords (root + 3rd + 7th, no 5th) for 7th chord qualities — added
  // after all standard/nobarre cards to match the reference sheet layout.
  if (FB_NOBARRE_QUALITIES.has(chord.quality)) {
    ['E', 'A', 'D'].forEach(letter => {
      const shellFrets = FB_SHELL_PATTERNS[letter] && FB_SHELL_PATTERNS[letter][chord.quality];
      if (!shellFrets) return;
      const family = FB_MOVABLE_SHAPES[letter];
      const shShape = { frets: shellFrets, rootString: family.rootString, rootFret: 0 };
      const shBarreFret = fbBarreFretForShape(chord.root, shShape);
      const shDegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(shShape, chord.quality) : null;
      const shCard = document.createElement('div');
      shCard.className = 'fb-shape-card';
      const shTitle = document.createElement('div');
      shTitle.className = 'fb-shape-card-title';
      shTitle.textContent = `${letter}-shape（壳）`;
      shCard.appendChild(shTitle);
      const shWrap = document.createElement('div');
      shCard.appendChild(shWrap);
      fbRenderShapeBox(shWrap, shShape, shBarreFret, shDegreeLabels, true);
      el.appendChild(shCard);
    });
  }

  // Shell+9 chords (root + 3rd/b3 + 7th/maj7 + 9th, no 5th) for 9/m9/maj9 —
  // a different fingering family from the CAGED-derived E/A/D shapes above
  // (see FB_SHELL9_PATTERNS comment). Root can only sit on the E or A string;
  // a D-string-root version isn't practical (same reach issue that already
  // excludes D-shape from the plain 9/m9/maj9 barre voicings above).
  if (FB_SHELL9_QUALITIES.has(chord.quality)) {
    ['E', 'A'].forEach(letter => {
      const pattern = FB_SHELL9_PATTERNS[letter] && FB_SHELL9_PATTERNS[letter][chord.quality];
      if (!pattern) return;
      const family = FB_MOVABLE_SHAPES[letter];
      const sh9Shape = { frets: pattern.frets, rootString: family.rootString, rootFret: pattern.rootFret };
      const sh9BarreFret = fbBarreFretForShape(chord.root, sh9Shape);
      const sh9DegreeLabels = fbState.chord.showDegreesOnDiagram ? fbShapeDegreeLabels(sh9Shape, chord.quality) : null;
      const sh9Card = document.createElement('div');
      sh9Card.className = 'fb-shape-card';
      const sh9Title = document.createElement('div');
      sh9Title.className = 'fb-shape-card-title';
      sh9Title.textContent = `${letter}-shape（壳+9）`;
      sh9Card.appendChild(sh9Title);
      const sh9Wrap = document.createElement('div');
      sh9Card.appendChild(sh9Wrap);
      fbRenderShapeBox(sh9Wrap, sh9Shape, sh9BarreFret, sh9DegreeLabels, true);
      el.appendChild(sh9Card);
    });
  }
}

function fbChordLoadStats() {
  try { fbState.chord.stats = JSON.parse(localStorage.getItem(FB_CHORD_STATS_KEY)) || {}; }
  catch (_) { fbState.chord.stats = {}; }
}
function fbChordSaveStats() {
  localStorage.setItem(FB_CHORD_STATS_KEY, JSON.stringify(fbState.chord.stats));
}

function fbChordSymbol(root, quality) {
  return FB_NOTE_NAMES[root] + quality;
}

function fbChordGroupState(g) {
  const quals = FB_CHORD_GROUPS[g].qualities;
  const checkedCount = quals.filter(q => fbState.chord.qualities[q]).length;
  if (checkedCount === 0) return 'none';
  if (checkedCount === quals.length) return 'all';
  return 'partial';
}

function fbRenderChordOptions() {
  const s = fbState.chord;
  const q = s.qualities;
  document.getElementById('fb-chord-options').innerHTML = `
    <span>Notation:</span>
    <select onchange="fbState.chord.notationStyle=this.value; fbPrefsSave(); fbChordRefreshLabels()">
      ${Object.keys(FB_CHORD_NOTATION_STYLES).map(k => `<option value="${k}" ${s.notationStyle===k?'selected':''}>${FB_CHORD_NOTATION_STYLES[k].label}</option>`).join('')}
    </select>
    <span class="ml-3">Chord source:</span>
    <select onchange="fbChordSetSource(this.value)">
      <option value="random"      ${s.source==='random'     ?'selected':''}>Random</option>
      <option value="fixed_root"  ${s.source==='fixed_root' ?'selected':''}>Fixed root — same root, random quality</option>
      <option value="progression" ${s.source==='progression'?'selected':''}>Progressions (I-V-vi-IV, ii-V-I, etc.)</option>
    </select>
    ${s.source === 'fixed_root' ? `
    <label class="ml-2">Root:
      <select onchange="fbState.chord.fixedRoot=parseInt(this.value); fbPrefsSave(); fbChordNewChord()">
        ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.fixedRoot===i?'selected':''}>${n}</option>`).join('')}
      </select>
    </label>` : ''}
    ${s.source === 'random' ? `
    <label class="ml-2">Practice:
      <select onchange="fbState.chord.practiceMode=this.value; fbPrefsSave(); fbChordNewChord()">
        <option value="all"  ${s.practiceMode==='all' ?'selected':''}>All</option>
        <option value="weak" ${s.practiceMode==='weak'?'selected':''}>Focus on weak</option>
      </select>
    </label>` : ''}
    ${s.source === 'progression' ? `
    <label class="ml-2">Pattern:
      <select onchange="fbState.chord.progression.categoryFilter=this.value; fbState.chord.progression.chords=null; fbPrefsSave()">
        <option value="all"        ${s.progression.categoryFilter==='all'       ?'selected':''}>All</option>
        <option value="functional" ${s.progression.categoryFilter==='functional'?'selected':''}>Functional (T-S-D-T)</option>
        <option value="circle5"    ${s.progression.categoryFilter==='circle5'   ?'selected':''}>Circle of fifths</option>
        <option value="stepwise"   ${s.progression.categoryFilter==='stepwise'  ?'selected':''}>Stepwise descent/ascent</option>
        <option value="blues"      ${s.progression.categoryFilter==='blues'     ?'selected':''}>12-bar blues</option>
      </select>
    </label>
    <label class="ml-2">Repeat each progression:
      <input type="number" min="1" max="8" value="${s.progression.repeatCount}" class="w-[48px]!"
        onchange="fbState.chord.progression.repeatCount=Math.max(1, parseInt(this.value)||1); fbPrefsSave()"> ×
    </label>
    <label class="ml-2"><input type="checkbox" ${s.progression.lockKey ? 'checked' : ''}
      onchange="fbState.chord.progression.lockKey=this.checked; fbState.chord.progression.chords=null; fbPrefsSave(); fbRenderChordOptions()"> Lock key</label>
    ${s.progression.lockKey ? `
    <select onchange="fbState.chord.progression.lockedKeyRoot=parseInt(this.value); fbState.chord.progression.chords=null; fbPrefsSave()">
      ${FB_NOTE_NAMES.map((n, i) => `<option value="${i}" ${s.progression.lockedKeyRoot===i?'selected':''}>${n}</option>`).join('')}
    </select>` : ''}` : ''}
    <div class="fb-chord-type-groups">
      ${Object.keys(FB_CHORD_GROUPS).map(g => `
        <div class="fb-chord-type-group">
          <label class="fb-chord-group-label"><input type="checkbox" class="fb-chord-group-cb" data-group="${g}" onchange="fbChordToggleGroup('${g}')"> ${FB_CHORD_GROUPS[g].label}</label>
          <span class="fb-chord-type-children">
            ${FB_CHORD_GROUPS[g].qualities.map(qk => `
              <label><input type="checkbox" ${q[qk] ? 'checked' : ''} onchange="fbChordToggleQuality('${qk}')"> ${FB_CHORD_QUALITY_LABELS[qk]}</label>
            `).join('')}
          </span>
        </div>
      `).join('')}
      <div class="fb-chord-type-group">
        <label><input type="checkbox" ${s.showFormula ? 'checked' : ''} onchange="fbState.chord.showFormula=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord formula (e.g. 1 b3 5 b7)</label>
        <label><input type="checkbox" ${s.showChordDiagram ? 'checked' : ''} onchange="fbState.chord.showChordDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show chord shape diagrams (E/A/D-shape)</label>
        <label><input type="checkbox" ${s.showDegreesOnDiagram ? 'checked' : ''} onchange="fbState.chord.showDegreesOnDiagram=this.checked; fbPrefsSave(); fbChordRefreshLabels()"> Show degree labels on shape diagrams</label>
        <label class="flex items-center gap-1.5">
          📐 Diagram size:
          <input type="range" min="100" max="300" step="10" value="${s.diagramSize || 200}"
            oninput="fbState.chord.diagramSize=parseInt(this.value); fbPrefsSave(); fbApplyDiagramSize(); fbChordRefreshLabels(); document.getElementById('fb-diagram-size-val').textContent=this.value+'px'">
          <span id="fb-diagram-size-val">${s.diagramSize || 200}px</span>
        </label>
      </div>
    </div>
  `;
  // indeterminate is JS-only, can't be expressed as an HTML attribute
  document.querySelectorAll('.fb-chord-group-cb').forEach(cb => {
    const st = fbChordGroupState(cb.dataset.group);
    cb.checked = st === 'all';
    cb.indeterminate = st === 'partial';
  });
}

function fbChordToggleGroup(g) {
  const turnOn = fbChordGroupState(g) !== 'all'; // not fully on yet → select all; already all on → clear
  FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = turnOn; });
  if (!Object.values(fbState.chord.qualities).some(Boolean)) FB_CHORD_GROUPS[g].qualities.forEach(qk => { fbState.chord.qualities[qk] = true; });
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordToggleQuality(qk) {
  const qs = fbState.chord.qualities;
  qs[qk] = !qs[qk];
  if (!Object.values(qs).some(Boolean)) qs[qk] = true; // keep at least one
  fbState.chord.progression.chords = null; // stale — enabled qualities changed
  fbPrefsSave();
  fbRenderChordOptions();
}

function fbChordSetSource(source) {
  fbState.chord.source = source;
  fbState.chord.progression.chords = null;
  fbPrefsSave();
  fbRenderChordOptions();  // re-render to show/hide root picker
  fbChordNewChord();
}

function fbChordResetStats() {
  fbState.chord.stats = {};
  fbChordSaveStats();
  fbRenderChordStatsTable();
}

// 12-value weight vector for a chord: root strongest, third/fifth present,
// everything else a small non-zero baseline so an otherwise-clean chroma
// isn't penalized to zero by string noise / open-string bleed.
function fbChordTemplate(root, quality) {
  const intervals = FB_CHORD_QUALITIES[quality];
  const template = new Array(12).fill(0.12);
  intervals.forEach((iv, idx) => {
    const pc = (root + iv) % 12;
    template[pc] = idx === 0 ? 1.0 : 0.75;
  });
  return template;
}

function fbCosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 12; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// Cosine similarity alone under-discriminates triads vs. their 7th-chord
// extensions: a plain triad already covers 3 of a 7th chord's 4 tones, which
// is enough overlap to clear the similarity threshold even though the 7th
// itself never sounded. This gate requires every interval in the chord to
// actually have energy present, so a missing tone (e.g. no minor 7th when
// you only played the triad) can't pass as that 7th chord.
const FB_CHORD_MIN_TONE_PRESENCE = 0.3;
function fbChordCoverageOk(chroma, root, quality) {
  return FB_CHORD_QUALITIES[quality].every(iv => chroma[(root + iv) % 12] >= FB_CHORD_MIN_TONE_PRESENCE);
}

function fbChordEnabledPool() {
  const qs = fbState.chord.qualities;
  const pool = [];
  for (const q of Object.keys(FB_CHORD_QUALITIES)) {
    if (!qs[q]) continue;
    for (let root = 0; root < 12; root++) pool.push({ root, quality: q, symbol: fbChordSymbol(root, q) });
  }
  return pool;
}

// ── Chord progression mode: instead of a uniformly random chord every time,
// walk through a real chord-progression "lick" (I-V-vi-IV, ii-V-I, etc.) in
// a randomly chosen key, then pick a new progression/key once it's done.
// Each diatonic degree lists candidate qualities in preference order (plain
// triad first, then its 7th-chord extension) — whichever is actually
// enabled in the user's quality checkboxes gets used, so this respects the
// existing quality filter rather than fighting it.
const FB_MAJOR_SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const FB_MINOR_SCALE_OFFSETS = [0, 2, 3, 5, 7, 8, 10];
const FB_MAJOR_DEGREE_QUALITIES = [
  ['', 'maj7', '6', 'maj9', 'add9'],  // I
  ['m', 'm7', 'm9'],                  // ii
  ['m', 'm7', 'm9'],                  // iii
  ['', 'maj7', '6', 'maj9', 'add9'],  // IV
  ['', '7', '9'],                     // V
  ['m', 'm7', 'm6', 'm9'],            // vi
  ['m7b5', 'dim7'],                   // vii°
];
const FB_MINOR_DEGREE_QUALITIES = [
  ['m', 'm7', 'm6', 'm9'],            // i
  ['m7b5', 'dim7'],                   // ii°
  ['', 'maj7', 'maj9'],                // III
  ['m', 'm7', 'm9'],                  // iv
  ['m', 'm7', 'm9'],                  // v
  ['', 'maj7', '6', 'maj9'],           // VI
  ['', '7', '9'],                     // VII
];
// category is a rough tag for the *dominant generative mechanism* behind
// each progression's root motion — not a rigorous classification (several
// progressions could fit more than one bucket), just enough to let you
// filter down to "only give me circle-of-fifths ones" etc. to drill one
// pattern at a time. See docs/chord-progressions-guide.md for the theory.
const FB_CHORD_PROGRESSIONS = [
  { name: 'I – V – vi – IV (pop)', keyType: 'major', degrees: [0, 4, 5, 3], category: 'functional' },
  { name: 'I – vi – IV – V (50s / doo-wop)', keyType: 'major', degrees: [0, 5, 3, 4], category: 'functional' },
  { name: 'ii – V – I (jazz)', keyType: 'major', degrees: [1, 4, 0], category: 'circle5' },
  { name: 'I – IV – V – IV', keyType: 'major', degrees: [0, 3, 4, 3], category: 'functional' },
  { name: 'vi – IV – I – V', keyType: 'major', degrees: [5, 3, 0, 4], category: 'functional' },
  { name: 'I – vi – ii – V (turnaround)', keyType: 'major', degrees: [0, 5, 1, 4], category: 'circle5' },
  { name: 'iii – vi – ii – V (jazz turnaround)', keyType: 'major', degrees: [2, 5, 1, 4], category: 'circle5' },
  { name: '12-bar blues (changes)', keyType: 'major', degrees: [0, 3, 0, 4, 3, 0], category: 'blues' },
  { name: 'I – iii – IV – V', keyType: 'major', degrees: [0, 2, 3, 4], category: 'functional' },
  { name: 'I – V – IV – V', keyType: 'major', degrees: [0, 4, 3, 4], category: 'functional' },
  { name: 'vi – ii – V – I (circle of fifths)', keyType: 'major', degrees: [5, 1, 4, 0], category: 'circle5' },
  { name: 'I – ii – iii – IV (ascending)', keyType: 'major', degrees: [0, 1, 2, 3], category: 'stepwise' },
  { name: 'IV – iii – ii – I (stepwise descent)', keyType: 'major', degrees: [3, 2, 1, 0], category: 'stepwise' },
  { name: 'i – VI – III – VII (minor pop)', keyType: 'minor', degrees: [0, 5, 2, 6], category: 'functional' },
  { name: 'i – iv – v (minor)', keyType: 'minor', degrees: [0, 3, 4], category: 'functional' },
  { name: 'i – VII – VI – VII', keyType: 'minor', degrees: [0, 6, 5, 6], category: 'functional' },
  { name: 'i – iv – VII – III (minor rock)', keyType: 'minor', degrees: [0, 3, 6, 2], category: 'circle5' },
  { name: 'i – VII – VI – v (Andalusian-ish)', keyType: 'minor', degrees: [0, 6, 5, 4], category: 'stepwise' },
  { name: 'ii – V – I – vi (R&B / neo-soul loop)', keyType: 'major', degrees: [1, 4, 0, 5], category: 'circle5' },
  { name: 'I – IV – I – V (gospel / R&B vamp)', keyType: 'major', degrees: [0, 3, 0, 4], category: 'functional' },
  { name: 'i – iv – v – i (minor R&B vamp)', keyType: 'minor', degrees: [0, 3, 4, 0], category: 'functional' },
];

// The first enabled quality among a degree's candidates, or null if the user
// has disabled every quality that degree could plausibly use.
function fbChordBestQualityFor(degreeIdx, keyType) {
  const candidates = (keyType === 'minor' ? FB_MINOR_DEGREE_QUALITIES : FB_MAJOR_DEGREE_QUALITIES)[degreeIdx];
  // NB: '' (major triad) is a valid quality but JS-falsy — can't use `|| null` here.
  const found = candidates.find(q => fbState.chord.qualities[q]);
  return found !== undefined ? found : null;
}

// A progression only qualifies if every degree it uses resolves to some
// enabled quality — otherwise we'd be asking the user to strum a chord type
// they've explicitly turned off.
function fbChordEligibleProgressions() {
  const catFilter = fbState.chord.progression.categoryFilter;
  return FB_CHORD_PROGRESSIONS.filter(p =>
    (catFilter === 'all' || p.category === catFilter) &&
    // NB: fbChordBestQualityFor can validly return '' (major triad) — check
    // against null explicitly rather than truthiness.
    p.degrees.every(d => fbChordBestQualityFor(d, p.keyType) !== null)
  );
}

// Builds the concrete { root, quality, symbol } list for one pass through a
// progression in a given key, then — about 30% of the time — drops in a
// secondary dominant (V7 of the following chord) before some middle chord,
// just for a bit of harmonic variety. Only happens if '7' is enabled.
function fbChordBuildProgressionChords(prog, keyRoot) {
  const offsets = prog.keyType === 'minor' ? FB_MINOR_SCALE_OFFSETS : FB_MAJOR_SCALE_OFFSETS;
  const chords = prog.degrees.map(d => {
    const root = (keyRoot + offsets[d]) % 12;
    const quality = fbChordBestQualityFor(d, prog.keyType);
    return { root, quality, symbol: fbChordSymbol(root, quality) };
  });
  if (fbState.chord.qualities['7'] && chords.length > 2 && Math.random() < 0.3) {
    const insertAt = 1 + Math.floor(Math.random() * (chords.length - 1)); // never before the very first chord
    const target = chords[insertAt];
    const secDom = { root: (target.root + 7) % 12, quality: '7' };
    chords.splice(insertAt, 0, { ...secDom, symbol: fbChordSymbol(secDom.root, secDom.quality) });
  }
  return chords;
}

function fbChordPickTargetRandom() {
  const pool = fbChordEnabledPool();
  if (fbState.chord.practiceMode !== 'weak') {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Weighted by (1 – accuracy); chords with no stats yet get weight 0.5
  // so new chords still appear.  Floor at 0.1 so even perfect chords
  // aren't completely excluded.
  const weights = pool.map(c => {
    const st = fbState.chord.stats[c.symbol];
    const acc = st && st.presented > 0 ? st.matched / st.presented : 0.5;
    return Math.max(0.1, 1 - acc);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let k = 0; k < pool.length; k++) {
    r -= weights[k];
    if (r <= 0) return pool[k];
  }
  return pool[pool.length - 1];
}

function fbChordPickTargetFixedRoot() {
  const s = fbState.chord;
  const root = s.fixedRoot;
  const enabledQ = Object.keys(FB_CHORD_QUALITIES).filter(q => s.qualities[q]);
  if (!enabledQ.length) return fbChordPickTargetRandom();
  // Avoid repeating the same quality consecutively
  const prevQ = s.target ? s.target.quality : null;
  const pool  = enabledQ.length > 1 ? enabledQ.filter(q => q !== prevQ) : enabledQ;
  const quality = pool[Math.floor(Math.random() * pool.length)];
  return { root, quality, symbol: fbChordSymbol(root, quality) };
}

function fbChordPickTargetProgression() {
  const s = fbState.chord;
  const p = s.progression;
  if (!p.chords || p.stepIdx >= p.chords.length) {
    if (p.chords && p.repeatsLeft > 0) {
      // Loop the same progression/key again instead of jumping to a new one
      // every single pass — rebuilt (not reused) so the ~30% secondary-dominant
      // insert can still vary between repeats.
      p.repeatsLeft--;
      p.chords = fbChordBuildProgressionChords(p.def, p.keyRoot);
      p.stepIdx = 0;
    } else {
      const eligible = fbChordEligibleProgressions();
      if (!eligible.length) return fbChordPickTargetRandom(); // no progression fits the enabled qualities — fall back
      p.def = eligible[Math.floor(Math.random() * eligible.length)];
      p.keyRoot = p.lockKey ? p.lockedKeyRoot : Math.floor(Math.random() * 12);
      p.chords = fbChordBuildProgressionChords(p.def, p.keyRoot);
      p.stepIdx = 0;
      p.repeatsLeft = Math.max(0, p.repeatCount - 1);
    }
  }
  return p.chords[p.stepIdx++];
}

function fbChordPickTarget() {
  if (fbState.chord.source === 'fixed_root') return fbChordPickTargetFixedRoot();
  if (fbState.chord.source === 'progression') return fbChordPickTargetProgression();
  return fbChordPickTargetRandom();
}

function fbRenderChordStats() {
  const s = fbState.chord;
  document.getElementById('fb-chord-stats').innerHTML = `
    <span class="fb-stat-ok">Matches <b>${s.matches}/${s.total}</b></span>
    <span class="fb-stat-streak">Streak <b>${s.streak}</b></span>
  `;
}

function fbRenderChordStatsTable() {
  const s = fbState.chord;
  const el = document.getElementById('fb-chord-stats-table');
  if (!el) return;
  const rows = Object.keys(s.stats).map(sym => {
    const st = s.stats[sym];
    const acc = st.presented ? Math.round((st.matched / st.presented) * 100) : null;
    const avg = st.matched ? (st.totalMs / st.matched / 1000).toFixed(1) : null;
    // older saved stats (pre-notation-style) don't carry root/quality — fall back to the raw key
    const label = (st.root != null && st.quality != null) ? fbChordDisplaySymbol(st.root, st.quality) : sym;
    return { label, presented: st.presented, acc, avg, wrong: st.wrongHits || 0 };
  }).filter(r => r.presented > 0)
    .sort((a, b) => (a.acc ?? 999) - (b.acc ?? 999) || (b.avg ?? 0) - (a.avg ?? 0));
  if (!rows.length) {
    el.innerHTML = '<span class="text-fg-faint text-sm">No attempts yet — start listening and strum some chords.</span>';
    return;
  }
  el.innerHTML = fbStatsTableHead('Per-chord accuracy', 'fbChordResetStats') + `
    <table class="fb-stats-table">
      <tr><th>Chord</th><th>Tries</th><th>Accuracy</th><th>Avg time</th><th>Wrong hits</th></tr>
      ${rows.map(r => `<tr><td>${r.label}</td><td>${r.presented}</td><td>${r.acc}%</td><td>${r.avg ?? '—'}s</td><td>${r.wrong}</td></tr>`).join('')}
    </table>
  `;
}

function fbRenderChroma(chroma, target) {
  const el = document.getElementById('fb-chord-chroma');
  const chordTones = target ? new Set(FB_CHORD_QUALITIES[target.quality].map(iv => (target.root + iv) % 12)) : new Set();
  el.innerHTML = FB_NOTE_NAMES.map((n, i) => {
    const isTone = chordTones.has(i);
    const val = Math.max(0, Math.min(1, chroma[i] || 0));
    const hit = isTone && val > 0.5;
    return `
      <div class="fb-chroma-col${isTone ? ' chord-tone' : ''}${hit ? ' hit' : ''}">
        <div class="fb-chroma-bar" style="height:${Math.round(val * 100)}%"></div>
        <div class="fb-chroma-label">${n}</div>
      </div>
    `;
  }).join('');
}

function fbChordNewChord() {
  const s = fbState.chord;
  const t = fbChordPickTarget();
  s.target = t;
  s.matched = false;
  s._holdCount = 0;
  s._wrongSymbol = null;
  s._wrongHoldCount = 0;
  s.startTime = performance.now();
  s._hiddenMs = 0;
  s._hiddenSince = document.hidden ? s.startTime : null;
  const st = s.stats[t.symbol] || (s.stats[t.symbol] = { root: t.root, quality: t.quality, presented: 0, matched: 0, totalMs: 0, wrongHits: 0 });
  st.presented++;
  fbChordSaveStats();

  fbRenderChordStats();
  fbRenderChordStatsTable();
  fbRenderChroma(new Array(12).fill(0), t);
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = '';
  fb.className = 'fb-feedback';
  fbChordRefreshLabels();
}

// Re-renders whatever's currently on screen (target symbol/formula, chord
// shape diagrams if enabled) to reflect a settings change, without
// generating a new chord.
function fbChordRenderProgressionInfo() {
  const el = document.getElementById('fb-chord-progression-info');
  const previewBtn = document.getElementById('fb-chord-preview-btn');
  if (!el) return;
  const s = fbState.chord;
  const p = s.progression;
  const active = s.source === 'progression' && p.def && p.chords;
  if (previewBtn) previewBtn.classList.toggle('hidden', !active);
  if (!active) { el.textContent = ''; return; }
  const currentLoop = p.repeatCount - p.repeatsLeft;
  const loopSuffix = p.repeatCount > 1 ? ` (loop ${currentLoop}/${p.repeatCount})` : '';
  el.textContent = `Progression: ${p.def.name} in ${FB_NOTE_NAMES[p.keyRoot]} — chord ${p.stepIdx}/${p.chords.length}${loopSuffix}`;
}

// Lets you hear the *current* progression instance (same key, same chords,
// including any secondary-dominant insert) before attempting it yourself —
// so a fumbled attempt doesn't end up teaching you the wrong sound by
// accident. Reuses Ear Training's shared AudioContext/output routing/volume,
// just strums each chord's own tones as a block instead of playing a melody.
let fbChordPreviewPlayingUntil = 0;
function fbChordPreviewProgression() {
  const s = fbState.chord;
  const p = s.progression;
  if (s.source !== 'progression' || !p.chords || !p.chords.length) return;
  const now = Date.now();
  if (now < fbChordPreviewPlayingUntil) return; // debounce — a preview is already playing

  const ctx = fbEarGetAudioCtx();
  const chordDur = 0.9, gap = 0.15;
  let t = ctx.currentTime + 0.05;
  p.chords.forEach(chord => {
    const rootMidi = 48 + chord.root; // low-mid register, consistent regardless of key
    FB_CHORD_QUALITIES[chord.quality].forEach(iv => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = fbFreqFromMidi(rootMidi + iv);
      const gain = ctx.createGain();
      const peak = 0.22 * fbMasterGain() * fbSoundGain('practiceTones');
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.02);
      gain.gain.setValueAtTime(peak, t + chordDur - 0.1);
      gain.gain.linearRampToValueAtTime(0, t + chordDur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + chordDur + 0.02);
    });
    t += chordDur + gap;
  });
  fbChordPreviewPlayingUntil = now + Math.ceil((t - ctx.currentTime) * 1000);
}

function fbChordRefreshLabels() {
  const s = fbState.chord;
  fbChordRenderProgressionInfo();
  if (s.target) {
    document.getElementById('fb-chord-target').textContent = fbChordDisplaySymbol(s.target.root, s.target.quality);
    const formulaEl = document.getElementById('fb-chord-formula');
    if (formulaEl) formulaEl.textContent = s.showFormula ? fbChordFormula(s.target.quality) : '';
    const diagramsEl = document.getElementById('fb-chord-diagrams');
    if (diagramsEl) {
      if (s.showChordDiagram) fbRenderChordShapeDiagrams(s.target);
      else diagramsEl.innerHTML = '';
    }
  }
  fbRenderChordStatsTable();
}

async function fbChordStart() {
  try {
    // 32768 gives ~1.5Hz/bin at 48kHz — needed because the tightest semitone
    // gap on guitar (E2→F2, ~4.9Hz) is *smaller* than a bin at 8192, which
    // would smear a low bass note's energy into the wrong pitch class.
    await fbMicStart('chord', fbChordOnFrame, 32768);
  } catch (e) {
    const fb = document.getElementById('fb-chord-feedback');
    fb.textContent = 'Microphone access denied or unavailable: ' + e.message;
    fb.className = 'fb-feedback err';
    return;
  }
  fbSyncMicButtons('chord');
}

function fbChordStop() {
  fbMicStop();
  fbSyncMicButtons('chord');
  fbRenderChroma(new Array(12).fill(0), fbState.chord.target);
}

function fbComputeChroma(analyser, sampleRate) {
  const freqData = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(freqData);
  const binHz = sampleRate / analyser.fftSize;
  const minBin = Math.max(1, Math.floor(FB_CHORD_MIN_HZ / binHz));
  const maxBin = Math.min(freqData.length - 1, Math.ceil(FB_CHORD_MAX_HZ / binHz));
  const chroma = new Array(12).fill(0);
  for (let i = minBin; i <= maxBin; i++) {
    const db = freqData[i];
    if (db < FB_CHORD_NOISE_FLOOR_DB) continue;
    const amp = Math.pow(10, db / 20);
    const midi = 69 + 12 * Math.log2((i * binHz) / 440);
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += amp;
  }
  const max = Math.max(...chroma, 1e-9);
  return chroma.map(v => v / max);
}

function fbChordOnFrame(analyser, sampleRate) {
  const s = fbState.chord;
  const chroma = fbComputeChroma(analyser, sampleRate);
  const totalEnergy = chroma.reduce((a, b) => a + b, 0);

  if (totalEnergy < 0.5) { // effectively silent — nothing meaningful ringing
    fbRenderChroma(new Array(12).fill(0), s.target);
    s._holdCount = 0;
    return;
  }

  const targetTemplate = fbChordTemplate(s.target.root, s.target.quality);
  const sim = fbCosineSim(chroma, targetTemplate);
  const covered = fbChordCoverageOk(chroma, s.target.root, s.target.quality);
  fbRenderChroma(chroma, s.target);

  const simEl = document.getElementById('fb-chord-feedback');
  if (!s.matched && !(sim >= FB_CHORD_MATCH_SIM && covered)) {
    simEl.textContent = `Similarity to ${fbChordDisplaySymbol(s.target.root, s.target.quality)}: ${Math.round(sim * 100)}%`;
    simEl.className = 'fb-feedback';
  }
  if (s.matched) return;

  if (sim >= FB_CHORD_MATCH_SIM && covered) {
    s._holdCount++;
    s._wrongHoldCount = 0;
    if (s._holdCount >= FB_CHORD_MATCH_HOLD_FRAMES) fbChordOnMatch();
    return;
  }
  s._holdCount = 0;

  // find the closest-matching *other* known chord to give useful wrong feedback
  // (only consider chords whose tones are actually all present, not just correlated)
  let best = null;
  fbChordEnabledPool().forEach(c => {
    if (c.symbol === s.target.symbol) return;
    if (!fbChordCoverageOk(chroma, c.root, c.quality)) return;
    const csim = fbCosineSim(chroma, fbChordTemplate(c.root, c.quality));
    if (!best || csim > best.sim) best = { symbol: c.symbol, root: c.root, quality: c.quality, sim: csim };
  });
  if (best && best.sim >= FB_CHORD_WRONG_SIM) {
    if (best.symbol === s._wrongSymbol) s._wrongHoldCount++;
    else { s._wrongSymbol = best.symbol; s._wrongHoldCount = 1; }
    if (s._wrongHoldCount === FB_CHORD_WRONG_HOLD_FRAMES && performance.now() - s._lastWrongMsgAt > FB_CHORD_WRONG_MSG_COOLDOWN_MS) {
      fbChordOnWrong(best);
    }
  } else {
    s._wrongSymbol = null; s._wrongHoldCount = 0;
  }
}

function fbChordOnWrong(heard) {
  const s = fbState.chord;
  s._lastWrongMsgAt = performance.now();
  const st = s.stats[s.target.symbol];
  if (st) { st.wrongHits++; fbChordSaveStats(); }
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Not quite — that sounds like ${fbChordDisplaySymbol(heard.root, heard.quality)}, target is ${fbChordDisplaySymbol(s.target.root, s.target.quality)}. Keep trying…`;
  fb.className = 'fb-feedback err';
}

function fbChordOnMatch() {
  const s = fbState.chord;
  s.matched = true;
  const elapsedMs = performance.now() - s.startTime - (s._hiddenMs || 0);
  s.total++; s.matches++; s.streak++;
  const st = s.stats[s.target.symbol];
  st.matched++; st.totalMs += elapsedMs;
  fbChordSaveStats();
  fbRenderChordStats();
  fbRenderChordStatsTable();
  const fb = document.getElementById('fb-chord-feedback');
  fb.textContent = `Matched ${fbChordDisplaySymbol(s.target.root, s.target.quality)} in ${(elapsedMs / 1000).toFixed(1)}s!`;
  fb.className = 'fb-feedback ok';
  setTimeout(fbChordNewChord, 1100);
}

// Exposed for unit tests (Node/CommonJS only — no-op in the browser <script> tag).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FB_CHORD_QUALITIES, FB_CHORD_QUALITY_LABELS, FB_CHORD_DEGREE_LABELS, fbChordFormula, FB_CHORD_NOTATION_STYLES, fbChordDisplaySymbol,
    fbShapeDegreeLabels, FB_CHORD_GROUPS, FB_CHORD_MATCH_SIM, FB_CHORD_WRONG_SIM, FB_CHORD_MATCH_HOLD_FRAMES, FB_CHORD_WRONG_HOLD_FRAMES,
    FB_CHORD_WRONG_MSG_COOLDOWN_MS, FB_CHORD_STATS_KEY, FB_CHORD_MIN_HZ, FB_MOVABLE_SHAPES, FB_SKIP_E_SHAPE, FB_NOBARRE_QUALITIES,
    FB_SHELL_PATTERNS, FB_SHELL9_PATTERNS, FB_SHELL9_QUALITIES, fbRenderChordShapeDiagrams, fbChordLoadStats, fbChordSaveStats,
    fbChordSymbol, fbChordGroupState, fbRenderChordOptions, fbChordToggleGroup, fbChordToggleQuality, fbChordSetSource,
    fbChordResetStats, fbChordTemplate, fbCosineSim, FB_CHORD_MIN_TONE_PRESENCE, fbChordCoverageOk, fbChordEnabledPool,
    FB_MAJOR_SCALE_OFFSETS, FB_MINOR_SCALE_OFFSETS, FB_MAJOR_DEGREE_QUALITIES, FB_MINOR_DEGREE_QUALITIES, FB_CHORD_PROGRESSIONS, fbChordBestQualityFor,
    fbChordEligibleProgressions, fbChordBuildProgressionChords, fbChordPickTargetRandom, fbChordPickTargetFixedRoot, fbChordPickTargetProgression, fbChordPickTarget,
    fbRenderChordStats, fbRenderChordStatsTable, fbRenderChroma, fbChordNewChord, fbChordRenderProgressionInfo, fbChordPreviewPlayingUntil,
    fbChordPreviewProgression, fbChordRefreshLabels, fbChordStart, fbChordStop, fbComputeChroma, fbChordOnFrame,
    fbChordOnWrong, fbChordOnMatch,
  };
}
