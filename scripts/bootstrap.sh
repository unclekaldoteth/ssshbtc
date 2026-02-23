#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Installing workspace dependencies..."
npm install

echo "Building shared package..."
npm run build -w @sssh-btc/shared

if [[ ! -f apps/web/.env.local ]]; then
  cp apps/web/.env.example apps/web/.env.local
  echo "Created apps/web/.env.local from template"
fi

if [[ ! -f services/indexer/.env ]]; then
  cat > services/indexer/.env <<EOT
PORT=4100
SSSH_BTC_INDEXER_STATE_FILE=.data/state.json
EOT
  echo "Created services/indexer/.env"
fi

if [[ ! -f services/prover/.env ]]; then
  cat > services/prover/.env <<EOT
PORT=4200
SSSH_BTC_MOCK_PROOFS=false
SSSH_BTC_ZK_ARTIFACTS_DIR=../../circuits/build
EOT
  echo "Created services/prover/.env"
fi

echo "Bootstrap complete."
echo "If proving artifacts are missing, run: ./scripts/setup-zk-artifacts.sh"
echo "Then run: npm run dev"
