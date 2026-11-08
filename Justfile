dev:
    python -m uvicorn src.server:app --port 8765 --reload

# FluidSynth lives under a custom prefix on this machine (same value as app-nanny.toml);
# without it every server-importing test errors with "Couldn't find the FluidSynth library".
test:
    HOMEBREW_PREFIX=${HOMEBREW_PREFIX:-$HOME/.local/opt/my-music-fluidsynth} ${PYTHON:-.venv/bin/python} -m pytest tests/ -v

# Browser smoke test against the running dev server (needs Chrome, server on :3050, read-only).
smoke:
    node tests/browser/smoke.mjs

test-js:
    npm test

lint:
    python -m ruff check src/ tests/

lint-fix:
    python -m ruff check --fix src/ tests/

format:
    python -m ruff format src/ tests/
