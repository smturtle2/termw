# termw

Fast web terminal — WASM, Korean IME, theme-synced PTY.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)

Lightweight `node-pty` + `wterm` (Zig/WASM). Single `theme.json` drives CSS, PTY env, and OSC.

## Features

- Korean IME — compositionView overlay, correct `한` width
- Theme sync — `config/theme.json` → `COLORFGBG` + `OSC 11;?`
- Minimal — WASM core, raw WS, no xterm.js bloat

## Quickstart

```bash
cp config/theme.json.example config/theme.json
npm install
npm run dev  # http://127.0.0.1:3000
```

Build:

```bash
npm run build:wasm   # zig 0.16 else prebuilt
npm run build:client # → public/app.js
npm run build:server # → dist/
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for contracts and [deploy/systemd/termw.service.example](./deploy/systemd/termw.service.example) for deploy.

## License

Apache-2.0 — [LICENSE](./LICENSE). Vendored `wterm` © Vercel Labs.
