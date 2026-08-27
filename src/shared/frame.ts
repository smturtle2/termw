/**
 * Binary render-frame protocol between server and client.
 *
 * The server owns the terminal emulator (grid + scrollback + viewport) and
 * encodes the current viewport as compact frames; the client is a pure
 * rendering layer that decodes frames into a cell cache and draws them.
 *
 * Cell wire layout (12 bytes, little-endian, mirrors zig Cell extern struct):
 *   0: u32 char          — code point
 *   4: u16 fg            — palette index (256 = default)
 *   6: u16 bg            — palette index (256 = default)
 *   8: u8  flags         — bold/dim/italic/underline/blink/reverse/...
 *   9: u8  width         — 0 continuation, 1 narrow, 2 wide lead
 *  10: u16 link          — hyperlink table index (0 = none)
 *
 * Frame layout:
 *   0:  u8  magic = 0x54
 *   1:  u8  version = 1
 *   2:  u16 cols, 4: u16 rows
 *   6:  u32 scrollbackTotal
 *  10:  u32 viewportOffset   (lines above the screen bottom being viewed)
 *  14:  u8  atBottom
 *  15:  u8  modes
 *          bits 0-1: mouse tracking (0=off,1=1000,2=1002,3=1003)
 *          bit  2:   SGR encoding on
 *          bit  3:   focus events on
 *          bit  4:   bracketed paste on
 *          bit  5:   application cursor keys on
 *  16:  u16 cursorRow, 18: u16 cursorCol, 20: u8 cursorVisible
 *  21:  u16 dirtyRowCount
 *        per row: u16 index, u16 cellCount, cellCount * 12 bytes
 *  tail: u16 linkCount
 *        per link: u16 index, u16 uriLen, uri utf8, u16 idLen, id utf8
 */

export const FRAME_MAGIC = 0x54;
export const FRAME_VERSION = 1;

/** Modes bit flags. */
export const MODE_MOUSE_MASK = 0x03;
export const MODE_MOUSE_1000 = 1;
export const MODE_MOUSE_1002 = 2;
export const MODE_MOUSE_1003 = 3;
export const MODE_SGR = 0x04;
export const MODE_FOCUS = 0x08;
export const MODE_BRACKETED_PASTE = 0x10;
export const MODE_CURSOR_APP = 0x20;

export interface FrameMeta {
  cols: number;
  rows: number;
  scrollbackTotal: number;
  viewportOffset: number;
  atBottom: boolean;
  cursorRow: number;
  cursorCol: number;
  cursorVisible: boolean;
  mouseTracking: 0 | 1000 | 1002 | 1003;
  mouseSgr: boolean;
  focusEvents: boolean;
  bracketedPaste: boolean;
  cursorKeysApp: boolean;
}

export interface DecodedCell {
  char: number;
  fg: number;
  bg: number;
  flags: number;
  width: number;
  link: number;
}

export interface FrameLink {
  index: number;
  uri: string;
  id?: string;
}

export interface DecodedFrame {
  meta: FrameMeta;
  rows: Array<{ index: number; cells: DecodedCell[] }>;
  links: FrameLink[];
}

export interface FrameDirtyRow {
  /** Viewport row index (0-based). */
  index: number;
  /** Raw 12-byte cells (already padded to `cols`). */
  bytes: Uint8Array;
}

export function mouseTrackingToBits(v: 0 | 1000 | 1002 | 1003): number {
  if (v === 1000) return MODE_MOUSE_1000;
  if (v === 1002) return MODE_MOUSE_1002;
  if (v === 1003) return MODE_MOUSE_1003;
  return 0;
}

export function bitsToMouseTracking(bits: number): 0 | 1000 | 1002 | 1003 {
  switch (bits & MODE_MOUSE_MASK) {
    case MODE_MOUSE_1000:
      return 1000;
    case MODE_MOUSE_1002:
      return 1002;
    case MODE_MOUSE_1003:
      return 1003;
    default:
      return 0;
  }
}

/** Blank cell used to pad short scrollback lines / empty columns. */
export const BLANK_CELL_BYTES = new Uint8Array(12); // all zero → char=0 handled by decoder as space

function writeU16(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff];
}

