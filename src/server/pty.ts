import type { ServerWebSocket } from "bun";
import { decodeResize, decodeSessionDelete, TITLE_UPDATE_TYPE } from "../shared/protocol.js";
import { getTheme } from "./theme.js";
import { buildPtyEnv } from "./env.js";

export interface PtyOptions {
  shell: string;
  home: string;
}

type WS = ServerWebSocket<unknown>;

/** Detached sessions are killed after this idle time (default 24h). */
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || "", 10) || 24 * 60 * 60 * 1000;
/** Ring buffer cap for screen replay (scrollback included). */
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
/** Tail size for reassembling queries split across PTY chunks. */
const SCAN_TAIL = 64;
/** Tail size for OSC 0/2 titles (256 chars max). */
const TITLE_TAIL = 320;

interface Session {
  id: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  cols: number;
  rows: number;
  ws: WS | null;
  attaching: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  title: string;
  oscTail: string;
  titleTail: string;
  buffer: { chunks: string[]; size: number };
}

const sessionsById = new Map<string, Session>();
const sessionIdByWs = new Map<WS, string>();

function safeSend(ws: WS | null, data: string) {
  if (!ws) return;
  try {
    // @ts-ignore — bun ServerWebSocket has send
    ws.send(data);
  } catch {}
}

/** Standard OSC color query responder (OSC 10;?, 11;?, 4;<idx>;?) + DSR (CSI 6n).
 * Any TUI may query terminal colors this way; answers are injected straight
 * into the PTY from the server theme so apps never depend on a browser
 * round trip (no timeout races). Queries split across output chunks are
 * reassembled via a small tail buffer. Terminator (BEL/ST) is mirrored.
 * Query sequences are stripped from the returned `toStore` text so a screen
 * replay never re-triggers responses in the client-side parser. */
function scanAndStrip(
  chunk: string,
  tail: string,
): { replies: string; toStore: string; tail: string } {
  const combined = tail + chunk;
  const tailLen = Math.min(SCAN_TAIL, combined.length);
  const theme = getTheme();
  const bg = parseInt(theme.background.slice(1), 16);
  const fg = parseInt(theme.foreground.slice(1), 16);
  const hex = (v: number) => (v * 257).toString(16).padStart(4, "0");
  let replies = "";
  let clean = combined;
  const oscRe = /\x1b\](10|11|4;\d+);\?(?=(\x07|\x1b\\))/g;
  let m: RegExpExecArray | null;
  while ((m = oscRe.exec(combined)) !== null) {
    const kind = m[1];
    const term = m[2];
    const end = m.index + m[0].length + term.length;
    const rgb = kind === "10" ? fg : bg;
    replies += `\x1b]${kind};rgb:${hex((rgb >> 16) & 0xff)}/${hex((rgb >> 8) & 0xff)}/${hex(rgb & 0xff)}${term}`;
    clean = clean.slice(0, m.index) + clean.slice(end);
  }
  const dsrRe = /\x1b\[6n/g;
  while ((m = dsrRe.exec(combined)) !== null) {
    clean = clean.slice(0, m.index) + clean.slice(m.index + m[0].length);
  }
  const toStore = clean.slice(0, Math.max(0, clean.length - tailLen));
  return { replies, toStore, tail: combined.slice(-tailLen) };
}

/** OSC 0/2 window title scanner. Reassembles across chunk splits. */
function scanTitle(chunk: string, tail: string): { title: string | null; tail: string } {
  const combined = tail + chunk;
  const re = /\x1b\]([02]);([\s\S]*?)(?:\x07|\x1b\\)/g;
  let title: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combined)) !== null) {
    title = m[2].slice(0, 256);
  }
  return { title, tail: combined.slice(-TITLE_TAIL) };
}

function bufferAppend(sess: Session, text: string) {
  if (!text) return;
  sess.buffer.chunks.push(text);
  sess.buffer.size += text.length;
  while (sess.buffer.size > MAX_BUFFER_BYTES && sess.buffer.chunks.length > 1) {
    const head = sess.buffer.chunks.shift()!;
    sess.buffer.size -= head.length;
  }
}

function bufferDrain(sess: Session): string {
  return sess.buffer.chunks.join("");
}

function killSession(sess: Session, reason: string) {
  console.log(`[termw] session ${sess.id} kill (${reason})`);
  sessionsById.delete(sess.id);
  if (sess.ws) sessionIdByWs.delete(sess.ws);
  if (sess.ws) {
    try {
      sess.ws.close();
    } catch {}
  }
  sess.ws = null;
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  if (sess.ttlTimer) {
    clearTimeout(sess.ttlTimer);
    sess.ttlTimer = null;
  }
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
}

