import type { TerminalCore } from "./core.js";
import {
  BLANK_CELL_BYTES,
  encodeFrame,
  type FrameDirtyRow,
  type FrameLink,
  type FrameMeta,
} from "../shared/frame.js";

/**
 * Server-owned viewport. The client renders exactly `rows` viewport rows —
 * never scrollback DOM, never a scrollable container. Scrolling moves this
 * viewport into the server-side scrollback buffer and the composed rows are
 * shipped as a frame; the browser just draws the result.
 */
export class Viewport {
  private core: TerminalCore;
  /** Lines above the screen bottom being viewed. 0 = following the screen. */
  offset = 0;
  private lastCursorRow = -1;
  private forceFull = false;
  private linkCache = new Map<
    number,
    { uri: string; id?: string }
  >();

  constructor(core: TerminalCore) {
    this.core = core;
  }

  /** Next frame ships every viewport row (reconnect / resize). */
  forceFullFrame(): void {
    this.forceFull = true;
  }

  /** Scroll by a signed row delta; clamps to [0, scrollbackTotal]. Full-screen
   *  apps (alt screen) own their scroll, so the viewport must not move. */
  scrollBy(delta: number): void {
    if (this.core.modes().usingAltScreen) return;
    const max = this.core.scrollbackCount();
    this.offset = Math.max(0, Math.min(max, this.offset + Math.round(delta)));
  }

  scrollToBottom(): void {
    this.offset = 0;
  }

  scrollToTop(): void {
    this.offset = this.core.scrollbackCount();
  }

  get atBottom(): boolean {
    return this.offset === 0;
  }

  private blankRowBytes(cols: number): Uint8Array {
    const out = new Uint8Array(cols * BLANK_CELL_BYTES.length);
    const blank = BLANK_CELL_BYTES;
    for (let c = 0; c < cols; c++) out.set(blank, c * 12);
    return out;
  }

  private linkRows(rows: FrameDirtyRow[], links: FrameLink[]): void {
    const seen = new Set<number>();
    for (const row of rows) {
      for (let i = 0; i < row.bytes.length; i += 12) {
        const linkIdx =
          (row.bytes[i + 10] | (row.bytes[i + 11] << 8)) & 0xffff;
        if (linkIdx !== 0 && !seen.has(linkIdx)) {
          seen.add(linkIdx);
          const entry = this.linkCache.get(linkIdx);
          if (entry) {
            links.push({ index: linkIdx, ...entry });
          } else {
            const resolved = this.core.linkAt(linkIdx);
            if (resolved) {
              this.linkCache.set(linkIdx, resolved);
              links.push({ index: linkIdx, ...resolved });
            }
          }
        }
      }
    }
  }

  /**
   * Build the current viewport frame. When following the screen only dirty
   * grid rows are shipped; when scrolled the viewport is recomposed from
   * scrollback + screen (all rows dirty) and the cursor is hidden.
   */
  buildFrame(): Uint8Array {
    const core = this.core;
    const cols = core.cols;
    const rows = core.rows;
    const scrollbackTotal = core.scrollbackCount();
    const modes = core.modes();

    let dirtyRows: FrameDirtyRow[];
    let cursor: { row: number; col: number; visible: boolean };

    if (this.atBottom && !this.forceFull) {
      const flags = core.dirtyRowFlags();
      dirtyRows = [];
      for (let r = 0; r < rows; r++) {
        if (flags[r] !== 0) {
          dirtyRows.push({ index: r, bytes: core.gridRowBytes(r) });
        }
      }
      cursor = core.getCursor();
      // Cursor movement alone doesn't dirty rows — force the old and new
      // cursor rows into the frame so the browser redraws the cursor.
      if (this.lastCursorRow >= 0 && this.lastCursorRow < rows) {
        if (!dirtyRows.some((d) => d.index === this.lastCursorRow)) {
          dirtyRows.push({ index: this.lastCursorRow, bytes: core.gridRowBytes(this.lastCursorRow) });
        }
      }
      if (cursor.visible && cursor.row < rows) {
        if (!dirtyRows.some((d) => d.index === cursor.row)) {
          dirtyRows.push({ index: cursor.row, bytes: core.gridRowBytes(cursor.row) });
        }
      }
      this.lastCursorRow = cursor.visible ? cursor.row : -1;
      this.forceFull = false;
    } else {
      const total = scrollbackTotal + rows;
      const start = Math.max(0, total - this.offset - rows);
      dirtyRows = [];
      const blank = this.blankRowBytes(cols);
      for (let r = 0; r < rows; r++) {
        const g = start + r;
        let bytes: Uint8Array;
        if (g >= scrollbackTotal) {
          bytes = core.gridRowBytes(g - scrollbackTotal);
        } else if (g >= 0) {
          // Core indexes scrollback from the newest line (offset 0); document
          // position g counts from the oldest, so invert.
          const line = core.scrollbackLineBytes(scrollbackTotal - 1 - g);
          if (line.length >= cols * 12) {
            bytes = line;
          } else {
            const out = new Uint8Array(cols * 12);
            out.set(line, 0);
            out.set(blank.subarray(line.length), line.length);
            bytes = out;
          }
        } else {
          bytes = blank;
        }
        dirtyRows.push({ index: r, bytes });
      }
      cursor = { row: 0, col: 0, visible: false };
      this.lastCursorRow = -1;
      this.forceFull = false;
    }

    const links: FrameLink[] = [];
    this.linkRows(dirtyRows, links);

    const meta: FrameMeta = {
      cols,
      rows,
      scrollbackTotal,
      viewportOffset: this.offset,
      atBottom: this.atBottom,
      cursorRow: cursor.row,
      cursorCol: cursor.col,
      cursorVisible: cursor.visible,
      mouseTracking: modes.mouseTracking,
      mouseSgr: modes.mouseSgr,
      focusEvents: modes.focusEvents,
      bracketedPaste: modes.bracketedPaste,
      cursorKeysApp: modes.cursorKeysApp,
    };

    core.clearDirty();
    return encodeFrame(meta, dirtyRows, links);
  }
}