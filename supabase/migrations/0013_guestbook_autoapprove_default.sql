-- BUG-0002: the admin "Auto-approve guestbook messages" toggle reads
-- DEFAULT_SETTINGS.autoApproveGuestbook = true when a client's content lacks the
-- key, so it renders ON — but the trigger defaulted the same missing key to
-- FALSE, silently holding new clients' messages in the pending queue. Align the
-- server default with what the toggle shows: absent key = auto-approve ON.
create or replace function public.guestbook_set_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare auto boolean;
begin
  select coalesce((content->>'autoApproveGuestbook')::boolean, true) into auto
  from clients where id = new.client_id;
  new.status := case when auto then 'approved' else 'pending' end;
  return new;
end; $$;
revoke execute on function public.guestbook_set_status() from anon, authenticated, public;
