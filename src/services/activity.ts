import { db, schema } from "../db/index.js";

/**
 * Append-only activity log writer.
 * Use from any route that performs a notable action so /activity feed picks it up.
 */
export interface ActivityEntry {
  merchantId: string;
  actorUserId: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  if (!db) return;
  try {
    await db.insert(schema.activityLog).values({
      merchantId: entry.merchantId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetKind: entry.targetKind ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (err) {
    console.warn("[activity] failed to log:", err);
  }
}
