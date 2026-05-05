import { config } from "../config.js";

/**
 * WhatsApp Cloud API client.
 *
 * In MOCK_MODE we don't hit Meta — just log + persist. The persistence
 * happens at the call site (conversations API), this client is only the
 * outbound network layer.
 *
 * In production: POST to https://graph.facebook.com/v21.0/{phone_number_id}/messages
 */

export interface SendOptions {
  to: string;
  body: string;
  /** Optional WhatsApp display-name prefix for per-user identity. */
  agentDisplayName?: string;
}

export interface SendResult {
  ok: boolean;
  messageId: string;
  mock: boolean;
  error?: string;
}

export async function sendWhatsApp(opts: SendOptions): Promise<SendResult> {
  const finalBody = opts.agentDisplayName
    ? `*${opts.agentDisplayName}:*\n${opts.body}`
    : opts.body;

  if (config.mockMode) {
    const mockId = `mock-wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.log(
      `[whatsapp:mock] → ${opts.to} (id=${mockId}): ${finalBody.slice(0, 80)}${finalBody.length > 80 ? "…" : ""}`
    );
    return { ok: true, messageId: mockId, mock: true };
  }

  const { accessToken, phoneNumberId } = config.whatsapp;
  if (!accessToken || !phoneNumberId) {
    return { ok: false, messageId: "", mock: false, error: "missing_credentials" };
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: opts.to,
        type: "text",
        text: { body: finalBody },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, messageId: "", mock: false, error: text };
  }
  const data = (await res.json()) as { messages: Array<{ id: string }> };
  return { ok: true, messageId: data.messages[0].id, mock: false };
}
