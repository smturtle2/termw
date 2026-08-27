<div align="center">

# termw

**빠른 웹 터미널 — WASM, 한글 IME, 테마 동기화 PTY**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)
[![Zig](https://img.shields.io/badge/zig-0.16.0-orange)](./vendor/wterm/build.zig.zon)

*`node-pty` + `wterm`(Zig/WASM). `theme.json` 하나로 CSS, PTY와 OSC를 결정.*

[English](./README.md) · [아키텍처](./docs/ARCHITECTURE.md)

</div>

## 특징

- **한글 IME — 매끄러운 조합, 중복 `?` 없음**
- **테마 동기화 — `theme.json` 하나로 CSS와 PTY 일치**
- **경량 — WASM 코어, xterm.js 없이 가볍게**

## 빠른 시작

```bash
cp config/theme.json.example config/theme.json
npm install
npm run dev  # http://127.0.0.1:3000
```

자세한 내용은 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 참고.

## 라이선스

Apache-2.0 — [LICENSE](./LICENSE)
