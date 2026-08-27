import path from "path";
import fs from "fs";

/**
 * Headless wrapper over the zig terminal core (wasm32-freestanding) running
 * in the server process. The browser no longer holds terminal state — this
 * core is the single source of truth for grid, scrollback and terminal modes.
 */

const CORE_WASM_PATH = path.resolve(
  import.meta.dirname,
  "../../vendor/wterm/packages/@wterm/core/wasm/wterm.wasm",
);

interface WasmExports {
  memory: WebAssembly.Memory;
  init(cols: number, rows: number): void;
  resizeTerminal(cols: number, rows: number): void;
  setThemeColors(bgRgb: number, fgRgb: number): void;
  getWriteBuffer(): number;
  writeBytes(len: number): void;
  getGridPtr(): number;
  getDirtyPtr(): number;
  clearDirty(): void;
  getCursorRow(): number;
  getCursorCol(): number;
  getCursorVisible(): number;
  getCols(): number;
  getRows(): number;
  getCursorKeysApp(): number;
  getBracketedPaste(): number;
  getUsingAltScreen(): number;
  getMouseTracking(): number;
  getMouseSgr(): number;
  getFocusEvents(): number;
  getSynchronizedOutput(): number;
  getSynchronizedOutputGeneration(): number;
  getTitlePtr(): number;
  getTitleLen(): number;
  getTitleChanged(): number;
  getLinkUriPtr(index: number): number;
  getLinkUriLen(index: number): number;
  getLinkIdPtr(index: number): number;
  getLinkIdLen(index: number): number;
  getScrollbackCount(): number;
  getScrollbackLine(offset: number): number;
  getScrollbackLineLen(offset: number): number;
  getResponsePtr(): number;
  getResponseLen(): number;
  clearResponse(): void;
  getCellSize(): number;
  getMaxCols(): number;
}

let wasmCache: ArrayBuffer | null = null;

function loadWasmBytes(): ArrayBuffer {
  if (wasmCache) return wasmCache;
  const buf = fs.readFileSync(CORE_WASM_PATH);
  wasmCache = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return wasmCache;
}

export interface CoreModeSnapshot {
  mouseTracking: 0 | 1000 | 1002 | 1003;
  mouseSgr: boolean;
  focusEvents: boolean;
  bracketedPaste: boolean;
  cursorKeysApp: boolean;
  usingAltScreen: boolean;
}

export class TerminalCore {
  private exports: WasmExports;
  private memory: WebAssembly.Memory;
  private gridPtr = 0;
  private dirtyPtr = 0;
  private writeBufferPtr = 0;
  private cellSize = 12;
  private _maxCols = 256;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  static async create(): Promise<TerminalCore> {
    const bytes = loadWasmBytes();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new TerminalCore(instance);
  }

