# Architecture

Clean contracts for `termw`. This doc holds the internal details that were previously in README.

## Overview

```
browser                  server (Bun)               pty
 WTerm ──WS text──►  index.ts (Bun.serve) ──► Bun.spawn ──► $SHELL -l
   │ fetch(/theme.json)   │ theme.ts/env.ts          │ COLORFGBG=0;15/15;0, THEME_BG/FG
   │ PUT /api/theme       │ watchTheme()              │ LANG=ko_KR.UTF-8
   └─ OSC 10/11 drain ────┘                           └─ theme via THEME_BG
 vendor/wterm (Zig/WASM)
  terminal.zig:setTheme / parser.zig:osc_terminated_by_st
```

## 1) Theme — `config/theme.json` single source

`src/shared/theme.ts:Theme`

```json
{"background":"#ffffff","foreground":"#000000"}
```

- Validation: `^#[0-9a-f]{6}$` (`src/shared/theme.ts:isHexColor`, `validateTheme`). Invalid → `400 {errors}` on `PUT /api/theme`, fallback to `DEFAULT_THEME` on `GET`.
- Server `src/server/theme.ts:getTheme()` reads `config/theme.json`, fallback `theme.json`, then `DEFAULT_THEME` (`#ffffff/#000000`). `setTheme()` does atomic `tmp→rename`. `watchTheme()` (`fs.watch` 100ms debounce) broadcasts.
- HTTP: `GET /theme.json` / `GET /api/theme` (no-cache), `PUT /api/theme` validates `background/foreground`, writes atomically, broadcasts WS `{type:"theme",theme}`.
- PTY env `src/server/env.ts:buildPtyEnv()` derives `COLORFGBG` via `luminance(background)>128 ? "0;15":"15;0"` (Rec.601) + `THEME_BG/FG`. No `THEME_MODE`. Existing sessions keep old env; new `Bun.spawn` gets new theme. TUI reads `COLORFGBG` and `OSC 11;?` luminance on startup — terminal reports `theme_bg` verbatim.
- WASM `vendor/wterm/src/terminal.zig:setTheme()` + `wasm_api.zig:setThemeColors()` called by `src/client/main.ts:applyTheme()` (via `luminance(background)>128` → `theme-korean-light` vs `theme-dark`) and by WS live update, so `ESC]11;?` → `rgb:ffff/ffff/ffff` etc + `ST` vs `BEL` echo (`parser.zig:osc_terminated_by_st`).
- Live reload: `watchTheme` watches file (external `echo > config/theme.json`) + `PUT /api/theme` both broadcast to all WS. Client `src/client/main.ts` handles `{type:"theme"}` in `ws.onmessage` before PTY write, calls `applyTheme` + `bridge.setThemeColors`.
- CLI: `bun run theme get|set|validate` (`scripts/theme.ts`) — presets `light/dark/solarized/monokai`, `--bg/--fg/--json/--preset`, `--file` for direct write, otherwise `setTheme` + `PUT /api/theme` live push.
- UI: `public/index.html` 🎨 button → `dialog` with `input[type=color]` + preset `select` → `PUT /api/theme`.

> Browser CSS (`vendor/wterm/packages/@wterm/dom/src/terminal.css:.theme-korean-light`) is presentation only; theme decision follows `config/theme.json` background luminance, TUI measures luminance from OSC itself.

## 2) Wire — WebSocket text UTF-8

`src/shared/protocol.ts`

- Client → Server: `"\x1b[RESIZE:cols;rows]"` (single frame) for initial + every `onResize`. Server `pty.ts:decodeResize()` validates 1..1024.
- Server → Client: raw PTY bytes (incl. OSC). Frontend decodes `ArrayBuffer`/`Uint8Array`→string, then checks `JSON.parse` for `{type:"theme"}` before `wterm.write()`, then drains `bridge.getResponse()` loop (both `10;?` and `11;?`).
- Endpoints `WS_PATHS = ["/ws","/api/terminal","/ws/terminal"]`.

## 3) PTY — `Bun.spawn`

- `Bun.spawn([SHELL,"-l"], { cwd: HOME, env: buildPtyEnv(theme), terminal: { cols, rows, data(term,data){ ws.send(data) } } })` — env allowlist only, `LANG=ko_KR.UTF-8` for `한` width=2 (AC00-D7A3).
- `Bun.serve` in `src/server/index.ts` handles `fetch` (static via `Bun.file`, `MIME`, `PUBLIC_DIR`, traversal guard) + `websocket: {open,message,close}` delegates to `pty.ts`.

## 4) IME — Korean

- `vendor/wterm/packages/@wterm/dom/src/input.ts:303` guard `composing||isComposing||229||Process`, `compositionView` overlay (`terminal.css:128`), flush `committed` + `textarea.value` tail (e.g. `안녕` + `?`).
- Zig width table already `width=2` for 한글 (`unicode_width_table.zig`).

## Tests

- Zig: `cd vendor/wterm && zig build test` (152+ tests)
- Manual: `echo 한글테스트`, `printf '한?나' | od -An -tx1` → `ed 95 9c 3f eb 82 98` (no duplicate `?`)
- Theme: `bun run theme set --preset dark` → `GET /theme.json` → `COLORFGBG=15;0`, `curl -X PUT /api/theme -d '{"background":"#ffffff","foreground":"#000000"}'` → live WS update, `ESC]11;?` → `rgb:ffff/ffff/ffff`
