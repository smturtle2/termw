/** Theme contract — single source of truth for PTY env, OSC 10/11, and CSS. */

export interface Theme {
  background: string; // "#rrggbb"
  foreground: string;
}

export const DEFAULT_THEME: Theme = {
  background: "#ffffff",
  foreground: "#000000",
};

export const DARK_FALLBACK: Theme = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(s: string): boolean {
  return HEX_RE.test(s);
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

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  theme?: Theme;
}

export function validateTheme(raw: unknown): ValidateResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["theme must be an object with background/foreground"] };
  }
  const o = raw as Record<string, unknown>;
  const bgRaw = o.background;
  const fgRaw = o.foreground;
  if (typeof bgRaw !== "string" || !isHexColor(bgRaw)) {
    errors.push("background must be #rrggbb (e.g. #ffffff)");
  }
  if (typeof fgRaw !== "string" || !isHexColor(fgRaw)) {
    errors.push("foreground must be #rrggbb (e.g. #000000)");
  }
  if (errors.length) return { ok: false, errors };
  const theme: Theme = {
    background: (bgRaw as string).toLowerCase(),
    foreground: (fgRaw as string).toLowerCase(),
  };
  return { ok: true, errors: [], theme };
}

export function normalizeTheme(raw: unknown): Theme {
  const v = validateTheme(raw);
  if (v.ok && v.theme) return v.theme;
  // fallback: try partial valid fields, otherwise DEFAULT
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_THEME;
  const o = raw as Record<string, unknown>;
  const bg = typeof o.background === "string" && isHexColor(o.background) ? o.background.toLowerCase() : DEFAULT_THEME.background;
  const fg = typeof o.foreground === "string" && isHexColor(o.foreground) ? o.foreground.toLowerCase() : DEFAULT_THEME.foreground;
  return { background: bg, foreground: fg };
}

/** xterm COLORFGBG: "fg;bg" using 0=black 15=white — derived from background luminance */
export function toColorFgbg(theme: Theme): string {
  return luminance(theme.background) > 128 ? "0;15" : "15;0";
}
