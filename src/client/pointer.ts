import type { PointerEventMsg, ClientEvent } from "../shared/protocol.js";

interface Modes {
  mouseTracking: 0 | 1000 | 1002 | 1003;
  mouseSgr: boolean;
}

/**
 * Unified pointer/wheel/touch capture → raw events. The server decides
 * SGR-vs-scroll; the client only forwards cell coordinates and gates native
 * behaviors (text selection) on whether the app has mouse reporting on.
 */
export class PointerCapture {
  private element: HTMLElement;
  private emit: (e: ClientEvent) => void;
  private getCellAt: (x: number, y: number) => { col: number; row: number } | null;
  private getModes: () => Modes;
  private focus: () => void;

  private pressStart: { x: number; y: number } | null = null;
  private wasDrag = false;
  private pointerDown = false;
  private suppressGesture = false;
  private capturedPointer: number | null = null;
  private heldButton = 0;
  private lastCell: { col: number; row: number } | null = null;

  private _onPointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private _onPointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private _onPointerUp = (e: PointerEvent) => this.onPointerUp(e);
  private _onPointerCancel = () => this.onPointerCancel();
  private _onWheel = (e: WheelEvent) => this.onWheel(e);
  private _onClick = (e: MouseEvent) => this.onClick(e);

  constructor(
    element: HTMLElement,
    emit: (e: ClientEvent) => void,
    getCellAt: (x: number, y: number) => { col: number; row: number } | null,
    getModes: () => Modes,
    focus: () => void,
  ) {
    this.element = element;
    this.emit = emit;
    this.getCellAt = getCellAt;
    this.getModes = getModes;
    this.focus = focus;
  }

  attach(): void {
    this.element.addEventListener("pointerdown", this._onPointerDown);
    this.element.addEventListener("pointermove", this._onPointerMove);
    this.element.addEventListener("pointerup", this._onPointerUp);
    this.element.addEventListener("pointercancel", this._onPointerCancel);
    this.element.addEventListener("wheel", this._onWheel, { passive: false });
    this.element.addEventListener("click", this._onClick);
  }

  detach(): void {
    this.element.removeEventListener("pointerdown", this._onPointerDown);
    this.element.removeEventListener("pointermove", this._onPointerMove);
    this.element.removeEventListener("pointerup", this._onPointerUp);
    this.element.removeEventListener("pointercancel", this._onPointerCancel);
    this.element.removeEventListener("wheel", this._onWheel);
    this.element.removeEventListener("click", this._onClick);
  }

  private modBits(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }): number {
    return (
      (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0)
    );
  }

  private pointerTypeBits(pt: string): 0 | 1 | 2 {
    if (pt === "touch") return 1;
    if (pt === "pen") return 2;
    return 0;
  }

  private onPointerDown(e: PointerEvent): void {
    const modes = this.getModes();
    const reporting = modes.mouseTracking !== 0 && modes.mouseSgr;
    // While the app has mouse reporting, Ctrl/Cmd+click on a link still opens
    // it (standard terminal behavior) instead of sending SGR to the app.
    if (reporting && (e.ctrlKey || e.metaKey)) {
      const target = e.target;
      if (target instanceof Element && target.closest(".term-link")) {
        this.suppressGesture = true;
        return;
      }
    }
    const cell = this.getCellAt(e.clientX, e.clientY);
    if (!cell) return;
    this.pressStart = { x: e.clientX, y: e.clientY };
    this.wasDrag = false;
    this.pointerDown = true;
    this.heldButton = e.button <= 2 ? e.button : 0;
    this.lastCell = cell;
    if (this.element.setPointerCapture) {
      try {
        this.element.setPointerCapture(e.pointerId);
      } catch {}
      this.capturedPointer = e.pointerId;
    }
    if (reporting) e.preventDefault();
    this.emit({
      t: "ptr",
      k: 0,
      x: cell.col,
      y: cell.row,
      b: this.heldButton,
      m: this.modBits(e),
      pt: this.pointerTypeBits(e.pointerType),
    });
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.suppressGesture) return;
    const cell = this.getCellAt(e.clientX, e.clientY);
    if (!cell) return;
    if (this.pressStart) {
      const dx = e.clientX - this.pressStart.x;
      const dy = e.clientY - this.pressStart.y;
      if (Math.hypot(dx, dy) > 4) this.wasDrag = true;
    }
    const modes = this.getModes();
    const reporting = modes.mouseTracking !== 0 && modes.mouseSgr;
    const anyMotion = reporting && modes.mouseTracking === 1003 && !this.pointerDown;
    if (!this.pointerDown && !anyMotion) return;
    // For button-less any-motion only report cell changes to avoid noise.
    if (!this.pointerDown) {
      if (this.lastCell && this.lastCell.col === cell.col && this.lastCell.row === cell.row)
        return;
    }
    this.lastCell = cell;
    this.emit({
      t: "ptr",
      k: 1,
      x: cell.col,
      y: cell.row,
      b: this.heldButton,
      m: this.modBits(e),
      pt: this.pointerTypeBits(e.pointerType),
    });
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.suppressGesture) {
      this.suppressGesture = false;
      this.pointerDown = false;
      this.pressStart = null;
      return;
    }
    this.pointerDown = false;
    if (this.capturedPointer !== null) {
      try {
        this.element.releasePointerCapture(this.capturedPointer);
      } catch {}
      this.capturedPointer = null;
    }
    const modes = this.getModes();
    const reporting = modes.mouseTracking !== 0 && modes.mouseSgr;
    const cell = this.getCellAt(e.clientX, e.clientY);
    if (reporting && cell) {
      this.emit({
        t: "ptr",
        k: 2,
        x: cell.col,
        y: cell.row,
        b: this.heldButton,
        m: this.modBits(e),
        pt: this.pointerTypeBits(e.pointerType),
      });
    }
    this.pressStart = null;
  }

  private onPointerCancel(): void {
    this.pointerDown = false;
    this.pressStart = null;
    this.capturedPointer = null;
  }

  private onWheel(e: WheelEvent): void {
    const modes = this.getModes();
    const reporting = modes.mouseTracking !== 0 && modes.mouseSgr;
    if (reporting) e.preventDefault();
    const cell = this.getCellAt(e.clientX, e.clientY);
    this.emit({
      t: "ptr",
      k: 3,
      x: cell?.col ?? 1,
      y: cell?.row ?? 1,
      b: 0,
      m: this.modBits(e),
      pt: 0,
      dx: e.deltaX,
      dy: e.deltaY,
    });
  }

  private onClick(e: MouseEvent): void {
    if (this.wasDrag) return;
    const target = e.target;
    if (target instanceof Element && target.closest(".term-link")) return;
    this.focus();
  }
}