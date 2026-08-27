# Patches vs upstream vercel-labs/wterm (cdff1c0)

This vendored copy includes local patches. The `@wterm/core` (zig wasm) is used
**server-side** by termw: the browser no longer emulates — it is a pure
rendering layer that decodes server frames. The old `@wterm/dom` browser
package has been superseded by `src/client/*` (render.ts / input.ts /
pointer.ts / term.ts) and is no longer imported by termw.

Upstream: https://github.com/vercel-labs/wterm
Base commit: cdff1c0 (fix(dom): preserve fractional autoscroll)

## Core patches (retained — the server runs this wasm in Bun)

## 1. `src/parser.zig` — OSC terminator discrimination
- `osc_terminated_by_st: bool`, `handleEscape ESC ']'` resets it, BEL resets it.
- Why: OSC 10/11 replies echo the terminator the client used (BEL vs ST).

## 2. `src/terminal.zig` — theme-aware OSC 10/11
- `theme_bg/theme_fg/setTheme`; `handleOsc` expands `theme_bg/fg` `*257` → `rgb:`.
- Why: server-driven light/dark reported via OSC so TUI picks the right variant.

## 3. `src/wasm_api.zig` — expose theme to JS
- `init()` calls `terminal.setTheme(0xffffff,0x000000)`; exports `setThemeColors`.
- Why: default theme deterministic before the server applies theme.json.

## 4. `packages/@wterm/core/src/wasm-bridge.ts` — JS boundary
- `setThemeColors?(bgRgb,fgRgb)` + `WasmBridge.setThemeColors()` forwarder.
- Also fixed `mouseTracking()` so it returns `1003` (any-motion) instead of
  mapping it to `0` — the mode that broke opencode pan/scroll.

## 7. `src/terminal.zig` — OSC 4;idx;? palette query replies
- `4;<idx>;?` answered with `rgb:` using `theme_bg` fallback. Some TUIs gate
  their `OSC 11` luminance probe on an `ESC]4;0;?` reply.

## 8. `src/terminal.zig` — 1003 (any-motion) mouse tracking
- DECSET `1003` sets `mouse_tracking = 1003`. opencode enables 1000+1002+1003+1006.

## 5. `packages/@wterm/dom/src/input.ts` — Korean IME composition
- Retained for reference only (the termw client uses `src/client/input.ts`,
  which ports the hidden-textarea + composition-view approach).
- `handleKeyDown` guards `keyCode===229` / `key==="Process"`; compositionend
  emits committed text and flushes the leftover `textarea.value`.

## 6. `packages/@wterm/dom/src/terminal.css` — composition + light theme
- `::selection #b4d5fe`, `.term-composition` underline, `.theme-korean-light`.

## Superseded (previous client-side architecture)
- `#9 input.ts touch→SGR`, `#10 wterm.ts plain-click/drag-guard/initial-size`,
  `#11 renderer.ts auto-link`, `#12 auto-link style`: replaced by the
  server-authoritative client in `src/client/` — the server owns mouse mode,
  scroll, and input conversion; the browser only renders frames and forwards
  raw input events.

See `src/client/render.ts`, `src/client/pointer.ts`, `src/client/term.ts`,
`src/server/*`, and `src/shared/frame.ts` for the current design.