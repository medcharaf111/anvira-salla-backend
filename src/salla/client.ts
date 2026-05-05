/**
 * Salla OAuth + REST client.
 *
 * Salla docs: https://docs.salla.dev
 * OAuth 2.0 authorization code flow:
 *   1. Merchant visits install URL → Salla → consents → redirects to our callback with `code`
 *   2. We POST `code` to /oauth2/token → receive { access_token, refresh_token, expires_in }
 *   3. We use access_token to call /admin/v2/* endpoints
 *   4. When access_token expires, refresh via refresh_token
 */

const SALLA_OAUTH_BASE = "https://accounts.salla.sa/oauth2";
const SALLA_API_BASE = "https://api.salla.dev/admin/v2";

export interface SallaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface SallaStoreInfo {
  id: number;
  owner_id: number;
  name: string;
  domain: string | null;
  email: string | null;
  plan: string | null;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export function buildInstallUrl(state: string): string {
  const url = new URL(`${SALLA_OAUTH_BASE}/auth`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requireEnv("SALLA_CLIENT_ID"));
  url.searchParams.set("redirect_uri", requireEnv("SALLA_REDIRECT_URI"));
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "offline_access");
  return url.toString();
}

export async function exchangeCode(code: string): Promise<SallaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: requireEnv("SALLA_CLIENT_ID"),
    client_secret: requireEnv("SALLA_CLIENT_SECRET"),
    redirect_uri: requireEnv("SALLA_REDIRECT_URI"),
    scope: "offline_access",
  });
  const res = await fetch(`${SALLA_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salla token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as SallaTokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<SallaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requireEnv("SALLA_CLIENT_ID"),
    client_secret: requireEnv("SALLA_CLIENT_SECRET"),
  });
  const res = await fetch(`${SALLA_OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salla token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as SallaTokenResponse;
}

/**
 * Fetch the merchant's store profile after OAuth. Used to populate
 * the `merchants` row with name + domain + email.
 */
export async function fetchStoreInfo(
  accessToken: string
): Promise<SallaStoreInfo> {
  const res = await fetch(`${SALLA_API_BASE}/store/info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salla store/info failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { data: SallaStoreInfo };
  return json.data;
}
