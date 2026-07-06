-- 0023_realtime_backfill.sql — audit fix #43 (idempotent realtime) + neutralizes
-- the #27 ordering hazard.
--
-- Background: the realtime publication adds were spread across 0019 and
-- 0020_realtime_site_requests.sql. The site_requests add (0020) sorts BEFORE the
-- table is created (0021_site_requests.sql), so a fresh rebuild errored, and a
-- re-apply errored with "already a member". Those two files are now idempotent
-- and guarded; this final migration is the authoritative, order-independent
-- guarantee: after every table exists, ensure all four guest/admin-feed tables
-- are published exactly once. Fully idempotent — a no-op on the live DB.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['rsvps','guestbook','quiz_answers','site_requests'] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
