-- Owner access + moderation, plus security hardening.
-- Owners (profiles.role='owner', client_id=X) may read/moderate ONLY their own
-- client's submissions. Superadmin manages everything. auth_client() returns the
-- caller's own client_id (null for anyone else), so these are safe for {public}/anon.

-- ---- Owner: read + manage own client's data ------------------------------
drop policy if exists "owner read rsvps" on rsvps;
create policy "owner read rsvps" on rsvps for select to authenticated
  using (client_id = public.auth_client());
drop policy if exists "owner delete rsvps" on rsvps;
create policy "owner delete rsvps" on rsvps for delete to authenticated
  using (client_id = public.auth_client());

drop policy if exists "owner read guestbook" on guestbook;
create policy "owner read guestbook" on guestbook for select to authenticated
  using (client_id = public.auth_client());
drop policy if exists "owner update guestbook" on guestbook;
create policy "owner update guestbook" on guestbook for update to authenticated
  using (client_id = public.auth_client()) with check (client_id = public.auth_client());
drop policy if exists "owner delete guestbook" on guestbook;
create policy "owner delete guestbook" on guestbook for delete to authenticated
  using (client_id = public.auth_client());

drop policy if exists "owner read quiz" on quiz_answers;
create policy "owner read quiz" on quiz_answers for select to authenticated
  using (client_id = public.auth_client());

-- ---- Superadmin: full manage on submissions (replaces the read-only 0004) -
drop policy if exists "superadmin read rsvps" on rsvps;
drop policy if exists "superadmin manage rsvps" on rsvps;
create policy "superadmin manage rsvps" on rsvps for all to authenticated
  using (public.auth_role() = 'superadmin') with check (public.auth_role() = 'superadmin');

drop policy if exists "superadmin read guestbook" on guestbook;
drop policy if exists "superadmin manage guestbook" on guestbook;
create policy "superadmin manage guestbook" on guestbook for all to authenticated
  using (public.auth_role() = 'superadmin') with check (public.auth_role() = 'superadmin');

drop policy if exists "superadmin read quiz" on quiz_answers;
drop policy if exists "superadmin manage quiz" on quiz_answers;
create policy "superadmin manage quiz" on quiz_answers for all to authenticated
  using (public.auth_role() = 'superadmin') with check (public.auth_role() = 'superadmin');

-- ---- Hardening -----------------------------------------------------------
-- handle_new_user is a trigger function, never meant to be called via RPC.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Guestbook status is decided server-side (ignores client input) so a submitter
-- can't post with status='approved' to skip moderation. Honors per-client
-- auto-approve (clients.content.autoApproveGuestbook).
create or replace function public.guestbook_set_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare auto boolean;
begin
  select coalesce((content->>'autoApproveGuestbook')::boolean, false) into auto
  from clients where id = new.client_id;
  new.status := case when auto then 'approved' else 'pending' end;
  return new;
end; $$;
revoke execute on function public.guestbook_set_status() from anon, authenticated, public;
drop trigger if exists guestbook_set_status_trg on guestbook;
create trigger guestbook_set_status_trg before insert on guestbook
  for each row execute function public.guestbook_set_status();
