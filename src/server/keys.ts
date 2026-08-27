import type { CoreModeSnapshot } from "./core.js";
import type { KeyEvent } from "../shared/protocol.js";

/**
 * Raw keyboard events → escape sequences. The client only captures keys; the
 * server owns the mapping so it can consult the emulator's current modes
 * (application cursor keys, etc.). Ported from the former client-side mapper.
 */

const NORMAL_KEYS: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
};

const APP_KEYS: Record<string, string> = {
  ArrowUp: "\x1bOA",
  ArrowDown: "\x1bOB",
  ArrowRight: "\x1bOC",
  ArrowLeft: "\x1bOD",
  Home: "\x1bOH",
  End: "\x1bOF",
};

const FIXED_KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

export function keyToSequence(
  e: KeyEvent,
  modes: CoreModeSnapshot,
): string | null {
  const { k: key, ctrl, alt, meta } = e;

  if (ctrl && !alt && !meta) {
    if (key.length === 1) {
      const code = key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
    }
    if (key === "[") return "\x1b";
    if (key === "\\") return "\x1c";
    if (key === "]") return "\x1d";
    if (key === "^") return "\x1e";
    if (key === "_") return "\x1f";
  }

  if (key === "Enter" && e.shift) return "\x1b[13;2u";
  if (key === "Tab" && e.shift) return "\x1b[Z";

  const fixed = FIXED_KEYS[key];
  if (fixed) return alt ? "\x1b" + fixed : fixed;

  const navMap = modes.cursorKeysApp ? APP_KEYS : NORMAL_KEYS;
  const nav = navMap[key];
  if (nav) return alt ? "\x1b" + nav : nav;

  if (key.length === 1 && !ctrl && !meta) {
    return alt ? "\x1b" + key : key;
  }

  return null;
}