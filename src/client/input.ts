import type { ClientEvent } from "../shared/protocol.js";

interface CursorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Keyboard + IME + clipboard capture. The client only captures and forwards
 * raw events; the server owns key→escape-sequence conversion.
 */
export class InputCapture {
  private element: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private compositionView: HTMLSpanElement;
  private emit: (e: ClientEvent) => void;
  private getCursorRect: () => CursorRect | null;
  private composing = false;

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onPaste: (e: ClipboardEvent) => void;
  private _onCompositionStart: () => void;
  private _onCompositionUpdate: (e: CompositionEvent) => void;
  private _onCompositionEnd: (e: CompositionEvent) => void;
  private _onInput: () => void;
  private _onFocus: () => void;
  private _onBlur: () => void;
  private _onElementKeyDown: (e: KeyboardEvent) => void;

  constructor(
    element: HTMLElement,
    emit: (e: ClientEvent) => void,
    getCursorRect: () => CursorRect | null,
  ) {
    this.element = element;
    this.emit = emit;
    this.getCursorRect = getCursorRect;

    this.textarea = document.createElement("textarea");
    this.textarea.setAttribute("autocapitalize", "off");
    this.textarea.setAttribute("autocomplete", "off");
    this.textarea.setAttribute("autocorrect", "off");
    this.textarea.setAttribute("spellcheck", "false");
    this.textarea.setAttribute("enterkeyhint", "send");
    this.textarea.setAttribute("tabindex", "0");
    this.textarea.setAttribute("aria-hidden", "true");
    const s = this.textarea.style;
    s.position = "absolute";
    s.left = "0";
    s.top = "0";
    s.width = "1ch";
    s.height = "1.2em";
    s.opacity = "0";
    s.zIndex = "10";
    s.overflow = "hidden";
    s.border = "0";
    s.padding = "0";
    s.margin = "0";
    s.outline = "none";
    s.resize = "none";
    s.pointerEvents = "none";
    s.caretColor = "transparent";
    s.color = "transparent";
    s.background = "transparent";
    element.appendChild(this.textarea);

    this.compositionView = document.createElement("span");
    this.compositionView.className = "term-composition";
    const cs = this.compositionView.style;
    cs.position = "absolute";
    cs.font = "inherit";
    cs.color = "inherit";
    cs.background = "var(--term-bg, #1e1e1e)";
    cs.whiteSpace = "pre";
    cs.textDecoration = "underline";
    cs.textDecorationStyle = "solid";
    cs.zIndex = "50";
    cs.pointerEvents = "none";
    cs.padding = "0";
    cs.margin = "0";
    cs.border = "0";
    cs.display = "none";
    element.appendChild(this.compositionView);

    this._onKeyDown = (e) => this.handleKeyDown(e);
    this._onPaste = (e) => this.handlePaste(e);
    this._onCompositionStart = () => {
      this.composing = true;
      this.positionAtCursor();
      this.compositionView.style.display = "inline-block";
    };
    this._onCompositionUpdate = (e) => {
      this.compositionView.textContent = e.data || "";
    };
    this._onCompositionEnd = (e) => {
      this.composing = false;
      this.compositionView.style.display = "none";
      this.compositionView.textContent = "";
      const committed = e.data || "";
      if (committed) this.emit({ t: "text", s: committed });
      const raw = this.textarea.value;
      if (raw) {
        let toSend = raw;
        if (committed && raw.startsWith(committed)) {
          toSend = raw.slice(committed.length);
        }
        if (toSend) this.emit({ t: "text", s: toSend });
      }
      this.textarea.value = "";
    };
    this._onInput = () => {
      if (this.composing) return;
      const value = this.textarea.value;
      if (value) {
        this.emit({ t: "text", s: value });
        this.textarea.value = "";
      }
    };
    this._onFocus = () => {
      this.element.classList.add("focused");
      this.emit({ t: "focus", v: true });
    };
    this._onBlur = () => {
      this.element.classList.remove("focused");
      this.emit({ t: "focus", v: false });
    };
    // After a drag the browser moves focus to the (tabindex=0) terminal div,
    // so keys would go nowhere. Forward them to the textarea instead.
    this._onElementKeyDown = (e) => {
      if (this.element.ownerDocument.activeElement !== this.element) return;
      e.preventDefault();
      e.stopPropagation();
      this.textarea.focus({ preventScroll: true });
      this.textarea.dispatchEvent(new KeyboardEvent("keydown", e));
    };

    this.textarea.addEventListener("keydown", this._onKeyDown);
    this.textarea.addEventListener("paste", this._onPaste as EventListener);
    this.textarea.addEventListener("compositionstart", this._onCompositionStart);
    this.textarea.addEventListener("compositionupdate", this._onCompositionUpdate);
    this.textarea.addEventListener("compositionend", this._onCompositionEnd);
    this.textarea.addEventListener("input", this._onInput);
    this.textarea.addEventListener("focus", this._onFocus);
    this.textarea.addEventListener("blur", this._onBlur);
    this.element.addEventListener("keydown", this._onElementKeyDown);
  }

  focus(): void {
    this.textarea.focus({ preventScroll: true });
  }

  private positionAtCursor(): void {
    const rect = this.getCursorRect();
    if (!rect) return;
    const s = this.textarea.style;
    s.left = rect.left + "px";
    s.top = rect.top + "px";
    s.width = Math.max(1, rect.width) + "px";
    s.height = Math.max(1, rect.height) + "px";
    const cs = this.compositionView.style;
    cs.left = rect.left + "px";
    cs.top = rect.top + "px";
    cs.height = rect.height + "px";
    cs.lineHeight = rect.height + "px";
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (
      this.composing ||
      (e as any).isComposing ||
      e.keyCode === 229 ||
      e.key === "Process"
    )
      return;

    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "v") {
      this.textarea.focus();
      return;
    }
    if (e.metaKey && !e.ctrlKey) {
      if (e.key === "Backspace") {
        e.preventDefault();
        this.emit({ t: "text", s: "\x15" });
        return;
      }
      if (e.key === "a") {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(this.element);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return;
      }
    }

    e.preventDefault();
    this.emit({
      t: "key",
      k: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      repeat: e.repeat,
    });
  }

  private handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (!text) return;
    this.emit({ t: "paste", s: text });
  }

  destroy(): void {
    this.textarea.removeEventListener("keydown", this._onKeyDown);
    this.textarea.removeEventListener("paste", this._onPaste as EventListener);
    this.textarea.removeEventListener("compositionstart", this._onCompositionStart);
    this.textarea.removeEventListener("compositionupdate", this._onCompositionUpdate);
    this.textarea.removeEventListener("compositionend", this._onCompositionEnd);
    this.textarea.removeEventListener("input", this._onInput);
    this.textarea.removeEventListener("focus", this._onFocus);
    this.textarea.removeEventListener("blur", this._onBlur);
    this.element.removeEventListener("keydown", this._onElementKeyDown);
    this.textarea.remove();
    this.compositionView.remove();
  }
}