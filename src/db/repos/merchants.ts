import { eq } from "drizzle-orm";
import { db, schema } from "../index.js";

const { merchants } = schema;

export type Merchant = typeof merchants.$inferSelect;
export type NewMerchant = typeof merchants.$inferInsert;

function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL not configured — db client unavailable");
  }
  return db;
}

export async function findBySallaStoreId(
  sallaStoreId: string
): Promise<Merchant | null> {
  const rows = await requireDb()
    .select()
    .from(merchants)
    .where(eq(merchants.sallaStoreId, sallaStoreId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Upsert a merchant by Salla store id. Used after OAuth exchange and on
 * `app.installed` webhook events. Re-installs reuse the existing row,
 * just refreshing tokens.
 */
export async function upsertBySallaStoreId(
  payload: Omit<NewMerchant, "id" | "installedAt"> & { sallaStoreId: string }
): Promise<Merchant> {
  const existing = await findBySallaStoreId(payload.sallaStoreId);
  if (existing) {
    const [updated] = await requireDb()
      .update(merchants)
      .set({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        tokenExpiresAt: payload.tokenExpiresAt,
        name: payload.name,
        domain: payload.domain,
        email: payload.email,
        plan: payload.plan ?? existing.plan,
        uninstalledAt: null,
      })
      .where(eq(merchants.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await requireDb()
    .insert(merchants)
    .values(payload)
    .returning();
  return created;
}

export async function markUninstalled(sallaStoreId: string): Promise<void> {
  await requireDb()
    .update(merchants)
    .set({ uninstalledAt: new Date() })
    .where(eq(merchants.sallaStoreId, sallaStoreId));
}
