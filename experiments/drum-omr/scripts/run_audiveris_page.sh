#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 INPUT_PDF PAGE_NUMBER RUN_DIR [AUDIVERIS_OPTIONS...]" >&2
  exit 2
fi

input_pdf=$1
page_number=$2
run_dir=$3
audiveris_bin=${AUDIVERIS_BIN:-"$HOME/Applications/Audiveris.app/Contents/MacOS/Audiveris"}
shift 3
extra_args=("$@")

if [[ ! -f "$input_pdf" ]]; then
  echo "Input PDF not found: $input_pdf" >&2
  exit 1
fi
if [[ ! "$page_number" =~ ^[1-9][0-9]*$ ]]; then
  echo "Page number must be a positive integer: $page_number" >&2
  exit 2
fi
if [[ ! -x "$audiveris_bin" ]]; then
  echo "Audiveris executable not found or not executable: $audiveris_bin" >&2
  exit 1
fi

mkdir -p "$run_dir"

if command -v pdftoppm >/dev/null 2>&1; then
  pdftoppm -f "$page_number" -l "$page_number" -png -r 150 \
    "$input_pdf" "$run_dir/source-page"
fi

set +e
"$audiveris_bin" \
  -batch \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.oneLineStaves=true \
  -constant org.audiveris.omr.sheet.ProcessingSwitches.drumNotation=true \
  -sheets "$page_number" \
  -transcribe \
  -save \
  -export \
  -output "$run_dir" \
  "${extra_args[@]}" \
  "$input_pdf" 2>&1 | tee "$run_dir/audiveris.log"
audiveris_status=${PIPESTATUS[0]}
set -e

printf 'input=%s\npage=%s\nexit_code=%s\n' \
  "$input_pdf" "$page_number" "$audiveris_status" > "$run_dir/run-status.txt"

exit "$audiveris_status"
