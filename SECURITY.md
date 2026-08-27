# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |

## Reporting a Vulnerability

Open a private security advisory on GitHub or email the maintainer. Do not open a public issue for sensitive reports.

## Notes

- Server binds `127.0.0.1:3000` by default. Do not expose `0.0.0.0` without auth / reverse proxy.
- PTY env is allowlisted in `src/server/env.ts` — never passes `process.env` wholesale.
- Static handler in `src/server/static.ts` has traversal guard.
