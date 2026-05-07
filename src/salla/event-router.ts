import { recordAbandonedCart } from "../db/repos/abandoned-carts.js";
import { findBySallaStoreId, markUninstalled, upsertBySallaStoreId } from "../db/repos/merchants.js";
import { recordOrder } from "../db/repos/orders.js";
import { fetchStoreInfo } from "./client.js";

/**
 * Salla webhook event payloads share a common envelope:
 *   { event: string, merchant: number, data: {...} }
 *
 * Reference: https://docs.salla.dev/421518m0
 *
 * v1 supported events:
 *   app.installed         → upsert merchant, refresh tokens
 *   app.uninstalled       → soft-delete merchant
 *   order.created         → mirror order for context in inbox
 *   order.payment.updated → update order status
 *   abandoned.cart        → schedule recovery WhatsApp message
 *
 * Unhandled events are logged and acked (200) so Salla doesn't retry forever.
 */

export interface SallaEventEnvelope {
  event: string;
  merchant: number | string;
  data: Record<string, unknown>;
}

export async function handleSallaEvent(
  envelope: SallaEventEnvelope
): Promise<{ handled: boolean; note?: string }> {
  const { event, merchant: sallaStoreIdRaw, data } = envelope;
  const sallaStoreId = String(sallaStoreIdRaw);

  console.log(`[salla-webhook] event=${event} merchant=${sallaStoreId}`);

  switch (event) {
    // app.store.authorize is Salla's Easy Mode event — payload includes tokens
    // app.installed in Custom Mode arrives without tokens (we get them via callback)
    case "app.store.authorize":
    case "app.installed": {
      // Diagnostic: log payload structure (keys only — values may include tokens)
      console.log(
        `[salla-webhook] ${event} data keys:`,
        Object.keys(data),
        "merchant keys:",
        data.merchant ? Object.keys(data.merchant as object) : "(no merchant key)"
      );

      // Tokens may live at data.access_token (Easy Mode) or data.data.access_token
      // (some Salla v2 payloads), or be entirely absent (Custom Mode).
      const dataAny = data as Record<string, unknown>;
      const nested = (dataAny.data ?? {}) as Record<string, unknown>;
      const access =
        (dataAny.access_token as string | undefined) ??
        (nested.access_token as string | undefined);
      const refresh =
        (dataAny.refresh_token as string | undefined) ??
        (nested.refresh_token as string | undefined);
      const expires =
        (dataAny.expires as number | undefined) ??
        (nested.expires as number | undefined);
      const merchantInfo =
        (dataAny.merchant as Record<string, unknown> | undefined) ?? {};

      // Find existing merchant (e.g. created by an earlier app.installed)
      const existing = await findBySallaStoreId(sallaStoreId);

      // If we have an access_token, save it. In Easy Mode the refresh_token is
      // often absent — Salla manages refresh server-side and we just receive
      // updated tokens via subsequent app.store.authorize events.
      if (access) {
        // Initial save with token + whatever merchant info Salla included
        await upsertBySallaStoreId({
          sallaStoreId,
          accessToken: access,
          refreshToken: refresh ?? existing?.refreshToken ?? null,
          tokenExpiresAt: expires
            ? new Date(expires * 1000)
            : existing?.tokenExpiresAt ?? undefined,
          name: String(merchantInfo.name ?? existing?.name ?? `Salla store ${sallaStoreId}`),
          domain:
            typeof merchantInfo.domain === "string"
              ? merchantInfo.domain
              : existing?.domain ?? undefined,
          email:
            typeof merchantInfo.email === "string"
              ? merchantInfo.email
              : existing?.email ?? undefined,
          plan: existing?.plan ?? "starter",
        });

        // Fetch full store info from Salla — populates name/domain/email
        // when the webhook payload didn't include them
        try {
          const storeInfo = await fetchStoreInfo(access);
          await upsertBySallaStoreId({
            sallaStoreId,
            accessToken: access,
            refreshToken: refresh ?? existing?.refreshToken ?? null,
            tokenExpiresAt: expires
              ? new Date(expires * 1000)
              : existing?.tokenExpiresAt ?? undefined,
            name: storeInfo.name,
            domain: storeInfo.domain ?? undefined,
            email: storeInfo.email ?? undefined,
            plan: existing?.plan ?? "starter",
          });
          console.log(`[salla-webhook] enriched merchant from /store/info: ${storeInfo.name}`);
        } catch (err) {
          console.warn("[salla-webhook] /store/info fetch failed (token may be a different scope):", err);
        }

        return { handled: true, note: "upserted_with_access_token" };
      }

      // No tokens at all — fall back to stub merchant from app.installed
      if (!existing) {
        await upsertBySallaStoreId({
          sallaStoreId,
          accessToken: "",
          refreshToken: null,
          tokenExpiresAt: undefined,
          name: String(merchantInfo.name ?? `Salla store ${sallaStoreId}`),
          domain: typeof merchantInfo.domain === "string" ? merchantInfo.domain : undefined,
          email: typeof merchantInfo.email === "string" ? merchantInfo.email : undefined,
          plan: "starter",
        });
        return { handled: true, note: "stub_created_awaiting_tokens" };
      }
      return { handled: true, note: "no_tokens_in_payload_yet" };
    }

    case "app.uninstalled":
    case "app.store.uninstalled": {
      await markUninstalled(sallaStoreId);
      return { handled: true };
    }

    case "order.created":
    case "order.updated": {
      const merchant = await findBySallaStoreId(sallaStoreId);
      if (!merchant) return { handled: false, note: "merchant_not_found" };

      const orderData = data as Record<string, unknown>;
      const sallaOrderId = String(orderData.id ?? "");
      if (!sallaOrderId) return { handled: false, note: "missing_order_id" };

      const customer = (orderData.customer ?? {}) as Record<string, unknown>;
      const totalRaw = (orderData.total ?? {}) as Record<string, unknown>;
      const totalAmount = typeof totalRaw.amount === "number"
        ? Math.round(totalRaw.amount * 100)
        : null;

      await recordOrder({
        merchantId: merchant.id,
        sallaOrderId,
        customerPhone: typeof customer.mobile === "string" ? customer.mobile : undefined,
        status: String(orderData.status ?? "unknown"),
        totalAmount: totalAmount ?? undefined,
        currency: typeof totalRaw.currency === "string" ? totalRaw.currency : "SAR",
        rawPayload: orderData,
      });
      return { handled: true };
    }

    case "abandoned.cart": {
      const merchant = await findBySallaStoreId(sallaStoreId);
      if (!merchant) return { handled: false, note: "merchant_not_found" };

      const cartData = data as Record<string, unknown>;
      const sallaCartId = String(cartData.id ?? "");
      if (!sallaCartId) return { handled: false, note: "missing_cart_id" };

      const customer = (cartData.customer ?? {}) as Record<string, unknown>;
      const totalRaw = (cartData.total ?? {}) as Record<string, unknown>;
      const totalAmount = typeof totalRaw.amount === "number"
        ? Math.round(totalRaw.amount * 100)
        : null;

      await recordAbandonedCart({
        merchantId: merchant.id,
        sallaCartId,
        customerPhone: typeof customer.mobile === "string" ? customer.mobile : undefined,
        totalAmount: totalAmount ?? undefined,
        currency: typeof totalRaw.currency === "string" ? totalRaw.currency : "SAR",
        rawPayload: cartData,
      });
      // TODO: enqueue cart recovery WhatsApp send (next pillar)
      return { handled: true };
    }

    default:
      return { handled: false, note: "unhandled_event" };
  }
}
