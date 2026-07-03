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

alter publication supabase_realtime add table public.rsvps;
alter publication supabase_realtime add table public.guestbook;
alter publication supabase_realtime add table public.quiz_answers;
