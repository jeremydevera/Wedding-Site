-- Strict RSVP gate v2: distinguish "not on the list" from "more than one guest
-- shares this name". Previously a guest omitting their middle name could never
-- match a registry entry that had one (the initial rule needed both sides
-- non-empty), so two "Joseph Celis" entries (L / R) made a middle-less probe
-- fail with "can't find your name". Now:
--   ok        -> exactly one guest matches (allocation returned)
--   ambiguous -> several first+last candidates and the middle doesn't single
--                one out -> the form asks the guest to add their middle name
--   not_found -> no first+last match (or the client hasn't enabled strictRsvp)
-- Matching is tiered: exact/initial middle matches win; an empty middle on
-- either side is a wildcard fallback only when the exact tier finds nothing.
drop function if exists public.rsvp_guest_allocation(uuid,text,text,text);
create function public.rsvp_guest_allocation(p_client_id uuid, p_first text, p_middle text, p_last text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_exact int; v_exact_alloc int; v_wild int; v_wild_alloc int;
begin
  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and coalesce((c.content->>'strictRsvp')::boolean, false)
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  with candidates as (
    select g.allocation, public.norm_name(g.middle_name) as gm
    from public.guests g
    where g.client_id = p_client_id
      and public.norm_name(g.first_name) = public.norm_name(p_first)
      and public.norm_name(g.last_name)  = public.norm_name(p_last)
  ),
  exact as (
    select allocation from candidates
    where gm = public.norm_name(p_middle)
       or (gm <> '' and public.norm_name(p_middle) <> ''
           and left(gm, 1) = left(public.norm_name(p_middle), 1)
           and (length(gm) = 1 or length(public.norm_name(p_middle)) = 1))
  ),
  wild as (
    select allocation from candidates
    where gm = '' or public.norm_name(p_middle) = ''
  )
  select (select count(*) from exact), (select min(allocation) from exact),
         (select count(*) from wild),  (select min(allocation) from wild)
    into v_exact, v_exact_alloc, v_wild, v_wild_alloc;

  if v_exact = 1 then return jsonb_build_object('status', 'ok', 'allocation', v_exact_alloc); end if;
  if v_exact > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  if v_wild = 1 then return jsonb_build_object('status', 'ok', 'allocation', v_wild_alloc); end if;
  if v_wild > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;

revoke all on function public.rsvp_guest_allocation(uuid,text,text,text) from public;
grant execute on function public.rsvp_guest_allocation(uuid,text,text,text) to anon, authenticated;
