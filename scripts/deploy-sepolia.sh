#!/usr/bin/env bash
set -euo pipefail

# Sssh BTC Wallet Sepolia deployment script skeleton.
# Requires: starkli, scarb, and exported signer/account env vars.

VERIFIER_MOCK_MODE="${VERIFIER_MOCK_MODE:-0}" # 0 = external verifier, 1 = mock
EXTERNAL_VERIFIER_ADDRESS="${EXTERNAL_VERIFIER_ADDRESS:-}"
DEPLOY_TEST_VECTOR_VERIFIER="${DEPLOY_TEST_VECTOR_VERIFIER:-1}"
TEST_VECTOR_ADMIN_ADDRESS="${TEST_VECTOR_ADMIN_ADDRESS:-}"
POOL_OWNER_ADDRESS="${POOL_OWNER_ADDRESS:-}"
VERIFIER_ADMIN_ADDRESS="${VERIFIER_ADMIN_ADDRESS:-}"

if ! command -v scarb >/dev/null 2>&1; then
  echo "scarb is required"
  exit 1
fi

if ! command -v starkli >/dev/null 2>&1; then
  echo "starkli is required"
  exit 1
fi

if [[ -z "${STARKNET_RPC_URL:-}" ]]; then
  echo "Set STARKNET_RPC_URL"
  exit 1
fi

if [[ -z "${STARKNET_ACCOUNT:-}" ]]; then
  echo "Set STARKNET_ACCOUNT"
  exit 1
fi

if [[ -z "${STARKNET_KEYSTORE:-}" ]]; then
  echo "Set STARKNET_KEYSTORE"
  exit 1
fi

DEPLOYER_ACCOUNT_ADDRESS=""
if command -v jq >/dev/null 2>&1 && [[ -f "$STARKNET_ACCOUNT" ]]; then
  DEPLOYER_ACCOUNT_ADDRESS="$(jq -r '.deployment.address // empty' "$STARKNET_ACCOUNT")"
fi

parse_last_felt() {
  grep -Eo '0x[0-9a-fA-F]+' | tail -n 1
}

declare_class() {
  local artifact="$1"
  local output class_hash status expected_casm_hash

  if output="$(starkli declare "$artifact" --rpc "$STARKNET_RPC_URL" 2>&1)"; then
    status=0
  else
    status=$?
  fi
  printf '%s\n' "$output" >&2

  if [[ "$status" -ne 0 ]] && [[ "$output" == *"Mismatch compiled class hash"* ]]; then
    expected_casm_hash="$(
      printf '%s\n' "$output" | sed -nE 's/.*Expected: (0x[0-9a-fA-F]+).*/\1/p' | tail -n 1
    )"
    if [[ -n "$expected_casm_hash" ]]; then
      echo "Retrying declare with sequencer expected CASM hash: $expected_casm_hash" >&2
      if output="$(
        starkli declare "$artifact" --casm-hash "$expected_casm_hash" --rpc "$STARKNET_RPC_URL" 2>&1
      )"; then
        status=0
      else
        status=$?
      fi
      printf '%s\n' "$output" >&2
    fi
  fi

  if [[ "$status" -ne 0 ]]; then
    return "$status"
  fi

  class_hash="$(printf '%s\n' "$output" | parse_last_felt)" || true

  if [[ -z "$class_hash" ]]; then
    echo "Failed to parse class hash for $artifact" >&2
    exit 1
  fi

  printf '%s\n' "$class_hash"
}

deploy_class() {
  local class_hash="$1"
  shift
  local output contract_address status nonce attempt

  attempt=1
  while true; do
    if [[ "$attempt" -eq 1 ]]; then
      if output="$(starkli deploy "$class_hash" "$@" --rpc "$STARKNET_RPC_URL" 2>&1)"; then
        status=0
      else
        status=$?
      fi
    else
      if [[ -z "$DEPLOYER_ACCOUNT_ADDRESS" ]]; then
        output="Failed to retry deploy for class hash $class_hash: deployer account address unavailable."
        status=1
      else
        nonce="$(starkli nonce "$DEPLOYER_ACCOUNT_ADDRESS" --rpc "$STARKNET_RPC_URL")"
        if output="$(
          starkli deploy "$class_hash" "$@" --rpc "$STARKNET_RPC_URL" --nonce "$nonce" 2>&1
        )"; then
          status=0
        else
          status=$?
        fi
      fi
    fi

    printf '%s\n' "$output" >&2

    if [[ "$status" -eq 0 ]]; then
      contract_address="$(printf '%s\n' "$output" | parse_last_felt)" || true

      if [[ -z "$contract_address" ]]; then
        echo "Failed to parse deployed contract address for class hash $class_hash" >&2
        exit 1
      fi

      printf '%s\n' "$contract_address"
      return 0
    fi

    if [[ ( "$output" == *"InvalidTransactionNonce"* || "$output" == *"Invalid transaction nonce"* ) && "$attempt" -lt 3 ]]; then
      echo "Retrying deployment with refreshed nonce..." >&2
      attempt=$((attempt + 1))
      sleep 2
      continue
    fi

    return "$status"
  done
}

