import cors from "cors";
import express from "express";
import morgan from "morgan";
import { z } from "zod";

import {
  amountToCommitment,
  deriveCommitment,
  randomHex,
  type NoteCiphertext,
  type PaymentRequest,
  type TransferExecutionRequest,
  type WithdrawExecutionRequest,
} from "@sssh-btc/shared";

import { IndexerStore } from "./state.js";

function envVar(name: string, legacyName?: string): string | undefined {
  return process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
}

const PORT = Number(process.env.PORT ?? "4100");
const app = express();
const store = new IndexerStore(
  envVar("SSSH_BTC_INDEXER_STATE_FILE", "SHADOWBTC_INDEXER_STATE_FILE") ?? ".data/state.json"
);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const ingestCommitmentSchema = z.object({
  commitment: z.string().min(2),
  recipientHint: z.string().min(1),
  note: z.object({
    ownerHint: z.string().min(1),
    asset: z.string().min(1),
    amount: z.string().min(1),
    blinding: z.string().min(1),
  }),
  ciphertext: z.object({
    commitment: z.string(),
    recipientHint: z.string(),
    ephemeralPubKey: z.string(),
    ciphertext: z.string(),
    nonce: z.string(),
  }),
});

const paymentRequestSchema = z.object({
  requestHash: z.string().min(2),
  receiverStealthPubkey: z.string().min(1),
  expiry: z.number().int().positive(),
  memo: z.string().max(200).optional(),
  asset: z.string().min(1),
  amountCommitment: z.string().min(2),
});

const payRequestSchema = z.object({
  commitmentRef: z.string().min(2),
});

const spendNoteSchema = z.object({
  walletHint: z.string().min(1),
  commitment: z.string().min(2),
  nullifier: z.string().min(2),
});

const transferExecutionSchema: z.ZodType<TransferExecutionRequest> = z.object({
  senderHint: z.string().min(1),
  root: z.string().min(1),
  asset: z.string().min(1),
  feeAmount: z.string().min(1),
  inputNotes: z
    .array(
      z.object({
        commitment: z.string().min(2),
        amount: z.string().min(1),
        blinding: z.string().min(1),
      })
    )
    .min(1),
  outputNotes: z
    .array(
      z.object({
        ownerHint: z.string().min(1),
        amount: z.string().min(1),
        blinding: z.string().min(1),
      })
    )
    .min(1),
  proofBundle: z.object({
    proof: z.array(z.string()).min(1),
    publicInputs: z.object({
      root: z.string().min(1),
      inputCommitments: z.array(z.string().min(2)).min(1),
      inputNullifiers: z.array(z.string().min(2)).min(1),
      outputCommitments: z.array(z.string().min(2)).min(1),
      feeCommitment: z.string().min(2),
      asset: z.string().min(1),
    }),
    scheme: z.literal("groth16"),
    circuit: z.literal("transfer"),
    mock: z.boolean(),
  }),
  requestHash: z.string().min(2).optional(),
});

const withdrawExecutionSchema: z.ZodType<WithdrawExecutionRequest> = z.object({
  senderHint: z.string().min(1),
  root: z.string().min(1),
  asset: z.string().min(1),
  recipient: z.string().min(1),
  withdrawAmount: z.string().min(1),
  feeAmount: z.string().min(1),
  inputNotes: z
    .array(
      z.object({
        commitment: z.string().min(2),
        amount: z.string().min(1),
        blinding: z.string().min(1),
      })
    )
    .min(1),
  changeBlinding: z.string().min(1).optional(),
  proofBundle: z.object({
    proof: z.array(z.string()).min(1),
    publicInputs: z.object({
      root: z.string().min(1),
      inputCommitments: z.array(z.string().min(2)).min(1),
      inputNullifiers: z.array(z.string().min(2)).min(1),
      recipient: z.string().min(1),
      amountCommitment: z.string().min(2),
      feeCommitment: z.string().min(2),
      asset: z.string().min(1),
    }),
    scheme: z.literal("groth16"),
    circuit: z.literal("withdraw"),
    mock: z.boolean(),
  }),
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sssh-btc-indexer",
    mode: "in-memory+json",
    now: new Date().toISOString(),
  });
});

