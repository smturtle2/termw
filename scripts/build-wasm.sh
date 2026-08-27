#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/wterm"
OUT_WASM="$ROOT/public/wterm.wasm"
VENDOR_WASM="$VENDOR/packages/@wterm/core/wasm/wterm.wasm"

# If zig not available, just copy existing vendor wasm
if ! command -v zig >/dev/null 2>&1; then
  echo "[termw] zig not found — copying prebuilt $VENDOR_WASM -> $OUT_WASM"
  cp "$VENDOR_WASM" "$OUT_WASM"
  exit 0
fi

# Check if rebuild needed (src newer than out) unless --force
if [[ "${1:-}" != "--force" && -f "$OUT_WASM" ]]; then
  if [[ "$VENDOR/src/terminal.zig" -ot "$OUT_WASM" && "$VENDOR/src/wasm_api.zig" -ot "$OUT_WASM" && "$VENDOR/src/parser.zig" -ot "$OUT_WASM" ]]; then
    echo "[termw] wasm up-to-date $OUT_WASM"
    exit 0
  fi
fi

echo "[termw] building wasm via zig..."
pushd "$VENDOR" >/dev/null
zig build -Doptimize=ReleaseSmall
# Update inline base64 for fallback (core/dist not needed for termw but keep in sync)
cp zig-out/bin/wterm.wasm packages/@wterm/core/wasm/wterm.wasm
if [[ -f packages/@wterm/core/scripts/inline-wasm.js ]]; then
  node packages/@wterm/core/scripts/inline-wasm.js || true
fi
popd >/dev/null

echo "[termw] copy $VENDOR_WASM -> $OUT_WASM"
cp "$VENDOR_WASM" "$OUT_WASM"
# Rebuild inline file for termw vendor too
if [[ -f "$VENDOR/packages/@wterm/core/src/wasm-inline.ts" ]]; then
  echo "[termw] wasm-inline updated"
fi
echo "[termw] done $(ls -lh "$OUT_WASM")"
