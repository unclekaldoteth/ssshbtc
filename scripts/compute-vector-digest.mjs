#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const FIELD_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);

function usage() {
  console.error(
    "Usage: node scripts/compute-vector-digest.mjs <proof-bundle-json-path>"
  );
}

function toBigInt(value) {
  if (typeof value !== "string") {
    throw new Error(`Expected string felt value, got ${typeof value}`);
  }

  if (value.startsWith("0x")) {
    return BigInt(value);
  }

  return BigInt(value);
}

function modField(value) {
  const next = value % FIELD_PRIME;
  return next >= 0n ? next : next + FIELD_PRIME;
}

function toHex(value) {
  return `0x${value.toString(16)}`;
}

const inputPath = process.argv[2];
if (!inputPath) {
  usage();
  process.exit(1);
}

const fullPath = path.resolve(process.cwd(), inputPath);
const raw = fs.readFileSync(fullPath, "utf-8");
const bundle = JSON.parse(raw);

const payload = bundle?.proofBundle ?? bundle;
const proof = payload?.proof;
const publicSignals = payload?.publicSignals;

if (!Array.isArray(proof) || proof.length === 0) {
  throw new Error("proof array missing or empty");
}

if (!Array.isArray(publicSignals) || publicSignals.length === 0) {
  throw new Error("publicSignals array missing or empty");
}

let digest = 0n;
for (const item of proof) {
  digest = modField(digest + toBigInt(item));
}
for (const item of publicSignals) {
  digest = modField(digest + toBigInt(item));
}

const output = {
  circuit: payload?.circuit ?? bundle?.circuit ?? "unknown",
  inputFile: fullPath,
  proofLength: proof.length,
  publicSignalsLength: publicSignals.length,
  digestDecimal: digest.toString(10),
  digestHex: toHex(digest),
};

console.log(JSON.stringify(output, null, 2));
