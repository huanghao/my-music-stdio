"""
Regression tests for the chord reference sheet SVG output.

These tests verify that generate_chords.py produced a well-formed chords.json
with uniform card dimensions.  Run after generating:

    python web/tools/generate_chords.py   # requires dev server on :3050
    python -m pytest tests/test_chord_sheet.py -v
"""
import json
import math
import re
from pathlib import Path

import pytest

CHORDS_JSON = Path(__file__).parent.parent / 'web' / 'tools' / 'chords.json'


@pytest.fixture(scope="module")
def chords():
    if not CHORDS_JSON.exists():
        pytest.skip(f"chords.json not found at {CHORDS_JSON}; run generate_chords.py first")
    with open(CHORDS_JSON) as f:
        return json.load(f)


def viewbox(svg: str):
    """Return (x, y, w, h) from viewBox attribute."""
    m = re.search(r'viewBox="([^"]+)"', svg)
    assert m, "SVG missing viewBox"
    return list(map(float, m.group(1).split()))


def count_string_lines(svg: str) -> int:
    """Count vertical <line> elements (= guitar strings) in the SVG."""
    matches = re.findall(
        r'<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)" y2="[\d.]+"',
        svg,
    )
    return sum(1 for x1, x2 in matches if math.isclose(float(x1), float(x2), abs_tol=0.5))


def count_finger_circles(svg: str) -> int:
    return len(re.findall(r'class="finger[^"]*finger-circle"', svg))


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_total_count(chords):
    """Should produce exactly 44 entries (35 original + 9 shell chords)."""
    assert len(chords) == 44, f"Expected 44, got {len(chords)}"


def test_all_have_svg(chords):
    for c in chords:
        assert c.get("svg"), f"{c['family']} {c['kind']} {c['quality']} missing svg"


def test_viewbox_height_in_expected_set(chords):
    """Each card's viewBox height must be one of the four values produced by
    svguitar for the chord configurations we generate.

    svguitar keeps per-fret height exactly 105.60 viewport units (confirmed
    empirically: 4-row-mute minus 3-row-mute = 105.60; 3-row-mute minus
    2-row-mute = 105.60).  Overhead varies by configuration:
      - muted strings add  +24.41 px above the nut
      - barre-arc (ARC style) adds +23.91 px above the nut
      - E-nobarre shapes (2 muted strings, no barre) add +48.32 px

    The four actually-occurring heights for our 35 chords:
      294.16 → 2-row, muted, no barre arc  (E-nobarre shapes)
      375.35 → 3-row, no-muted, barre arc  (E-movable shapes)
      399.76 → 3-row, muted, barre arc     (A/D-movable + some ext)
      505.36 → 4-row, muted, barre arc     (A-sus4, D-sus2, D-sus4)
    """
    # Heights measured with fingerSize=0.82; the barre arc (ARC style) sits
    # above the nut and scales with fingerSize, so the E-movable bucket
    # shifted from 375.35 (fingerSize=0.68) → 381.93 (fingerSize=0.82).
    VALID = {294.16, 381.93, 399.76, 505.36}
    TOL = 1.0
    for c in chords:
        _, _, _, h = viewbox(c["svg"])
        assert any(abs(h - v) < TOL for v in VALID), (
            f"{c['family']}-{c['kind']} {c['quality']}: "
            f"height {h:.2f} not in expected set {sorted(VALID)}"
        )


def test_uniform_viewbox_width(chords):
    """All cards must have the same viewBox width (within 1 px)."""
    widths = [viewbox(c["svg"])[2] for c in chords]
    w0 = widths[0]
    bad = [
        (w, c["family"], c["kind"], c["quality"])
        for w, c in zip(widths, chords)
        if abs(w - w0) > 1.0
    ]
    assert not bad, (
        f"Cards with different widths (expected ≈{w0:.0f}):\n"
        + "\n".join(f"  {fam}-{kind} {q}: {w:.0f}" for w, fam, kind, q in bad)
    )


def test_all_six_strings(chords):
    """Every card must draw exactly 6 vertical string lines.

    Previous bug: edge-muted strings were stripped before rendering, producing
    3-string diagrams for some ext shapes (e.g. A6 = [x,3,2,2,x,x]).
    """
    for c in chords:
        n = count_string_lines(c["svg"])
        assert n == 6, (
            f"{c['family']}-{c['kind']} {c['quality']}: expected 6 string lines, got {n}"
        )


def test_each_chord_has_fingers(chords):
    """Every card must have at least 3 finger dots (open/fretted notes)."""
    for c in chords:
        n = count_finger_circles(c["svg"])
        assert n >= 3, (
            f"{c['family']}-{c['kind']} {c['quality']}: only {n} finger dots"
        )


def test_finger_text_font_size_36(chords):
    """Degree labels inside the finger dots must have font-size=36 SVG units.

    svguitar hard-codes font-size=24, which renders too small at the card
    widths we use.  generate_chords.py post-processes the SVG to bump it to
    36 (still fits inside dots with fingerSize=0.82, radius≈28.9 units;
    2-char labels like 'b7' ≈ 37.8 units wide < diameter 57.7).
    """
    for c in chords:
        fsizes = set(re.findall(r'font-size="([\d.]+)"', c["svg"]))
        assert fsizes == {"36"}, (
            f"{c['family']}-{c['kind']} {c['quality']}: "
            f"expected only font-size=36, got {fsizes}"
        )


def test_required_families_present(chords):
    """Each quality (except intentionally skipped) must have E, A, D entries."""
    from itertools import product
    by = {(c["family"], c["quality"]): c for c in chords if c["kind"] != "nobarre"}
    # Qualities that should have all three families in the main movable set
    core_qualities = ["maj7", "7", "m7", "dim7", "m7b5", "sus4"]
    for fam, q in product(["E", "A", "D"], core_qualities):
        if fam == "E" and q == "sus2":
            continue  # intentionally excluded (5-fret stretch)
        assert (fam, q) in by, f"Missing {fam}-shape {q}"


def test_nobarre_only_for_e_shape_sevenths(chords):
    """No-barre variants should only exist for E-shape 7/m7/maj7."""
    for c in chords:
        if c["kind"] == "nobarre":
            assert c["family"] == "E", f"Unexpected nobarre for {c['family']}-shape"
            assert c["quality"] in ("7", "m7", "maj7"), (
                f"Unexpected nobarre quality {c['quality']}"
            )


def test_aspect_ratio_sensible(chords):
    """height/width ratio must be within the range produced by valid fret/mute
    combinations.  Narrowest = 2-fret no-mute (245.84/400 ≈ 0.61);
    tallest = 4-fret muted (513.36/400 ≈ 1.28)."""
    for c in chords:
        _, _, w, h = viewbox(c["svg"])
        ratio = h / w
        assert 0.55 <= ratio <= 1.35, (
            f"{c['family']}-{c['kind']} {c['quality']}: "
            f"aspect ratio {ratio:.2f} out of acceptable range [0.55, 1.35]"
        )
