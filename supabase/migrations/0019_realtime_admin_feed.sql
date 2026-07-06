-- 0019: Realtime feed for the admin notification bell.
-- Publish row changes on the three guest-activity tables so the admin
-- dashboard receives INSERTs over websocket (no refresh). Delivery is still
-- gated per-subscriber by RLS: an owner only receives rows their own select
-- policies allow, so client A never sees client B's activity.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Idempotent: add each table only if it exists and isn't already published, so a
-- re-apply or a fresh rebuild never aborts with "relation is already member of
-- publication" (the tables may already be published via the dashboard toggle).
do $$
declare t text;
begin
  foreach t in array array['rsvps','guestbook','quiz_answers'] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
