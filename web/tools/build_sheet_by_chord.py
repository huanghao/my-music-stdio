"""
Build chord-reference-sheet-by-chord.html from chords.json.

Usage:
    python web/tools/build_sheet_by_chord.py

Reads:  web/tools/chords.json   (produced by generate_chords.py)
Writes: web/chord-reference-sheet-by-chord.html
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
CHORDS_JSON = HERE / 'chords.json'
OUT_HTML = HERE.parent / 'chord-reference-sheet-by-chord.html'

with open(CHORDS_JSON) as f:
    chords = json.load(f)

QUALITY_LABELS = {
    '7': 'Dominant 7', 'm7': 'Minor 7', 'maj7': 'Maj7',
    'sus4': 'Sus4', 'sus2': 'Sus2', 'dim7': 'Diminished 7', 'm7b5': 'Half-dim 7 (m7b5)',
    '6': '6', 'add9': 'Add9', 'aug': 'Augmented', 'dim': 'Diminished (triad)',
}
# 每行并排两个 section，配对如下：
QUALITY_PAIRS = [
    ('7',    'dim7'),   # 属七 — 减七
    ('m7',   'm7b5'),   # 小七 — 半减七
    ('maj7', None),     # 大七
    ('sus2', 'sus4'),   # sus2 — sus4
    ('6',    'add9'),   # 6 — add9
    ('aug',  'dim'),    # 增三 — 减三
]

FAMILY_TAG = {'E': 'E-shape', 'A': 'A-shape', 'D': 'D-shape'}

by_quality = {}
for c in chords:
    by_quality.setdefault(c['quality'], []).append(c)

FAMILY_RANK = {'E': 0, 'A': 1, 'D': 2}
# Shell chords appear after all movable/nobarre cards in the same section.
KIND_GROUP = {'movable': 0, 'nobarre': 0, 'ext': 0, 'shell': 1}
def sort_key(c):
    return (KIND_GROUP.get(c['kind'], 0), FAMILY_RANK[c['family']], 1 if c['kind'] == 'nobarre' else 0)

def render_card(c):
    sym = f'<div class="card-sym">{c["symmetry"]}</div>' if c.get('symmetry') else ''
    if c['kind'] == 'nobarre':
        tag = FAMILY_TAG[c['family']] + '（免横按）'
    elif c['kind'] == 'shell':
        tag = FAMILY_TAG[c['family']] + '（壳）'
    else:
        tag = FAMILY_TAG[c['family']]
    return f'''
    <div class="card">
      <div class="card-tag">{tag}</div>
      <div class="card-svg">{c['svg']}</div>
      {sym}
    </div>'''

def render_section(quality):
    items = sorted(by_quality.get(quality, []), key=sort_key)
    if not items:
        return ''
    cards = ''.join(render_card(c) for c in items)
    return f'''
    <section class="q-section">
      <h2>{QUALITY_LABELS[quality]}</h2>
      <div class="card-row">{cards}</div>
    </section>'''

pair_rows = []
for left_q, right_q in QUALITY_PAIRS:
    left_html = render_section(left_q)
    right_html = render_section(right_q) if right_q else ''
    pair_rows.append(f'<div class="section-pair">{left_html}{right_html}</div>')

total = len(chords)

html = f'''<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>吉他和弦指型参考表 — Music Practice</title>
<style>
  :root {{ --card-width: 140px; }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f0efe8; color: #2a2a2a; margin: 0; padding: 0 0 30px;
  }}
  .toolbar {{
    position: sticky; top: 0; z-index: 10;
    background: #fff; border-bottom: 1px solid #ddd;
    padding: 10px 24px; display: flex; align-items: center; gap: 16px;
  }}
  .toolbar h1 {{ font-size: 15px; font-weight: 600; margin: 0; }}
  .toolbar .src {{ font-size: 11px; color: #aaa; }}
  .toolbar .spacer {{ flex: 1; }}
  .toolbar button {{
    background: #4a7c4a; color: #fff; border: none; border-radius: 6px;
    padding: 7px 16px; font-size: 13px; cursor: pointer;
  }}
  .toolbar .hint {{ font-size: 12px; color: #888; }}

  main {{
    max-width: 1600px; margin: 0 auto; padding: 14px 4px;
  }}

  /* 每行两个 section 并排：左列-右列固定配对，和 column-count 不同 */
  .section-pair {{ display: flex; gap: 24px; margin-bottom: 16px; }}
  .section-pair .q-section {{ flex: 1; min-width: 0; margin-bottom: 0; }}
  .q-section {{ margin-bottom: 0; }}
  .q-section h2 {{ font-size: 16px; margin: 0 0 8px; font-weight: 700; font-family: Georgia, serif; }}

  /* --card-width controlled by the size slider in the toolbar (default 140px).
     Every card has the same width so all chord diagrams render at the same
     scale; each fret row stays identical in height across all cards. */
  .card-row {{ display: flex; flex-wrap: wrap; gap: 8px; }}
  .card {{
    background: #fff; border: 1px solid #ddd; border-radius: 6px;
    padding: 6px; text-align: center; width: var(--card-width, 140px); flex: 0 0 auto;
  }}
  .card-tag {{ font-size: 12px; font-weight: 600; color: #4a7c4a; margin-bottom: 2px; }}
  .card-svg svg {{ width: 100%; height: auto; display: block; }}
  .card-sym {{ font-size: 10px; color: #6a8caa; margin-top: 4px; line-height: 1.4; }}

  @media print {{
    /* margin: 0 → browser suppresses its own header/footer (date, URL).
       Content padding is applied to main instead. */
    @page {{ size: A4; margin: 0; }}
    body {{ background: #fff; padding: 0; }}
    .toolbar {{ display: none; }}
    main {{ max-width: none; padding: 10mm; }}
    .section-pair {{ gap: 10mm; margin-bottom: 8px; break-inside: avoid; }}
    .card-row {{ gap: 4px; }}
    /* 80px → 4 per row fits in A4 half-column (4×80+3×4=332px ≤ ~380px).
       finger-label font (36 SVG units × 72/400) ≈ 6.5px. */
    .card {{ break-inside: avoid; border: 1px solid #ccc; width: 80px; padding: 4px; }}
  }}
</style>
</head>
<body>

<div class="toolbar">
  <h1>🎵 吉他和弦指型参考表</h1>
  <span class="src">共 {total} 个可移动指型，按和弦性质分组 — 每组内是不同手型（E/A/D-shape）</span>
  <span class="spacer"></span>
  <span class="hint" style="display:flex;align-items:center;gap:6px;white-space:nowrap">
    📐
    <input type="range" id="card-size-slider" min="80" max="220" value="140" step="10" style="width:90px"
      oninput="document.documentElement.style.setProperty('--card-width',this.value+'px');document.getElementById('card-size-val').textContent=this.value+'px'">
    <span id="card-size-val">140px</span>
  </span>
  <span class="hint">Cmd/Ctrl + P 另存为 PDF</span>
  <button onclick="window.print()">打印 / 导出 PDF</button>
</div>

<main>
  {''.join(pair_rows)}
</main>

</body>
</html>
'''

with open(OUT_HTML, 'w') as f:
    f.write(html)
print(f"Wrote {OUT_HTML}, {len(html)} bytes, total={total}")
