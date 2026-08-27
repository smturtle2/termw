import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_THEME, normalizeTheme, type Theme } from "../shared/theme.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function projectRoot(): string {
  return path.resolve(__dirname, "../..");
}

function candidatePaths(): string[] {
  const root = projectRoot();
  return [path.join(root, "config/theme.json"), path.join(root, "theme.json")];
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

export function setTheme(theme: Theme): string {
  const target = candidatePaths()[0];
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(theme, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, target);
  return target;
}

export function watchTheme(cb: (theme: Theme) => void): { close(): void } {
  const paths = candidatePaths();
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        cb(getTheme());
      } catch {}
    }, 100);
  };
  for (const p of paths) {
    try {
      const dir = path.dirname(p);
      fs.mkdirSync(dir, { recursive: true });
      // watch dir always (captures create/rename/truncate), plus file if exists
      const wd = fs.watch(dir, debounced);
      watchers.push(wd);
      if (fs.existsSync(p)) {
        try {
          const wf = fs.watch(p, debounced);
          watchers.push(wf);
        } catch {}
      }
    } catch {}
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) try { w.close(); } catch {}
    },
  };
}
