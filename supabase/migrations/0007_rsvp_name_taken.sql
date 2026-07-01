-- Boolean-only duplicate-name check for RSVPs.
-- Guests can't read the rsvps table (RLS), so this SECURITY DEFINER function lets
-- the public RSVP form ask "has this name already RSVP'd?" without ever exposing
-- the guest list — it returns only true/false.
create or replace function public.rsvp_name_taken(p_client_id uuid, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rsvps
    where client_id = p_client_id
      and lower(btrim(full_name)) = lower(btrim(p_name))
  );
$$;

revoke all on function public.rsvp_name_taken(uuid, text) from public;
grant execute on function public.rsvp_name_taken(uuid, text) to anon, authenticated;
