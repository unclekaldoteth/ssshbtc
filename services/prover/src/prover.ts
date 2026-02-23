import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  amountToCommitment,
  checksumProofPublicInputs,
  decimalToFelt,
  deriveCommitment,
  feltToDecimal,
  hashToField,
  isMockProofBundleConsistent,
  toField,
  type ProofBundle,
  type PublicInputsTransfer,
  type PublicInputsWithdraw,
  type TransferProofRequest,
  type WithdrawProofRequest,
} from "@sssh-btc/shared";

type CircuitId = "transfer" | "withdraw";

interface CircuitArtifacts {
  wasmPath: string;
  zkeyPath: string;
  verificationKeyPath: string;
}

interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol?: string;
  curve?: string;
}

interface Groth16Result {
  proof: Groth16Proof;
  publicSignals: string[];
}

function envVar(name: string, legacyName: string): string | undefined {
  return process.env[name] ?? process.env[legacyName];
}

function parseNonNegative(value: string, label: string): bigint {
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

function padToTwo(values: string[]): [string, string] {
  if (values.length > 2) {
    throw new Error("This prover supports up to 2 values for transfer circuits");
  }

  const first = values[0] ?? "0";
  const second = values[1] ?? "0";
  return [first, second];
}

function deriveCircuitNullifier(commitment: string, senderSecret: string): string {
  const commitmentField = BigInt(toField(commitment));
  const secretField = BigInt(toField(senderSecret));
  return decimalToFelt((commitmentField + secretField).toString());
}

function flattenGroth16Proof(proof: Groth16Proof): string[] {
  if (!proof?.pi_a || !proof?.pi_b || !proof?.pi_c) {
    throw new Error("Invalid Groth16 proof object");
  }

  return [
    proof.pi_a[0],
    proof.pi_a[1],
    proof.pi_b[0][0],
    proof.pi_b[0][1],
    proof.pi_b[1][0],
    proof.pi_b[1][1],
    proof.pi_c[0],
    proof.pi_c[1],
  ].map((value) => decimalToFelt(value));
}

function resolveDefaultArtifactsDir(): string {
  const fromEnv = envVar("SSSH_BTC_ZK_ARTIFACTS_DIR", "SHADOWBTC_ZK_ARTIFACTS_DIR");
  if (fromEnv) {
    return resolve(process.cwd(), fromEnv);
  }

  const localCandidates = [
    resolve(process.cwd(), "circuits", "build"),
    resolve(process.cwd(), "..", "..", "circuits", "build"),
    resolve(
      fileURLToPath(new URL("../../../circuits/build", import.meta.url))
    ),
  ];

  const found = localCandidates.find((candidate) => existsSync(candidate));
  return found ?? localCandidates[0];
}

export class Prover {
  private readonly artifactsDir: string;
  private readonly circuits: Record<CircuitId, CircuitArtifacts>;
  private readonly verificationKeys = new Map<CircuitId, unknown>();

  constructor(private readonly mockMode = true, artifactsDir = resolveDefaultArtifactsDir()) {
    this.artifactsDir = artifactsDir;

    this.circuits = {
      transfer: {
        wasmPath:
          envVar("SSSH_BTC_TRANSFER_WASM", "SHADOWBTC_TRANSFER_WASM") ??
          resolve(this.artifactsDir, "transfer_js", "transfer.wasm"),
        zkeyPath:
          envVar("SSSH_BTC_TRANSFER_ZKEY", "SHADOWBTC_TRANSFER_ZKEY") ??
          resolve(this.artifactsDir, "transfer_final.zkey"),
        verificationKeyPath:
          envVar("SSSH_BTC_TRANSFER_VKEY", "SHADOWBTC_TRANSFER_VKEY") ??
          resolve(this.artifactsDir, "transfer_verification_key.json"),
      },
      withdraw: {
        wasmPath:
          envVar("SSSH_BTC_WITHDRAW_WASM", "SHADOWBTC_WITHDRAW_WASM") ??
          resolve(this.artifactsDir, "withdraw_js", "withdraw.wasm"),
        zkeyPath:
          envVar("SSSH_BTC_WITHDRAW_ZKEY", "SHADOWBTC_WITHDRAW_ZKEY") ??
          resolve(this.artifactsDir, "withdraw_final.zkey"),
        verificationKeyPath:
          envVar("SSSH_BTC_WITHDRAW_VKEY", "SHADOWBTC_WITHDRAW_VKEY") ??
          resolve(this.artifactsDir, "withdraw_verification_key.json"),
      },
    };
  }

  private getCircuitArtifacts(circuit: CircuitId): CircuitArtifacts {
    return this.circuits[circuit];
  }

  private ensureCircuitArtifacts(circuit: CircuitId): void {
    const artifacts = this.getCircuitArtifacts(circuit);
    const missing = [artifacts.wasmPath, artifacts.zkeyPath, artifacts.verificationKeyPath].filter(
      (filePath) => !existsSync(filePath)
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing ${circuit} proof artifacts in ${this.artifactsDir}. Missing: ${missing.join(", ")}. ` +
          "Generate artifacts with: ./scripts/setup-zk-artifacts.sh"
      );
    }
  }

  private async getSnarkjs(): Promise<any> {
    const mod = (await import("snarkjs")) as any;
    return mod.default ?? mod;
  }

  private async getVerificationKey(circuit: CircuitId): Promise<unknown> {
    const cached = this.verificationKeys.get(circuit);
    if (cached) {
      return cached;
    }

    const filePath = this.getCircuitArtifacts(circuit).verificationKeyPath;
    const key = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    this.verificationKeys.set(circuit, key);
    return key;
  }

  private async fullProve(circuit: CircuitId, input: Record<string, unknown>): Promise<Groth16Result> {
    this.ensureCircuitArtifacts(circuit);

    const snarkjs = await this.getSnarkjs();
    const artifacts = this.getCircuitArtifacts(circuit);

    const { proof, publicSignals } = (await snarkjs.groth16.fullProve(
      input,
      artifacts.wasmPath,
      artifacts.zkeyPath
    )) as {
      proof: Groth16Proof;
      publicSignals: string[];
    };

    return { proof, publicSignals };
  }

  private async verifyGroth16(
    circuit: CircuitId,
    proofData: Record<string, unknown>,
    publicSignals: string[]
  ): Promise<boolean> {
    this.ensureCircuitArtifacts(circuit);

    const snarkjs = await this.getSnarkjs();
    const verificationKey = await this.getVerificationKey(circuit);

    return (await snarkjs.groth16.verify(verificationKey, publicSignals, proofData)) as boolean;
  }

  async createTransferProof(
    request: TransferProofRequest
  ): Promise<
    ProofBundle<PublicInputsTransfer> & {
      derived: {
        outputBlindings: string[];
        outputCommitments: string[];
        inputNullifiers: string[];
      };
    }
  > {
    const outputBlindings = request.outputNotes.map((out) => out.blinding);

    const outputCommitments = request.outputNotes.map((output, idx) =>
      deriveCommitment(output.ownerHint, request.asset, output.amount, outputBlindings[idx])
    );

    const feeCommitment = amountToCommitment(
      request.feeAmount,
      hashToField(
        "transfer-fee",
        request.asset,
        request.feeAmount,
        ...request.inputNotes.map((note) => note.commitment)
      )
    );

    if (this.mockMode) {
      const inputNullifiers = request.inputNotes.map((input) =>
        hashToField("nullifier", input.commitment, request.senderSecret)
      );

      const publicInputs: PublicInputsTransfer = {
        root: request.root,
        inputCommitments: request.inputNotes.map((n) => n.commitment),
        inputNullifiers,
        outputCommitments,
        feeCommitment,
        asset: request.asset,
      };

      return {
        proof: [checksumProofPublicInputs(publicInputs)],
        publicInputs,
        scheme: "groth16",
        circuit: "transfer",
        mock: true,
        derived: {
          outputBlindings,
          outputCommitments,
          inputNullifiers,
        },
      };
    }

    const paddedInputCommitments = padToTwo(request.inputNotes.map((note) => note.commitment));
    const inCommitments = [
      feltToDecimal(paddedInputCommitments[0]),
      feltToDecimal(paddedInputCommitments[1]),
    ] as [string, string];
    const inAmounts = padToTwo(
      request.inputNotes.map((note) => parseNonNegative(note.amount, "input amount").toString())
    );

    const paddedOutputCommitments = padToTwo(outputCommitments);
    const outCommitments = [
      feltToDecimal(paddedOutputCommitments[0]),
      feltToDecimal(paddedOutputCommitments[1]),
    ] as [string, string];
    const outAmounts = padToTwo(
      request.outputNotes.map((note) => parseNonNegative(note.amount, "output amount").toString())
    );
    const inputNullifiers = [
      deriveCircuitNullifier(paddedInputCommitments[0], request.senderSecret),
      deriveCircuitNullifier(paddedInputCommitments[1], request.senderSecret),
    ] as [string, string];

    const totalIn = request.inputNotes.reduce(
      (sum, note) => sum + parseNonNegative(note.amount, "input amount"),
      0n
    );
    const totalOut = request.outputNotes.reduce(
      (sum, note) => sum + parseNonNegative(note.amount, "output amount"),
      0n
    );
    const feeAmount = parseNonNegative(request.feeAmount, "fee amount");
    if (totalIn !== totalOut + feeAmount) {
      throw new Error("Transfer conservation check failed before proof generation");
    }

    const input = {
      root: feltToDecimal(request.root),
      asset: feltToDecimal(toField(request.asset)),
      senderSecret: feltToDecimal(toField(request.senderSecret)),
      inCommitments,
      inAmounts,
      inputNullifiers: [feltToDecimal(inputNullifiers[0]), feltToDecimal(inputNullifiers[1])],
      outputCommitments: [
        feltToDecimal(paddedOutputCommitments[0]),
        feltToDecimal(paddedOutputCommitments[1]),
      ],
      feeCommitment: feltToDecimal(feeCommitment),
      outAmounts,
      outCommitments,
      fee: feeAmount.toString(),
      feeCommitmentIn: feltToDecimal(feeCommitment),
    };

    const { proof: proofData, publicSignals } = await this.fullProve("transfer", input);

    if (publicSignals.length < 9) {
      throw new Error("Transfer public signals are incomplete");
    }

    const parsedNullifiers = [decimalToFelt(publicSignals[4]), decimalToFelt(publicSignals[5])].slice(
      0,
      request.inputNotes.length
    );
    const parsedOutputCommitments = [
      decimalToFelt(publicSignals[6]),
      decimalToFelt(publicSignals[7]),
    ].slice(0, request.outputNotes.length);
    const parsedFeeCommitment = decimalToFelt(publicSignals[8]);

    for (let i = 0; i < parsedOutputCommitments.length; i += 1) {
      if (parsedOutputCommitments[i] !== outputCommitments[i]) {
        throw new Error("Transfer output commitment mismatch between witness and public signals");
      }
    }

    if (parsedFeeCommitment !== feeCommitment) {
      throw new Error("Transfer fee commitment mismatch between witness and public signals");
    }

    const publicInputs: PublicInputsTransfer = {
      root: request.root,
      inputCommitments: request.inputNotes.map((n) => n.commitment),
      inputNullifiers: parsedNullifiers,
      outputCommitments,
      feeCommitment,
      asset: request.asset,
    };

    return {
      proof: flattenGroth16Proof(proofData),
      proofData: proofData as unknown as Record<string, unknown>,
      publicSignals,
      publicInputs,
      scheme: "groth16",
      circuit: "transfer",
      mock: false,
      derived: {
        outputBlindings,
        outputCommitments,
        inputNullifiers: parsedNullifiers,
      },
    };
  }

  async createWithdrawProof(
    request: WithdrawProofRequest
  ): Promise<
    ProofBundle<PublicInputsWithdraw> & {
      derived: {
        amountCommitment: string;
        inputNullifiers: string[];
      };
    }
  > {
    if (request.inputNotes.length !== 1) {
      throw new Error("Withdraw circuit currently supports exactly 1 input note");
    }

    const feeAmount = request.feeAmount || "0";
    const amountCommitment = hashToField(
      "withdraw-amount",
      request.amount,
      request.recipient,
      request.asset,
      feeAmount
    );
    const feeCommitment = amountToCommitment(
      feeAmount,
      hashToField("withdraw-fee", request.asset, request.recipient, feeAmount)
    );

    if (this.mockMode) {
      const inputNullifiers = request.inputNotes.map((input) =>
        hashToField("nullifier", input.commitment, request.senderSecret)
      );

      const publicInputs: PublicInputsWithdraw = {
        root: request.root,
        inputCommitments: request.inputNotes.map((n) => n.commitment),
        inputNullifiers,
        recipient: request.recipient,
        amountCommitment,
        feeCommitment,
        asset: request.asset,
      };

      return {
        proof: [checksumProofPublicInputs(publicInputs)],
        publicInputs,
        scheme: "groth16",
        circuit: "withdraw",
        mock: true,
        derived: {
          amountCommitment,
          inputNullifiers,
        },
      };
    }

    const inAmount = parseNonNegative(request.inputNotes[0].amount, "input amount");
    const outAmount = parseNonNegative(request.amount, "withdraw amount");
    const fee = parseNonNegative(feeAmount, "fee amount");
    if (inAmount !== outAmount + fee) {
      throw new Error("Withdraw conservation check failed before proof generation");
    }

    const input = {
      root: feltToDecimal(request.root),
      asset: feltToDecimal(toField(request.asset)),
      senderSecret: feltToDecimal(toField(request.senderSecret)),
      inCommitment: feltToDecimal(request.inputNotes[0].commitment),
      inputNullifier: feltToDecimal(
        deriveCircuitNullifier(request.inputNotes[0].commitment, request.senderSecret)
      ),
      inAmount: inAmount.toString(),
      recipient: feltToDecimal(toField(request.recipient)),
      withdrawAmount: outAmount.toString(),
      fee: fee.toString(),
      amountCommitment: feltToDecimal(amountCommitment),
      feeCommitment: feltToDecimal(feeCommitment),
      amountCommitmentIn: feltToDecimal(amountCommitment),
      feeCommitmentIn: feltToDecimal(feeCommitment),
    };

    const { proof: proofData, publicSignals } = await this.fullProve("withdraw", input);

    if (publicSignals.length < 7) {
      throw new Error("Withdraw public signals are incomplete");
    }

    // Circom public signals follow declaration order for public inputs in this circuit:
    // [root, asset, inCommitment, recipient, inputNullifier, amountCommitment, feeCommitment]
    const parsedNullifier = decimalToFelt(publicSignals[4]);
    const parsedAmountCommitment = decimalToFelt(publicSignals[5]);
    const parsedFeeCommitment = decimalToFelt(publicSignals[6]);

    if (parsedAmountCommitment !== amountCommitment) {
      throw new Error(
        `Withdraw amount commitment mismatch between witness and public signals (expected=${amountCommitment}, actual=${parsedAmountCommitment})`
      );
    }

    if (parsedFeeCommitment !== feeCommitment) {
      throw new Error(
        `Withdraw fee commitment mismatch between witness and public signals (expected=${feeCommitment}, actual=${parsedFeeCommitment})`
      );
    }

    const publicInputs: PublicInputsWithdraw = {
      root: request.root,
      inputCommitments: [request.inputNotes[0].commitment],
      inputNullifiers: [parsedNullifier],
      recipient: request.recipient,
      amountCommitment,
      feeCommitment,
      asset: request.asset,
    };

    return {
      proof: flattenGroth16Proof(proofData),
      proofData: proofData as unknown as Record<string, unknown>,
      publicSignals,
      publicInputs,
      scheme: "groth16",
      circuit: "withdraw",
      mock: false,
      derived: {
        amountCommitment,
        inputNullifiers: [parsedNullifier],
      },
    };
  }

  async verifyProofBundle<TPublicInputs>(proofBundle: ProofBundle<TPublicInputs>): Promise<boolean> {
    if (proofBundle.mock) {
      return isMockProofBundleConsistent(proofBundle);
    }

    if (!proofBundle.proofData || !proofBundle.publicSignals) {
      return false;
    }

    return this.verifyGroth16(
      proofBundle.circuit,
      proofBundle.proofData,
      proofBundle.publicSignals
    );
  }
}
