#!/usr/bin/env bash
set -euo pipefail

INDEXER_URL="${INDEXER_URL:-http://localhost:4100}"
PROVER_URL="${PROVER_URL:-http://localhost:4200}"

echo "1) Indexer health"
curl -sS "$INDEXER_URL/health"

echo "\n2) Prover health"
curl -sS "$PROVER_URL/health"

echo "\n3) Mint demo note"
curl -sS -X POST "$INDEXER_URL/demo/mint-note" \
  -H 'content-type: application/json' \
  -d '{"ownerHint":"demo-alice","recipientHint":"demo-alice","asset":"tBTC","amount":"12345"}'

echo "\n4) Root"
curl -sS "$INDEXER_URL/tree/root"

echo "\n5) Snapshot"
curl -sS "$INDEXER_URL/wallet/demo-alice/snapshot"

echo "\n6) Transfer proof generation"
curl -sS -X POST "$PROVER_URL/proof/transfer" \
  -H 'content-type: application/json' \
  -d '{"root":"0x1","inputNotes":[{"commitment":"0xaaa","amount":"100","blinding":"0x1"}],"outputNotes":[{"ownerHint":"demo-bob","amount":"70","blinding":"0x2"}],"feeAmount":"30","asset":"tBTC","senderSecret":"0xdead"}'

echo "\n7) Atomic private transfer flow"
node ./scripts/private-flow-smoke.mjs

echo "\nSmoke test complete."
