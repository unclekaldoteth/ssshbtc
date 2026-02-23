#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

npm run build -w @sssh-btc/shared >/tmp/sssh-btc-shared-build.log 2>&1

cleanup() {
  [[ -n "${PID_INDEXER:-}" ]] && kill "$PID_INDEXER" >/dev/null 2>&1 || true
  [[ -n "${PID_PROVER:-}" ]] && kill "$PID_PROVER" >/dev/null 2>&1 || true
  [[ -n "${PID_WEB:-}" ]] && kill "$PID_WEB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

npm run dev:indexer >/tmp/sssh-btc-indexer.log 2>&1 &
PID_INDEXER=$!
npm run dev:prover >/tmp/sssh-btc-prover.log 2>&1 &
PID_PROVER=$!
npm run dev:web >/tmp/sssh-btc-web.log 2>&1 &
PID_WEB=$!

sleep 4

printf '\n=== health checks ===\n'
curl -sS http://localhost:4100/health
printf '\n'
curl -sS http://localhost:4200/health
printf '\n'

printf '\nOpen http://localhost:3000 for the UI.\n'
printf 'Logs:\n'
printf '  /tmp/sssh-btc-indexer.log\n'
printf '  /tmp/sssh-btc-prover.log\n'
printf '  /tmp/sssh-btc-web.log\n\n'

wait
