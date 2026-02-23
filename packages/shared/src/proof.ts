import type { ProofBundle } from "./types.js";

import { hashToField } from "./crypto.js";

export function checksumProofPublicInputs(publicInputs: unknown): string {
  return hashToField("proof", JSON.stringify(publicInputs));
}

export function isMockProofBundleConsistent<TPublicInputs>(
  proofBundle: ProofBundle<TPublicInputs>
): boolean {
  const checksum = checksumProofPublicInputs(proofBundle.publicInputs);
  return proofBundle.proof.includes(checksum);
}
