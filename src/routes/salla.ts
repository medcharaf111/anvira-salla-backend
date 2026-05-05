import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

/**
 * Salla integration routes.
 *
 * Endpoints:
 *   POST /salla/oauth/exchange     — exchange OAuth code for access token (called from frontend callback)
 *   POST /salla/webhook            — receive merchant events (orders, abandoned carts, etc.)
 *   GET  /salla/install            — start the OAuth flow (returns Salla install URL)
 *
 * STUBBED: real implementation requires SALLA_CLIENT_ID / SALLA_CLIENT_SECRET
 * and signature verification on webhook payloads.
 *
 * Docs: https://docs.salla.dev
 */
export const salla = new Hono();

const exchangeSchema = z.object({
  code: z.string().min(1),
  state: z.string().nullable().optional(),
});

salla.post("/oauth/exchange", zValidator("json", exchangeSchema), async (c) => {
  const { code } = c.req.valid("json");

  const clientId = process.env.SALLA_CLIENT_ID;
  const clientSecret = process.env.SALLA_CLIENT_SECRET;
  const redirectUri = process.env.SALLA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return c.json({ error: "salla_credentials_missing" }, 500);
  }

  // TODO: POST to https://accounts.salla.sa/oauth2/token with code+grant_type
  // TODO: persist merchant + tokens in db (merchants table)
  // TODO: subscribe to webhooks for this merchant
  console.log("[salla] oauth exchange request received", { code });

  return c.json({ ok: true, todo: "implement_token_exchange" });
});

salla.post("/webhook", async (c) => {
  // TODO: verify x-salla-signature header against SALLA_WEBHOOK_SECRET
  // TODO: route by event.type:
  //   order.created            → store + maybe notify merchant on WA
  //   order.payment.failed     → trigger fallback flow
  //   abandoned.cart           → schedule recovery messages
  //   product.updated          → invalidate caches
  const body = await c.req.json().catch(() => ({}));
  console.log("[salla] webhook received", { event: body?.event });
  return c.json({ received: true });
});

salla.get("/install", (c) => {
  const clientId = process.env.SALLA_CLIENT_ID;
  const redirectUri = process.env.SALLA_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return c.json({ error: "salla_credentials_missing" }, 500);
  }
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.salla.sa/oauth2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "offline_access");
  return c.json({ install_url: url.toString(), state });
});
