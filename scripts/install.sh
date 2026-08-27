#!/usr/bin/env bash
set -euo pipefail

# termw — one-liner installer (Bun 1.4)
# Usage: curl -fsSL https://raw.githubusercontent.com/smturtle2/termw/main/scripts/install.sh | bash
#    or: curl -fsSL .../install.sh -o install.sh && bash install.sh --dir /opt/termw --port 3000 --no-systemd
# Options: --dir <path> --port <n> --host <ip> --shell <path> --no-systemd --force --help

BUN_VERSION="${BUN_VERSION:-1.4.0}"
TERM_W_REPO="${TERM_W_REPO:-https://github.com/smturtle2/termw.git}"
TERM_W_DIR="${TERM_W_DIR:-/opt/termw}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
SHELL_BIN="${SHELL_BIN:-/usr/bin/zsh}"
NO_SYSTEMD=0
FORCE=0

# colors
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; DIM='\033[2m'; RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; DIM=''; RESET=''
fi
info()  { echo -e "${GREEN}[termw]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[termw warn]${RESET} $*" >&2; }
err()   { echo -e "${RED}[termw error]${RESET} $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
termw installer — Bun 1.4 + WASM

Usage:
  install.sh [options]

Options:
  --dir <path>      Install dir (default: /opt/termw, fallback $HOME/.termw if no sudo)
  --port <n>        Port (default: 3000)
  --host <ip>       Host (default: 127.0.0.1)
  --shell <path>    Shell for PTY (default: /usr/bin/zsh)
  --no-systemd      Skip systemd unit install
  --force           Force re-clone / re-install
  --help            Show this help

Env:
  BUN_VERSION=1.4.0  TERM_W_REPO=...  TERM_W_DIR=...  HOST=...  PORT=...  SHELL_BIN=...

Examples:
  curl -fsSL https://raw.githubusercontent.com/smturtle2/termw/main/scripts/install.sh | bash
  bash install.sh -- --dir $HOME/.termw --no-systemd
  curl -fsSL .../install.sh -o install.sh && bash install.sh --port 3000 --host 127.0.0.1
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) TERM_W_DIR="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --host) HOST="$2"; shift 2;;
    --shell) SHELL_BIN="$2"; shift 2;;
    --no-systemd) NO_SYSTEMD=1; shift;;
    --force) FORCE=1; shift;;
    --help|-h) usage; exit 0;;
    --) shift; break;;
    *) warn "unknown arg $1"; usage; exit 1;;
  esac
done

# --dir may be passed as first positional after `bash -s --`
if [[ "${1:-}" != "" && "$TERM_W_DIR" == "/opt/termw" ]]; then
  # allow `bash install.sh /custom/dir` compat — not recommended
  warn "positional arg $1 ignored, use --dir"
fi

# detect sudo need for /opt
need_sudo() { [[ -w "$(dirname "$TERM_W_DIR")" ]] || command -v sudo >/dev/null 2>&1; }

