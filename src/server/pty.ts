import type { ServerWebSocket } from "bun";
import { TerminalCore } from "./core.js";
import { Viewport } from "./viewport.js";
import { keyToSequence } from "./keys.js";
import { createPointerState, handlePointer } from "./pointer.js";
import {
  decodeClientEvent,
  TITLE_UPDATE_TYPE,
  type ClientEvent,
} from "../shared/protocol.js";
import { getTheme } from "./theme.js";
import { buildPtyEnv } from "./env.js";

export interface PtyOptions {
  shell: string;
  home: string;
}

type WS = ServerWebSocket<unknown>;

/** Detached sessions are killed after this idle time (default 24h). */
const SESSION_TTL_MS =
  parseInt(process.env.SESSION_TTL_MS || "", 10) || 24 * 60 * 60 * 1000;
/** Fallback flush for synchronized-output frames held too long. */
const SYNC_HOLD_MS = 250;

interface Session {
  id: string;
  core: TerminalCore;
  viewport: Viewport;
  pointer: ReturnType<typeof createPointerState>;
  proc: ReturnType<typeof Bun.spawn> | null;
  cols: number;
  rows: number;
  ws: WS | null;
  timer: ReturnType<typeof setTimeout> | null;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  syncHeld: boolean;
  syncTimer: ReturnType<typeof setTimeout> | null;
  lastTitle: string;
  lastAltScreen: boolean;
}

const sessionsById = new Map<string, Session>();
const sessionIdByWs = new Map<WS, string>();

function safeSend(ws: WS | null, data: string | Uint8Array) {
  if (!ws) return;
  try {
    // @ts-ignore — bun ServerWebSocket has send
    ws.send(data);
  } catch {}
}

function sendFrame(sess: Session) {
  if (!sess.ws) return;
  safeSend(sess.ws, sess.viewport.buildFrame());
}

function sendTitle(sess: Session, title: string) {
  sess.lastTitle = title;
  if (sess.ws) {
    safeSend(sess.ws, JSON.stringify({ type: TITLE_UPDATE_TYPE, title }));
  }
}

function flushFrame(sess: Session) {
  if (sess.syncHeld) {
    if (sess.syncTimer) clearTimeout(sess.syncTimer);
    sess.syncTimer = setTimeout(() => {
      sess.syncTimer = null;
      sendFrame(sess);
    }, SYNC_HOLD_MS);
    return;
  }
  sendFrame(sess);
}

function writePty(sess: Session, data: string) {
  if (!sess.proc) return;
  try {
    // @ts-ignore — terminal exists
    sess.proc.terminal.write(data);
  } catch {}
}

function applyThemeToCore(sess: Session) {
  const theme = getTheme();
  const bg = parseInt(theme.background.slice(1), 16);
  const fg = parseInt(theme.foreground.slice(1), 16);
  sess.core.setThemeColors(bg, fg);
}

/** Broadcast current theme to every live core (OSC color replies follow it). */
export function applyThemeToSessions() {
  for (const sess of sessionsById.values()) applyThemeToCore(sess);
}

