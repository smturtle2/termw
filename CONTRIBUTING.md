# Contributing

Thanks for helping make termw better!

## Quickstart

```bash
cp config/theme.json.example config/theme.json
npm ci
npm run build:wasm   # needs zig 0.16.0, else copies prebuilt
npm run build:client
npm run typecheck
npm run dev          # http://127.0.0.1:3000
```

## Project layout

- `src/shared/theme.ts + protocol.ts` — contracts (color, wire)
- `src/server/{theme,env,static,pty,index}.ts` — HTTP + WS + PTY
- `src/client/main.ts` — WTerm + `fetch(/theme.json)` + OSC drain
- `vendor/wterm/` — patched wterm (see `vendor/wterm/PATCHES.md`)
- `public/{index.html,terminal.css,wterm.wasm,app.js}` — static (`app.js` built)

## Contracts

Do not break without updating docs:

1. **Theme** — `config/theme.json` single source → `COLORFGBG` + `OSC 11;?`
2. **Wire** — `ESC[RESIZE:cols;rows]` single frame, else raw PTY bytes
3. **IME** — `compositionView` overlay, flush tail

See `docs/ARCHITECTURE.md`.

## Tests

```bash
npm run typecheck
npm run build
cd vendor/wterm && zig build test  # 152+ tests
# manual: echo 한글테스트, printf '한?나' | od -An -tx1 → ed 95 9c 3f eb 82 98
```

## Commit style

- `feat:`, `fix:`, `docs:`, `chore:` prefix
- Keep patches minimal, reference `PATCHES.md` if touching `vendor/wterm/`

## PR

Fill `PULL_REQUEST_TEMPLATE.md`. One concern per PR.