if [[ -z "$TEST_VECTOR_ADMIN_ADDRESS" ]] && command -v jq >/dev/null 2>&1 && [[ -f "$STARKNET_ACCOUNT" ]]; then
  TEST_VECTOR_ADMIN_ADDRESS="$(jq -r '.deployment.address // empty' "$STARKNET_ACCOUNT")"
fi
if [[ -z "$POOL_OWNER_ADDRESS" ]] && command -v jq >/dev/null 2>&1 && [[ -f "$STARKNET_ACCOUNT" ]]; then
  POOL_OWNER_ADDRESS="$(jq -r '.deployment.address // empty' "$STARKNET_ACCOUNT")"
fi
if [[ -z "$VERIFIER_ADMIN_ADDRESS" ]]; then
  VERIFIER_ADMIN_ADDRESS="$TEST_VECTOR_ADMIN_ADDRESS"
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/contracts"

CONTRACT_ARTIFACT_PREFIX="sssh_btc_contracts"

echo "Building Cairo contracts..."
scarb build

echo "Declare VerifierAdapter"
VERIFIER_CLASS_HASH=$(
  declare_class "target/dev/${CONTRACT_ARTIFACT_PREFIX}_VerifierAdapter.contract_class.json"
)

if [[ -z "$EXTERNAL_VERIFIER_ADDRESS" && "$DEPLOY_TEST_VECTOR_VERIFIER" == "1" ]]; then
  echo "Declare TestVectorVerifier"
  TEST_VECTOR_VERIFIER_CLASS_HASH=$(
    declare_class "target/dev/${CONTRACT_ARTIFACT_PREFIX}_TestVectorVerifier.contract_class.json"
  )
fi

echo "Declare ShieldedPool"
POOL_CLASS_HASH=$(declare_class "target/dev/${CONTRACT_ARTIFACT_PREFIX}_ShieldedPool.contract_class.json")

echo "Declare PaymentRequestRegistry"
REGISTRY_CLASS_HASH=$(
  declare_class "target/dev/${CONTRACT_ARTIFACT_PREFIX}_PaymentRequestRegistry.contract_class.json"
)

if [[ -n "$EXTERNAL_VERIFIER_ADDRESS" ]]; then
  EXTERNAL_ADDRESS="$EXTERNAL_VERIFIER_ADDRESS"
elif [[ "$DEPLOY_TEST_VECTOR_VERIFIER" == "1" ]]; then
  if [[ -z "$TEST_VECTOR_ADMIN_ADDRESS" ]]; then
    echo "Set TEST_VECTOR_ADMIN_ADDRESS (or ensure STARKNET_ACCOUNT has deployment.address)"
    exit 1
  fi
  echo "Deploy TestVectorVerifier"
  EXTERNAL_ADDRESS=$(deploy_class "$TEST_VECTOR_VERIFIER_CLASS_HASH" "$TEST_VECTOR_ADMIN_ADDRESS")
else
  EXTERNAL_ADDRESS="0x0"
fi

echo "Deploy VerifierAdapter (mock_mode=$VERIFIER_MOCK_MODE)"
if [[ -z "$VERIFIER_ADMIN_ADDRESS" ]]; then
  echo "Set VERIFIER_ADMIN_ADDRESS (or TEST_VECTOR_ADMIN_ADDRESS)"
  exit 1
fi
VERIFIER_ADDRESS=$(
  deploy_class "$VERIFIER_CLASS_HASH" "$EXTERNAL_ADDRESS" "$VERIFIER_MOCK_MODE" "$VERIFIER_ADMIN_ADDRESS"
)

echo "Deploy ShieldedPool"
if [[ -z "$POOL_OWNER_ADDRESS" ]]; then
  echo "Set POOL_OWNER_ADDRESS (or ensure STARKNET_ACCOUNT has deployment.address)"
  exit 1
fi
POOL_ADDRESS=$(deploy_class "$POOL_CLASS_HASH" "$POOL_OWNER_ADDRESS" "$VERIFIER_ADDRESS" 0x0)

echo "Deploy PaymentRequestRegistry"
REGISTRY_ADDRESS=$(deploy_class "$REGISTRY_CLASS_HASH")

echo "Deployment complete"
echo "ExternalVerifier: $EXTERNAL_ADDRESS"
echo "VerifierAdapter: $VERIFIER_ADDRESS"
echo "ShieldedPool: $POOL_ADDRESS"
echo "PaymentRequestRegistry: $REGISTRY_ADDRESS"

if [[ "$VERIFIER_MOCK_MODE" == "0" ]]; then
  echo "Next: register proof digests on the external verifier:"
  echo "  starkli invoke $EXTERNAL_ADDRESS register_digest <digest_felt> --rpc \"$STARKNET_RPC_URL\""
  echo "Then run adapter check:"
  echo "  starkli call $VERIFIER_ADDRESS verify_proof <proof_len proof...> <public_inputs_len inputs...> --rpc \"$STARKNET_RPC_URL\""
fi
