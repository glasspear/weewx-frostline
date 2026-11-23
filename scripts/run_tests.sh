#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Error: .venv not found at $ROOT_DIR/.venv" >&2
  exit 1
fi

"$PYTHON_BIN" -m unittest discover -s "$ROOT_DIR/tests" -p "test_*.py" -v
"$PYTHON_BIN" "$ROOT_DIR/scripts/build_preview.py" --output "$ROOT_DIR/preview"
