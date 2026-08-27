#!/usr/bin/env bun
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeTheme, validateTheme, type Theme } from "../src/shared/theme.js";
import { getTheme, setTheme, themeFileInUse } from "../src/server/theme.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function usage(): never {
  console.log(`termw theme — manage terminal theme (background/foreground only)

Usage:
  bun run theme get                      # print current theme (GET /theme.json effective)
  bun run theme validate [file]          # validate json
  bun run theme set --bg #ffffff --fg #000000 [--file config/theme.json]
  bun run theme set --json '{"background":"#1e1e1e","foreground":"#d4d4d4"}'
  bun run theme set --preset light|dark|solarized|monokai

Presets:
  light      #ffffff / #000000
  dark       #1e1e1e / #d4d4d4
  solarized  #002b36 / #839496
  monokai    #272822 / #f8f8f2

API:
  curl -X PUT http://127.0.0.1:3000/api/theme -H 'Content-Type: application/json' -d '{"background":"#1e1e1e","foreground":"#d4d4d4"}'
  curl http://127.0.0.1:3000/theme.json
`);
  process.exit(1);
}

const PRESETS: Record<string, Theme> = {
  light: { background: "#ffffff", foreground: "#000000" },
  dark: { background: "#1e1e1e", foreground: "#d4d4d4" },
  solarized: { background: "#002b36", foreground: "#839496" },
  monokai: { background: "#272822", foreground: "#f8f8f2" },
};

async function main() {
  const cmd = process.argv[2];
  if (!cmd) usage();
  if (cmd === "get") {
    const t = getTheme();
    console.log(JSON.stringify(t, null, 2));
    const f = themeFileInUse();
    console.error(`file: ${f ?? "(default, no file)"}`);
    return;
  }
  if (cmd === "validate") {
    const file = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "config/theme.json");
    const raw = fs.readFileSync(file, "utf-8");
    const j = JSON.parse(raw);
    const v = validateTheme(j);
    if (!v.ok) {
      console.error(`invalid: ${v.errors.join("; ")}`);
      process.exit(1);
    }
    console.log(`ok: ${JSON.stringify(v.theme)} file=${file}`);
    return;
  }
  if (cmd === "set") {
    let bg: string | undefined;
    let fg: string | undefined;
    let jsonStr: string | undefined;
    let preset: string | undefined;
    let file: string | undefined;
    for (let i = 3; i < process.argv.length; i++) {
      const a = process.argv[i];
      if (a === "--bg") bg = process.argv[++i];
      else if (a === "--fg") fg = process.argv[++i];
      else if (a === "--json") jsonStr = process.argv[++i];
      else if (a === "--preset") preset = process.argv[++i];
      else if (a === "--file") file = process.argv[++i];
      else usage();
    }
    let theme: Theme;
    if (preset) {
      const p = PRESETS[preset];
      if (!p) { console.error(`unknown preset ${preset}. available: ${Object.keys(PRESETS).join(", ")}`); process.exit(1); }
      theme = p;
    } else if (jsonStr) {
      const j = JSON.parse(jsonStr);
      const v = validateTheme(j);
      if (!v.ok) { console.error(`invalid: ${v.errors.join("; ")}`); process.exit(1); }
      theme = v.theme!;
    } else if (bg && fg) {
      const v = validateTheme({ background: bg, foreground: fg });
      if (!v.ok) { console.error(`invalid: ${v.errors.join("; ")}`); process.exit(1); }
      theme = v.theme!;
    } else {
      usage();
    }
    if (file) {
      const abs = path.resolve(file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(theme, null, 2) + "\n");
      fs.renameSync(tmp, abs);
      console.log(`wrote ${abs} ${JSON.stringify(theme)}`);
      return;
    }
    const out = setTheme(theme);
    console.log(`wrote ${out} ${JSON.stringify(theme)}`);
    // try live push via API if server running
    try {
      const port = process.env.PORT || "3000";
      const res = await fetch(`http://127.0.0.1:${port}/api/theme`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(theme) });
      if (res.ok) console.error(`live pushed via PUT /api/theme`);
    } catch {}
    return;
  }
  usage();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
