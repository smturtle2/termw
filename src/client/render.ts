/**
 * Viewport cell renderer. Renders a fixed rows×cols grid from the frame
 * cache; there is no scrollback DOM and no scrollable container — the server
 * owns the viewport and ships complete rows in each frame.
 */

export interface RenderCell {
  char: number;
  fg: number;
  bg: number;
  flags: number;
  width: number;
  linkUri?: string;
  linkKey?: string;
}

const DEFAULT_COLOR = 256;
const FLAG_BOLD = 0x01;
const FLAG_DIM = 0x02;
const FLAG_ITALIC = 0x04;
const FLAG_UNDERLINE = 0x08;
const FLAG_REVERSE = 0x20;
const FLAG_INVISIBLE = 0x40;
const FLAG_STRIKETHROUGH = 0x80;

function colorToCSS(index: number): string | null {
  if (index === DEFAULT_COLOR) return null;
  if (index < 16) return `var(--term-color-${index})`;
  if (index < 232) {
    const n = index - 16;
    const r = Math.floor(n / 36) * 51;
    const g = (Math.floor(n / 6) % 6) * 51;
    const b = (n % 6) * 51;
    return `rgb(${r},${g},${b})`;
  }
  const level = (index - 232) * 10 + 8;
  return `rgb(${level},${level},${level})`;
}

function cellFgCSS(fg: number): string | null {
  return colorToCSS(fg);
}
function cellBgCSS(bg: number): string | null {
  return colorToCSS(bg);
}

function buildCellStyle(fg: number, bg: number, flags: number): string {
  let fgIdx = fg;
  let bgIdx = bg;

  if (flags & FLAG_REVERSE) {
    const tmp = fgIdx;
    fgIdx = bgIdx;
    bgIdx = tmp;
    if (fgIdx === DEFAULT_COLOR) fgIdx = 0;
    if (bgIdx === DEFAULT_COLOR) bgIdx = 7;
  }

  const fgCSS = cellFgCSS(fgIdx);
  const bgCSS = cellBgCSS(bgIdx);

  let style = "";
  if (fgCSS) style += `color:${fgCSS};`;
  if (bgCSS) style += `background:${bgCSS};`;
  if (flags & FLAG_BOLD) style += "font-weight:bold;";
  if (flags & FLAG_DIM) style += "opacity:0.5;";
  if (flags & FLAG_ITALIC) style += "font-style:italic;";

  const decorations: string[] = [];
  if (flags & FLAG_UNDERLINE) decorations.push("underline");
  if (flags & FLAG_STRIKETHROUGH) decorations.push("line-through");
  if (decorations.length) style += `text-decoration:${decorations.join(" ")};`;

  if (flags & FLAG_INVISIBLE) style += "visibility:hidden;";
  return style;
}

function resolveColors(
  fg: number,
  bg: number,
  flags: number,
): { fg: string; bg: string } {
  let fgIdx = fg;
  let bgIdx = bg;
  if (flags & FLAG_REVERSE) {
    [fgIdx, bgIdx] = [bgIdx, fgIdx];
    if (fgIdx === DEFAULT_COLOR) fgIdx = 0;
    if (bgIdx === DEFAULT_COLOR) bgIdx = 7;
  }
  return {
    fg: cellFgCSS(fgIdx) || "var(--term-fg)",
    bg: cellBgCSS(bgIdx) || "var(--term-bg)",
  };
}

const SNAP_1_8 = "round(calc(var(--term-row-height) * 0.125), 1px)";
const SNAP_2_8 = "round(calc(var(--term-row-height) * 0.25), 1px)";
const SNAP_3_8 = "round(calc(var(--term-row-height) * 0.375), 1px)";
const SNAP_4_8 = "round(calc(var(--term-row-height) * 0.5), 1px)";
const SNAP_5_8 = "round(calc(var(--term-row-height) * 0.625), 1px)";
const SNAP_6_8 = "round(calc(var(--term-row-height) * 0.75), 1px)";
const SNAP_7_8 = "round(calc(var(--term-row-height) * 0.875), 1px)";

