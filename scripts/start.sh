#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../backend"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -e ".[dev]"
export VIDEO_MAKER_STORAGE_DIR="${VIDEO_MAKER_STORAGE_DIR:-../storage}"
uvicorn app.main:app --reload --host 0.0.0.0 --port "${PORT:-8000}"
