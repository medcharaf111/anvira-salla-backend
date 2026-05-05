/**
 * Centralized config + feature flags for the demo MVP.
 *
 * MOCK_MODE=true short-circuits external API calls (Salla, WhatsApp Cloud API)
 * and persists fake-but-realistic data into the real DB. Gemini AI calls remain
 * REAL even in mock mode (we have a Gemini key; the rest are placeholders for
 * the demo).
 *
 * For production launch, set MOCK_MODE=false and provide real Salla/WhatsApp
 * credentials.
 */

function bool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  mockMode: bool(process.env.MOCK_MODE, true),
  databaseUrl: process.env.DATABASE_URL,

  salla: {
    clientId: process.env.SALLA_CLIENT_ID ?? "",
    clientSecret: process.env.SALLA_CLIENT_SECRET ?? "",
    redirectUri: process.env.SALLA_REDIRECT_URI ?? "",
    webhookSecret: process.env.SALLA_WEBHOOK_SECRET ?? "",
  },

  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  },

  supabase: {
    /** https://<project>.supabase.co — base API URL */
    url: process.env.SUPABASE_URL ?? "",
    /** Public anon key — safe to expose to browser */
    anonKey: process.env.SUPABASE_ANON_KEY ?? "",
    /** Server-side admin key — NEVER expose to browser */
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },
} as const;

export const isMockMode = () => config.mockMode;
