# Patches vs upstream vercel-labs/wterm (cdff1c0)

This vendored copy includes 8 local patches required for Korean IME and server-driven theme.

Upstream: https://github.com/vercel-labs/wterm
Base commit: cdff1c0 (fix(dom): preserve fractional autoscroll)

## 1. `src/parser.zig` — OSC terminator discrimination
- Added `osc_terminated_by_st: bool`
- `feed(0x1B)` in `osc_string` now sets `true` and returns `osc_dispatch`
- `handleEscape ESC ']'` resets `false`, `handleOscString BEL` resets `false`
- Why: OSC 10/11 replies must echo the terminator the client used (BEL vs ST `ESC \`). Needed for TUI luminance probes that expect exact echo.

## 2. `src/terminal.zig` — theme-aware OSC 10/11
- Added fields `theme_bg: u32 = 0xffffff`, `theme_fg: u32 = 0x000000`, `setTheme(bg,fg)`
- `handleOsc` no longer hardcodes `ffff/0000`; now expands `theme_bg/fg` `*257` → `rgb:RRRR/GGGG/BBBB` and echoes terminator via `parser.osc_terminated_by_st`.
- Why: Allows server-driven light/dark (`#ffffff` vs `#1e1e1e`) to be reported via `COLORFGBG` + OSC, so TUI picks correct variant without client hacks.

## 3. `src/wasm_api.zig` — expose theme to JS
- `init()` now calls `terminal.setTheme(0xffffff,0x000000)` after `reset` (device-independent default light)
- Added `export fn setThemeColors(bg_rgb, fg_rgb)` → `terminal.setTheme`
- Why: `undefined` global `terminal` would otherwise leave theme 0; default must be deterministic before JS sets server theme.

## 4. `packages/@wterm/core/src/wasm-bridge.ts` — JS boundary
- Added `setThemeColors?(bgRgb,fgRgb)` to `WasmExports`, `WasmBridge.setThemeColors()` forwarder
- Optional so old WASM still loads.

## 5. `packages/@wterm/dom/src/input.ts` — Korean IME composition
- Hidden textarea moved to `left:0 top:0 1ch` (was -9999px) + new `compositionView: span.term-composition` overlay (underline, `var(--term-bg)`).
- `handleKeyDown` guard: `if(composing || isComposing || keyCode===229 || key==="Process") return` (prevents 229 leak `s你好`).
- `compositionstart` → anchor + show overlay, `compositionupdate` → text, `compositionend` → `onData(committed)` + generic flush `textarea.value` stripping `committed` prefix (handles `안녕` + `?` via Shift+/).
- Cursor anchoring via `.term-cursor` rect else `bridge.getCursor()` + `MutationObserver` + rAF coalescing; repositions on focus/compositionstart.

## 6. `packages/@wterm/dom/src/terminal.css` — composition visuals + light theme
- `::selection` `#b4d5fe`, `.term-composition` absolute underline, `.wterm.theme-korean-light` `{#000,#fff,#000}`.

## 7. `src/terminal.zig` — OSC 4;idx;? palette query replies
- `handleOsc` answers `4;<idx>;?` with `rgb:RRRR/GGGG/BBBB` (`*257` expansion, terminator echo) using `theme_bg` as fallback for any idx. Some TUIs (e.g. opentui) gate their `OSC 11` luminance probe on an `ESC]4;0;?` reply; without it the probe is ignored and the TUI falls back to its built-in default.

All patches are intentionally minimal and keep `Cell`/`Grid`/`hyperlink`/`unicode_width` contracts untouched. See git diff in `../wterm` for exact hunks.