function spawn(sess: Session, c: number, r: number, opts: PtyOptions) {
  if (sess.proc) return;
  sess.cols = c;
  sess.rows = r;
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  const theme = getTheme();
  const proc = Bun.spawn([opts.shell, "-l"], {
    cwd: opts.home,
    env: buildPtyEnv(theme) as Record<string, string>,
    terminal: {
      cols: c,
      rows: r,
      data(_term, data) {
        const text =
          data instanceof Uint8Array ? new TextDecoder().decode(data) : String(data);
        try {
          const r2 = scanAndStrip(text, sess.oscTail);
          sess.oscTail = r2.tail;
          if (r2.replies && sess.proc) {
            // @ts-ignore — terminal exists
            sess.proc.terminal.write(r2.replies);
          }
          if (r2.toStore) bufferAppend(sess, r2.toStore);
        } catch (e) {
          console.error("[termw] osc responder failed", e);
        }
        try {
          const t = scanTitle(text, sess.titleTail);
          sess.titleTail = t.tail;
          if (t.title !== null && t.title !== sess.title) {
            sess.title = t.title;
            if (sess.ws && !sess.attaching) {
              safeSend(sess.ws, JSON.stringify({ type: TITLE_UPDATE_TYPE, title: t.title }));
            }
          }
        } catch (e) {
          console.error("[termw] title scan failed", e);
        }
        if (sess.ws && !sess.attaching) safeSend(sess.ws, text);
      },
    },
  }) as ReturnType<typeof Bun.spawn>;

  sess.proc = proc;

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  proc.exited
    .then((code) => {
      console.log(`[termw] pty exit code=${code} session=${sess.id}`);
      killSession(sess, `exit(${code})`);
    })
    .catch((e) => {
      console.error("[termw] pty exited error", e);
      killSession(sess, "error");
    });
}

function createSession(id: string, opts: PtyOptions): Session {
  const sess: Session = {
    id,
    proc: null,
    cols: 80,
    rows: 24,
    ws: null,
    attaching: false,
    timer: null,
    ttlTimer: null,
    title: "",
    oscTail: "",
    titleTail: "",
    buffer: { chunks: [], size: 0 },
  };
  sessionsById.set(id, sess);
  sess.timer = setTimeout(() => {
    if (!sess.proc) {
      console.log(`[termw] no initial RESIZE, spawn 80x24 (session=${id})`);
      spawn(sess, sess.cols, sess.rows, opts);
    }
  }, 5000);
  return sess;
}

function attach(ws: WS, sess: Session, opts: PtyOptions) {
  const prevWs = sess.ws;
  if (prevWs && prevWs !== ws) {
    try {
      prevWs.close();
    } catch {}
  }
  sess.ws = ws;
  sessionIdByWs.set(ws, sess.id);
  if (sess.ttlTimer) {
    clearTimeout(sess.ttlTimer);
    sess.ttlTimer = null;
  }
  if (!sess.proc) {
    if (sess.timer) clearTimeout(sess.timer);
    sess.timer = setTimeout(() => {
      if (!sess.proc) {
        console.log(`[termw] no initial RESIZE, spawn 80x24 (session=${sess.id})`);
        spawn(sess, sess.cols, sess.rows, opts);
      }
    }, 5000);
    return;
  }
  // Re-attach: replay ring buffer first (fresh client parser is empty), then
  // let live output flow. `attaching` keeps new PTY output out of the socket
  // until the replay is fully queued, preserving byte order.
  sess.attaching = true;
  const replay = bufferDrain(sess);
  if (replay) safeSend(ws, replay);
  sess.attaching = false;
  try {
    // @ts-ignore — terminal exists
    sess.proc.terminal.resize(sess.cols, sess.rows);
  } catch {}
  if (sess.title) {
    safeSend(ws, JSON.stringify({ type: TITLE_UPDATE_TYPE, title: sess.title }));
  }
}

export function ptyOpen(ws: WS, id: string, opts: PtyOptions) {
  let sess = sessionsById.get(id);
  if (!sess) sess = createSession(id, opts);
  attach(ws, sess, opts);
}

export function ptyMessage(ws: WS, raw: string | Buffer | Uint8Array, opts: PtyOptions) {
  const id = sessionIdByWs.get(ws);
  if (!id) return;
  const sess = sessionsById.get(id);
  if (!sess) return;
  const input = typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array);

  const delId = decodeSessionDelete(input);
  if (delId) {
    const target = sessionsById.get(delId);
    if (target) killSession(target, "client delete");
    return;
  }

  const resized = decodeResize(input);
  if (resized) {
    sess.cols = resized.cols;
    sess.rows = resized.rows;
    if (!sess.proc) spawn(sess, resized.cols, resized.rows, opts);
    else {
      try {
        // @ts-ignore — terminal exists
        sess.proc.terminal.resize(resized.cols, resized.rows);
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
    spawn(sess, sess.cols, sess.rows, opts);
    if (sess.proc) {
      try {
        // @ts-ignore
        sess.proc.terminal.write(input);
      } catch {}
    }
  }
}

export function ptyClose(ws: WS) {
  const id = sessionIdByWs.get(ws);
  sessionIdByWs.delete(ws);
  if (!id) return;
  const sess = sessionsById.get(id);
  if (!sess) return;
  if (sess.timer) {
    clearTimeout(sess.timer);
    sess.timer = null;
  }
  // Detach: keep the PTY and its ring buffer alive so a reconnect (or another
  // device) re-attaches to the same session. Start the idle TTL.
  sess.ws = null;
  sess.attaching = false;
  if (sess.proc) {
    if (sess.ttlTimer) clearTimeout(sess.ttlTimer);
    sess.ttlTimer = setTimeout(() => {
      if (sess.ws === null) killSession(sess, "idle ttl");
    }, SESSION_TTL_MS);
  } else {
    sessionsById.delete(id);
  }
}

/** For tests: list live session ids. */
export function listSessions(): string[] {
  return [...sessionsById.keys()];
}

// Legacy wrapper — keep for compat if called via ws event emitter (unused with Bun.serve)
export function handlePtyConnection(_ws: unknown, _opts: PtyOptions) {
  console.warn("[termw] handlePtyConnection is deprecated — use ptyOpen/ptyMessage/ptyClose with Bun.serve");
}