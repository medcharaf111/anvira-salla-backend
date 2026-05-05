import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Salla webhook payload's HMAC-SHA256 signature.
 *
 * Salla signs the raw request body with `SALLA_WEBHOOK_SECRET`. The signature
 * arrives in the `x-salla-signature` header (hex-encoded).
 *
 * Use timingSafeEqual to defend against timing attacks.
 *
 * Returns true if signature is valid, false otherwise.
 * Returns false if the secret is not configured (do not silently accept).
 */
export function verifySallaSignature(
  rawBody: string,
  signatureHeader: string | undefined
): boolean {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let providedBuf: Buffer;
  try {
    providedBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
