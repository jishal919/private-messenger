import { randomBytes } from "crypto";

export function generateUserId(): string {
  /*
   * Generate 18 decimal digits from cryptographically secure
   * random bytes.
   *
   * First digit is 1-8 so the resulting value is always:
   * 100000000000000000 - 899999999999999999
   */
  const bytes = randomBytes(18);

  let id = "";

  for (let i = 0; i < 18; i++) {
    let digit = bytes[i] % 10;

    if (i === 0) {
      digit = 1 + (bytes[i] % 8);
    }

    id += digit.toString();
  }

  return id;
}

export function isValidUserId(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    /^[1-8]\d{17}$/.test(value)
  );
}