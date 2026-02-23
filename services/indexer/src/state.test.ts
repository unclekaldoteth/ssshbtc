import assert from "node:assert/strict";
import test from "node:test";

import {
  amountToCommitment,
  checksumProofPublicInputs,
  deriveCommitment,
  hashToField,
  randomHex,
} from "@sssh-btc/shared";

import { IndexerStore } from "./state.js";

test("ingest commitment updates root and notes", () => {
  const store = new IndexerStore();
  const commitment = randomHex();

  const created = store.ingestCommitment({
    commitment,
    recipientHint: "alice",
    note: {
      ownerHint: "alice",
      asset: "tBTC",
      amount: "42",
      blinding: randomHex(),
    },
    ciphertext: {
      commitment,
      recipientHint: "alice",
      ephemeralPubKey: randomHex(),
      ciphertext: randomHex(),
      nonce: randomHex(12),
    },
  });

  assert.equal(created.index, 0);
  assert.equal(store.getNotes("alice").length, 1);
  assert.equal(typeof created.root, "string");
});

test("nullifier cannot be reused", () => {
  const store = new IndexerStore();
  const n = randomHex();

  store.spendNullifier(n);
  assert.equal(store.isNullifierUsed(n), true);

  assert.throws(() => store.spendNullifier(n));
});

test("markNoteSpent updates spent state", () => {
  const store = new IndexerStore();
  const commitment = randomHex();

  store.ingestCommitment({
    commitment,
    recipientHint: "alice",
    note: {
      ownerHint: "alice",
      asset: "tBTC",
      amount: "12",
      blinding: randomHex(),
    },
    ciphertext: {
      commitment,
      recipientHint: "alice",
      ephemeralPubKey: randomHex(),
      ciphertext: randomHex(),
      nonce: randomHex(12),
    },
  });

  const spent = store.markNoteSpent("alice", commitment, "0x01");
  assert.equal(spent.nullifier, "0x01");
  assert.equal(typeof spent.spentAt, "string");
});

test("executePrivateTransfer enforces conservation and updates notes atomically", () => {
  const store = new IndexerStore();

  const senderHint = "alice";
  const senderBlinding = "0xblinding1";
  const senderAmount = "100";
  const asset = "tBTC";

  const senderCommitment = deriveCommitment(senderHint, asset, senderAmount, senderBlinding);
  const minted = store.ingestCommitment({
    commitment: senderCommitment,
    recipientHint: senderHint,
    note: {
      ownerHint: senderHint,
      asset,
      amount: senderAmount,
      blinding: senderBlinding,
    },
    ciphertext: {
      commitment: senderCommitment,
      recipientHint: senderHint,
      ephemeralPubKey: randomHex(),
      ciphertext: randomHex(),
      nonce: randomHex(12),
    },
  });

  store.createPaymentRequest({
    requestHash: "0xreq1",
    receiverStealthPubkey: "bob",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    memo: "invoice",
    asset,
    amountCommitment: randomHex(),
    createdAt: new Date().toISOString(),
    paid: false,
  });

  const outputNotes = [
    { ownerHint: "bob", amount: "30", blinding: "0xbbb" },
    { ownerHint: senderHint, amount: "65", blinding: "0xccc" },
  ];

  const outputCommitments = outputNotes.map((note) =>
    deriveCommitment(note.ownerHint, asset, note.amount, note.blinding)
  );
  const inputNullifier = "0xnullifier1";
  const feeAmount = "5";

  const publicInputs = {
    root: minted.root,
    inputCommitments: [senderCommitment],
    inputNullifiers: [inputNullifier],
    outputCommitments,
    feeCommitment: amountToCommitment(
      feeAmount,
      hashToField("transfer-fee", asset, feeAmount, senderCommitment)
    ),
    asset,
  };

  const result = store.executePrivateTransfer({
    senderHint,
    root: minted.root,
    asset,
    feeAmount,
    inputNotes: [
      {
        commitment: senderCommitment,
        amount: senderAmount,
        blinding: senderBlinding,
      },
    ],
    outputNotes,
    proofBundle: {
      proof: [checksumProofPublicInputs(publicInputs)],
      publicInputs,
      scheme: "groth16",
      circuit: "transfer",
      mock: true,
    },
    requestHash: "0xreq1",
  });

  assert.equal(result.outputCommitments.length, 2);
  assert.equal(result.spentCommitments[0], senderCommitment);
  assert.equal(result.paidRequestHash, "0xreq1");
  assert.equal(store.isNullifierUsed(inputNullifier), true);

  const bobNotes = store.getNotes("bob");
  assert.equal(bobNotes.length, 1);
  assert.equal(bobNotes[0].amount, "30");

  const aliceNotes = store.getNotes(senderHint);
  assert.equal(aliceNotes.some((note) => note.spentAt !== undefined), true);
  assert.equal(aliceNotes.some((note) => note.amount === "65" && !note.spentAt), true);

  const paidRequest = store.getPaymentRequest("0xreq1");
  assert.equal(paidRequest?.paid, true);
});

test("executePrivateWithdraw consumes note and creates change note", () => {
  const store = new IndexerStore();

  const senderHint = "alice";
  const asset = "tBTC";
  const senderBlinding = "0xsenderblinding";
  const senderCommitment = deriveCommitment(senderHint, asset, "100", senderBlinding);

  const minted = store.ingestCommitment({
    commitment: senderCommitment,
    recipientHint: senderHint,
    note: {
      ownerHint: senderHint,
      asset,
      amount: "100",
      blinding: senderBlinding,
    },
    ciphertext: {
      commitment: senderCommitment,
      recipientHint: senderHint,
      ephemeralPubKey: randomHex(),
      ciphertext: randomHex(),
      nonce: randomHex(12),
    },
  });

  const withdrawAmount = "60";
  const feeAmount = "10";
  const recipient = "0xabc";
  const nullifier = "0xnull2";

  const publicInputs = {
    root: minted.root,
    inputCommitments: [senderCommitment],
    inputNullifiers: [nullifier],
    recipient,
    amountCommitment: hashToField("withdraw-amount", withdrawAmount, recipient, asset, feeAmount),
    feeCommitment: amountToCommitment(
      feeAmount,
      hashToField("withdraw-fee", asset, recipient, feeAmount)
    ),
    asset,
  };

  const result = store.executePrivateWithdraw({
    senderHint,
    root: minted.root,
    asset,
    recipient,
    withdrawAmount,
    feeAmount,
    inputNotes: [
      {
        commitment: senderCommitment,
        amount: "100",
        blinding: senderBlinding,
      },
    ],
    changeBlinding: "0xchange",
    proofBundle: {
      proof: [checksumProofPublicInputs(publicInputs)],
      publicInputs,
      scheme: "groth16",
      circuit: "withdraw",
      mock: true,
    },
  });

  assert.equal(result.nullifiers[0], nullifier);
  assert.equal(result.withdrawAmount, withdrawAmount);
  assert.equal(typeof result.changeCommitment, "string");
  assert.equal(store.isNullifierUsed(nullifier), true);

  const aliceNotes = store.getNotes(senderHint);
  assert.equal(aliceNotes.some((note) => note.amount === "30" && !note.spentAt), true);
});
