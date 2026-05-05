import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

/**
 * Server-side Supabase client.
 *
 * Uses the SERVICE ROLE key — bypasses Row Level Security, can do anything.
 * Never expose this client to a browser; never return its raw responses to
 * unauthenticated users.
 *
 * Drizzle remains the primary data layer (typed queries, migrations).
 * Supabase JS client is here for features Drizzle doesn't cover:
 *   - Realtime broadcast / channel subscriptions
 *   - Storage (file uploads)
 *   - Auth admin operations
 *
 * Returns null if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured,
 * so callers must null-check.
 */
let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  const { url, serviceRoleKey } = config.supabase;
  if (!url || !serviceRoleKey) {
    console.warn(
      "[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — admin client unavailable"
    );
    return null;
  }
  _admin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _admin;
}
