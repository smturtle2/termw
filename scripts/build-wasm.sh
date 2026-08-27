#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/wterm"
VENDOR_WASM="$VENDOR/packages/@wterm/core/wasm/wterm.wasm"

# termw runs the freestanding zig core server-side; the only build artifact it
# needs is the compiled wasm at VENDOR_WASM. public/terminal.css is the
# canonical stylesheet (no longer synced from the unused @wterm/dom package).
if ! command -v zig >/dev/null 2>&1; then
  echo "[termw] zig not found — using prebuilt $VENDOR_WASM"
  exit 0
fi

if [[ "${1:-}" != "--force" && -f "$VENDOR_WASM" ]]; then
  if [[ "$VENDOR/src/terminal.zig" -ot "$VENDOR_WASM" && "$VENDOR/src/wasm_api.zig" -ot "$VENDOR_WASM" && "$VENDOR/src/parser.zig" -ot "$VENDOR_WASM" ]]; then
    echo "[termw] wasm up-to-date $VENDOR_WASM"
    exit 0
  fi
fi

echo "[termw] building wasm via zig..."
pushd "$VENDOR" >/dev/null
zig build -Doptimize=ReleaseSmall
cp zig-out/bin/wterm.wasm packages/@wterm/core/wasm/wterm.wasm
popd >/dev/null

echo "[termw] done $(ls -lh "$VENDOR_WASM")"