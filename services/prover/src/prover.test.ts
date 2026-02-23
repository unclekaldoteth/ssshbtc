import assert from "node:assert/strict";
import test from "node:test";

import { Prover } from "./prover.js";

test("transfer proof contains nullifiers and commitments", async () => {
  const prover = new Prover(true);

  const result = await prover.createTransferProof({
    root: "0x123",
    inputNotes: [
      { commitment: "0xaaa", amount: "120", blinding: "0x1" },
      { commitment: "0xbbb", amount: "30", blinding: "0x2" },
    ],
    outputNotes: [
      { ownerHint: "alice", amount: "100", blinding: "0x3" },
      { ownerHint: "bob", amount: "40", blinding: "0x4" },
    ],
    feeAmount: "10",
    asset: "tBTC",
    senderSecret: "0xdeadbeef",
  });

  assert.equal(result.circuit, "transfer");
  assert.equal(result.publicInputs.outputCommitments.length, 2);
  assert.equal(result.publicInputs.inputNullifiers.length, 2);
});

test("withdraw proof exposes amount commitment", async () => {
  const prover = new Prover(true);

  const result = await prover.createWithdrawProof({
    root: "0x123",
    inputNotes: [{ commitment: "0xaaa", amount: "100", blinding: "0x1" }],
    recipient: "0x99",
    amount: "80",
    feeAmount: "20",
    asset: "tBTC",
    senderSecret: "0xdeadbeef",
  });

  assert.equal(result.circuit, "withdraw");
  assert.equal(result.publicInputs.inputNullifiers.length, 1);
  assert.equal(typeof result.derived.amountCommitment, "string");
  assert.equal(typeof result.publicInputs.feeCommitment, "string");
});

test("proof verification validates checksum for mock proofs", async () => {
  const prover = new Prover(true);
  const result = await prover.createTransferProof({
    root: "0xabc",
    inputNotes: [{ commitment: "0xaaa", amount: "10", blinding: "0x1" }],
    outputNotes: [{ ownerHint: "bob", amount: "8", blinding: "0x2" }],
    feeAmount: "2",
    asset: "tBTC",
    senderSecret: "0xdead",
  });

  assert.equal(await prover.verifyProofBundle(result), true);

  const tampered = { ...result, proof: ["0x0"] };
  assert.equal(await prover.verifyProofBundle(tampered), false);
});

test("real mode fails with a clear error when artifacts are missing", async () => {
  const prover = new Prover(false, "/tmp/sssh-btc-missing-artifacts");

  await assert.rejects(
    () =>
      prover.createTransferProof({
        root: "0xabc",
        inputNotes: [{ commitment: "0xaaa", amount: "10", blinding: "0x1" }],
        outputNotes: [{ ownerHint: "bob", amount: "8", blinding: "0x2" }],
        feeAmount: "2",
        asset: "tBTC",
        senderSecret: "0xdead",
      }),
    /Missing transfer proof artifacts/
  );
});
