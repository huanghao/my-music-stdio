#!/bin/bash
# One-shot: tab video -> pages -> panorama -> 4-bars-per-row PDF.
# usage: video_to_score.sh VIDEO.mp4 OUTDIR Y0 H [FPS=4]
#   Y0/H = the tab strip's rows in the 1920x1080 frame (look at a frame first: ffmpeg -ss 10 -i V -frames:v 1 f.png)
# Tunables via env (see README / docs): MINN FIXED_STAFF MAXOV MIN_NCC REG_BELOW MERGE_MIN_NCC
# Defaults below suit "a handful of pages, page-flip layout". For fast flips (many pages, ~2s each): MINN=3.
set -euo pipefail
V=$1; OUT=$2; Y0=$3; H=$4; FPS=${5:-4}
HERE=$(cd "$(dirname "$0")" && pwd)
export PYTHONPATH=$HERE MAXOV=${MAXOV:-1500} MIN_NCC=${MIN_NCC:-0.55} REG_BELOW=${REG_BELOW:-8}
mkdir -p "$OUT"
python3 -s "$HERE/video_pages.py" "$V" "$OUT/p" "$FPS" "$Y0" "$H"
python3 -s "$HERE/video_tab.py" "$OUT/p" "$OUT/pano" | grep -E "unique|staff|weak|panorama|barlines" | cut -c1-200
python3 -s "$HERE/compose_rows.py" "$OUT/pano" "$OUT/score.pdf" 4
qlmanage -t -s 1700 -o "$OUT" "$OUT/score.pdf" >/dev/null 2>&1 && echo "preview: $OUT/score.pdf.png (look at it before publishing!)"
