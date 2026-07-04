"""
Generate chords.json for the chord reference sheet.

Usage:
    # Start the dev server first (port 3050), then:
    python web/tools/generate_chords.py

Output: web/tools/chords.json
Next step: python web/tools/build_sheet_by_chord.py
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent / 'chords.json'
SERVER_URL = 'http://127.0.0.1:3050/index.html'

FAMILIES = ['E', 'A', 'D']
QUALITIES = ['', 'm', 'maj7', '7', 'm7', 'dim7', 'm7b5', 'sus2', 'sus4']
QUALITY_LABELS = {
    '': 'Major', 'm': 'Minor', 'maj7': 'Maj7', '7': 'Dominant 7', 'm7': 'Minor 7',
    'dim7': 'Diminished 7', 'm7b5': 'Half-dim 7 (m7b5)', 'sus2': 'Sus2', 'sus4': 'Sus4',
    '6': '6', 'add9': 'Add9', 'aug': 'Augmented', 'dim': 'Diminished (triad)',
}
# dim7 and aug are the only two common qualities that are fully symmetric
# (the shape repeats and IS the same chord, just a different inversion --
# verified via interval-set math, not folklore).
SYMMETRY_NOTE = {
    'dim7': '对称和弦：每 3 品是同一个和弦',
    'aug': '对称和弦：每 4 品是同一个和弦',
}

# E/A-shape major & minor triads don't need a reference diagram;
# D-shape's are also dropped (each only has one card, wasting a grid row).
SKIP = {('E', ''), ('E', 'm'), ('A', ''), ('A', 'm'), ('D', ''), ('D', 'm')}

# Illustrative fixed barre fret so svguitar draws a barre line --
# the number itself is stripped from the rendered output.
FIXED_BARRE = 3

main_specs = []
for family in FAMILIES:
    for quality in QUALITIES:
        if (family, quality) in SKIP:
            continue
        if family == 'E' and quality == 'sus2':
            continue  # 5-fret stretch, rarely used
        main_specs.append(('movable', family, quality, None, SYMMETRY_NOTE.get(quality)))
        # No-barre simplified grip for E-shape 7th chords: mute BOTH the A
        # string (5th) and the high-e string (1st).
        if family == 'E' and quality in ('7', 'm7', 'maj7'):
            main_specs.append(('nobarre', family, quality, None, None))

# Extended/local-interval qualities not in FB_CHORD_QUALITIES.
EXT_QUALITIES = {
    '6':    {'intervals': [0, 4, 7, 9], 'labels': ['1', '3', '5', '6']},
    'add9': {'intervals': [0, 2, 4, 7], 'labels': ['1', '9', '3', '5']},
    'aug':  {'intervals': [0, 4, 8], 'labels': ['1', '3', '#5']},
    'dim':  {'intervals': [0, 3, 6], 'labels': ['1', 'b3', 'b5']},
}
EXT_SHAPES = {
    ('E', '6'):    [3, 'x', 2, 4, 3, 'x'],
    ('A', '6'):    ['x', 3, 2, 2, 'x', 'x'],   # 5th omitted -- unreachable within a compact span
    ('D', '6'):    ['x', 'x', 3, 5, 3, 5],
    ('E', 'add9'): [3, 2, 'x', 2, 3, 'x'],
    ('A', 'add9'): ['x', 3, 2, 'x', 3, 3],
    ('D', 'add9'): ['x', 'x', 3, 2, 1, 3],
    ('E', 'aug'):  [3, 2, 1, 'x', 'x', 'x'],
    ('E', 'dim'):  [3, 4, 'x', 3, 'x', 'x'],
    ('A', 'aug'):  ['x', 3, 2, 1, 'x', 'x'],
    ('A', 'dim'):  ['x', 3, 4, 'x', 4, 'x'],
    ('D', 'aug'):  ['x', 'x', 3, 2, 2, 'x'],
    ('D', 'dim'):  ['x', 'x', 3, 4, 'x', 4],
}

for family in FAMILIES:
    for eq in ['6', 'add9', 'aug', 'dim']:
        main_specs.append(('ext', family, eq, None, SYMMETRY_NOTE.get(eq)))

# Shell chords: root + 3rd + 7th only (no 5th) — jazz comping voicings.
# Fret offsets relative to barre position (same convention as FB_MOVABLE_SHAPES).
# Verified via FB_STRING_OPEN = [4,9,2,7,11,4]:
#   E-shape (root str=0, open=4):  D str(open=2) @ 0 → b7; G str(open=7) @ 1 → maj3; G@0 → min3; D@1 → maj7
#   A-shape (root str=1, open=9):  G str(open=7) @ 0 → b7; B str(open=11) @ 2 → maj3; B@1 → min3; G@1 → maj7
#   D-shape (root str=2, open=2):  B str(open=11) @ 1 → b7; e str(open=4) @ 2 → maj3; e@1 → min3; B@2 → maj7
SHELL_PATTERNS = {
    ('E', '7'):    [0, 'x', 0, 1, 'x', 'x'],
    ('E', 'm7'):   [0, 'x', 0, 0, 'x', 'x'],
    ('E', 'maj7'): [0, 'x', 1, 1, 'x', 'x'],
    ('A', '7'):    ['x', 0, 'x', 0, 2, 'x'],
    ('A', 'm7'):   ['x', 0, 'x', 0, 1, 'x'],
    ('A', 'maj7'): ['x', 0, 'x', 1, 2, 'x'],
    ('D', '7'):    ['x', 'x', 0, 'x', 1, 2],
    ('D', 'm7'):   ['x', 'x', 0, 'x', 1, 1],
    ('D', 'maj7'): ['x', 'x', 0, 'x', 2, 2],
}
for family in FAMILIES:
    for quality in ['7', 'm7', 'maj7']:
        main_specs.append(('shell', family, quality, None, None))

print(f"Total main: {len(main_specs)}")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 400, 'height': 400})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(SERVER_URL)
    page.wait_for_timeout(300)

    def render(kind, letter_or_family, quality, barre_forced):
        js = """
        ({kind, family, quality, barre, extFrets, extIntervals, extLabels, shellFrets}) => {
          let shape, degreeLabels, barreFret, forceNoBarre = false;
          if (kind === 'movable') {
            const fam = FB_MOVABLE_SHAPES[family];
            const pattern = fam.patterns[quality];
            shape = { frets: pattern.frets, rootString: fam.rootString, rootFret: pattern.rootFret };
            degreeLabels = fbShapeDegreeLabels(shape, quality);
            barreFret = barre;
          } else if (kind === 'nobarre') {
            const fam = FB_MOVABLE_SHAPES[family];
            const pattern = fam.patterns[quality];
            // mute string index 1 (A) AND index 5 (high e) -- both, not just one
            const frets = pattern.frets.map((v, i) => (i === 1 || i === 5) ? 'x' : v);
            shape = { frets, rootString: fam.rootString, rootFret: pattern.rootFret };
            degreeLabels = fbShapeDegreeLabels(shape, quality);
            barreFret = barre;
            forceNoBarre = true;
          } else if (kind === 'shell') {
            // Shell chord: root + 3rd + 7th, no 5th. Uses the same movable
            // shape family (E/A/D) for root position, but only 3 strings.
            const fam = FB_MOVABLE_SHAPES[family];
            const pattern = fam.patterns[quality];
            shape = { frets: shellFrets, rootString: fam.rootString, rootFret: pattern.rootFret };
            degreeLabels = fbShapeDegreeLabels(shape, quality);
            barreFret = barre;
            forceNoBarre = true;
          } else { // ext: 6/add9/aug/dim, local interval table
            shape = { frets: extFrets, rootString: extFrets.findIndex(f => f !== 'x'), rootFret: null };
            shape.rootFret = extFrets[shape.rootString];
            const map = {};
            extIntervals.forEach((iv, idx) => { map[iv] = extLabels[idx]; });
            const rootBase = FB_STRING_OPEN[shape.rootString] + shape.rootFret;
            degreeLabels = shape.frets.map((v, i) => {
              if (v === 'x') return null;
              const offset = ((FB_STRING_OPEN[i] + v - rootBase) % 12 + 12) % 12;
              return map[offset] || '?';
            });
            barreFret = 3; // same illustrative convention as the rest of the sheet
          }

          let fingers, barres;
          if (forceNoBarre) {
            // build fingers directly, bypassing fbShapeToSvguitarChord's
            // barre auto-detection -- it groups ANY strings sharing the same
            // relative fret into one barre, even non-adjacent ones.
            fingers = [];
            shape.frets.forEach((v, i) => {
              const svString = 6 - i;
              if (v === 'x') { fingers.push([svString, svguitar.SILENT]); return; }
              const isRoot = i === shape.rootString && v === shape.rootFret;
              const label = degreeLabels && degreeLabels[i] ? degreeLabels[i] : undefined;
              const relFret = v + 1;
              const opts = { color: isRoot ? '#b8843a' : '#4a7c4a' };
              if (label) opts.text = label;
              fingers.push([svString, relFret, opts]);
            });
            barres = [];
          } else {
            ({ fingers, barres } = fbShapeToSvguitarChord(shape, barreFret, degreeLabels));
          }

          // Shift frets so the first active note sits at row 1 (no empty rows
          // at the top).
          let minF = Infinity;
          fingers.forEach(f => { if (typeof f[1] === 'number') minF = Math.min(minF, f[1]); });
          (barres || []).forEach(b => { minF = Math.min(minF, b.fret); });
          const fretShift = minF === Infinity ? 0 : minF - 1;
          if (fretShift > 0) {
            fingers = fingers.map(f => typeof f[1] === 'number' ? [f[0], f[1] - fretShift, f[2]] : f);
            barres = barres.map(b => ({ ...b, fret: b.fret - fretShift }));
          }

          (barres || []).forEach(b => { b.color = '#b7b2a6'; b.style = svguitar.BarreChordStyle.ARC; });

          // Use only as many fret rows as needed (min 2) — svguitar keeps each
          // fret row exactly the same height (105.6 viewport units) regardless
          // of how many rows there are, so cards will have different heights but
          // each individual row will look the same size on screen.
          let maxFret = 1;
          fingers.forEach(f => { if (typeof f[1] === 'number' && f[1] > maxFret) maxFret = f[1]; });
          (barres || []).forEach(b => { if (b.fret > maxFret) maxFret = b.fret; });
          const fretsToShow = Math.max(2, maxFret);

          // fingerSize 0.82 → degree label inside dots ≈ 11px at the 170px
          // HTML card width (vs. 6px with 0.68); print uses 108px cards where
          // the labels come out ≈ 7px — larger than before, still A4-printable.
          const fingerSize = 0.82;

          const el = document.createElement('div');
          document.body.appendChild(el);
          new svguitar.SVGuitarChord(el)
            .configure({
              strings: 6, frets: fretsToShow,
              color: '#8a8578',
              fingerColor: '#4a7c4a',
              fingerTextColor: '#fff',
              fretLabelFontSize: 30,
              strokeWidth: 2,
              fingerSize,
              sidePadding: 0.06,
            })
            .chord({ fingers, barres, position: barreFret === 0 ? 1 : barreFret })
            .draw();

          const svgEl = el.querySelector('svg');
          // Remove decorative labels; keep svguitar's natural viewBox — it
          // already encodes the correct per-row height.
          svgEl.querySelectorAll('.fret-position, .tuning, .title').forEach(n => n.remove());
          // svguitar hard-codes font-size=24 SVG units for finger-dot labels,
          // independent of fingerSize.  Scale it up to 36 so the degree labels
          // are readable at the card widths used in HTML (140px, ≈11.5px on
          // screen) and print (80px, ≈6.1px).  36 still fits inside the dots
          // (radius 28.9 SVG units; 2-char label "b7" ≈ 38 SVG units wide ≤
          // diameter 57.7).
          svgEl.querySelectorAll('.finger-text').forEach(t => t.setAttribute('font-size', '36'));
          svgEl.removeAttribute('width');
          svgEl.removeAttribute('height');
          return svgEl.outerHTML;
        }
        """
        ext_frets = EXT_SHAPES.get((letter_or_family, quality))
        ext_def = EXT_QUALITIES.get(quality, {})
        shell_frets = SHELL_PATTERNS.get((letter_or_family, quality))
        return page.evaluate(js, {
            "kind": kind, "family": letter_or_family, "quality": quality, "barre": barre_forced,
            "extFrets": ext_frets, "extIntervals": ext_def.get('intervals'), "extLabels": ext_def.get('labels'),
            "shellFrets": shell_frets,
        })

    def build(specs, section):
        out = []
        for kind, fam, quality, note, symmetry in specs:
            try:
                svg = render(kind, fam, quality, FIXED_BARRE)
            except Exception as e:
                print(f"ERROR rendering {kind} {fam} {quality}: {e}")
                raise
            if kind == 'nobarre':
                label = QUALITY_LABELS[quality] + '（免横按）'
            elif kind == 'shell':
                label = QUALITY_LABELS[quality] + '（壳）'
            else:  # movable, ext
                label = QUALITY_LABELS[quality]
            out.append({"kind": kind, "family": fam, "quality": quality, "label": label, "svg": svg,
                         "section": section, "note": note, "symmetry": symmetry})
        return out

    results = build(main_specs, 'main')
    print("errors during generation:", errors)
    browser.close()

with open(OUT, 'w') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"Generated {len(results)} entries → {OUT}")
