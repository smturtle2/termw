import {
  blankCell,
  decodeFrame,
  type DecodedCell,
} from "../shared/frame.js";
import type { ClientEvent } from "../shared/protocol.js";
import { ViewRenderer, type RenderCell } from "./render.js";
import { InputCapture } from "./input.js";
import { PointerCapture } from "./pointer.js";

interface TermCallbacks {
  emit: (e: ClientEvent) => void;
  onTitle: (title: string) => void;
}

/**
 * The terminal view: a pure rendering layer over server frames. Holds a cell
 * cache, forwards raw input events, and never emulates or stores scrollback.
 */
export class TermView {
  element: HTMLElement;
  private grid: HTMLElement;
  private scrollbar: HTMLElement;
  private renderer: ViewRenderer;
  private input: InputCapture;
  private pointer: PointerCapture;
  private emit: (e: ClientEvent) => void;
  private onTitle: (title: string) => void;

  private cols = 0;
  private rows = 0;
  private cells: DecodedCell[] = [];
  private linkCache = new Map<number, { uri: string; id?: string }>();
  private dirty = new Set<number>();

  private cursorRow = 0;
  private cursorCol = 0;
  private cursorVisible = false;
  mouseTracking: 0 | 1000 | 1002 | 1003 = 0;
  private mouseSgr = false;
  private focusEvents = false;

  private scrollbackTotal = 0;
  private viewportOffset = 0;
  private atBottom = true;

  private charWidth = 8;
  private rowHeight = 17;
  private resizeObserver: ResizeObserver | null = null;

  constructor(element: HTMLElement, callbacks: TermCallbacks) {
    this.element = element;
    this.emit = callbacks.emit;
    this.onTitle = callbacks.onTitle;
    element.classList.add("wterm");
    element.classList.add("cursor-blink");

    this.grid = document.createElement("div");
    this.grid.className = "term-grid";
    element.appendChild(this.grid);

    this.scrollbar = document.createElement("div");
    this.scrollbar.className = "term-scrollbar";
    this.scrollbar.style.opacity = "0";
    element.appendChild(this.scrollbar);

    this.renderer = new ViewRenderer(this.grid);
    this.input = new InputCapture(element, (e) => this.emit(e), () =>
      this.getCursorRect(),
    );
    this.pointer = new PointerCapture(
      element,
      (e) => this.emit(e),
      (x, y) => this.getCellAt(x, y),
      () => ({
        mouseTracking: this.mouseTracking,
        mouseSgr: this.mouseSgr,
      }),
      () => this.input.focus(),
    );
    this.pointer.attach();
    this.setupScrollbar();
  }

  get colsNow(): number {
    return this.cols;
  }
  get rowsNow(): number {
    return this.rows;
  }

  focus(): void {
    this.input.focus();
  }

  applyTitle(title: string): void {
    this.onTitle(title);
  }

  applyFrame(buf: Uint8Array): void {
    const frame = decodeFrame(buf);
    if (frame.meta.cols !== this.cols || frame.meta.rows !== this.rows) {
      this.resizeCache(frame.meta.cols, frame.meta.rows);
    }
    for (const link of frame.links) {
      this.linkCache.set(link.index, { uri: link.uri, id: link.id });
    }
    for (const row of frame.rows) {
      const base = row.index * this.cols;
      for (let c = 0; c < row.cells.length; c++) {
        this.cells[base + c] = row.cells[c];
      }
      this.dirty.add(row.index);
    }
    this.cursorRow = frame.meta.cursorRow;
    this.cursorCol = frame.meta.cursorCol;
    this.cursorVisible = frame.meta.cursorVisible;
    this.mouseTracking = frame.meta.mouseTracking;
    this.mouseSgr = frame.meta.mouseSgr;
    this.focusEvents = frame.meta.focusEvents;
    this.scrollbackTotal = frame.meta.scrollbackTotal;
    this.viewportOffset = frame.meta.viewportOffset;
    this.atBottom = frame.meta.atBottom;
    this.updateScrollbar();
    this.render();
  }

