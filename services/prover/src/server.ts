import cors from "cors";
import express from "express";
import morgan from "morgan";
import { z } from "zod";

import type { ProofBundle, TransferProofRequest, WithdrawProofRequest } from "@sssh-btc/shared";

import { Prover } from "./prover.js";

function envVar(name: string, legacyName?: string): string | undefined {
  return process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
}

const PORT = Number(process.env.PORT ?? "4200");
const MOCK_MODE = (envVar("SSSH_BTC_MOCK_PROOFS", "SHADOWBTC_MOCK_PROOFS") ?? "false") === "true";

const app = express();
const prover = new Prover(MOCK_MODE);

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));

const transferSchema: z.ZodType<TransferProofRequest> = z.object({
  root: z.string().min(2),
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
  feeAmount: z.string().min(1),
  asset: z.string().min(1),
  senderSecret: z.string().min(1),
});

const withdrawSchema: z.ZodType<WithdrawProofRequest> = z.object({
  root: z.string().min(2),
  inputNotes: z
    .array(
      z.object({
        commitment: z.string().min(2),
        amount: z.string().min(1),
        blinding: z.string().min(1),
      })
    )
    .min(1),
  recipient: z.string().min(2),
  amount: z.string().min(1),
  feeAmount: z.string().min(1),
  asset: z.string().min(1),
  senderSecret: z.string().min(1),
});

const verifyProofSchema = z.object({
  proofBundle: z.object({
    proof: z.array(z.string()).min(1),
    publicInputs: z.unknown(),
    scheme: z.literal("groth16"),
    circuit: z.union([z.literal("transfer"), z.literal("withdraw")]),
    mock: z.boolean(),
    proofData: z.record(z.unknown()).optional(),
    publicSignals: z.array(z.string()).optional(),
  }),
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sssh-btc-prover",
    mockMode: MOCK_MODE,
  });
});

app.post("/proof/transfer", async (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const proofBundle = await prover.createTransferProof(parsed.data);
    return res.status(201).json(proofBundle);
  } catch (error) {
    return res.status(422).json({
      error: error instanceof Error ? error.message : "Unable to generate transfer proof",
    });
  }
});

app.post("/proof/withdraw", async (req, res) => {
  const parsed = withdrawSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const proofBundle = await prover.createWithdrawProof(parsed.data);
    return res.status(201).json(proofBundle);
  } catch (error) {
    return res.status(422).json({
      error: error instanceof Error ? error.message : "Unable to generate withdraw proof",
    });
  }
});

app.post("/proof/verify", async (req, res) => {
  const parsed = verifyProofSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const proofBundle = parsed.data.proofBundle as ProofBundle<unknown>;
    const valid = await prover.verifyProofBundle(proofBundle);
    return res.json({ valid, circuit: proofBundle.circuit });
  } catch (error) {
    return res.status(422).json({
      error: error instanceof Error ? error.message : "Unable to verify proof bundle",
    });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sssh-btc-prover listening on http://localhost:${PORT}`);
});
