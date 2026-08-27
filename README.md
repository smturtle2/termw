<div align="center">

# termw

**Fast web terminal — WASM, Korean IME, theme-synced PTY**

[![CI](https://github.com/smturtle2/termw/actions/workflows/ci.yml/badge.svg)](https://github.com/smturtle2/termw/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)
[![Zig](https://img.shields.io/badge/zig-0.16.0-orange)](./vendor/wterm/build.zig.zon)
[![Korean IME](https://img.shields.io/badge/IME-%ED%95%9C%EA%B8%80-ff69b4)](#features)

*Lightweight `node-pty` + `wterm` (Zig/WASM) stack. Single `theme.json` drives CSS, PTY env, and OSC replies.*

[Features](#features) · [Quickstart](#quickstart) · [Configuration](#configuration) · [Deploy](#deploy) · [Architecture](./docs/ARCHITECTURE.md) · [한국어](./README.ko.md)

</div>

---

## Features

- 🖋️ **Korean IME that just works** — compositionView overlay, `229/Process` guard, `한` width=2 (AC00–D7A3). No duplicated `?` from `Shift+/`.
- 🎨 **Theme is single source of truth** — `config/theme.json` → PTY `COLORFGBG`/`THEME_*` + WASM `ESC]11;?` replies. TUI picks correct variant on startup.
- ⚡ **WASM core** — `vendor/wterm` (Zig) via `wterm.wasm`, no xterm.js bloat. 152+ Zig tests.
- 🔌 **Minimal wire protocol** — `WebSocket` UTF-8 text, single `ESC[RESIZE:cols;rows]` frame. Raw PTY bytes otherwise.
- 📦 **Deploy-friendly** — binds `127.0.0.1:3000`, `systemd` example included, reverse-proxy agnostic.

<p align="center">
  <img src="./assets/screenshot-light.png" alt="termw light theme" width="800" />
  <br />
  <em>Light theme • D2Coding • Korean input (`안녕하세요`)</em>
  <br />
  <sub>Drop your own <code>assets/demo.gif</code> here — see <a href="./docs/SCREENSHOT.md">docs/SCREENSHOT.md</a></sub>
</p>


## Quickstart

```bash
cp config/theme.json.example config/theme.json
cp config/env.example .env   # optional: HOST/PORT/SHELL

npm install
npm run build:wasm   # needs zig 0.16.0, else copies prebuilt
npm run build:client # esbuild → public/app.js
npm run typecheck

# dev (no build)
npm run dev          # http://127.0.0.1:3000  ws://…/ws  health /health

# prod
npm run build:server # tsc → dist/
node dist/server/index.js
```

Switch theme:

```bash
echo '{"mode":"dark","background":"#1e1e1e","foreground":"#d4d4d4"}' > config/theme.json
# next PTY spawn picks it up; restart to re-serve /theme.json if cached
```

## Configuration

### `config/theme.json`

Single source of truth for color. Validated by `src/shared/theme.ts`.

| Field | Type | Example | Notes |
|---|---|---|---|
| `mode` | `"light" \| "dark"` | `"light"` | drives `COLORFGBG` and `OSC 11;?` |
| `background` | `"#rrggbb"` | `"#ffffff"` | `^#[0-9a-f]{6}$` |
| `foreground` | `"#rrggbb"` | `"#000000"` | same |

Served as `GET /theme.json` (`no-cache`). Client `src/client/main.ts` fetches it before `WTerm.init()` and calls `bridge.setThemeColors()`.

### `config/env.example`

| Var | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Never `0.0.0.0` without auth/proxy |
| `PORT` | `3000` | |
| `SHELL` | `/usr/bin/zsh` | spawned as `SHELL -l` |
| `HOME` | `$HOME` | PTY cwd |

Theme never comes from env — only `config/theme.json`.

## Deploy

```bash
# systemd example
sudo cp deploy/systemd/termw.service.example /etc/systemd/system/termw.service
# edit User, WorkingDirectory=/opt/termw
sudo systemctl enable --now termw
```

Server binds `127.0.0.1` by default. Put nginx/caddy in front, terminate TLS there.

See `deploy/systemd/termw.service.example` for full unit.

## Architecture

```
browser                  server                     pty
 WTerm ──WS text──►  index.ts / pty.ts  ──► node-pty ──► $SHELL -l
   │ fetch(/theme.json)   │ theme.ts/env.ts          │ COLORFGBG=0;15, THEME_*
   └─ OSC 10/11 drain ────┘                           └─ LANG=ko_KR.UTF-8
 vendor/wterm (Zig/WASM)
  terminal.zig:setTheme / parser.zig:osc_terminated_by_st
```

- **Wire**: client → server `ESC[RESIZE:cols;rows]` (single frame, validated `1..1024`), server → client raw PTY bytes incl. OSC. See `src/shared/protocol.ts`.
- **PTY**: `xterm-256color`, env allowlist only. Workspace paths `["/ws","/api/terminal","/ws/terminal"]`.
- **IME**: `vendor/wterm/packages/@wterm/dom/src/input.ts` compositionView overlay + flush tail.

Full contract → [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Patches → [`vendor/wterm/PATCHES.md`](./vendor/wterm/PATCHES.md).

## Development

```bash
npm run dev              # tsx watch
npm run typecheck
npm run build            # wasm + client + server

# Zig
cd vendor/wterm && zig build test   # 152+ tests
```

Manual checks: `echo 한글테스트`, `printf '한?나' | od -An -tx1` → `ed 95 9c 3f eb 82 98`.

## Acknowledgements

- Base `vercel-labs/wterm@cdff1c0` — vendored at `vendor/wterm/` with 7 patches. Upstream: https://github.com/vercel-labs/wterm
- Fonts: D2Coding, Noto Sans Mono CJK

## License

Apache-2.0 — see [LICENSE](./LICENSE). Vendored wterm retains its Apache-2.0 headers.
