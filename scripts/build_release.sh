#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.0.0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
PKG_NAME="weewx-frostline-v${VERSION}"
STAGE_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

PKG_ROOT="$STAGE_DIR/$PKG_NAME"
mkdir -p "$PKG_ROOT/skins/frostline" "$DIST_DIR"

cp "$ROOT_DIR/install.py" "$PKG_ROOT/install.py"
cp "$ROOT_DIR/LICENSE" "$PKG_ROOT/LICENSE"
cp "$ROOT_DIR/README.md" "$PKG_ROOT/README.md"
cp "$ROOT_DIR/changelog" "$PKG_ROOT/changelog"

rsync -a \
  --exclude='.DS_Store' \
  --exclude='__pycache__/' \
  --exclude='*.py[cod]' \
  "$ROOT_DIR/frostline/" "$PKG_ROOT/skins/frostline/"

OUT_TAR="$DIST_DIR/${PKG_NAME}.tar.gz"
tar -C "$STAGE_DIR" -czf "$OUT_TAR" "$PKG_NAME"

echo "Built $OUT_TAR"
tar -tzf "$OUT_TAR"
