const FIELD_PRIME = BigInt(
  "0x800000000000011000000000000000000000000000000000000000000000001"
);

function normalizeHex(input: string): string {
  if (input.startsWith("0x")) return input.toLowerCase();
  return `0x${input.toLowerCase()}`;
}

function normalizeFeltHex(input: string | bigint): string {
  const value = typeof input === "bigint" ? input : BigInt(input);
  const bounded = ((value % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
  return normalizeHex(bounded.toString(16));
}

export function isNumberishFelt(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value) || /^[0-9]+$/.test(value);
}

export function toField(value: string): string {
  if (isNumberishFelt(value)) {
    return normalizeFeltHex(value);
  }

  return hashToField("field", value);
}

export function feltToDecimal(value: string): string {
  return BigInt(toField(value)).toString(10);
}

export function decimalToFelt(value: string): string {
  return normalizeFeltHex(BigInt(value));
}

export function hashToField(...parts: string[]): string {
  let state = 0n;
  const seeded = parts.join("|");

  for (let idx = 0; idx < seeded.length; idx += 1) {
    state = (state * 131n + BigInt(seeded.charCodeAt(idx))) % FIELD_PRIME;
  }

  const value = state % FIELD_PRIME;
  return normalizeFeltHex(value);
}

export function deriveCommitment(
  ownerHint: string,
  asset: string,
  amount: string,
  blinding: string
): string {
  return hashToField("commitment", ownerHint, asset, amount, blinding);
}

export function deriveNullifier(commitment: string, senderSecret: string): string {
  return hashToField("nullifier", commitment, senderSecret);
}

export function deriveRoot(previousRoot: string, commitment: string, index: number): string {
  return hashToField("root", previousRoot, commitment, String(index));
}

export function randomHex(bytes = 32): string {
  const values = new Uint8Array(bytes);

  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return normalizeHex(hex);
}

export function amountToCommitment(amount: string, blinding: string): string {
  return hashToField("amount", amount, blinding);
}
