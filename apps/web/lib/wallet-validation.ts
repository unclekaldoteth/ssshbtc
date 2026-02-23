export interface ValidationFailure {
  ok: false;
  error: string;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
  normalized: string;
}

export type ValidationResult<T> = ValidationFailure | ValidationSuccess<T>;

interface ParseAmountOptions {
  allowZero?: boolean;
  defaultToZero?: boolean;
}

const WHOLE_NUMBER_PATTERN = /^\d+$/;

export function parseRequiredText(value: string, label: string): ValidationResult<string> {
  const normalized = value.trim();
  if (!normalized) {
    return {
      ok: false,
      error: `${label} is required.`,
    };
  }

  return {
    ok: true,
    value: normalized,
    normalized,
  };
}

export function parseAmountInput(
  value: string,
  label: string,
  options: ParseAmountOptions = {}
): ValidationResult<bigint> {
  const normalized = value.trim();
  const allowZero = options.allowZero ?? false;
  const defaultToZero = options.defaultToZero ?? false;

  if (!normalized) {
    if (defaultToZero) {
      return {
        ok: true,
        value: 0n,
        normalized: "0",
      };
    }

    return {
      ok: false,
      error: `${label} is required.`,
    };
  }

  if (!WHOLE_NUMBER_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: `${label} must be a whole number.`,
    };
  }

  const parsed = BigInt(normalized);
  if (!allowZero && parsed === 0n) {
    return {
      ok: false,
      error: `${label} must be greater than zero.`,
    };
  }

  return {
    ok: true,
    value: parsed,
    normalized: parsed.toString(),
  };
}
