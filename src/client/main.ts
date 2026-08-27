import { WTerm } from "@wterm/dom";
import { DEFAULT_THEME, normalizeTheme, type Theme } from "../shared/theme.js";
import { encodeResize } from "../shared/protocol.js";

const el = document.getElementById("terminal") as HTMLElement;
let ws: WebSocket | null = null;
let term: WTerm | null = null;

async function fetchTheme(): Promise<Theme> {
  try {
    const r = await fetch("/theme.json", { cache: "no-store" });
    if (!r.ok) return DEFAULT_THEME;
    const j = await r.json();
    return normalizeTheme(j);
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme, wterm: WTerm) {
  el.classList.remove("theme-korean-light", "theme-light", "theme-dark", "theme-solarized-dark", "theme-monokai");
  if (theme.mode === "dark") {
    el.classList.add("theme-dark");
  } else {
    el.classList.add("theme-korean-light");
  }
  try {
    const bg = parseInt(theme.background.replace("#", ""), 16);
    const fg = parseInt(theme.foreground.replace("#", ""), 16);
    (wterm as any).bridge?.setThemeColors?.(bg, fg);
  } catch {}
  // Force font stack (server default D2Coding)
  el.style.setProperty("--term-font-family", "'D2Coding', 'D2Coding ligature', 'Noto Sans Mono CJK KR', 'NanumGothicCoding', monospace");
  el.style.setProperty("--term-font-size", "15px");
  el.style.setProperty("--term-line-height", "1.2");
}

async function init() {
  const theme = await fetchTheme();

  const wterm = new WTerm(el, {
    cols: 80,
    rows: 24,
    autoResize: true,
    wasmUrl: "/wterm.wasm",
    cursorBlink: true,
    onData: (data: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    onTitle: (title: string) => {
      document.title = title ? `${title} — termw` : "termw";
    },
    onResize: (cols: number, rows: number) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows));
    },
  });

  await wterm.init();
  term = wterm;
  applyTheme(theme, wterm);
  wterm.focus();
  connect(wterm);
}

function connect(wterm: WTerm) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}/ws`;
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ws!.send(encodeResize(wterm.cols, wterm.rows));
  };

  ws.onmessage = (event: MessageEvent) => {
    const data = event.data;
    let text: string;
    if (data instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(data));
    else if (data instanceof Uint8Array) text = new TextDecoder().decode(data);
    else text = data as string;
    wterm.write(text);
    // Drain OSC 10/11 replies (e.g., opencode queries both)
    const bridge = (wterm as any).bridge as { getResponse?: () => string | null } | undefined;
    if (bridge?.getResponse) {
      let resp: string | null;
      while ((resp = bridge.getResponse()) !== null) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(resp);
      }
    }
  };

  ws.onclose = () => {
    wterm.write("\r\n\x1b[90m[연결 종료 — 새로고침으로 재연결]\x1b[0m\r\n");
  };
  ws.onerror = () => {
    wterm.write("\r\n\x1b[31m[WebSocket 오류]\x1b[0m\r\n");
  };
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") term?.focus();
});
window.addEventListener("click", () => term?.focus());

init();
