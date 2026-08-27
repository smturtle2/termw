# termw — wterm based web terminal

Clean, github-ready web terminal. Vendor-ed `wterm` with Korean IME + theme-aware OSC patches, and a minimal `node-pty` server whose **theme is single source of truth**.

```
~/projects/termw
  src/shared/theme.ts + protocol.ts  — single contract for color & wire
  src/server/{theme,env,static,pty,index}.ts — HTTP + WS + PTY
  src/client/main.ts                 — WTerm + fetch(theme.json) + OSC drain
  vendor/wterm/                      — patched wterm (see vendor/wterm/PATCHES.md)
  public/{index.html,terminal.css,wterm.wasm,app.js} — static (app.js built)
  config/theme.json.example          — copy to config/theme.json
  deploy/systemd/termw.service.example
```

## Contracts (확실한 계약)

### 1) Theme — `config/theme.json` single source
```json
{"mode":"light","background":"#ffffff","foreground":"#000000"}
```
- `src/shared/theme.ts:Theme` validates `mode` + `^#[0-9a-f]{6}$`
- Server `src/server/theme.ts:getTheme()` reads `config/theme.json` (fallback `theme.json` then `DEFAULT_THEME` light). Serves `GET /theme.json` (`no-cache`).
- PTY env `src/server/env.ts:buildPtyEnv()` derives `COLORFGBG=0;15` (light) / `15;0` (dark) + `THEME_*` — opencode 등 TUI는 startup 시 `COLORFGBG`와 `OSC 11;?`휘도로 variant 선택.
- WASM `vendor/wterm/src/terminal.zig:setTheme()` + `wasm_api.zig:setThemeColors()` is called by `src/client/main.ts:applyTheme()` after `fetch("/theme.json")` so `ESC]11;?` → `rgb:ffff/ffff/ffff` (light) / `1e1e/...` (dark) + `ST` vs `BEL` echo (`parser.zig:osc_terminated_by_st`).

> 브라우저 CSS (`vendor/wterm/packages/@wterm/dom/src/terminal.css:.theme-korean-light`)는 presentation만, luminance 판정은 항상 서버 `theme.json`.

### 2) Wire — WebSocket text UTF-8
- `src/shared/protocol.ts`
- Client → Server: `"\x1b[RESIZE:cols;rows]"` (single frame) for initial + every `onResize`. Server `pty.ts:decodeResize()` validates 1..1024.
- Server → Client: raw PTY bytes (incl. OSC). Frontend decodes `ArrayBuffer`/`Uint8Array`→string, then `wterm.write()`, then drains `bridge.getResponse()` loop (both `10;?` and `11;?`).

### 3) PTY — `node-pty`
- `pty.spawn(SHELL -l, {name:"xterm-256color", cols, rows, cwd:HOME, env: buildPtyEnv(theme)})` — env allowlist only, `LANG=ko_KR.UTF-8` for `한` width=2 (AC00-D7A3).
- Paths `WS_PATHS = ["/ws","/api/terminal","/ws/terminal"]` backward-compat, else socket.destroy.
- Upgrade handled in `src/server/index.ts`, static via `src/server/static.ts` (`MIME`, `../public`, `no-cache`, traversal guard).

### 4) IME — Korean
- `vendor/wterm/packages/@wterm/dom/src/input.ts:303` guard `composing||isComposing||229||Process`, `compositionView` overlay (`terminal.css:128`), flush `committed` + `textarea.value` tail (e.g. `안녕` + `?`).
- Zig width table already `width=2` for 한글.

## Quickstart (local)

```bash
cp config/theme.json.example config/theme.json
cp config/env.example .env   # optional HOST/PORT/SHELL

npm install
npm run build:wasm   # needs zig 0.16.0; else copies prebuilt
npm run build:client # esbuild src/client/main.ts -> public/app.js
npm run typecheck

# dev (tsx, no build)
npm run dev          # http://127.0.0.1:3000  ws://.../ws  health /health

# prod
npx tsc
node dist/server/index.js
```

Switch theme:
```bash
echo '{"mode":"dark","background":"#1e1e1e","foreground":"#d4d4d4"}' > config/theme.json
# PTY env + OSC now report dark; restart not needed for next spawn (theme read at spawn), but restart to re-serve /theme.json if cached
```

## Deploy (example, no secrets committed)

- `deploy/systemd/termw.service.example` → `/etc/systemd/system/termw.service` (edit `User`, `WorkingDirectory=/opt/termw`)
- Reverse proxy is user discretion. Server binds `127.0.0.1:3000` by default; expose as you like.

`HOST` stays `127.0.0.1` by default. Never expose `3000` on `0.0.0.0` without auth/proxy.

## Vendor wterm

- Base `vercel-labs/wterm@cdff1c0`, vendored at `vendor/wterm/` (only `src/`, `packages/@wterm/{core,dom}`, `build.zig`).
- Patches documented in `vendor/wterm/PATCHES.md` — all 7 files, 240 ins. Upstream PR pending → keep patch file for audit.

## Test

- Zig: `cd vendor/wterm && zig build test` (152+ tests)
- Manual: `echo 한글테스트`, `printf '한?나' | od -An -tx1` → `ed 95 9c 3f eb 82 98` (no duplicate `?` from composition tail)
- Opencode: `COLORFGBG=0;15` light variant, `15;0` dark — `theme.json` drives it.

## License

Apache-2.0 (vendor/wterm upstream). See `LICENSE`.