  private resizeCache(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    const blank = blankCell();
    this.cells = new Array(cols * rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = { ...blank };
    this.dirty.clear();
    for (let r = 0; r < rows; r++) this.dirty.add(r);
  }

  private renderCellAt(r: number, c: number): RenderCell {
    const cell = this.cells[r * this.cols + c];
    const link = cell.link !== 0 ? this.linkCache.get(cell.link) : undefined;
    const out: RenderCell = {
      char: cell.char,
      fg: cell.fg,
      bg: cell.bg,
      flags: cell.flags,
      width: cell.width,
    };
    if (link) {
      out.linkUri = link.uri;
      out.linkId = link.id;
      out.linkKey = link.id ? `e\0${link.id}\0${link.uri}` : `b\0${cell.link}`;
    }
    return out;
  }

  private render(): void {
    if (this.dirty.size === 0) return;
    this.renderer.render(
      (r, c) => this.renderCellAt(r, c),
      this.cols,
      this.rows,
      this.cursorRow,
      this.cursorCol,
      this.cursorVisible,
      this.dirty,
    );
    this.dirty.clear();
  }

  getCellAt(x: number, y: number): { col: number; row: number } | null {
    if (this.cols === 0 || this.rows === 0) return null;
    const rect = this.element.getBoundingClientRect();
    if (this.charWidth <= 0 || this.rowHeight <= 0) return null;
    const col = Math.floor((x - rect.left) / this.charWidth) + 1;
    const row = Math.floor((y - rect.top) / this.rowHeight) + 1;
    if (col < 1 || row < 1) return null;
    return {
      col: Math.min(col, this.cols),
      row: Math.min(row, this.rows),
    };
  }

  getCursorRect(): { left: number; top: number; width: number; height: number } | null {
    if (this.cols === 0) return null;
    return {
      left: this.cursorCol * this.charWidth,
      top: this.cursorRow * this.rowHeight,
      width: this.charWidth,
      height: this.rowHeight,
    };
  }

  /** Re-measure char metrics and container size; returns desired grid size. */
  measure(): { cols: number; rows: number } | null {
    const probe = document.createElement("div");
    probe.className = "term-row";
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    const span = document.createElement("span");
    span.textContent = "W";
    probe.appendChild(span);
    this.grid.appendChild(probe);
    const cw = span.getBoundingClientRect().width;
    const rh = probe.getBoundingClientRect().height;
    probe.remove();
    if (cw > 0 && rh > 0) {
      this.charWidth = cw;
      this.rowHeight = rh;
      this.element.style.setProperty("--term-row-height", `${Math.ceil(rh)}px`);
    }
    const style = getComputedStyle(this.element);
    const rect = this.element.getBoundingClientRect();
    const width =
      rect.width -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);
    const height =
      rect.height -
      (parseFloat(style.paddingTop) || 0) -
      (parseFloat(style.paddingBottom) || 0);
    if (width <= 0 || height <= 0 || this.charWidth <= 0 || this.rowHeight <= 0)
      return null;
    const cols = Math.max(1, Math.floor(width / this.charWidth));
    const rows = Math.max(1, Math.floor(height / this.rowHeight));
    return { cols, rows };
  }

  /** Attach a ResizeObserver that re-emits resize when the grid size changes. */
  startResizeObserver(onChange: (cols: number, rows: number) => void): void {
    this.resizeObserver = new ResizeObserver(() => {
      const m = this.measure();
      if (m && (m.cols !== this.cols || m.rows !== this.rows)) onChange(m.cols, m.rows);
    });
    this.resizeObserver.observe(this.element);
  }

  private setupScrollbar(): void {
    this.scrollbar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startOffset = this.viewportOffset;
      const move = (ev: PointerEvent) => {
        const total = this.scrollbackTotal;
        if (total <= 0) return;
        const pxPerRow = this.element.clientHeight / total;
        if (pxPerRow <= 0) return;
        const delta = (startY - ev.clientY) / pxPerRow;
        const target = Math.max(0, Math.min(total, startOffset + delta));
        const d = target - this.viewportOffset;
        if (d !== 0) this.emit({ t: "scroll", d });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  private updateScrollbar(): void {
    const total = this.scrollbackTotal + this.rows;
    if (total <= this.rows || this.atBottom || this.scrollbackTotal === 0) {
      this.scrollbar.style.opacity = "0";
      return;
    }
    const h = Math.max(24, (this.rows / total) * 100);
    const top = (this.viewportOffset / total) * 100;
    this.scrollbar.style.height = `${h}%`;
    this.scrollbar.style.top = `${top}%`;
    this.scrollbar.style.opacity = "1";
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.pointer.detach();
    this.input.destroy();
    this.element.classList.remove("wterm");
    this.element.innerHTML = "";
  }
}