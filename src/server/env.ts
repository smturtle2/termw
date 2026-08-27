import type { Theme } from "../shared/theme.js";
import { toColorFgbg } from "../shared/theme.js";

const FALLBACK_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/**
 * Build sanitized env for Bun.spawn terminal.
 * Contract: never pass process.env wholesale — only allowlisted keys.
 * Theme drives COLORFGBG + THEME_BG/FG so the PTY and any TUI see the
 * terminal theme; TUIs measure background luminance via OSC 11;? or COLORFGBG.
 */
export function buildPtyEnv(theme: Theme): Record<string, string> {
  const user = process.env.USER || process.env.LOGNAME || "root";
  const home = process.env.HOME || (user === "root" ? "/root" : `/home/${user}`);
  return {
    HOME: home,
    PATH: process.env.PATH || FALLBACK_PATH,
    LANG: "ko_KR.UTF-8",
    LC_ALL: "ko_KR.UTF-8",
    LANGUAGE: "ko_KR:ko:en_US:en",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLORFGBG: toColorFgbg(theme),
    SHELL: process.env.SHELL || "/usr/bin/zsh",
    USER: user,
    LOGNAME: user,
    EDITOR: process.env.EDITOR || "vi",
    THEME_BG: theme.background,
    THEME_FG: theme.foreground,
  };
}