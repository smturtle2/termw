import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createStaticHandler } from "./static.js";
import { handlePtyConnection } from "./pty.js";
import { getTheme } from "./theme.js";
import { isWsPath } from "../shared/protocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// When running via `tsx src/server/index.ts`, __dirname is .../src/server
// When running compiled `dist/server/index.js`, it's .../dist/server
// Public dir is always at project root /public
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = parseInt(process.env.PORT || "3000", 10);
const SHELL = process.env.SHELL || "/usr/bin/zsh";
const HOME = process.env.HOME || "/root";

const serveStatic = createStaticHandler(PUBLIC_DIR);

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (url === "/theme.json" || url.startsWith("/theme.json?")) {
    try {
      const theme = getTheme();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(JSON.stringify(theme));
      return;
    } catch {}
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
  if (isWsPath(pathname)) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handlePtyConnection(ws, { shell: SHELL, home: HOME });
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[termw] ready http://${HOST}:${PORT}  public=${PUBLIC_DIR}`);
  console.log(`[termw] ws ws://${HOST}:${PORT}/ws  shell=${SHELL} home=${HOME}`);
});
