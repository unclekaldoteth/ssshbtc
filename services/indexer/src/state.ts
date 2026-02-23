import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  DEFAULT_TREE_ROOT,
  amountToCommitment,
  deriveCommitment,
  hashToField,
  isMockProofBundleConsistent,
  randomHex,
  type NoteCiphertext,
  type PaymentRequest,
  type ShieldedNote,
  type TransferExecutionRequest,
  type TransferExecutionResult,
  type WalletStateSnapshot,
  type WithdrawExecutionRequest,
  type WithdrawExecutionResult,
  deriveRoot,
} from "@sssh-btc/shared";

interface IndexerState {
  root: string;
  commitmentCount: number;
  nullifiers: string[];
  commitments: string[];
  notesByHint: Record<string, ShieldedNote[]>;
  ciphertexts: Record<string, NoteCiphertext>;
  paymentRequests: Record<string, PaymentRequest>;
  knownRoots: string[];
}

const INITIAL_STATE: IndexerState = {
  root: DEFAULT_TREE_ROOT,
  commitmentCount: 0,
  nullifiers: [],
  commitments: [],
  notesByHint: {},
  ciphertexts: {},
  paymentRequests: {},
  knownRoots: [DEFAULT_TREE_ROOT],
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseNonNegativeAmount(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }

  if (parsed < 0n) {
    throw new Error(`${label} must be non-negative`);
  }

  return parsed;
}

