import { WTerm } from "@wterm/dom";
import { DEFAULT_THEME, luminance, normalizeTheme, type Theme } from "../shared/theme.js";
import {
  encodeResize,
  encodeSessionDelete,
  THEME_UPDATE_TYPE,
  TITLE_UPDATE_TYPE,
} from "../shared/protocol.js";

const el = document.getElementById("terminal") as HTMLElement;
const tabListEl = document.getElementById("tab-list") as HTMLElement;
const tabNewEl = document.getElementById("tab-new") as HTMLButtonElement;

interface TabMeta {
  id: string;
  title: string;
}

const TABS_KEY = "termw.tabs";
const RECONNECT_MAX_DELAY = 30000;

let ws: WebSocket | null = null;
let term: WTerm | null = null;
let currentTabId: string | null = null;
let currentTheme: Theme | null = null;
let connecting = false;
let manualClose = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function loadTabs(): TabMeta[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((t) => t && typeof t.id === "string" && t.id.length >= 8 && t.id.length <= 64);
  } catch {
    return [];
  }
}

function saveTabs(tabs: TabMeta[]) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {}
}

function getSyncTheme(): Theme | null {
  try {
    const el = document.getElementById("termw-theme") as HTMLElement | null;
    if (el && el.textContent) return normalizeTheme(JSON.parse(el.textContent));
  } catch {}
  return null;
}

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
  // palette class only supplies the 16-color table; bg/fg/cursor come from theme.json
  el.classList.remove("theme-korean-light", "theme-light", "theme-dark", "theme-solarized-dark", "theme-monokai");
  el.classList.add(luminance(theme.background) > 128 ? "theme-korean-light" : "theme-dark");
  el.style.setProperty("--term-bg", theme.background);
  el.style.setProperty("--term-fg", theme.foreground);
  el.style.setProperty("--term-cursor", theme.foreground);
  document.body.style.background = theme.background;
  document.body.style.color = theme.foreground;
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

function updateTitle(title: string) {
  document.title = title ? `${title} — termw` : "termw";
  if (!currentTabId) return;
  const tabs = loadTabs();
  const t = tabs.find((x) => x.id === currentTabId);
  if (t && t.title !== title) {
    t.title = title;
    saveTabs(tabs);
    renderTabBar();
  }
}

function renderTabBar() {
  const tabs = loadTabs();
  tabListEl.innerHTML = "";
  tabs.forEach((t, i) => {
    const item = document.createElement("div");
    item.className = "tab-item" + (t.id === currentTabId ? " active" : "");
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = t.title || `세션 ${i + 1}`;
    label.title = t.title || "";
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "세션 닫기";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.id);
    });
    item.appendChild(label);
    item.appendChild(close);
    item.addEventListener("click", () => {
      if (t.id !== currentTabId) void selectTab(t.id);
    });
    tabListEl.appendChild(item);
  });
}

function createTab() {
  const tabs = loadTabs();
  const id = crypto.randomUUID();
  tabs.push({ id, title: "" });
  saveTabs(tabs);
  renderTabBar();
  void selectTab(id);
}

function closeTab(id: string) {
  const tabs = loadTabs();
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  // ask server to tear the session down (fire-and-forget; frame is queued
  // before close below)
  if (id === currentTabId && ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(encodeSessionDelete(id));
    } catch {}
  }
  tabs.splice(idx, 1);
  saveTabs(tabs);
  if (id === currentTabId) {
    if (tabs.length > 0) void selectTab(tabs[Math.min(idx, tabs.length - 1)].id);
    else createTab();
  } else {
    renderTabBar();
  }
}

function teardownConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch {}
    ws = null;
  }
  connecting = false;
  manualClose = true;
  reconnectDelay = 1000;
}

async function selectTab(id: string) {
  if (id === currentTabId) {
    renderTabBar();
    return;
  }
  teardownConnection();
  currentTabId = id;
  renderTabBar();
  await setupTerm();
}

async function setupTerm() {
  term?.destroy();
  term = null;
  const theme = currentTheme ?? DEFAULT_THEME;
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
      updateTitle(title);
    },
    onResize: (cols: number, rows: number) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows));
    },
  });

  await wterm.init();
  term = wterm;
  // setThemeColors must complete before any PTY spawn/OSC query
  applyTheme(theme, wterm);
  connect();
  wterm.focus();
}