  private constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as WasmExports;
    this.memory = this.exports.memory;
    this.gridPtr = this.exports.getGridPtr();
    this.dirtyPtr = this.exports.getDirtyPtr();
    this.writeBufferPtr = this.exports.getWriteBuffer();
    this.cellSize = this.exports.getCellSize();
    this._maxCols = this.exports.getMaxCols();
  }

  init(cols: number, rows: number): void {
    this.exports.init(cols, rows);
    this.gridPtr = this.exports.getGridPtr();
    this.dirtyPtr = this.exports.getDirtyPtr();
  }

  resize(cols: number, rows: number): void {
    this.exports.resizeTerminal(cols, rows);
    this.gridPtr = this.exports.getGridPtr();
    this.dirtyPtr = this.exports.getDirtyPtr();
  }

  setThemeColors(bgRgb: number, fgRgb: number): void {
    this.exports.setThemeColors(bgRgb, fgRgb);
  }

  get cols(): number {
    return this.exports.getCols();
  }
  get rows(): number {
    return this.exports.getRows();
  }
  get maxCols(): number {
    return this._maxCols;
  }

  /** Feed raw PTY bytes into the emulator. Chunks are clamped to the input buffer. */
  write(data: Uint8Array): void {
    let offset = 0;
    while (offset < data.length) {
      const chunk = Math.min(data.length - offset, 8192);
      const buf = new Uint8Array(
        this.memory.buffer,
        this.writeBufferPtr,
        8192,
      );
      buf.set(data.subarray(offset, offset + chunk));
      this.exports.writeBytes(chunk);
      offset += chunk;
    }
  }

  /** Raw pointer to row `r` cells in grid memory (stride = maxCols * cellSize). */
  gridRowBytes(r: number): Uint8Array {
    return new Uint8Array(
      this.memory.buffer,
      this.gridPtr + r * this.maxCols * this.cellSize,
      this.cols * this.cellSize,
    );
  }

  dirtyRowFlags(): Uint8Array {
    return new Uint8Array(this.memory.buffer, this.dirtyPtr, this.rows);
  }

  clearDirty(): void {
    this.exports.clearDirty();
  }

  getCursor(): { row: number; col: number; visible: boolean } {
    return {
      row: this.exports.getCursorRow(),
      col: this.exports.getCursorCol(),
      visible: this.exports.getCursorVisible() !== 0,
    };
  }

  modes(): CoreModeSnapshot {
    const mt = this.exports.getMouseTracking();
    return {
      mouseTracking:
        mt === 1000 || mt === 1002 || mt === 1003
          ? (mt as 0 | 1000 | 1002 | 1003)
          : 0,
      mouseSgr: this.exports.getMouseSgr() !== 0,
      focusEvents: this.exports.getFocusEvents() !== 0,
      bracketedPaste: this.exports.getBracketedPaste() !== 0,
      cursorKeysApp: this.exports.getCursorKeysApp() !== 0,
      usingAltScreen: this.exports.getUsingAltScreen() !== 0,
    };
  }

  synchronizedOutput(): boolean {
    return this.exports.getSynchronizedOutput() !== 0;
  }
  synchronizedOutputGeneration(): number {
    return this.exports.getSynchronizedOutputGeneration();
  }

  /** Drain queued responses (DSR/CPR, OSC color replies) and return them. */
  drainResponses(): string {
    let out = "";
    let len = this.exports.getResponseLen();
    while (len > 0) {
      const ptr = this.exports.getResponsePtr();
      out += this.decoder.decode(
        new Uint8Array(this.memory.buffer, ptr, len),
      );
      this.exports.clearResponse();
      len = this.exports.getResponseLen();
    }
    return out;
  }

  /** Consume pending title change. Returns null when unchanged. */
  takeTitle(): string | null {
    if (this.exports.getTitleChanged() === 0) return null;
    const ptr = this.exports.getTitlePtr();
    const len = this.exports.getTitleLen();
    return this.decoder.decode(new Uint8Array(this.memory.buffer, ptr, len));
  }

  /** Scrollback line cells as raw bytes (may be shorter than cols). */
  scrollbackLineBytes(offset: number): Uint8Array {
    const ptr = this.exports.getScrollbackLine(offset);
    const len = this.exports.getScrollbackLineLen(offset);
    return new Uint8Array(this.memory.buffer, ptr, len * this.cellSize);
  }
  scrollbackCount(): number {
    return this.exports.getScrollbackCount();
  }

  /** Hyperlink table entry for a link index. */
  linkAt(index: number): { uri: string; id?: string } | null {
    const uriLen = this.exports.getLinkUriLen(index);
    if (uriLen === 0) return null;
    const uri = this.decoder.decode(
      new Uint8Array(
        this.memory.buffer,
        this.exports.getLinkUriPtr(index),
        uriLen,
      ),
    );
    const idLen = this.exports.getLinkIdLen(index);
    const id =
      idLen === 0
        ? undefined
        : this.decoder.decode(
            new Uint8Array(
              this.memory.buffer,
              this.exports.getLinkIdPtr(index),
              idLen,
            ),
          );
    return { uri, id };
  }
}