app.get("/tree/root", (_req, res) => {
  res.json(store.getRoot());
});

app.get("/notes/:walletHint", (req, res) => {
  const notes = store.getNotes(req.params.walletHint);
  res.json({ notes });
});

app.get("/wallet/:walletHint/snapshot", (req, res) => {
  res.json(store.getSnapshot(req.params.walletHint));
});

app.post("/commitments", (req, res) => {
  const parsed = ingestCommitmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const result = store.ingestCommitment(parsed.data);
  return res.status(201).json(result);
});

app.post("/nullifiers", (req, res) => {
  const parsed = z.object({ nullifier: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    store.spendNullifier(parsed.data.nullifier);
    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Nullifier rejected",
    });
  }
});

app.get("/nullifiers/:nullifier", (req, res) => {
  res.json({ used: store.isNullifierUsed(req.params.nullifier) });
});

app.post("/notes/spend", (req, res) => {
  const parsed = spendNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const note = store.markNoteSpent(
      parsed.data.walletHint,
      parsed.data.commitment,
      parsed.data.nullifier
    );
    return res.json(note);
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Unable to mark note as spent",
    });
  }
});

app.post("/transfers/private", (req, res) => {
  const parsed = transferExecutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const result = store.executePrivateTransfer(parsed.data);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Private transfer execution failed",
    });
  }
});

app.post("/withdrawals/private", (req, res) => {
  const parsed = withdrawExecutionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const result = store.executePrivateWithdraw(parsed.data);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Private withdrawal execution failed",
    });
  }
});

app.post("/payment-requests", (req, res) => {
  const parsed = paymentRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const request: PaymentRequest = {
    ...parsed.data,
    createdAt: new Date().toISOString(),
    paid: false,
  };

  try {
    const created = store.createPaymentRequest(request);
    return res.status(201).json(created);
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Unable to create request",
    });
  }
});

app.get("/payment-requests/:id", (req, res) => {
  const request = store.getPaymentRequest(req.params.id);
  if (!request) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(request);
});

app.post("/payment-requests/:id/pay", (req, res) => {
  const parsed = payRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const request = store.markPaymentRequestPaid(req.params.id, parsed.data.commitmentRef);
    return res.json(request);
  } catch (error) {
    return res.status(409).json({
      error: error instanceof Error ? error.message : "Unable to update request",
    });
  }
});

// Convenience endpoint for local demo mode.
app.post("/demo/mint-note", (req, res) => {
  const parsed = z
    .object({
      ownerHint: z.string().min(1),
      recipientHint: z.string().min(1),
      asset: z.string().default("tBTC"),
      amount: z.string().default("100000"),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const blinding = randomHex();
  const commitment = deriveCommitment(
    parsed.data.ownerHint,
    parsed.data.asset,
    parsed.data.amount,
    blinding
  );

  const ciphertext: NoteCiphertext = {
    commitment,
    recipientHint: parsed.data.recipientHint,
    ephemeralPubKey: randomHex(16),
    ciphertext: randomHex(32),
    nonce: randomHex(12),
  };

  const result = store.ingestCommitment({
    commitment,
    recipientHint: parsed.data.recipientHint,
    note: {
      ownerHint: parsed.data.ownerHint,
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      blinding,
    },
    ciphertext,
  });

  return res.status(201).json({
    ...result,
    note: {
      commitment,
      amountCommitment: amountToCommitment(parsed.data.amount, blinding),
      asset: parsed.data.asset,
      amount: parsed.data.amount,
      blinding,
      recipientHint: parsed.data.recipientHint,
    },
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sssh-btc-indexer listening on http://localhost:${PORT}`);
});
