import path from "path";
import { fileURLToPath } from "url";
import { getTheme } from "./theme.js";
import { isWsPath } from "../shared/protocol.js";
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

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/health") {
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    }

    if (pathname === "/theme.json") {
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

    if (isWsPath(pathname)) {
      const ok = server.upgrade(req);
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
    open(ws) {
      ptyOpen(ws as any, { shell: SHELL, home: HOME });
    },
    message(ws, message) {
      // message is string | Buffer (Uint8Array)
      ptyMessage(ws as any, message as unknown as string | Buffer, { shell: SHELL, home: HOME });
    },
    close(ws) {
      ptyClose(ws as any);
    },
  },
});

console.log(`[termw] ready http://${server.hostname}:${server.port}  public=${PUBLIC_DIR}`);
console.log(`[termw] ws ws://${server.hostname}:${server.port}/ws  shell=${SHELL} home=${HOME}`);
