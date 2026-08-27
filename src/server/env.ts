import type { Theme } from "../shared/theme.js";
import { toColorFgbg } from "../shared/theme.js";

/**
 * Build sanitized env for Bun.spawn terminal.
 * Contract: never pass process.env wholesale — only allowlisted keys.
 * Theme drives COLORFGBG + THEME_BG/FG so PTY and any TUI (opencode) see terminal theme.
 * TUI measures luminance from OSC 11;? / THEME_BG itself.
 */
export function buildPtyEnv(theme: Theme): Record<string, string> {
  return {
    HOME: process.env.HOME || "/root",
    PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "ko_KR.UTF-8",
    LC_ALL: "ko_KR.UTF-8",
    LANGUAGE: "ko_KR:ko:en_US:en",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    COLORFGBG: toColorFgbg(theme),
    SHELL: process.env.SHELL || "/usr/bin/zsh",
    USER: "root",
    LOGNAME: "root",
    EDITOR: process.env.EDITOR || "vi",
    THEME_BG: theme.background,
    THEME_FG: theme.foreground,
  };
}
