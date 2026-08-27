import path from "path";
import { fileURLToPath } from "url";
import { getTheme, setTheme, themeFileInUse, watchTheme } from "./theme.js";
import { validateTheme } from "../shared/theme.js";
import { isWsPath, isValidSessionId, THEME_UPDATE_TYPE } from "../shared/protocol.js";
import { ptyClose, ptyMessage, ptyOpen } from "./pty.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PUBLIC_DIR: src/server -> ../../public, dist/server -> ../../public
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = parseInt(process.env.PORT || "3000", 10);
const SHELL = process.env.SHELL || "/usr/bin/zsh";
const HOME = process.env.HOME || "/root";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

// track live WS for theme broadcast
const liveWS = new Set<any>();

function broadcastTheme() {
  const theme = getTheme();
  const payload = JSON.stringify({ type: THEME_UPDATE_TYPE, theme });
  for (const ws of liveWS) {
    try { ws.send(payload); } catch {}
  }
}

// watch theme file for external edits (echo > config/theme.json)
const themeWatcher = watchTheme(() => {
  broadcastTheme();
});

const server = Bun.serve<{ sid: string }>({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/health") {
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    }

    if (pathname === "/theme.json" || pathname === "/api/theme") {
      if (req.method === "GET") {
        try {
          const theme = getTheme();
          return new Response(JSON.stringify(theme), {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            },
          });
        } catch {
          return new Response("{}", { headers: { "Content-Type": "application/json" } });
        }
      }
      if (req.method === "PUT") {
        try {
          const body = await req.json();
          const v = validateTheme(body);
          if (!v.ok) {
            return new Response(JSON.stringify({ ok: false, errors: v.errors }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            });
          }
          const file = setTheme(v.theme!);
          // broadcast is also triggered by file watch, but send immediately
          const payload = JSON.stringify({ type: THEME_UPDATE_TYPE, theme: v.theme });
          for (const ws of liveWS) {
            try { ws.send(payload); } catch {}
          }
          return new Response(JSON.stringify({ ok: true, theme: v.theme, file }), {
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(JSON.stringify({ ok: false, errors: [msg || "invalid json"] }), {
            status: 400,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      }
    }

    if (isWsPath(pathname)) {
      // ?id=<session id> selects which persistent session this socket
      // attaches to. Missing/invalid ids fall back to the default session.
      let sid = url.searchParams.get("id") ?? "main";
      if (!isValidSessionId(sid)) sid = "main";
      const ok = server.upgrade(req, { data: { sid } });
      if (ok) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // static
    let filePath = pathname;
    if (filePath === "/") filePath = "/index.html";
    // strip leading /
    const normalized = path.normalize(filePath).replace(/^\/+/, "");
    const abs = path.join(PUBLIC_DIR, normalized);

    if (!abs.startsWith(PUBLIC_DIR)) {
      return new Response("Forbidden", { status: 403 });
    }

    // HTML injection: embed theme sync before WASM init to avoid OSC race
    if (normalized === "index.html") {
      const file = Bun.file(abs);
      const exists = await file.exists();
      if (!exists) {
        return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
      let html = await file.text();
      try {
        const theme = getTheme();
        const inject = `<script id="termw-theme" type="application/json">${JSON.stringify(theme)}</script>`;
        if (html.includes("</head>")) html = html.replace("</head>", `${inject}</head>`);
        else html = inject + html;
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        });
      } catch {
        // fallback to file
      }
    }

    const file = Bun.file(abs);
    const exists = await file.exists();
    if (!exists) {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }

    return new Response(file, {
      headers: {
        "Content-Type": mimeFor(abs),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  },
  websocket: {
    // Keep NAT/router mappings alive on mobile — without pings an idle
    // background tab loses its WS within a minute or two. Long idle timeout
    // so a phone that freezes the tab doesn't get its connection reaped.
    sendPings: true,
    idleTimeout: 600,
    open(ws) {
      const sid = ws.data?.sid ?? "main";
      liveWS.add(ws as any);
      ptyOpen(ws as any, sid, { shell: SHELL, home: HOME });
      // send current theme on connect so client can sync without fetch
      try {
        const theme = getTheme();
        ws.send(JSON.stringify({ type: THEME_UPDATE_TYPE, theme }));
      } catch {}
    },
    message(ws, message) {
      // message is string | Buffer (Uint8Array)
      ptyMessage(ws as any, message as unknown as string | Buffer, { shell: SHELL, home: HOME });
    },
    close(ws) {
      liveWS.delete(ws as any);
      ptyClose(ws as any);
    },
  },
});

console.log(`[termw] ready http://${server.hostname}:${server.port}  public=${PUBLIC_DIR}`);
console.log(`[termw] ws ws://${server.hostname}:${server.port}/ws  shell=${SHELL} home=${HOME}`);
console.log(`[termw] theme ${JSON.stringify(getTheme())} file=${themeFileInUse() ?? "(default)"}`);
