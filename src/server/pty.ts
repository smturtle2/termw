import * as pty from "node-pty";
import type { WebSocket } from "ws";
import { decodeResize } from "../shared/protocol.js";
import { getTheme } from "./theme.js";
import { buildPtyEnv } from "./env.js";

export interface PtyOptions {
  shell: string;
  home: string;
}

/**
 * Upgrade a WebSocket to a PTY session.
 * Contract:
 *  - Client sends one RESIZE frame as first message to specify cols/rows; if missing, 80x24 default after 5s.
 *  - All other text frames are written verbatim to PTY (UTF-8).
 *  - PTY data is forwarded as text frames (ws.send string) — frontend does TextDecoder for binary fallback.
 *  - Theme is read at spawn time via getTheme() → buildPtyEnv() so COLORFGBG reflects server theme.
 */
export function handlePtyConnection(ws: WebSocket, opts: PtyOptions) {
  let ptyProcess: any = null;
  let cols = 80;
  let rows = 24;

  function spawn(c: number, r: number) {
    cols = c;
    rows = r;
    const theme = getTheme();
    try {
      ptyProcess = pty.spawn(opts.shell, ["-l"], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: opts.home,
        env: buildPtyEnv(theme) as Record<string, string>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[termw] spawn failed: ${msg}`);
      if (ws.readyState === 1) {
        ws.send(`\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`);
        ws.close();
      }
      return;
    }
    ptyProcess.onData((data: string) => {
      if (ws.readyState === 1) ws.send(data);
    });
    ptyProcess.onExit(({ exitCode, signal }: any) => {
      console.log(`[termw] pty exit code=${exitCode} signal=${signal}`);
      if (ws.readyState === 1) ws.close();
    });
  }

  ws.on("message", (msg: Buffer | string) => {
    const input = typeof msg === "string" ? msg : msg.toString("utf-8");
    const resized = decodeResize(input);
    if (resized) {
      if (!ptyProcess) spawn(resized.cols, resized.rows);
      else {
        try {
          ptyProcess.resize(resized.cols, resized.rows);
        } catch (e) {
          console.error("[termw] resize failed", e);
        }
      }
      return;
    }
    if (ptyProcess) ptyProcess.write(input);
    else {
      spawn(cols, rows);
      if (ptyProcess) ptyProcess.write(input);
    }
  });

  ws.on("close", () => {
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {}
      ptyProcess = null;
    }
  });

  ws.on("error", (e) => {
    console.error("[termw] ws error", e);
    if (ptyProcess) {
      try {
        ptyProcess.kill();
      } catch {}
    }
  });

  setTimeout(() => {
    if (!ptyProcess) {
      console.log("[termw] no initial RESIZE, spawn 80x24");
      spawn(cols, rows);
    }
  }, 5000);
}
