#!/bin/bash
# Build and run Agetor on Linux: the compiled core (the `agetor` CLI binary
# boots the headless core with its hidden `__daemon` subcommand) plus the
# built React UI served on :5173, opened in your browser.
#
# There is no native window on Linux yet (see docs/linux-port.md); the UI is
# the same one the desktop app shows, talking to the core over HTTP + SSE.
#
# Usage: scripts/linux.sh [build|start|stop|restart|status|open]
#   build    vite build (UI → dist/) + bun build --compile (core+CLI → artifacts/)
#   start    build if needed, start core + UI, print the URL (default)
#   stop     stop both
#   restart  stop then start
#   status   report whether they're running, with the URL
#   open     open the URL with xdg-open
#
# Env overrides: AGETOR_DATA_DIR (default ~/.agetor), AGETOR_API_PORT (4317).
# Agents run in tmux and keep running when you stop the core; the next start
# reattaches them.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${AGETOR_DATA_DIR:-$HOME/.agetor}"
API_PORT="${AGETOR_API_PORT:-4317}"
# The core only accepts the UI from :5173 (ALLOWED_ORIGINS in src/bun/server.ts).
UI_PORT=5173
RUN_DIR="$DATA_DIR/linux-run"
CORE_PID_FILE="$RUN_DIR/core.pid"
UI_PID_FILE="$RUN_DIR/ui.pid"
TOKEN_FILE="$RUN_DIR/token"
CORE_LOG="$RUN_DIR/core.log"
UI_LOG="$RUN_DIR/ui.log"

case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
BIN="$REPO_ROOT/artifacts/agetor-linux-$ARCH"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
grn() { printf '\033[32m%s\033[0m\n' "$1"; }
dim() { printf '\033[2m%s\033[0m\n' "$1"; }

ACTION="${1:-start}"

pid_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
read_pid() { [ -f "$1" ] && cat "$1" || true; }

do_build() {
  cd "$REPO_ROOT"
  [ -d node_modules ] || { dim "bun install…"; bun install; }
  dim "building UI (vite build)…"
  bunx vite build
  dim "compiling core + CLI (bun build --compile)…"
  AGETOR_CLI_TARGET="bun-linux-$ARCH" bun run build:cli
  grn "built: $BIN and dist/"
}

url_for() {
  echo "http://localhost:$UI_PORT/#api=$API_PORT&token=$1"
}

print_info() {
  echo
  grn "Agetor is up"
  echo "  core: http://127.0.0.1:$API_PORT  (log: $CORE_LOG)"
  echo "  ui:   http://127.0.0.1:$UI_PORT  (log: $UI_LOG)"
  echo
  echo "Open:"
  grn "  $(url_for "$1")"
  echo
  dim "stop with: $0 stop"
}

stop_one() {
  local name="$1" pidfile="$2" pid
  pid="$(read_pid "$pidfile")"
  if pid_alive "$pid"; then
    dim "stopping $name (pid $pid)…"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 25); do pid_alive "$pid" || break; sleep 0.2; done
    pid_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

do_stop() {
  stop_one "core" "$CORE_PID_FILE"
  stop_one "ui" "$UI_PID_FILE"
  grn "stopped (agents in tmux keep running; the next start reattaches them)"
}

do_status() {
  if pid_alive "$(read_pid "$CORE_PID_FILE")" && pid_alive "$(read_pid "$UI_PID_FILE")"; then
    print_info "$(cat "$TOKEN_FILE")"
  else
    red "not running (start with: $0 start)"
    exit 1
  fi
}

do_start() {
  mkdir -p "$RUN_DIR"
  if pid_alive "$(read_pid "$CORE_PID_FILE")" && pid_alive "$(read_pid "$UI_PID_FILE")"; then
    dim "already running"
    print_info "$(cat "$TOKEN_FILE")"
    return 0
  fi
  stop_one "core" "$CORE_PID_FILE"
  stop_one "ui" "$UI_PID_FILE"

  if [ ! -x "$BIN" ] || [ ! -f "$REPO_ROOT/dist/index.html" ]; then
    do_build
  fi

  # The master token: the browser presents it, so the UI gets the desktop
  # app's full route set. Kept 0600 because it can drive the whole API.
  local token
  if [ -f "$TOKEN_FILE" ]; then
    token="$(cat "$TOKEN_FILE")"
  else
    token="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  ( umask 077; echo "$token" > "$TOKEN_FILE" )
  chmod 600 "$TOKEN_FILE"

  cd "$REPO_ROOT"
  dim "starting core on $API_PORT…"
  # AGETOR_DAEMON_IDLE_MS=0: never idle-exit when the browser tab is closed.
  AGETOR_DATA_DIR="$DATA_DIR" AGETOR_API_PORT="$API_PORT" AGETOR_API_TOKEN="$token" \
    AGETOR_DAEMON_IDLE_MS=0 nohup "$BIN" __daemon > "$CORE_LOG" 2>&1 &
  echo $! > "$CORE_PID_FILE"

  dim "serving UI on $UI_PORT…"
  nohup bunx vite preview --port "$UI_PORT" --strictPort --host 127.0.0.1 > "$UI_LOG" 2>&1 &
  echo $! > "$UI_PID_FILE"

  for _ in $(seq 1 50); do
    curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break
    sleep 0.3
  done
  if ! curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then
    red "core never became healthy — tail of $CORE_LOG:"
    tail -n 30 "$CORE_LOG" || true
    do_stop
    exit 1
  fi
  print_info "$token"
}

do_open() {
  [ -f "$TOKEN_FILE" ] || { red "not started yet"; exit 1; }
  xdg-open "$(url_for "$(cat "$TOKEN_FILE")")" >/dev/null 2>&1 &
}

case "$ACTION" in
  build) do_build ;;
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop; do_start ;;
  status) do_status ;;
  open) do_open ;;
  *) red "unknown command: $ACTION"; exit 1 ;;
esac
