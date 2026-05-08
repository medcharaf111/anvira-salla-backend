-- Enable Supabase Realtime for the tables the dashboard subscribes to.
-- Adding a table to the `supabase_realtime` publication broadcasts INSERT/UPDATE/DELETE
-- events to subscribed clients via the Postgres logical replication slot.
--
-- Idempotent: ALTER PUBLICATION ... ADD TABLE errors if the publication doesn't
-- exist (Supabase auto-creates it) or the table is already in it. Wrapping in
-- DO blocks so the migration succeeds on plain Postgres (Railway native) too,
-- where the publication isn't auto-created.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE conversations';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE messages';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE salla_orders';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE abandoned_carts';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE notifications';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE tasks';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Table already in publication — fine, ignore
    NULL;
END
$$;
--> statement-breakpoint
