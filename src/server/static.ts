import fs from "fs";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";

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

export function createStaticHandler(publicDir: string) {
  const PUBLIC_DIR = path.resolve(publicDir);

  return function serveStatic(req: IncomingMessage, res: ServerResponse) {
    let urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/") urlPath = "/index.html";

    const normalized = path.normalize(urlPath).replace(/^\/+/, "");
    const filePath = path.join(PUBLIC_DIR, normalized);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME[ext] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      fs.createReadStream(filePath).pipe(res);
    });
  };
}
