import { recordAbandonedCart } from "../db/repos/abandoned-carts.js";
import { findBySallaStoreId, markUninstalled, upsertBySallaStoreId } from "../db/repos/merchants.js";
import { recordOrder } from "../db/repos/orders.js";

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
    // app.store.authorize is Salla's Easy Mode event — same payload shape as app.installed
    case "app.store.authorize":
    case "app.installed": {
      // App.installed payload includes access_token, refresh_token,
      // expires, merchant store info (name, domain, email).
      // See https://docs.salla.dev/doc-421517 for shape.
      const access = (data as { access_token?: string }).access_token;
      const refresh = (data as { refresh_token?: string }).refresh_token;
      const expires = (data as { expires?: number }).expires;
      const merchantInfo = (data as { merchant?: Record<string, unknown> }).merchant ?? {};

      if (!access || !refresh) {
        return { handled: false, note: "missing_tokens_in_payload" };
      }
      await upsertBySallaStoreId({
        sallaStoreId,
        accessToken: access,
        refreshToken: refresh,
        tokenExpiresAt: expires ? new Date(expires * 1000) : undefined,
        name: String(merchantInfo.name ?? `Salla store ${sallaStoreId}`),
        domain: typeof merchantInfo.domain === "string" ? merchantInfo.domain : undefined,
        email: typeof merchantInfo.email === "string" ? merchantInfo.email : undefined,
        plan: "starter",
      });
      return { handled: true };
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
