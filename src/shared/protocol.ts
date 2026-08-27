/** Wire contract between client and server over WebSocket (text frames, UTF-8). */

/** Client → Server: resize. Client sends "\x1b[RESIZE:cols;rows]" as single text frame. */
export const RESIZE_PREFIX = "\x1b[RESIZE:";
export const RESIZE_RE = /\[RESIZE:(\d+);(\d+)\]/;

export function encodeResize(cols: number, rows: number): string {
  return `\x1b[RESIZE:${cols};${rows}]`;
}

export function decodeResize(msg: string): { cols: number; rows: number } | null {
  if (!msg.startsWith(RESIZE_PREFIX)) return null;
  const m = msg.match(RESIZE_RE);
  if (!m) return null;
  const cols = parseInt(m[1], 10);
  const rows = parseInt(m[2], 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
  if (cols <= 0 || rows <= 0 || cols > 1024 || rows > 1024) return null;
  return { cols, rows };
}

/** Client → Server: delete a session (tab closed). "\x1b[SESSION_DELETE:<id>]" */
export const SESSION_DELETE_PREFIX = "\x1b[SESSION_DELETE:";
export const SESSION_DELETE_RE = /\[SESSION_DELETE:([A-Za-z0-9-]{1,64})\]/;
export const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function encodeSessionDelete(id: string): string {
  return `${SESSION_DELETE_PREFIX}${id}]`;
}

export function decodeSessionDelete(msg: string): string | null {
  if (!msg.startsWith(SESSION_DELETE_PREFIX)) return null;
  const m = msg.match(SESSION_DELETE_RE);
  return m ? m[1] : null;
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

/** Server → Client: raw PTY bytes (including OSC responses). No framing. */
/** Theme live update: server broadcasts JSON {type:"theme", theme:{background,foreground}} */
export const THEME_UPDATE_TYPE = "theme";
/** Session title update (from OSC 0/2 in PTY output): JSON {type:"title", title:string} */
export const TITLE_UPDATE_TYPE = "title";
/** Endpoints that upgrade to WS — keep backward compat with old paths. */
export const WS_PATHS = ["/ws", "/api/terminal", "/ws/terminal"] as const;
export function isWsPath(pathname: string): boolean {
  return (WS_PATHS as readonly string[]).includes(pathname);
}
