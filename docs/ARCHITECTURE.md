# Architecture

Clean contracts for `termw`. This doc holds the internal details that were previously in README.

## Overview

```
browser                  server                     pty
 WTerm ──WS text──►  index.ts / pty.ts  ──► node-pty ──► $SHELL -l
   │ fetch(/theme.json)   │ theme.ts/env.ts          │ COLORFGBG=0;15, THEME_*
   └─ OSC 10/11 drain ────┘                           └─ LANG=ko_KR.UTF-8
 vendor/wterm (Zig/WASM)
  terminal.zig:setTheme / parser.zig:osc_terminated_by_st
```

## 1) Theme — `config/theme.json` single source

`src/shared/theme.ts:Theme`

```json
{"mode":"light","background":"#ffffff","foreground":"#000000"}
```

- Validation: `mode` ∈ `{light,dark}` + `^#[0-9a-f]{6}$` (`src/shared/theme.ts:isHexColor`).
- Server `src/server/theme.ts:getTheme()` reads `config/theme.json`, fallback `theme.json`, then `DEFAULT_THEME` (light). Serves `GET /theme.json` (`no-cache`).
- PTY env `src/server/env.ts:buildPtyEnv()` derives `COLORFGBG=0;15` (light) / `15;0` (dark) + `THEME_MODE/BG/FG`. TUI reads `COLORFGBG` and `OSC 11;?` luminance on startup.
- WASM `vendor/wterm/src/terminal.zig:setTheme()` + `wasm_api.zig:setThemeColors()` called by `src/client/main.ts:applyTheme()` after `fetch("/theme.json")` so `ESC]11;?` → `rgb:ffff/ffff/ffff` (light) / `1e1e/...` (dark) + `ST` vs `BEL` echo (`parser.zig:osc_terminated_by_st`).

> Browser CSS (`vendor/wterm/packages/@wterm/dom/src/terminal.css:.theme-korean-light`) is presentation only; luminance decision always follows server `theme.json`.

## 2) Wire — WebSocket text UTF-8

`src/shared/protocol.ts`

- Client → Server: `"\x1b[RESIZE:cols;rows]"` (single frame) for initial + every `onResize`. Server `pty.ts:decodeResize()` validates 1..1024.
- Server → Client: raw PTY bytes (incl. OSC). Frontend decodes `ArrayBuffer`/`Uint8Array`→string, then `wterm.write()`, then drains `bridge.getResponse()` loop (both `10;?` and `11;?`).

## 3) PTY — `node-pty`

- `pty.spawn(SHELL -l, {name:"xterm-256color", cols, rows, cwd:HOME, env: buildPtyEnv(theme)})` — env allowlist only, `LANG=ko_KR.UTF-8` for `한` width=2 (AC00-D7A3).
- Paths `WS_PATHS = ["/ws","/api/terminal","/ws/terminal"]` backward-compat, else `socket.destroy()`.
- Upgrade in `src/server/index.ts`, static via `src/server/static.ts` (`MIME`, `../public`, `no-cache`, traversal guard).

## 4) IME — Korean

- `vendor/wterm/packages/@wterm/dom/src/input.ts:303` guard `composing||isComposing||229||Process`, `compositionView` overlay (`terminal.css:128`), flush `committed` + `textarea.value` tail (e.g. `안녕` + `?`).
- Zig width table already `width=2` for 한글 (`unicode_width_table.zig`).

## Tests

- Zig: `cd vendor/wterm && zig build test` (152+ tests)
- Manual: `echo 한글테스트`, `printf '한?나' | od -An -tx1` → `ed 95 9c 3f eb 82 98` (no duplicate `?`)
- Opencode: `COLORFGBG=0;15` light, `15;0` dark — `theme.json` drives it.
