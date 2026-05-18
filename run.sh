#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Starting Music Practice server..."
echo "Open http://localhost:8765 in your browser"
python -m uvicorn src.server:app --port 8765 --reload
