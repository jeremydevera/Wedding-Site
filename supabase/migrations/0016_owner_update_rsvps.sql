-- Owners could read + delete their client's RSVPs (0005) but not UPDATE them.
-- The admin "remove companion" action edits the reply's companions/count, so
-- grant scoped update (same auth_client() pattern as the other owner policies).
drop policy if exists "owner update rsvps" on public.rsvps;
create policy "owner update rsvps" on public.rsvps for update to authenticated
  using (client_id = public.auth_client()) with check (client_id = public.auth_client());
