#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v circom >/dev/null 2>&1; then
  echo "circom is required (>=2.1.8). Install it before running this script."
  exit 1
fi

if [[ ! -d "$ROOT_DIR/circuits/circomlib/circuits" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required to fetch circomlib includes."
    exit 1
  fi

  echo "circomlib not found locally, cloning vendored copy..."
  git clone --depth 1 https://github.com/iden3/circomlib.git "$ROOT_DIR/circuits/circomlib"
fi

cd "$ROOT_DIR/circuits"

echo "Compiling circuits..."
npm run compile

echo "Generating Groth16 artifacts (ptau, zkeys, vkeys)..."
npm run setup

echo "Done. Artifacts are in $ROOT_DIR/circuits/build"