function getBlockBackground(cp: number, fg: string, bg: string): string {
  switch (cp) {
    case 0x2580:
      return `linear-gradient(${fg} ${SNAP_4_8},${bg} ${SNAP_4_8})`;
    case 0x2581:
      return `linear-gradient(${bg} ${SNAP_7_8},${fg} ${SNAP_7_8})`;
    case 0x2582:
      return `linear-gradient(${bg} ${SNAP_6_8},${fg} ${SNAP_6_8})`;
    case 0x2583:
      return `linear-gradient(${bg} ${SNAP_5_8},${fg} ${SNAP_5_8})`;
    case 0x2584:
      return `linear-gradient(${bg} ${SNAP_4_8},${fg} ${SNAP_4_8})`;
    case 0x2585:
      return `linear-gradient(${bg} ${SNAP_3_8},${fg} ${SNAP_3_8})`;
    case 0x2586:
      return `linear-gradient(${bg} ${SNAP_2_8},${fg} ${SNAP_2_8})`;
    case 0x2587:
      return `linear-gradient(${bg} ${SNAP_1_8},${fg} ${SNAP_1_8})`;
    case 0x2588:
      return fg;
    case 0x2589:
      return `linear-gradient(to right,${fg} 87.5%,${bg} 87.5%)`;
    case 0x258a:
      return `linear-gradient(to right,${fg} 75%,${bg} 75%)`;
    case 0x258b:
      return `linear-gradient(to right,${fg} 62.5%,${bg} 62.5%)`;
    case 0x258c:
      return `linear-gradient(to right,${fg} 50%,${bg} 50%)`;
    case 0x258d:
      return `linear-gradient(to right,${fg} 37.5%,${bg} 37.5%)`;
    case 0x258e:
      return `linear-gradient(to right,${fg} 25%,${bg} 25%)`;
    case 0x258f:
      return `linear-gradient(to right,${fg} 12.5%,${bg} 12.5%)`;
    case 0x2590:
      return `linear-gradient(to right,${bg} 50%,${fg} 50%)`;
    case 0x2591:
      return `color-mix(in srgb,${fg} 25%,${bg})`;
    case 0x2592:
      return `color-mix(in srgb,${fg} 50%,${bg})`;
    case 0x2593:
      return `color-mix(in srgb,${fg} 75%,${bg})`;
    case 0x2594:
      return `linear-gradient(${fg} ${SNAP_1_8},${bg} ${SNAP_1_8})`;
    case 0x2595:
      return `linear-gradient(to right,${bg} 87.5%,${fg} 87.5%)`;
    default: {
      const QUADRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
        0x2596: [false, false, true, false],
        0x2597: [false, false, false, true],
        0x2598: [true, false, false, false],
        0x2599: [true, false, true, true],
        0x259a: [true, false, false, true],
        0x259b: [true, true, true, false],
        0x259c: [true, true, false, true],
        0x259d: [false, true, false, false],
        0x259e: [false, true, true, false],
        0x259f: [false, true, true, true],
      };
      const q = QUADRANTS[cp];
      if (!q) return fg;
      const [tl, tr, bl, br] = q;
      if (tl && tr && bl && br) return fg;
      const layers: string[] = [];
      const POS = ["0 0", "100% 0", "0 100%", "100% 100%"];
      q.forEach((filled, i) => {
        if (filled)
          layers.push(
            `linear-gradient(${fg},${fg}) ${POS[i]}/50% 50% no-repeat`,
          );
      });
      layers.push(bg);
      return layers.join(",");
    }
  }
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeLinkHref(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const AUTO_URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

function linkIdentity(cell: RenderCell): string {
  return cell.linkKey ?? "";
}

function cellText(cell: RenderCell, inBounds: boolean): string {
  if (!inBounds) return " ";
  const cp = cell.char;
  return cp >= 32 ? String.fromCodePoint(cp) : " ";
}

export class ViewRenderer {
  private container: HTMLElement;
  private rowEls: HTMLDivElement[] = [];
  private prevRowBg: string[] = [];
  private prevContainerBg = "";
  private cols = 0;
  private rows = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setup(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.container.innerHTML = "";
    this.rowEls = [];
    this.prevRowBg = [];
    const fragment = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "term-row";
      fragment.appendChild(rowEl);
      this.rowEls.push(rowEl);
    }
    this.container.appendChild(fragment);
  }

  private renderRow(
    rowEl: HTMLDivElement,
    getCell: (col: number) => RenderCell,
    cursorCol: number,
    rowIndex: number,
  ): void {
    let html = "";
    let runStyle = "";
    let runText = "";
    let runCells: string[] = [];
    let runStart = 0;
    let runLinkKey = "";
    let runLinkUri: string | undefined;
    let outputLinkKey = "";

    const appendContent = (
      content: string,
      linkKey: string,
      uri: string | undefined,
    ) => {
      const href = safeLinkHref(uri);
      const nextLinkKey = href ? linkKey : "";
      if (nextLinkKey !== outputLinkKey) {
        if (outputLinkKey) html += "</a>";
        if (nextLinkKey) {
          html += `<a class="term-link" href="${escapeHTML(href!)}" target="_blank" rel="noopener noreferrer" draggable="false">`;
        }
        outputLinkKey = nextLinkKey;
      }
      html += content;
    };

    const flushRun = (endCol: number) => {
      if (!runText) return;
      if (cursorCol >= runStart && cursorCol < endCol) {
        const offset = cursorCol - runStart;
        const before = runCells.slice(0, offset).join("");
        const cursorChar = runCells[offset] || " ";
        const after = runCells.slice(offset + 1).join("");
        let content = "";
        if (before) {
          content += runStyle
            ? `<span style="${runStyle}">${escapeHTML(before)}</span>`
            : `<span>${escapeHTML(before)}</span>`;
        }
        content += runStyle
          ? `<span class="term-cursor" style="${runStyle}">${escapeHTML(cursorChar)}</span>`
          : `<span class="term-cursor">${escapeHTML(cursorChar)}</span>`;
        if (after) {
          content += runStyle
            ? `<span style="${runStyle}">${escapeHTML(after)}</span>`
            : `<span>${escapeHTML(after)}</span>`;
        }
        appendContent(content, runLinkKey, runLinkUri);
      } else if (!runLinkUri && AUTO_URL_RE.test(runText)) {
        AUTO_URL_RE.lastIndex = 0;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = AUTO_URL_RE.exec(runText))) {
          if (m.index > last) {
            const plain = runText.slice(last, m.index);
            html += runStyle
              ? `<span style="${runStyle}">${escapeHTML(plain)}</span>`
              : `<span>${escapeHTML(plain)}</span>`;
          }
          const raw = m[0];
          const clean = raw.replace(/[.,;:!?)\]]+$/, "");
          const href = /^https?:\/\//i.test(clean)
            ? clean
            : `https://${clean}`;
          html += `<a class="term-link term-auto" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer" draggable="false">${
            runStyle
              ? `<span style="${runStyle}">${escapeHTML(clean)}</span>`
              : `<span>${escapeHTML(clean)}</span>`
          }</a>`;
          last = m.index + raw.length;
        }
        if (last < runText.length) {
          const tail = runText.slice(last);
          html += runStyle
            ? `<span style="${runStyle}">${escapeHTML(tail)}</span>`
            : `<span>${escapeHTML(tail)}</span>`;
        }
      } else {
        const content =
          runStyle
            ? `<span style="${runStyle}">${escapeHTML(runText)}</span>`
            : `<span>${escapeHTML(runText)}</span>`;
        appendContent(content, runLinkKey, runLinkUri);
      }
      runText = "";
      runCells = [];
    };

    const appendStyledSpan = (
      className: string,
      style: string,
      text: string,
      linkKey: string,
      linkUri?: string,
    ) => {
      const classAttr = className ? ` class="${className}"` : "";
      const styleAttr = style ? ` style="${style}"` : "";
      appendContent(
        `<span${classAttr}${styleAttr}>${escapeHTML(text)}</span>`,
        linkKey,
        linkUri,
      );
    };

    for (let col = 0; col < this.cols; col++) {
      const cell = getCell(col);
      const cp = cell.char;
      const width = cell.width || 1;
      const cellLinkKey = linkIdentity(cell);
      const cellLinkUri = cell.linkUri;

      if (width === 0) {
        flushRun(col);
        const continuesWide = col > 0 && (getCell(col - 1).width || 1) === 2;
        if (!continuesWide) {
          appendStyledSpan(
            col === cursorCol ? "term-cursor" : "",
            "",
            " ",
            cellLinkKey,
            cellLinkUri,
          );
        }
        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 1;
        continue;
      }

      if (width === 2) {
        flushRun(col);
        if (col + 1 >= this.cols) {
          appendStyledSpan(
            col === cursorCol ? "term-cursor" : "",
            "",
            " ",
            cellLinkKey,
            cellLinkUri,
          );
          runStyle = "";
          runLinkKey = "";
          runLinkUri = undefined;
          runText = "";
          runCells = [];
          runStart = col + 1;
          continue;
        }
        const ch = cellText(cell, true);
        const style = buildCellStyle(cell.fg, cell.bg, cell.flags);
        const cls =
          cursorCol >= col && cursorCol < col + 2
            ? "term-wide term-cursor"
            : "term-wide";
        appendStyledSpan(cls, style, ch, cellLinkKey, cellLinkUri);
        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 2;
        continue;
      }

      if (cp >= 0x2580 && cp <= 0x259f) {
        flushRun(col);
        const colors = resolveColors(cell.fg, cell.bg, cell.flags);
        const cls =
          col === cursorCol ? "term-block term-cursor" : "term-block";
        const bg = getBlockBackground(cp, colors.fg, colors.bg);
        const dim = cell.flags & FLAG_DIM ? "opacity:0.5;" : "";
        appendContent(
          `<span class="${cls}" style="background:${bg};${dim}"></span>`,
          cellLinkKey,
          cellLinkUri,
        );
        runStyle = "";
        runLinkKey = "";
        runLinkUri = undefined;
        runText = "";
        runCells = [];
        runStart = col + 1;
      } else {
        const ch = cellText(cell, true);
        const style = buildCellStyle(cell.fg, cell.bg, cell.flags);
        if (style !== runStyle || cellLinkKey !== runLinkKey) {
          flushRun(col);
          runStyle = style;
          runLinkKey = cellLinkKey;
          runLinkUri = cellLinkUri;
          runText = ch;
          runCells = [ch];
          runStart = col;
        } else {
          runText += ch;
          runCells.push(ch);
        }
      }
    }
    flushRun(this.cols);
    if (outputLinkKey) html += "</a>";

    rowEl.innerHTML = html;

    const lastCell = getCell(this.cols - 1);
    let bgIdx = lastCell.bg;
    if (lastCell.flags & FLAG_REVERSE) {
      bgIdx = lastCell.fg;
      if (bgIdx === DEFAULT_COLOR) bgIdx = 7;
    }
    const bgCss = cellBgCSS(bgIdx) || "";
    const boxShadow = bgCss ? `0 1px 0 ${bgCss}` : "";
    if (bgCss !== (this.prevRowBg[rowIndex] ?? "")) {
      rowEl.style.background = bgCss;
      rowEl.style.boxShadow = boxShadow;
      this.prevRowBg[rowIndex] = bgCss;
    }
  }

  render(
    getCell: (row: number, col: number) => RenderCell,
    cols: number,
    rows: number,
    cursorRow: number,
    cursorCol: number,
    cursorVisible: boolean,
    dirtyRows: Set<number>,
  ): void {
    if (cols !== this.cols || rows !== this.rows) this.setup(cols, rows);

    const rowGet = (r: number) => (c: number) => getCell(r, c);

    for (const r of dirtyRows) {
      if (r < 0 || r >= this.rows) continue;
      const cCol = cursorVisible && r === cursorRow ? cursorCol : -1;
      this.renderRow(this.rowEls[r], rowGet(r), cCol, r);
    }

    // Container background follows the bottom-right cell.
    if (dirtyRows.has(this.rows - 1) || this.prevContainerBg === "") {
      const last = getCell(this.rows - 1, this.cols - 1);
      let bgIdx = last.bg;
      if (last.flags & FLAG_REVERSE) {
        bgIdx = last.fg;
        if (bgIdx === DEFAULT_COLOR) bgIdx = 7;
      }
      const bgCss = cellBgCSS(bgIdx) || "";
      if (bgCss !== this.prevContainerBg) {
        this.container.style.background = bgCss;
        this.prevContainerBg = bgCss;
      }
    }
  }
}