dev:
    python -m uvicorn src.server:app --port 8765 --reload

test:
    python -m pytest tests/ -v

test-js:
    npm test

lint:
    python -m ruff check src/ tests/

lint-fix:
    python -m ruff check --fix src/ tests/

format:
    python -m ruff format src/ tests/
