# termw

빠른 웹 터미널 — WASM, 한글 IME, 테마 동기화 PTY.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

`node-pty` + `wterm`(Zig/WASM). `theme.json` 하나가 CSS, PTY, OSC를 결정.

## 특징

- 한글 IME — compositionView, `한` 너비 보정
- 테마 동기화 — `config/theme.json` → `COLORFGBG` + `OSC 11;?`
- 경량 — WASM 코어, 순수 WS, xterm.js 없음

## 빠른 시작

```bash
cp config/theme.json.example config/theme.json
npm install
npm run dev  # http://127.0.0.1:3000
```

자세한 계약은 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 참고.

## 라이선스

Apache-2.0 — [LICENSE](./LICENSE)
