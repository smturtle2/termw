# Patches vs upstream vercel-labs/wterm (cdff1c0)

termw runs the vendored `@wterm/core` **zig wasm** server-side (Bun) and is
its own rendering/input layer in `src/client/*`. The vendored JS packages
(`@wterm/core` wasm-bridge/terminal-core, `@wterm/dom`) are **unused** and kept
pristine upstream. Only the zig sources are patched; the compiled wasm at
`packages/@wterm/core/wasm/wterm.wasm` is the single artifact termw loads.

Upstream: https://github.com/vercel-labs/wterm
Base commit: cdff1c0 (fix(dom): preserve fractional autoscroll)

## `src/parser.zig` — OSC terminator discrimination
- `osc_terminated_by_st: bool`; `feed(0x1B)` in `osc_string` sets it; `ESC ']'`
  and BEL reset it.
- Why: OSC 10/11 replies echo the terminator the client used (BEL vs ST), which
  TUI luminance probes expect.

## `src/terminal.zig` — theme-aware OSC 10/11 + OSC 4 palette + 1003
- `theme_bg/theme_fg/setTheme`; `handleOsc` expands `*257` → `rgb:RRRR/GGGG/BBBB`.
- `4;<idx>;?` palette replies using `theme_bg` fallback (some TUIs gate their
  OSC 11 probe on `ESC]4;0;?`).
- DECSET `1003` now sets `mouse_tracking = 1003` (any-motion). opencode enables
  1000+1002+1003+1006 and relies on 1003 for pan/scroll; without it SGR moves
  with no button held never arrive.

## `src/wasm_api.zig` — expose theme to JS
- `init()` applies `setTheme(0xffffff,0x000000)`; exports `setThemeColors`.
- Why: deterministic default before the server applies theme.json.

Server integration lives in `src/server/core.ts` (headless wasm wrapper) and
`src/server/viewport.ts` (server-owned scrollback viewport); the client renders
binary frames from `src/shared/frame.ts`. See git diff in `../wterm` for exact
zig hunks.