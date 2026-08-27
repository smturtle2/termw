# termw — dev notes

## Deployment rule (mandatory)

This repo is the dev checkout at `/root/projects/termw`. The live deployment is a
separate checkout at `/opt/termw` running as `termw.service` (systemd, port 3000,
proxied at https://vultr.tailc28d86.ts.net).

After ANY code/build change that should be live, apply it to the deployment:

```sh
git -C /opt/termw fetch origin
git -C /opt/termw reset --hard origin/main   # history is rewritten regularly — never `git pull`
cd /opt/termw && bun run build:client && bun run build:server && bun run build:wasm
systemctl restart termw
```

Verify with `journalctl -u termw -n 5` (theme line must read `#ffffff`/`#000000`),
`curl -s localhost:3000/health`, and the WS smoke test.

Notes:

- `config/theme.json` is gitignored deploy config — single source of truth is
  **light** `#ffffff`/`#000000` on the server; keep it light.
- `public/app.js` / `public/wterm.wasm` are gitignored build artifacts — always
  rebuild after pulling, never edit by hand.
- Push to origin/main is **force-push only** (`git push --force origin main`),
  because the branch history is deliberately rewritten to drop out-of-scope
  commits. Fetch + `reset --hard origin/main` on both checkouts afterwards.