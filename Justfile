dev:
    python -m uvicorn src.server:app --port 8765 --reload

test:
    python -m pytest tests/ -v