/** Spawn the PTY after a grace period unless a client already resized us. */
function scheduleSpawn(sess: Session, opts: PtyOptions) {
  if (sess.timer) clearTimeout(sess.timer);
  sess.timer = setTimeout(() => {
    sess.timer = null;
    if (!sess.proc) {
      console.log(`[termw] no initial RESIZE, spawn ${sess.cols}x${sess.rows} (session=${sess.id})`);
      spawn(sess, sess.cols, sess.rows, opts);
    }
  }, 5000);
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
  if (sess.syncTimer) {
    clearTimeout(sess.syncTimer);
    sess.syncTimer = null;
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
  const proc = Bun.spawn([opts.shell, "-l"], {
    cwd: opts.home,
    env: buildPtyEnv(getTheme()) as Record<string, string>,
    terminal: {
      cols: c,
      rows: r,
      data(_term, data) {
        try {
          const bytes =
            data instanceof Uint8Array
              ? data
              : new TextEncoder().encode(String(data));
          sess.core.write(bytes);
          const responses = sess.core.drainResponses();
          if (responses) writePty(sess, responses);
          const title = sess.core.takeTitle();
          if (title !== null && title !== sess.lastTitle) sendTitle(sess, title);
          const sync = sess.core.synchronizedOutput();
          // A full-screen app (alt screen) must start at the viewport bottom:
          // if the user had scrolled up, the TUI would otherwise render above
          // stale shell lines (offset persists across the screen switch).
          const altScreen = sess.core.modes().usingAltScreen;
          if (altScreen && !sess.lastAltScreen) {
            sess.viewport.scrollToBottom();
            sess.viewport.forceFullFrame();
          }
          sess.lastAltScreen = altScreen;
          if (sync) {
            sess.syncHeld = true;
            if (sess.syncTimer) clearTimeout(sess.syncTimer);
            sess.syncTimer = setTimeout(() => {
              sess.syncTimer = null;
              sendFrame(sess);
            }, SYNC_HOLD_MS);
          } else {
            if (sess.syncHeld) {
              sess.syncHeld = false;
              if (sess.syncTimer) clearTimeout(sess.syncTimer);
              sess.syncTimer = null;
            }
            sendFrame(sess);
          }
        } catch (e) {
          console.error("[termw] emulator feed failed", e);
        }
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

async function createSession(id: string, opts: PtyOptions): Promise<Session> {
  const core = await TerminalCore.create();
  core.init(80, 24);
  const sess: Session = {
    id,
    core,
    viewport: new Viewport(core),
    pointer: createPointerState(),
    proc: null,
    cols: 80,
    rows: 24,
    ws: null,
    timer: null,
    ttlTimer: null,
    syncHeld: false,
    syncTimer: null,
    lastTitle: "",
    lastAltScreen: false,
  };
  applyThemeToCore(sess);
  sessionsById.set(id, sess);
  scheduleSpawn(sess, opts);
  return sess;
}

async function attach(ws: WS, sess: Session, opts: PtyOptions) {
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
    scheduleSpawn(sess, opts);
    // Client will send resize; until then no screen exists.
    return;
  }
  // Reconnect: the emulator and its scrollback live server-side, so the fresh
  // client gets the current viewport in one full frame.
  sess.viewport.forceFullFrame();
  sendFrame(sess);
  if (sess.lastTitle) {
    safeSend(ws, JSON.stringify({ type: TITLE_UPDATE_TYPE, title: sess.lastTitle }));
  }
}

export async function ptyOpen(ws: WS, id: string, opts: PtyOptions) {
  let sess = sessionsById.get(id);
  if (!sess) sess = await createSession(id, opts);
  attach(ws, sess, opts);
}

export function ptyMessage(ws: WS, raw: string | Buffer | Uint8Array, opts: PtyOptions) {
  const id = sessionIdByWs.get(ws);
  if (!id) return;
  const sess = sessionsById.get(id);
  if (!sess) return;

  if (typeof raw === "string") {
    const ev = decodeClientEvent(raw);
    if (ev) {
      handleEvent(sess, ev, opts);
      return;
    }
  }
  // Legacy binary input (deprecated) — treat as raw PTY bytes.
  if (sess.proc) {
    try {
      // @ts-ignore
      sess.proc.terminal.write(raw as unknown as string);
    } catch {}
  }
}

function handleEvent(sess: Session, ev: ClientEvent, opts: PtyOptions) {
  switch (ev.t) {
    case "key": {
      const seq = keyToSequence(ev, sess.core.modes());
      if (seq) writePty(sess, seq);
      return;
    }
    case "text": {
      if (ev.s) writePty(sess, ev.s);
      return;
    }
    case "paste": {
      const modes = sess.core.modes();
      const safe = ev.s.replace(/\x1b/g, "");
      writePty(sess, modes.bracketedPaste ? `\x1b[200~${safe}\x1b[201~` : safe);
      return;
    }
    case "ptr": {
      const modes = sess.core.modes();
      const { input, scrolled } = handlePointer(
        ev,
        modes,
        sess.viewport,
        sess.pointer,
      );
      if (input) writePty(sess, input);
      if (scrolled) flushFrame(sess);
      return;
    }
    case "focus": {
      const modes = sess.core.modes();
      if (modes.focusEvents) writePty(sess, ev.v ? "\x1b[I" : "\x1b[O");
      return;
    }
    case "scroll": {
      sess.viewport.scrollBy(ev.d);
      flushFrame(sess);
      return;
    }
    case "resize": {
      if (ev.c <= 0 || ev.r <= 0 || ev.c > 1024 || ev.r > 1024) return;
      sess.cols = ev.c;
      sess.rows = ev.r;
      sess.core.resize(ev.c, ev.r);
      if (!sess.proc) {
        spawn(sess, ev.c, ev.r, opts);
      } else {
        try {
          // @ts-ignore — terminal exists
          sess.proc.terminal.resize(ev.c, ev.r);
        } catch {}
      }
      sess.viewport.forceFullFrame();
      flushFrame(sess);
      return;
    }
    case "del": {
      const target = sessionsById.get(ev.id);
      if (target) killSession(target, "client delete");
      return;
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
  // Detach: keep the PTY + emulator + scrollback alive server-side.
  sess.ws = null;
  if (sess.proc) {
    if (sess.ttlTimer) clearTimeout(sess.ttlTimer);
    sess.ttlTimer = setTimeout(() => {
      if (sess.ws === null) killSession(sess, "idle ttl");
    }, SESSION_TTL_MS);
  } else {
    sessionsById.delete(id);
  }
}