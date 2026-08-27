<div align="center">

# termw

**빠른 웹 터미널 — WASM, 한글 IME, 테마 동기화 PTY**

[![CI](https://github.com/smturtle2/termw/actions/workflows/ci.yml/badge.svg)](https://github.com/smturtle2/termw/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

*`node-pty` + `wterm`(Zig/WASM) 스택. `theme.json` 하나가 CSS, PTY env, OSC 응답을 모두 결정.*

[English](./README.md) · [아키텍처](./docs/ARCHITECTURE.md)

</div>

## 특징

- 🖋️ **한글 IME** — compositionView 오버레이, `229/Process` 가드, `한` 너비=2. `Shift+/`로 인한 `?` 중복 없음.
- 🎨 **테마 단일 진실 원천** — `config/theme.json` → `COLORFGBG` + `OSC 11;?`. TUI가 시작 시 자동으로 라이트/다크 선택.
- ⚡ **WASM 코어** — xterm.js 없이 가볍게. Zig 테스트 152+.

## 빠른 시작

```bash
cp config/theme.json.example config/theme.json
npm install
npm run build:wasm   # zig 0.16.0 필요, 없으면 prebuilt 복사
npm run build:client
npm run dev          # http://127.0.0.1:3000
```

자세한 설정/배포는 영문 [README](./README.md)를 참고하세요.

## 라이선스

Apache-2.0 — [LICENSE](./LICENSE)
