-- Owner-curated status: a guest added to the list counts as ATTENDING by
-- default; an RSVP reply overrides it (yes is redundant and the form informs
-- "already listed"; no flips them to declined). The admin can edit the status
-- per guest. rsvp_guest_allocation additionally returns the matched guest's
-- owner-set status (additive jsonb key — old bundles ignore it).
alter table public.guests
  add column if not exists status text not null default 'attending';

drop function if exists public.rsvp_guest_allocation(uuid,text,text,text);
create function public.rsvp_guest_allocation(p_client_id uuid, p_first text, p_middle text, p_last text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_exact int; v_exact_alloc int; v_exact_status text;
        v_wild int; v_wild_alloc int; v_wild_status text;
begin
  if not exists (
    select 1 from public.clients c
    where c.id = p_client_id and coalesce((c.content->>'strictRsvp')::boolean, false)
  ) then
    return jsonb_build_object('status', 'not_found');
  end if;

  with candidates as (
    select g.allocation, coalesce(g.status, 'attending') as gstatus,
           public.norm_name(g.middle_name) as gm
    from public.guests g
    where g.client_id = p_client_id
      and public.norm_name(g.first_name) = public.norm_name(p_first)
      and public.norm_name(g.last_name)  = public.norm_name(p_last)
  ),
  exact as (
    select allocation, gstatus from candidates
    where gm = public.norm_name(p_middle)
       or (gm <> '' and public.norm_name(p_middle) <> ''
           and left(gm, 1) = left(public.norm_name(p_middle), 1)
           and (length(gm) = 1 or length(public.norm_name(p_middle)) = 1))
  ),
  wild as (
    select allocation, gstatus from candidates
    where gm = '' or public.norm_name(p_middle) = ''
  )
  select (select count(*) from exact), (select min(allocation) from exact), (select min(gstatus) from exact),
         (select count(*) from wild),  (select min(allocation) from wild),  (select min(gstatus) from wild)
    into v_exact, v_exact_alloc, v_exact_status, v_wild, v_wild_alloc, v_wild_status;

  if v_exact = 1 then return jsonb_build_object('status', 'ok', 'allocation', v_exact_alloc, 'guest_status', v_exact_status); end if;
  if v_exact > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  if v_wild = 1 then return jsonb_build_object('status', 'ok', 'allocation', v_wild_alloc, 'guest_status', v_wild_status); end if;
  if v_wild > 1 then return jsonb_build_object('status', 'ambiguous'); end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;

revoke all on function public.rsvp_guest_allocation(uuid,text,text,text) from public;
grant execute on function public.rsvp_guest_allocation(uuid,text,text,text) to anon, authenticated;
