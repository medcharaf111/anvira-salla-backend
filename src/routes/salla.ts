import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { config, isMockMode } from "../config.js";
import { upsertBySallaStoreId } from "../db/repos/merchants.js";
import {
  buildInstallUrl,
  exchangeCode,
  fetchStoreInfo,
} from "../salla/client.js";
import {
  handleSallaEvent,
  type SallaEventEnvelope,
} from "../salla/event-router.js";
import { verifySallaSignature } from "../salla/webhook-verify.js";
import { ensureDemoSeed } from "../seed/demo-seed.js";

/**
 * Salla integration routes.
 *
 *   GET  /salla/install          → returns OAuth install URL (frontend can redirect to it)
 *   POST /salla/oauth/exchange   → frontend posts the auth code; we exchange + persist
 *   POST /salla/webhook          → Salla pushes merchant events here (HMAC-signed)
 *
 * Docs: https://docs.salla.dev
 */
export const salla = new Hono();

/**
 * Salla integration uses real OAuth whenever credentials are present —
 * MOCK_MODE only short-circuits when there are NO Salla creds (so local
 * dev still works without registering an app). This lets a deployment run
 * with both seeded demo data AND real Salla installs simultaneously.
 */
const sallaConfigured = () =>
  !!(config.salla.clientId && config.salla.clientSecret && config.salla.redirectUri);

salla.get("/install", (c) => {
  if (!sallaConfigured()) {
    if (isMockMode()) {
      return c.json({
        install_url: "/dashboard?mock_install=1",
        state: "mock-state",
        mock: true,
      });
    }
    return c.json({ error: "salla_credentials_missing" }, 500);
  }
  try {
    const state = randomUUID();
    const url = buildInstallUrl(state);
    return c.json({ install_url: url, state });
  } catch (err) {
    console.error("[salla/install]", err);
    return c.json({ error: "build_install_url_failed", detail: String(err) }, 500);
  }
});

const exchangeSchema = z.object({
  code: z.string().min(1),
  state: z.string().nullable().optional(),
});

salla.post("/oauth/exchange", zValidator("json", exchangeSchema), async (c) => {
  const { code } = c.req.valid("json");

  // No real Salla creds → fall back to mock-merchant exchange (local dev)
  if (!sallaConfigured()) {
    if (isMockMode()) {
      const seed = await ensureDemoSeed();
      if (!seed) return c.json({ error: "seed_failed" }, 500);
      return c.json({
        ok: true,
        mock: true,
        merchant: { id: seed.merchantId, name: "متجر الأناقة" },
      });
    }
    return c.json({ error: "salla_credentials_missing" }, 500);
  }

  try {
    const tokens = await exchangeCode(code);
    const store = await fetchStoreInfo(tokens.access_token);

    const merchant = await upsertBySallaStoreId({
      sallaStoreId: String(store.id),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      name: store.name,
      domain: store.domain ?? undefined,
      email: store.email ?? undefined,
      plan: "starter",
    });

    return c.json({
      ok: true,
      merchant: {
        id: merchant.id,
        sallaStoreId: merchant.sallaStoreId,
        name: merchant.name,
      },
    });
  } catch (err) {
    console.error("[salla/oauth/exchange]", err);
    return c.json({ error: "exchange_failed", detail: String(err) }, 500);
  }
});

salla.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-salla-signature");

  if (!verifySallaSignature(rawBody, signature)) {
    console.warn("[salla/webhook] signature_invalid");
    return c.json({ error: "invalid_signature" }, 401);
  }

  let envelope: SallaEventEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SallaEventEnvelope;
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const result = await handleSallaEvent(envelope);
    return c.json({ received: true, ...result });
  } catch (err) {
    console.error("[salla/webhook] handler error", err);
    return c.json({ error: "handler_failed", detail: String(err) }, 500);
  }
});
