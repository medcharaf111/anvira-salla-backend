import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a Salla webhook payload.
 *
 * Salla supports 3 webhook security modes (set in Partner Portal → app → Webhooks):
 *
 *   1. Signature  → HMAC-SHA256 of raw body, hex-encoded, in `x-salla-signature` header
 *   2. Token      → static token (the SALLA_WEBHOOK_SECRET) sent in either:
 *                     - `Authorization` header (e.g. `Bearer <token>` or just `<token>`)
 *                     - `x-salla-token` header (some Salla versions)
 *                     - `x-salla-signature` header containing the raw token (no HMAC)
 *   3. None       → no verification (do not use in prod)
 *
 * We accept Signature OR Token automatically — whichever validates.
 */

interface VerifyContext {
  rawBody: string;
  headers: Record<string, string | undefined>;
}

interface VerifyResult {
  valid: boolean;
  mode: "signature" | "token" | "none";
  detail?: string;
}

export function verifySallaWebhook(ctx: VerifyContext): VerifyResult {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  if (!secret) {
    return { valid: false, mode: "none", detail: "no_secret_configured" };
  }

  // Normalize header names (Hono returns mixed case but we lowercase to be safe)
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.headers)) {
    if (v !== undefined) headers[k.toLowerCase()] = v;
  }

  const sigHeader = headers["x-salla-signature"];
  const tokenHeader =
    headers["x-salla-token"] ?? headers["authorization"] ?? "";

  // Try Signature mode first (HMAC-SHA256)
  if (sigHeader) {
    const expectedHex = createHmac("sha256", secret)
      .update(ctx.rawBody)
      .digest("hex");
    const isHex = /^[0-9a-fA-F]+$/.test(sigHeader);
    if (isHex && sigHeader.length === expectedHex.length) {
      try {
        const a = Buffer.from(expectedHex, "hex");
        const b = Buffer.from(sigHeader, "hex");
        if (a.length === b.length && timingSafeEqual(a, b)) {
          return { valid: true, mode: "signature" };
        }
      } catch {
        // fall through to token check
      }
    }
    // The signature header might also be the raw token (Salla Token mode places
    // the token in this header on some configurations).
    const cleaned = sigHeader.replace(/^Bearer\s+/i, "").trim();
    if (constantTimeStringEqual(cleaned, secret)) {
      return { valid: true, mode: "token" };
    }
  }

  // Try explicit Token-mode headers
  const tokenCandidate = tokenHeader.replace(/^Bearer\s+/i, "").trim();
  if (tokenCandidate && constantTimeStringEqual(tokenCandidate, secret)) {
    return { valid: true, mode: "token" };
  }

  return {
    valid: false,
    mode: "signature",
    detail: `headers_present: x-salla-signature=${sigHeader ? sigHeader.length + "chars" : "missing"}, x-salla-token=${headers["x-salla-token"] ? "yes" : "no"}, authorization=${headers["authorization"] ? "yes" : "no"}`,
  };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Backwards-compat: existing salla.ts imports this name
export function verifySallaSignature(
  rawBody: string,
  signatureHeader: string | undefined
): boolean {
  return verifySallaWebhook({
    rawBody,
    headers: { "x-salla-signature": signatureHeader },
  }).valid;
}
