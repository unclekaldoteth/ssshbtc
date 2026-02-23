#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const PROVER_URL = process.env.PROVER_URL ?? "http://localhost:4200";
const circuit = (process.argv[2] ?? "transfer").toLowerCase();
const outputArg = process.argv[3];
const outFile =
  outputArg ??
  path.resolve(
    process.cwd(),
    "docs",
    "vectors",
    `${circuit}-proof-bundle.json`
  );

function usage() {
  console.error(
    "Usage: node scripts/export-proof-vector.mjs <transfer|withdraw> [output-json-path]"
  );
}

if (!["transfer", "withdraw"].includes(circuit)) {
  usage();
  process.exit(1);
}

async function req(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  return response.json();
}

async function run() {
  const transferReq = {
    root: "0x1",
    inputNotes: [{ commitment: "0xaaa", amount: "100", blinding: "0x1" }],
    outputNotes: [{ ownerHint: "demo-bob", amount: "70", blinding: "0x2" }],
    feeAmount: "30",
    asset: "tBTC",
    senderSecret: "0xdead",
  };

  const withdrawReq = {
    root: "0x1",
    inputNotes: [{ commitment: "0xaaa", amount: "100", blinding: "0x1" }],
    recipient: "0x99",
    amount: "80",
    feeAmount: "20",
    asset: "tBTC",
    senderSecret: "0xdead",
  };

  const endpoint = circuit === "transfer" ? "/proof/transfer" : "/proof/withdraw";
  const request = circuit === "transfer" ? transferReq : withdrawReq;
  const bundle = await req(`${PROVER_URL}${endpoint}`, request);

  if (!Array.isArray(bundle?.publicSignals) || bundle.publicSignals.length === 0) {
    throw new Error(
      "Expected real proof bundle with publicSignals. Ensure prover is running with SSSH_BTC_MOCK_PROOFS=false."
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    proverUrl: PROVER_URL,
    circuit,
    request,
    proofBundle: bundle,
  };

  const dir = path.dirname(outFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log(`Wrote ${circuit} proof vector to ${outFile}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
