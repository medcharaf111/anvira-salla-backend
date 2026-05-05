import { Hono } from "hono";

/**
 * WhatsApp Cloud API routes.
 *
 * Endpoints:
 *   GET  /whatsapp/webhook   — verification handshake (META subscribes here)
 *   POST /whatsapp/webhook   — incoming messages from Meta Cloud API
 *   POST /whatsapp/send      — outbound message dispatch (called by frontend)
 *
 * STUBBED: real implementation requires WHATSAPP_VERIFY_TOKEN +
 * WHATSAPP_ACCESS_TOKEN per merchant (or shared org-level token).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export const whatsapp = new Hono();

whatsapp.get("/webhook", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

whatsapp.post("/webhook", async (c) => {
  // TODO: parse Meta payload, persist message, trigger AI smart-reply pipeline
  const body = await c.req.json().catch(() => ({}));
  console.log("[whatsapp] inbound", JSON.stringify(body).slice(0, 500));
  return c.json({ received: true });
});

whatsapp.post("/send", async (c) => {
  // TODO: validate sender identity + RBAC, then POST to graph.facebook.com
  const body = await c.req.json().catch(() => ({}));
  console.log("[whatsapp] outbound request", body);
  return c.json({ ok: true, todo: "implement_outbound_send" });
});
