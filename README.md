<div align="center">

# termw

**Fast web terminal — WASM, Korean IME, theme-synced PTY**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)
[![Zig](https://img.shields.io/badge/zig-0.16.0-orange)](./vendor/wterm/build.zig.zon)

*Lightweight `node-pty` + `wterm` (Zig/WASM). Single `theme.json` drives CSS, PTY and OSC.*

[Features](#features) · [Quickstart](#quickstart) · [Docs](./docs/ARCHITECTURE.md) · [한국어](./README.ko.md)

</div>

---

## Features

- **Korean IME — smooth** — no duplicate `?`, correct `한` width
- **Theme sync — one `theme.json` drives CSS and PTY**
- **Minimal — WASM core, no xterm.js bloat**

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

## Configuration

```json
{"mode":"light","background":"#ffffff","foreground":"#000000"}
```

| Field | Type | Example |
|---|---|---|
| `mode` | `light` \| `dark` | `light` |
| `background` | `#rrggbb` | `#ffffff` |
| `foreground` | `#rrggbb` | `#000000` |

`config/theme.json` — single source, served as `GET /theme.json`.

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

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for contracts. Patches: [`vendor/wterm/PATCHES.md`](./vendor/wterm/PATCHES.md).

## Acknowledgements

- Base `vercel-labs/wterm@cdff1c0` — vendored at `vendor/wterm/` with 7 patches. Upstream: https://github.com/vercel-labs/wterm

## License

Apache-2.0 — see [LICENSE](./LICENSE). Vendored wterm retains its Apache-2.0 headers.
