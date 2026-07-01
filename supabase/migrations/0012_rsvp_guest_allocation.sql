-- Strict RSVP gate: return the invited guest's seat allocation for a name probe,
-- or null when the name isn't on the list — or when the client hasn't enabled
-- strictRsvp (so the probe is dead unless the feature is on). SECURITY DEFINER
-- because `guests` is owner-only under RLS; reuses the same fuzzy-name predicate
-- as rsvp_name_taken (0008). Returns ONLY a number — the guest list stays private.
create or replace function public.rsvp_guest_allocation(p_client_id uuid, p_first text, p_middle text, p_last text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select g.allocation from public.guests g
  where g.client_id = p_client_id
    and exists (
      select 1 from public.clients c
      where c.id = p_client_id and coalesce((c.content->>'strictRsvp')::boolean, false)
    )
    and public.norm_name(g.first_name) = public.norm_name(p_first)
    and public.norm_name(g.last_name)  = public.norm_name(p_last)
    and (
      public.norm_name(g.middle_name) = public.norm_name(p_middle)
      or (
        public.norm_name(g.middle_name) <> '' and public.norm_name(p_middle) <> ''
        and left(public.norm_name(g.middle_name), 1) = left(public.norm_name(p_middle), 1)
        and (length(public.norm_name(g.middle_name)) = 1 or length(public.norm_name(p_middle)) = 1)
      )
    )
  limit 1
$$;

revoke all on function public.rsvp_guest_allocation(uuid,text,text,text) from public;
grant execute on function public.rsvp_guest_allocation(uuid,text,text,text) to anon, authenticated;
