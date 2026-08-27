# Changelog

All notable changes to termw follow [Keep a Changelog](https://keepachangelog.com/) and [SemVer](https://semver.org/).

## [0.1.0] - 2026-08-27

### Added
- Initial release: `wterm` (Zig/WASM) + `node-pty` + `ws` stack
- `config/theme.json` single source of truth → `COLORFGBG` + `OSC 11;?`
- Korean IME: `compositionView` overlay, `229/Process` guard, width=2
- Wire protocol: `ESC[RESIZE:cols;rows]` + raw PTY bytes
- `systemd` deploy example, `GET /health`, `GET /theme.json` (`no-cache`)
- Vendored `wterm@cdff1c0` + 7 patches (`vendor/wterm/PATCHES.md`)

[0.1.0]: https://github.com/smturtle2/termw/releases/tag/v0.1.0
