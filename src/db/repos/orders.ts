import { db, schema } from "../index.js";

const { sallaOrders } = schema;

export type SallaOrder = typeof sallaOrders.$inferSelect;
export type NewSallaOrder = typeof sallaOrders.$inferInsert;

function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL not configured — db client unavailable");
  }
  return db;
}

export async function recordOrder(payload: NewSallaOrder): Promise<SallaOrder> {
  const [row] = await requireDb()
    .insert(sallaOrders)
    .values(payload)
    .returning();
  return row;
}
