import type { ServerWebSocket } from "bun";
import { decodeResize } from "../shared/protocol.js";
import { getTheme } from "./theme.js";
import { buildPtyEnv } from "./env.js";

export interface PtyOptions {
  shell: string;
  home: string;
}

type WS = ServerWebSocket<unknown>;

interface Session {
  proc: ReturnType<typeof Bun.spawn> | null;
  cols: number;
  rows: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const sessions = new WeakMap<WS, Session>();

function safeSend(ws: WS, data: string) {
  try {
    // @ts-ignore — bun ServerWebSocket has send
    ws.send(data);
  } catch {}
}

/** Standard OSC color query responder (OSC 10;?, 11;?, 4;<idx>;?).
 * Any TUI may query terminal colors this way; answers are injected straight
 * into the PTY from the server theme so apps never depend on a browser
 * round trip (no timeout races). Queries split across output chunks are
 * reassembled via a small tail buffer. Terminator (BEL/ST) is mirrored. */
function scanOscQueries(chunk: string, tail: string): { replies: string; tail: string } {
  tail = (tail + chunk).slice(-64);
  const re = /\x1b\](10|11|4;\d+);\?(?=(\x07|\x1b\\))/g;
  const theme = getTheme();
  const bg = parseInt(theme.background.slice(1), 16);
  const fg = parseInt(theme.foreground.slice(1), 16);
  let replies = "";
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) !== null) {
    const kind = m[1];
    const term = m[2];
    const rgb = kind === "10" ? fg : bg;
    const hex = (v: number) => ((v * 257).toString(16).padStart(4, "0"));
    replies += `\x1b]${kind};rgb:${hex((rgb >> 16) & 0xff)}/${hex((rgb >> 8) & 0xff)}/${hex(rgb & 0xff)}${term}`;
    lastEnd = m.index + m[0].length + term.length;
  }
  if (lastEnd > 0) tail = tail.slice(lastEnd);
  return { replies, tail };
}

function spawn(ws: WS, c: number, r: number, opts: PtyOptions) {
  const sess = sessions.get(ws);
  if (!sess) return;
  if (sess.proc) return;
  sess.cols = c;
  sess.rows = r;
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  const theme = getTheme();
  let oscTail = "";
  try {
    const proc = Bun.spawn([opts.shell, "-l"], {
      cwd: opts.home,
      env: buildPtyEnv(theme) as Record<string, string>,
      terminal: {
        cols: c,
        rows: r,
        data(_term, data) {
          // data is Uint8Array/Buffer
          const text = data instanceof Uint8Array ? new TextDecoder().decode(data) : String(data);
          try {
            const r2 = scanOscQueries(text, oscTail);
            oscTail = r2.tail;
            if (r2.replies && sess.proc) {
              // @ts-ignore — terminal exists
              sess.proc.terminal.write(r2.replies);
            }
          } catch (e) {
            console.error("[termw] osc responder failed", e);
          }
          safeSend(ws, text);
        },
      },
    }) as ReturnType<typeof Bun.spawn>;

    sess.proc = proc;

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    proc.exited
      .then((code) => {
        console.log(`[termw] pty exit code=${code}`);
        try {
          ws.close();
        } catch {}
      })
      .catch((e) => {
        console.error("[termw] pty exited error", e);
        try {
          ws.close();
        } catch {}
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[termw] spawn failed: ${msg}`);
    safeSend(ws, `\r\n\x1b[31mFailed to spawn shell: ${msg}\x1b[0m\r\n`);
    try {
      ws.close();
    } catch {}
  }
}

export function ptyOpen(ws: WS, opts: PtyOptions) {
  const sess: Session = { proc: null, cols: 80, rows: 24, timer: null };
  sessions.set(ws, sess);
  sess.timer = setTimeout(() => {
    const s = sessions.get(ws);
    if (s && !s.proc) {
      console.log("[termw] no initial RESIZE, spawn 80x24");
      spawn(ws, s.cols, s.rows, opts);
    }
  }, 5000);
}

export function ptyMessage(ws: WS, raw: string | Buffer | Uint8Array, opts: PtyOptions) {
  const sess = sessions.get(ws);
  if (!sess) return;
  const input = typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);
  const resized = decodeResize(input);
  if (resized) {
    if (!sess.proc) spawn(ws, resized.cols, resized.rows, opts);
    else {
      try {
        // @ts-ignore — terminal exists
        sess.proc.terminal.resize(resized.cols, resized.rows);
        sess.cols = resized.cols;
        sess.rows = resized.rows;
      } catch (e) {
        console.error("[termw] resize failed", e);
      }
    }
    return;
  }
  if (sess.proc) {
    try {
      // @ts-ignore
      sess.proc.terminal.write(input);
    } catch (e) {
      console.error("[termw] write failed", e);
    }
  } else {
    spawn(ws, sess.cols, sess.rows, opts);
    const s2 = sessions.get(ws);
    if (s2?.proc) {
      try {
        // @ts-ignore
        s2.proc.terminal.write(input);
      } catch {}
    }
  }
}

export function ptyClose(ws: WS) {
  const sess = sessions.get(ws);
  if (!sess) return;
  if (sess.timer) clearTimeout(sess.timer);
  if (sess.proc) {
    try {
      // @ts-ignore
      sess.proc.terminal.close();
    } catch {}
    try {
      sess.proc.kill();
    } catch {}
    sess.proc = null;
  }
  sessions.delete(ws);
}

// Legacy wrapper — keep for compat if called via ws event emitter (unused with Bun.serve)
export function handlePtyConnection(_ws: unknown, _opts: PtyOptions) {
  console.warn("[termw] handlePtyConnection is deprecated — use ptyOpen/ptyMessage/ptyClose with Bun.serve");
}
