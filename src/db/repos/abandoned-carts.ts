import { db, schema } from "../index.js";

const { abandonedCarts } = schema;

export type AbandonedCart = typeof abandonedCarts.$inferSelect;
export type NewAbandonedCart = typeof abandonedCarts.$inferInsert;

function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL not configured — db client unavailable");
  }
  return db;
}

export async function recordAbandonedCart(
  payload: NewAbandonedCart
): Promise<AbandonedCart> {
  const [row] = await requireDb()
    .insert(abandonedCarts)
    .values(payload)
    .returning();
  return row;
}
