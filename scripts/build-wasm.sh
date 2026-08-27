#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor/wterm"
OUT_WASM="$ROOT/public/wterm.wasm"
VENDOR_WASM="$VENDOR/packages/@wterm/core/wasm/wterm.wasm"
VENDOR_CSS="$VENDOR/packages/@wterm/dom/src/terminal.css"
OUT_CSS="$ROOT/public/terminal.css"

sync_css() {
  if [[ -f "$VENDOR_CSS" ]]; then
    # public/terminal.css is a vendored copy — keep header + vendor body
    local header="/* termw — vendored from vendor/wterm/packages/@wterm/dom/src/terminal.css — do not edit manually */"
    if [[ -f "$OUT_CSS" ]] && head -1 "$OUT_CSS" | grep -q "vendored from"; then
      header="$(head -1 "$OUT_CSS")"
    fi
    { echo "$header"; cat "$VENDOR_CSS"; } > "$OUT_CSS.tmp" && mv "$OUT_CSS.tmp" "$OUT_CSS"
    echo "[termw] css synced $VENDOR_CSS -> $OUT_CSS"
  fi
}

# If zig not available, just copy existing vendor wasm + sync css
if ! command -v zig >/dev/null 2>&1; then
  echo "[termw] zig not found — copying prebuilt $VENDOR_WASM -> $OUT_WASM"
  cp "$VENDOR_WASM" "$OUT_WASM"
  sync_css
  exit 0
fi

# Check if rebuild needed (src newer than out) unless --force
if [[ "${1:-}" != "--force" && -f "$OUT_WASM" ]]; then
  if [[ "$VENDOR/src/terminal.zig" -ot "$OUT_WASM" && "$VENDOR/src/wasm_api.zig" -ot "$OUT_WASM" && "$VENDOR/src/parser.zig" -ot "$OUT_WASM" ]]; then
    echo "[termw] wasm up-to-date $OUT_WASM"
    sync_css
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
sync_css
# Rebuild inline file for termw vendor too
if [[ -f "$VENDOR/packages/@wterm/core/src/wasm-inline.ts" ]]; then
  echo "[termw] wasm-inline updated"
fi
echo "[termw] done $(ls -lh "$OUT_WASM")"