function writeU32(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

export function encodeFrame(
  meta: FrameMeta,
  rows: FrameDirtyRow[],
  links: FrameLink[],
): Uint8Array {
  const textEncoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const push = (arr: Uint8Array) => parts.push(arr);
  const pushByte = (v: number) => push(new Uint8Array([v & 0xff]));
  const pushU16 = (v: number) => push(new Uint8Array(writeU16(v)));
  const pushU32 = (v: number) => push(new Uint8Array(writeU32(v)));

  pushByte(FRAME_MAGIC);
  pushByte(FRAME_VERSION);
  pushU16(meta.cols);
  pushU16(meta.rows);
  pushU32(meta.scrollbackTotal);
  pushU32(meta.viewportOffset);
  pushByte(meta.atBottom ? 1 : 0);
  const modes =
    mouseTrackingToBits(meta.mouseTracking) |
    (meta.mouseSgr ? MODE_SGR : 0) |
    (meta.focusEvents ? MODE_FOCUS : 0) |
    (meta.bracketedPaste ? MODE_BRACKETED_PASTE : 0) |
    (meta.cursorKeysApp ? MODE_CURSOR_APP : 0);
  pushByte(modes);
  pushU16(meta.cursorRow);
  pushU16(meta.cursorCol);
  pushByte(meta.cursorVisible ? 1 : 0);
  pushU16(rows.length);
  for (const row of rows) {
    pushU16(row.index);
    pushU16(meta.cols);
    push(row.bytes);
  }
  pushU16(links.length);
  for (const link of links) {
    const uri = textEncoder.encode(link.uri);
    const id = link.id !== undefined ? textEncoder.encode(link.id) : new Uint8Array(0);
    pushU16(link.index);
    pushU16(uri.length);
    push(uri);
    pushU16(id.length);
    push(id);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function isRenderFrame(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === FRAME_MAGIC && buf[1] === FRAME_VERSION;
}

export function decodeFrame(buf: Uint8Array): DecodedFrame {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 2; // skip magic+version
  const cols = dv.getUint16(o, true);
  o += 2;
  const rows = dv.getUint16(o, true);
  o += 2;
  const scrollbackTotal = dv.getUint32(o, true);
  o += 4;
  const viewportOffset = dv.getUint32(o, true);
  o += 4;
  const atBottom = dv.getUint8(o) !== 0;
  o += 1;
  const modes = dv.getUint8(o);
  o += 1;
  const cursorRow = dv.getUint16(o, true);
  o += 2;
  const cursorCol = dv.getUint16(o, true);
  o += 2;
  const cursorVisible = dv.getUint8(o) !== 0;
  o += 1;
  const rowCount = dv.getUint16(o, true);
  o += 2;

  const meta: FrameMeta = {
    cols,
    rows,
    scrollbackTotal,
    viewportOffset,
    atBottom,
    cursorRow,
    cursorCol,
    cursorVisible,
    mouseTracking: bitsToMouseTracking(modes),
    mouseSgr: (modes & MODE_SGR) !== 0,
    focusEvents: (modes & MODE_FOCUS) !== 0,
    bracketedPaste: (modes & MODE_BRACKETED_PASTE) !== 0,
    cursorKeysApp: (modes & MODE_CURSOR_APP) !== 0,
  };

  const frameRows: Array<{ index: number; cells: DecodedCell[] }> = [];
  for (let i = 0; i < rowCount; i++) {
    const index = dv.getUint16(o, true);
    o += 2;
    const cellCount = dv.getUint16(o, true);
    o += 2;
    const cells: DecodedCell[] = new Array(cellCount);
    for (let c = 0; c < cellCount; c++) {
      const base = o + c * 12;
      cells[c] = {
        char: dv.getUint32(base, true),
        fg: dv.getUint16(base + 4, true),
        bg: dv.getUint16(base + 6, true),
        flags: dv.getUint8(base + 8),
        width: dv.getUint8(base + 9),
        link: dv.getUint16(base + 10, true),
      };
    }
    o += cellCount * 12;
    frameRows.push({ index, cells });
  }

  const linkCount = dv.getUint16(o, true);
  o += 2;
  const links: FrameLink[] = [];
  for (let i = 0; i < linkCount; i++) {
    const index = dv.getUint16(o, true);
    o += 2;
    const uriLen = dv.getUint16(o, true);
    o += 2;
    const uri = new TextDecoder().decode(buf.subarray(o, o + uriLen));
    o += uriLen;
    const idLen = dv.getUint16(o, true);
    o += 2;
    const id = idLen > 0 ? new TextDecoder().decode(buf.subarray(o, o + idLen)) : undefined;
    o += idLen;
    links.push({ index, uri, id });
  }

  return { meta, rows: frameRows, links };
}

/** Blank cell (space, default colors, narrow). */
export function blankCell(): DecodedCell {
  return { char: 0x20, fg: 256, bg: 256, flags: 0, width: 1, link: 0 };
}