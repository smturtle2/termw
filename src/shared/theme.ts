/** Theme contract — single source of truth for PTY env, OSC 10/11, and CSS. */

export type ThemeMode = "light" | "dark";

export interface Theme {
  mode: ThemeMode;
  background: string; // "#rrggbb"
  foreground: string;
}

export const DEFAULT_THEME: Theme = {
  mode: "light",
  background: "#ffffff",
  foreground: "#000000",
};

export const DARK_FALLBACK: Theme = {
  mode: "dark",
  background: "#1e1e1e",
  foreground: "#d4d4d4",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
}

export function normalizeTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== "object") return DEFAULT_THEME;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "dark" ? "dark" : "light";
  const bg = typeof o.background === "string" && isHexColor(o.background)
    ? o.background.toLowerCase()
    : mode === "dark" ? DARK_FALLBACK.background : DEFAULT_THEME.background;
  const fg = typeof o.foreground === "string" && isHexColor(o.foreground)
    ? o.foreground.toLowerCase()
    : mode === "dark" ? DARK_FALLBACK.foreground : DEFAULT_THEME.foreground;
  return { mode, background: bg, foreground: fg };
}

export function isLight(theme: Theme): boolean {
  return theme.mode !== "dark";
}

/** xterm COLORFGBG: "fg;bg" using 0=black 15=white */
export function toColorFgbg(theme: Theme): string {
  return isLight(theme) ? "0;15" : "15;0";
}

export function hexToRgbInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16) & 0xffffff;
}

/** Luminance (Rec. 601) — TUI uses bg luminance to pick variant. */
export function luminance(hex: string): number {
  const n = hexToRgbInt(hex);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