function assertEqualArray(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label} length mismatch`);
  }

  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(`${label} mismatch at index ${i}`);
    }
  }
}

export class IndexerStore {
  private state: IndexerState;

  constructor(private readonly persistenceFile?: string) {
    this.state = persistenceFile ? this.load(persistenceFile) : structuredClone(INITIAL_STATE);
  }

  private load(filePath: string): IndexerState {
    try {
      const raw = readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as IndexerState;
    } catch {
      return structuredClone(INITIAL_STATE);
    }
  }

  private persist(): void {
    if (!this.persistenceFile) {
      return;
    }

    mkdirSync(dirname(this.persistenceFile), { recursive: true });
    writeFileSync(this.persistenceFile, JSON.stringify(this.state, null, 2));
  }

  private getUnspentNoteByCommitment(walletHint: string, commitment: string): ShieldedNote {
    const notes = this.state.notesByHint[walletHint] ?? [];
    const note = notes.find((candidate) => candidate.commitment === commitment);

    if (!note) {
      throw new Error(`Input note ${commitment} not found for ${walletHint}`);
    }

    if (note.spentAt) {
      throw new Error(`Input note ${commitment} already spent`);
    }

    return note;
  }

  private assertProofBundleShape(proof: { proof: string[]; mock: boolean }): void {
    if (!proof.proof.length) {
      throw new Error("Proof payload is empty");
    }

    if (proof.mock && !isMockProofBundleConsistent(proof as never)) {
      throw new Error("Mock proof checksum mismatch");
    }
  }

  getRoot(): { root: string; commitmentCount: number } {
    return {
      root: this.state.root,
      commitmentCount: this.state.commitmentCount,
    };
  }

  isKnownRoot(root: string): boolean {
    return this.state.knownRoots.includes(root);
  }

  ingestCommitment(params: {
    commitment: string;
    recipientHint: string;
    note: Omit<ShieldedNote, "createdAt" | "noteId" | "commitment">;
    ciphertext: NoteCiphertext;
  }): { root: string; index: number } {
    const { commitment, recipientHint, note, ciphertext } = params;

    const index = this.state.commitmentCount;
    const nextRoot = deriveRoot(this.state.root, commitment, index);

    this.state.commitmentCount += 1;
    this.state.root = nextRoot;
    this.state.commitments.push(commitment);
    this.state.knownRoots.push(nextRoot);

    this.state.ciphertexts[commitment] = ciphertext;

    const noteEntry: ShieldedNote = {
      ...note,
      commitment,
      noteId: `${recipientHint}-${index}`,
      createdAt: nowIso(),
    };

    if (!this.state.notesByHint[recipientHint]) {
      this.state.notesByHint[recipientHint] = [];
    }
    this.state.notesByHint[recipientHint].push(noteEntry);

    this.persist();

    return { root: nextRoot, index };
  }

  spendNullifier(nullifier: string): void {
    if (this.state.nullifiers.includes(nullifier)) {
      throw new Error("Nullifier already used");
    }
    this.state.nullifiers.push(nullifier);
    this.persist();
  }

  isNullifierUsed(nullifier: string): boolean {
    return this.state.nullifiers.includes(nullifier);
  }

  getNotes(walletHint: string): ShieldedNote[] {
    return this.state.notesByHint[walletHint] ?? [];
  }

  markNoteSpent(walletHint: string, commitment: string, nullifier: string): ShieldedNote {
    const notes = this.state.notesByHint[walletHint];
    if (!notes || notes.length === 0) {
      throw new Error("Wallet has no notes");
    }

    const noteIndex = notes.findIndex((note) => note.commitment === commitment);
    if (noteIndex === -1) {
      throw new Error("Note not found");
    }

    const next: ShieldedNote = {
      ...notes[noteIndex],
      nullifier,
      spentAt: nowIso(),
    };

    notes[noteIndex] = next;
    this.persist();

    return next;
  }

  executePrivateTransfer(params: TransferExecutionRequest): TransferExecutionResult {
    if (!this.isKnownRoot(params.root)) {
      throw new Error("Unknown Merkle root");
    }

    if (params.proofBundle.circuit !== "transfer") {
      throw new Error("Transfer execution requires transfer proof bundle");
    }

    this.assertProofBundleShape(params.proofBundle);

    const publicInputs = params.proofBundle.publicInputs;

    if (publicInputs.root !== params.root) {
      throw new Error("Proof root mismatch");
    }

    if (publicInputs.asset !== params.asset) {
      throw new Error("Proof asset mismatch");
    }

    if (params.inputNotes.length === 0 || params.outputNotes.length === 0) {
      throw new Error("Transfer needs at least one input and output");
    }

    if (publicInputs.inputNullifiers.length !== params.inputNotes.length) {
      throw new Error("Nullifier count mismatch");
    }

    const expectedInputCommitments = params.inputNotes.map((note) => note.commitment);
    assertEqualArray(publicInputs.inputCommitments, expectedInputCommitments, "input commitments");

    const expectedOutputCommitments = params.outputNotes.map((output) =>
      deriveCommitment(output.ownerHint, params.asset, output.amount, output.blinding)
    );
    assertEqualArray(publicInputs.outputCommitments, expectedOutputCommitments, "output commitments");

    const expectedFeeCommitment = amountToCommitment(
      params.feeAmount,
      hashToField(
        "transfer-fee",
        params.asset,
        params.feeAmount,
        ...params.inputNotes.map((note) => note.commitment)
      )
    );
    if (publicInputs.feeCommitment !== expectedFeeCommitment) {
      throw new Error("Fee commitment mismatch");
    }

    const totalIn = params.inputNotes.reduce(
      (sum, note) => sum + parseNonNegativeAmount(note.amount, "input amount"),
      0n
    );
    const totalOut = params.outputNotes.reduce(
      (sum, note) => sum + parseNonNegativeAmount(note.amount, "output amount"),
      0n
    );
    const fee = parseNonNegativeAmount(params.feeAmount, "fee amount");

    if (totalIn !== totalOut + fee) {
      throw new Error("Conservation check failed for transfer");
    }

    for (let i = 0; i < params.inputNotes.length; i += 1) {
      const input = params.inputNotes[i];
      const stored = this.getUnspentNoteByCommitment(params.senderHint, input.commitment);

      if (stored.asset !== params.asset) {
        throw new Error(`Input note asset mismatch at ${i}`);
      }

      if (stored.amount !== input.amount || stored.blinding !== input.blinding) {
        throw new Error(`Input note witness mismatch at ${i}`);
      }

      const nullifier = publicInputs.inputNullifiers[i];
      if (this.isNullifierUsed(nullifier)) {
        throw new Error(`Nullifier already used at ${i}`);
      }
    }

    let requestToPay: PaymentRequest | null = null;
    if (params.requestHash) {
      requestToPay = this.getPaymentRequest(params.requestHash);
      if (!requestToPay) {
        throw new Error("Referenced payment request not found");
      }

      if (requestToPay.paid) {
        throw new Error("Referenced payment request is already paid");
      }

      if (requestToPay.asset !== params.asset) {
        throw new Error("Payment request asset mismatch");
      }

      if (requestToPay.receiverStealthPubkey !== params.outputNotes[0].ownerHint) {
        throw new Error("Payment request receiver does not match transfer recipient");
      }
    }

    const spentCommitments: string[] = [];
    for (let i = 0; i < params.inputNotes.length; i += 1) {
      const input = params.inputNotes[i];
      const nullifier = publicInputs.inputNullifiers[i];
      this.spendNullifier(nullifier);
      this.markNoteSpent(params.senderHint, input.commitment, nullifier);
      spentCommitments.push(input.commitment);
    }

    const insertedCommitments: TransferExecutionResult["insertedCommitments"] = [];
    for (let i = 0; i < params.outputNotes.length; i += 1) {
      const output = params.outputNotes[i];
      const commitment = expectedOutputCommitments[i];
      const result = this.ingestCommitment({
        commitment,
        recipientHint: output.ownerHint,
        note: {
          ownerHint: output.ownerHint,
          asset: params.asset,
          amount: output.amount,
          blinding: output.blinding,
        },
        ciphertext: {
          commitment,
          recipientHint: output.ownerHint,
          ephemeralPubKey: randomHex(16),
          ciphertext: randomHex(32),
          nonce: randomHex(12),
        },
      });

      insertedCommitments.push({
        commitment,
        ownerHint: output.ownerHint,
        index: result.index,
      });
    }

    if (requestToPay) {
      this.markPaymentRequestPaid(params.requestHash!, expectedOutputCommitments[0]);
    }

    return {
      newRoot: this.state.root,
      nullifiers: publicInputs.inputNullifiers,
      spentCommitments,
      outputCommitments: expectedOutputCommitments,
      insertedCommitments,
      ...(params.requestHash ? { paidRequestHash: params.requestHash } : {}),
    };
  }

  executePrivateWithdraw(params: WithdrawExecutionRequest): WithdrawExecutionResult {
    if (!this.isKnownRoot(params.root)) {
      throw new Error("Unknown Merkle root");
    }

    if (params.proofBundle.circuit !== "withdraw") {
      throw new Error("Withdraw execution requires withdraw proof bundle");
    }

    this.assertProofBundleShape(params.proofBundle);

    const publicInputs = params.proofBundle.publicInputs;

    if (publicInputs.root !== params.root) {
      throw new Error("Proof root mismatch");
    }

    if (publicInputs.asset !== params.asset) {
      throw new Error("Proof asset mismatch");
    }

    if (publicInputs.recipient !== params.recipient) {
      throw new Error("Proof recipient mismatch");
    }

    if (publicInputs.inputNullifiers.length !== params.inputNotes.length) {
      throw new Error("Nullifier count mismatch");
    }

    const expectedInputCommitments = params.inputNotes.map((note) => note.commitment);
    assertEqualArray(publicInputs.inputCommitments, expectedInputCommitments, "input commitments");

    const expectedAmountCommitment = hashToField(
      "withdraw-amount",
      params.withdrawAmount,
      params.recipient,
      params.asset,
      params.feeAmount
    );
    if (publicInputs.amountCommitment !== expectedAmountCommitment) {
      throw new Error("Withdraw amount commitment mismatch");
    }

    const expectedFeeCommitment = amountToCommitment(
      params.feeAmount,
      hashToField("withdraw-fee", params.asset, params.recipient, params.feeAmount)
    );
    if (publicInputs.feeCommitment !== expectedFeeCommitment) {
      throw new Error("Withdraw fee commitment mismatch");
    }

    const totalIn = params.inputNotes.reduce(
      (sum, note) => sum + parseNonNegativeAmount(note.amount, "input amount"),
      0n
    );
    const withdrawAmount = parseNonNegativeAmount(params.withdrawAmount, "withdraw amount");
    const feeAmount = parseNonNegativeAmount(params.feeAmount, "fee amount");

    if (totalIn < withdrawAmount + feeAmount) {
      throw new Error("Insufficient private balance for withdrawal + fee");
    }

    const changeAmount = totalIn - withdrawAmount - feeAmount;
    if (changeAmount > 0n && !params.changeBlinding) {
      throw new Error("changeBlinding is required when withdrawal leaves change");
    }

    for (let i = 0; i < params.inputNotes.length; i += 1) {
      const input = params.inputNotes[i];
      const stored = this.getUnspentNoteByCommitment(params.senderHint, input.commitment);

      if (stored.asset !== params.asset) {
        throw new Error(`Input note asset mismatch at ${i}`);
      }

      if (stored.amount !== input.amount || stored.blinding !== input.blinding) {
        throw new Error(`Input note witness mismatch at ${i}`);
      }

      const nullifier = publicInputs.inputNullifiers[i];
      if (this.isNullifierUsed(nullifier)) {
        throw new Error(`Nullifier already used at ${i}`);
      }
    }

    const spentCommitments: string[] = [];
    for (let i = 0; i < params.inputNotes.length; i += 1) {
      const input = params.inputNotes[i];
      const nullifier = publicInputs.inputNullifiers[i];
      this.spendNullifier(nullifier);
      this.markNoteSpent(params.senderHint, input.commitment, nullifier);
      spentCommitments.push(input.commitment);
    }

    let changeCommitment: string | undefined;
    if (changeAmount > 0n && params.changeBlinding) {
      changeCommitment = deriveCommitment(
        params.senderHint,
        params.asset,
        changeAmount.toString(),
        params.changeBlinding
      );

      this.ingestCommitment({
        commitment: changeCommitment,
        recipientHint: params.senderHint,
        note: {
          ownerHint: params.senderHint,
          asset: params.asset,
          amount: changeAmount.toString(),
          blinding: params.changeBlinding,
        },
        ciphertext: {
          commitment: changeCommitment,
          recipientHint: params.senderHint,
          ephemeralPubKey: randomHex(16),
          ciphertext: randomHex(32),
          nonce: randomHex(12),
        },
      });
    }

    return {
      newRoot: this.state.root,
      nullifiers: publicInputs.inputNullifiers,
      spentCommitments,
      amountCommitment: publicInputs.amountCommitment,
      ...(changeCommitment ? { changeCommitment } : {}),
      recipient: params.recipient,
      withdrawAmount: params.withdrawAmount,
    };
  }

  getSnapshot(walletHint: string): WalletStateSnapshot {
    const knownNotes = this.getNotes(walletHint);
    const pendingRequests = Object.values(this.state.paymentRequests).filter(
      (request) => !request.paid && request.receiverStealthPubkey === walletHint
    );

    return {
      root: this.state.root,
      totalCommitments: this.state.commitmentCount,
      knownNotes,
      pendingRequests,
      nullifierCount: this.state.nullifiers.length,
      lastSyncedAt: nowIso(),
    };
  }

  createPaymentRequest(request: PaymentRequest): PaymentRequest {
    if (this.state.paymentRequests[request.requestHash]) {
      throw new Error("Payment request already exists");
    }

    this.state.paymentRequests[request.requestHash] = request;
    this.persist();

    return request;
  }

  markPaymentRequestPaid(requestHash: string, commitmentRef: string): PaymentRequest {
    const request = this.state.paymentRequests[requestHash];
    if (!request) {
      throw new Error("Payment request not found");
    }

    if (request.paid) {
      throw new Error("Payment request already paid");
    }

    const next: PaymentRequest = {
      ...request,
      paid: true,
      paidCommitmentRef: commitmentRef,
    };

    this.state.paymentRequests[requestHash] = next;
    this.persist();

    return next;
  }

  getPaymentRequest(requestHash: string): PaymentRequest | null {
    return this.state.paymentRequests[requestHash] ?? null;
  }
}
