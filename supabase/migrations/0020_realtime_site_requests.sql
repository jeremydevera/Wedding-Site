-- 0020: Realtime for the superadmin console bell — publish site_requests so a
-- new /apply submission pushes to the console without a refresh. Delivery is
-- RLS-gated: only the superadmin's select policy passes, so nobody else can
-- subscribe to the intake queue.
-- Idempotent + table-exists guarded. This file's number (0020) sorts BEFORE
-- 0021_site_requests.sql which actually CREATES the table, so on a fresh rebuild
-- the table may not exist yet here — skip if so; 0023_realtime_backfill.sql runs
-- last and guarantees the add once every table exists. On an existing DB this is
-- a no-op (already published). Neither path errors.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'site_requests')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_requests') then
    alter publication supabase_realtime add table public.site_requests;
  end if;
end $$;
