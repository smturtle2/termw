import type { CoreModeSnapshot } from "./core.js";
import type { PointerEventMsg } from "../shared/protocol.js";
import type { Viewport } from "./viewport.js";

/**
 * Raw pointer events → either SGR sequences (when the app has mouse
 * reporting on) or viewport scroll commands. The server decides; the client
 * only forwards cell coordinates.
 */

/** Our modifier bits (1 shift, 2 alt, 4 ctrl) → SGR modifier bits (4/8/16). */
function sgrMods(m: number): number {
  return (m & 1 ? 4 : 0) | (m & 2 ? 8 : 0) | (m & 4 ? 16 : 0);
}

const WHEEL_SCROLL_ROWS = 3;

export interface PointerState {
  /** Last touch row (1-based) for scroll accumulation. */
  touchY: number | null;
}

export function createPointerState(): PointerState {
  return { touchY: null };
}

/**
 * Handle a pointer event. Returns an escape sequence to write to the PTY, or
 * null when the app is not listening (in which case scrolling may occur).
 * `scrolled` is set when the viewport moved (frame should be flushed).
 */
export function handlePointer(
  msg: PointerEventMsg,
  modes: CoreModeSnapshot,
  viewport: Viewport,
  state: PointerState,
): { input: string | null; scrolled: boolean } {
  const reporting = modes.mouseTracking !== 0 && modes.mouseSgr;
  const { k, x, y, b, m, pt } = msg;
  const mods = sgrMods(m);

  if (k === 3) {
    // Wheel.
    const dx = msg.dx ?? 0;
    const dy = msg.dy ?? 0;
    if (reporting) {
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx === 0) return { input: null, scrolled: false };
        return {
          input: `\x1b[<${(dx < 0 ? 66 : 67) | mods};${x};${y}M`,
          scrolled: false,
        };
      }
      if (dy === 0) return { input: null, scrolled: false };
      return {
        input: `\x1b[<${(dy < 0 ? 64 : 65) | mods};${x};${y}M`,
        scrolled: false,
      };
    }
    // Scrollback scroll: dy>0 (wheel down) moves toward newer output.
    const primary = Math.abs(dy) > 0 ? dy : dx;
    const lines = Math.max(1, Math.round(Math.abs(primary) / 100));
    viewport.scrollBy(primary > 0 ? -lines : lines);
    return { input: null, scrolled: true };
  }

  if (reporting) {
    // The client already gates moves (only while pressed, or any-motion in
    // 1003 mode), so every move we receive is reportable.
    if (k === 2 && b > 2) return { input: null, scrolled: false };
    const button = k === 1 ? b : b; // down/up/move use the button number
    const code =
      button | mods | (k === 1 ? 32 : 0);
    const final = k === 2 ? "m" : "M";
    return { input: `\x1b[<${code};${x};${y}${final}`, scrolled: false };
  }

  // No mouse reporting: touch drag scrolls the server viewport; mouse drag is
  // left to the browser for native text selection.
  if (pt === 1) {
    if (k === 0) {
      state.touchY = y;
      return { input: null, scrolled: false };
    }
    if (k === 1 && state.touchY !== null) {
      const delta = state.touchY - y; // finger moving up → scroll up (positive)
      state.touchY = y;
      if (delta === 0) return { input: null, scrolled: false };
      viewport.scrollBy(delta);
      return { input: null, scrolled: true };
    }
    if (k === 2) {
      state.touchY = null;
      return { input: null, scrolled: false };
    }
  }

  return { input: null, scrolled: false };
}