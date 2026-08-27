import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_THEME, normalizeTheme, type Theme } from "../shared/theme.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// termw layout: src/server/theme.ts -> dist/server/theme.js, so project root is ../../
// At runtime with `tsx` it's src/server/*.ts — same relative.
function projectRoot(): string {
  // dist/server -> ../.. ; src/server -> ../..
  return path.resolve(__dirname, "../..");
}

function candidatePaths(): string[] {
  const root = projectRoot();
  return [
    path.join(root, "config/theme.json"),
    path.join(root, "theme.json"),
    // legacy terminal path support when running from old cwd
    path.join(process.cwd(), "config/theme.json"),
    path.join(process.cwd(), "theme.json"),
  ];
}

export function getTheme(): Theme {
  for (const p of candidatePaths()) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const j = JSON.parse(raw);
      return normalizeTheme(j);
    } catch {
      // try next
    }
  }
  return DEFAULT_THEME;
}

export function themeFileInUse(): string | null {
  for (const p of candidatePaths()) {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return p;
    } catch {}
  }
  return null;
}