# fallback to $HOME/.termw if /opt not writable and no sudo
if [[ "$TERM_W_DIR" == "/opt/termw" && ! -w "/opt" && ! -w "$(dirname "$TERM_W_DIR")" ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    TERM_W_DIR="$HOME/.termw"
    warn "no write to /opt and no sudo — fallback to $TERM_W_DIR"
  fi
fi

info "install dir: $TERM_W_DIR  host=$HOST port=$PORT shell=$SHELL_BIN  bun=$BUN_VERSION"

# --- deps check ---
for cmd in curl git; do
  command -v "$cmd" >/dev/null 2>&1 || err "missing $cmd — install it first (apt install $cmd / brew install $cmd)"
done
if ! command -v unzip >/dev/null 2>&1; then
  warn "unzip not found — needed for bun install fallback"
fi

# --- bun install ---
ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    local v; v="$(bun --version 2>/dev/null || echo 0)"
    info "bun found: $v"
    # if version < 1.4, upgrade
    if [[ "$v" != "1.4."* ]]; then
      warn "bun $v != 1.4.x — upgrading to $BUN_VERSION"
      curl --proto '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" || true
      export PATH="$HOME/.bun/bin:$PATH"
    fi
    return 0
  fi
  info "installing bun $BUN_VERSION ..."
  curl --proto '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    # try explicit path
    export PATH="$HOME/.bun/bin:/root/.bun/bin:$PATH"
  fi
  command -v bun >/dev/null 2>&1 || err "bun install failed — check https://bun.sh"
  info "bun installed: $(bun --version)"
  # try to make available system-wide for systemd
  if [[ -f "$HOME/.bun/bin/bun" && -w "/usr/local/bin" ]]; then
    ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
  elif [[ -f "$HOME/.bun/bin/bun" && -w "/usr/local/bin" ]] || command -v sudo >/dev/null 2>&1; then
    sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun 2>/dev/null || true
  fi
}

ensure_bun
export PATH="$HOME/.bun/bin:/root/.bun/bin:/usr/local/bin:$PATH"
BUN_BIN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"

# --- fetch termw ---
fetch_termw() {
  if [[ -d "$TERM_W_DIR/.git" ]]; then
    if [[ "$FORCE" == "1" ]]; then
      info "updating existing clone $TERM_W_DIR (force)"
    else
      info "updating existing clone $TERM_W_DIR"
    fi
    if [[ -w "$TERM_W_DIR" ]]; then
      git -C "$TERM_W_DIR" pull --ff-only || warn "git pull failed — continuing"
    else
      sudo git -C "$TERM_W_DIR" pull --ff-only || warn "git pull failed"
    fi
  elif [[ -d "$TERM_W_DIR" && "$(ls -A "$TERM_W_DIR" 2>/dev/null)" != "" && "$FORCE" != "1" ]]; then
    err "$TERM_W_DIR exists and not empty — use --force or --dir"
  else
    info "cloning $TERM_W_REPO → $TERM_W_DIR"
    if [[ -w "$(dirname "$TERM_W_DIR")" ]]; then
      git clone "$TERM_W_REPO" "$TERM_W_DIR"
    else
      sudo git clone "$TERM_W_REPO" "$TERM_W_DIR"
      sudo chown -R "$(id -un)":"$(id -gn)" "$TERM_W_DIR" 2>/dev/null || true
    fi
  fi
}

fetch_termw

# --- build ---
info "installing deps + building (bun install) ..."
cd "$TERM_W_DIR"
# prefer frozen lockfile if bun.lock exists
if [[ -f "bun.lock" || -f "bun.lockb" ]]; then
  bun install --frozen-lockfile || bun install
else
  bun install
fi

# ensure config
if [[ ! -f "config/theme.json" && -f "config/theme.json.example" ]]; then
  cp config/theme.json.example config/theme.json
  info "created config/theme.json from example"
fi
if [[ ! -f ".env" && -f "config/env.example" ]]; then
  # create .env with current HOST/PORT/SHELL if not exists
  {
    echo "HOST=$HOST"
    echo "PORT=$PORT"
    echo "SHELL=$SHELL_BIN"
    echo "HOME=$HOME"
  } > .env
  info "created .env (HOST/PORT/SHELL)"
fi

info "building wasm/client/server ..."
bun run build:wasm || warn "build:wasm failed — will use prebuilt vendor wasm"
bun run build:client
bun run build:server

# verify
if [[ ! -f "public/app.js" ]]; then
  warn "public/app.js missing after build"
fi
if [[ ! -f "dist/server/index.js" ]]; then
  err "dist/server/index.js missing — build failed"
fi
if [[ ! -f "public/wterm.wasm" ]]; then
  warn "public/wterm.wasm missing — copying prebuilt"
  cp vendor/wterm/packages/@wterm/core/wasm/wterm.wasm public/wterm.wasm 2>/dev/null || true
fi

info "build ok — public/app.js $(du -h public/app.js 2>/dev/null | cut -f1)  dist/server/index.js  wterm.wasm $(du -h public/wterm.wasm 2>/dev/null | cut -f1)"

# --- systemd ---
if [[ "$NO_SYSTEMD" == "1" ]]; then
  info "skip systemd (--no-systemd)"
else
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not found — skip systemd (run: bun dist/server/index.js)"
  else
    if [[ ! -x "$BUN_BIN" && -x "/usr/local/bin/bun" ]]; then BUN_BIN="/usr/local/bin/bun"; fi
    if [[ ! -x "$BUN_BIN" && -x "$HOME/.bun/bin/bun" ]]; then BUN_BIN="$HOME/.bun/bin/bun"; fi

    UNIT_SRC="$TERM_W_DIR/deploy/systemd/termw.service.example"
    UNIT_DST="/etc/systemd/system/termw.service"
    if [[ -f "$UNIT_SRC" ]]; then
      info "installing systemd unit → $UNIT_DST (bun=$BUN_BIN)"
      # render unit with current HOST/PORT/SHELL/HOME/TERM_W_DIR
      TMP_UNIT="$(mktemp)"
      sed -e "s|WorkingDirectory=.*|WorkingDirectory=$TERM_W_DIR|" \
          -e "s|Environment=HOST=.*|Environment=HOST=$HOST|" \
          -e "s|Environment=PORT=.*|Environment=PORT=$PORT|" \
          -e "s|Environment=SHELL=.*|Environment=SHELL=$SHELL_BIN|" \
          -e "s|Environment=HOME=.*|Environment=HOME=$HOME|" \
          -e "s|ExecStart=.*|ExecStart=$BUN_BIN dist/server/index.js|" \
          "$UNIT_SRC" > "$TMP_UNIT"

      if [[ -w "/etc/systemd/system" ]]; then
        cp "$TMP_UNIT" "$UNIT_DST"
      else
        sudo cp "$TMP_UNIT" "$UNIT_DST"
      fi
      rm -f "$TMP_UNIT"

      if command -v systemctl >/dev/null 2>&1; then
        if [[ -w "/etc/systemd/system" ]]; then
          systemctl daemon-reload
          systemctl enable --now termw || warn "systemctl enable failed — try: sudo systemctl enable --now termw"
          systemctl status termw --no-pager -l 2>&1 | head -20 || true
        else
          sudo systemctl daemon-reload
          sudo systemctl enable --now termw || warn "systemctl enable failed"
          sudo systemctl status termw --no-pager -l 2>&1 | head -20 || true
        fi
      fi
    else
      warn "unit template not found: $UNIT_SRC"
    fi
  fi
fi

cat <<EOF

${GREEN}termw installed ✓${RESET}
  dir:  $TERM_W_DIR
  bun:  $(bun --version) ($BUN_BIN)
  url:  http://${HOST}:${PORT}  ws://${HOST}:${PORT}/ws

Run:
  bun --watch src/server/index.ts        # dev
  bun dist/server/index.js               # prod
  journalctl -u termw -f                 # logs (if systemd)

Update:
  git -C $TERM_W_DIR pull && bun install && bun run build

EOF

# health hint if running
if curl -fsS "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
  info "health ok http://${HOST}:${PORT}/health"
else
  info "start manually: cd $TERM_W_DIR && bun dist/server/index.js"
fi