function connect() {
  if (!currentTabId || connecting) return;
  const wterm = term;
  if (!wterm) return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}/ws?id=${encodeURIComponent(currentTabId)}`;
  connecting = true;
  manualClose = false;
  const s = new WebSocket(url);
  s.binaryType = "arraybuffer";
  ws = s;

  s.onopen = () => {
    connecting = false;
    reconnectDelay = 1000;
    if (ws === s) {
      try {
        s.send(encodeResize(wterm.cols, wterm.rows));
      } catch {}
    }
  };

  s.onmessage = (event: MessageEvent) => {
    const data = event.data;
    let text: string;
    if (data instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(data));
    else if (data instanceof Uint8Array) text = new TextDecoder().decode(data);
    else text = data as string;
    try {
      const j = JSON.parse(text);
      if (j && j.type === THEME_UPDATE_TYPE && j.theme) {
        const t = normalizeTheme(j.theme);
        currentTheme = t;
        applyTheme(t, wterm);
        return;
      }
      if (j && j.type === TITLE_UPDATE_TYPE && typeof j.title === "string") {
        updateTitle(j.title);
        return;
      }
    } catch {}
    wterm.write(text);
    // wterm.write already drains OSC replies via onData(ws.send); no second drain needed
  };

  s.onclose = () => {
    connecting = false;
    if (ws === s) ws = null;
    if (!manualClose && currentTabId) {
      wterm.write("\r\n\x1b[90m[연결 끊김 — 재연결 중...]\x1b[0m\r\n");
      scheduleReconnect();
    }
  };

  s.onerror = () => {
    // onclose follows; reconnection is handled there
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !currentTabId) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (ws === null && !manualClose) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
}

function reconnectNow() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws === null && !manualClose) connect();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    term?.focus();
    reconnectNow();
  }
});
window.addEventListener("click", () => term?.focus());

function setupThemeUI() {
  const btn = document.getElementById("theme-btn") as HTMLButtonElement | null;
  const dlg = document.getElementById("theme-dialog") as HTMLDialogElement | null;
  const bg = document.getElementById("theme-bg") as HTMLInputElement | null;
  const fg = document.getElementById("theme-fg") as HTMLInputElement | null;
  const preset = document.getElementById("theme-preset") as HTMLSelectElement | null;
  const apply = document.getElementById("theme-apply") as HTMLButtonElement | null;
  const cancel = document.getElementById("theme-cancel") as HTMLButtonElement | null;
  const status = document.getElementById("theme-status") as HTMLElement | null;
  if (!btn || !dlg || !bg || !fg || !preset || !apply || !cancel) return;
  const PRESETS: Record<string, Theme> = {
    light: { background: "#ffffff", foreground: "#000000" },
    dark: { background: "#1e1e1e", foreground: "#d4d4d4" },
    solarized: { background: "#002b36", foreground: "#839496" },
    monokai: { background: "#272822", foreground: "#f8f8f2" },
  };
  btn.addEventListener("click", async () => {
    try {
      const t = await fetchTheme();
      bg.value = t.background;
      fg.value = t.foreground;
      if (status) status.textContent = "";
      dlg.showModal();
    } catch {}
  });
  preset.addEventListener("change", () => {
    const p = PRESETS[preset.value];
    if (p) { bg.value = p.background; fg.value = p.foreground; }
  });
  cancel.addEventListener("click", () => dlg.close());
  apply.addEventListener("click", async () => {
    const theme = { background: bg.value, foreground: fg.value };
    try {
      const r = await fetch("/api/theme", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(theme) });
      const j = await r.json();
      if (!r.ok) {
        if (status) { status.style.color = "#c00"; status.textContent = (j.errors || ["failed"]).join("; "); }
        return;
      }
      if (term) applyTheme(j.theme, term);
      if (status) { status.style.color = "#0a0"; status.textContent = "saved"; }
      setTimeout(() => dlg.close(), 400);
    } catch (e) {
      if (status) { status.style.color = "#c00"; status.textContent = e instanceof Error ? e.message : String(e); }
    }
  });
}

async function init() {
  // Prefer sync injected theme to avoid OSC race before WASM setThemeColors
  currentTheme = getSyncTheme() ?? (await fetchTheme());
  tabNewEl.addEventListener("click", () => createTab());
  const tabs = loadTabs();
  if (tabs.length === 0) createTab();
  else void selectTab(tabs[0].id);
}

setupThemeUI();
void init();