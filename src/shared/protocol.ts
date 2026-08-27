/** Wire contract between client and server over WebSocket. */

/** Server → Client: live theme. JSON {type:"theme", theme:{background,foreground}} */
export const THEME_UPDATE_TYPE = "theme";
/** Server → Client: session title (from OSC 0/2). JSON {type:"title", title} */
export const TITLE_UPDATE_TYPE = "title";

/** Endpoints that upgrade to WS. */
export const WS_PATHS = ["/ws", "/api/terminal", "/ws/terminal"] as const;
export function isWsPath(pathname: string): boolean {
  return (WS_PATHS as readonly string[]).includes(pathname);
}

export const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

// ---------------------------------------------------------------------------
// Client → Server raw-input events (JSON text frames). The server owns all
// input conversion (keys → escape sequences, pointer → SGR, scroll intent).
// ---------------------------------------------------------------------------

export interface KeyEvent {
  t: "key";
  /** KeyboardEvent.key */
  k: string;
  /** KeyboardEvent.code (physical key) */
  code: string;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
  repeat: boolean;
}

/** IME composition / printable text committed client-side. */
export interface TextEvent {
  t: "text";
  s: string;
}

export interface PasteEvent {
  t: "paste";
  s: string;
}

export type PointerKind = 0 | 1 | 2 | 3; // 0 down, 1 move, 2 up, 3 wheel
export type PointerType = 0 | 1 | 2; // 0 mouse, 1 touch, 2 pen

export interface PointerEventMsg {
  t: "ptr";
  /** 0 down, 1 move, 2 up, 3 wheel */
  k: PointerKind;
  /** 1-based cell column */
  x: number;
  /** 1-based cell row */
  y: number;
  /** button: 0 left, 1 middle, 2 right (for down) */
  b: number;
  /** modifier bits: 1 shift, 2 alt, 4 ctrl */
  m: number;
  /** pointer type: 0 mouse, 1 touch, 2 pen */
  pt: PointerType;
  /** wheel deltas (kind === 3) */
  dx?: number;
  dy?: number;
}

export interface FocusEventMsg {
  t: "focus";
  v: boolean;
}

export interface ScrollEventMsg {
  t: "scroll";
  /** Signed row delta (positive = scroll up into history). */
  d: number;
}

export interface ResizeEventMsg {
  t: "resize";
  c: number;
  r: number;
}

export interface SessionDeleteMsg {
  t: "del";
  id: string;
}

export type ClientEvent =
  | KeyEvent
  | TextEvent
  | PasteEvent
  | PointerEventMsg
  | FocusEventMsg
  | ScrollEventMsg
  | ResizeEventMsg
  | SessionDeleteMsg;

export function encodeClientEvent(e: ClientEvent): string {
  return JSON.stringify(e);
}

export function decodeClientEvent(raw: string): ClientEvent | null {
  try {
    const j = JSON.parse(raw) as ClientEvent;
    if (typeof j !== "object" || j === null) return null;
    switch (j.t) {
      case "key":
        if (typeof j.k !== "string" || typeof j.code !== "string") return null;
        return j;
      case "text":
      case "paste":
        if (typeof (j as TextEvent).s !== "string") return null;
        return j;
      case "ptr":
        if (
          typeof j.k !== "number" ||
          typeof j.x !== "number" ||
          typeof j.y !== "number"
        )
          return null;
        return j;
      case "focus":
      case "scroll":
      case "resize":
      case "del":
        return j;
      default:
        return null;
    }
  } catch {
    return null;
  }
}