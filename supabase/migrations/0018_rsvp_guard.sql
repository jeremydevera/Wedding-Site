-- Server-side enforcement of the strict-RSVP + deadline rules (previously only
-- enforced in the browser). A BEFORE INSERT/UPDATE trigger guards GUEST (anon)
-- writes to rsvps; admin (authenticated) + service writes bypass it, so owner
-- edits are never blocked. Covers every anon path — the plain insert in
-- postRsvp AND the rsvp_upsert RPC — so a bypass of the form can't skip:
--   (a) the RSVP deadline,
--   (b) guest-list membership (strict mode), and
--   (c) the per-guest seat allotment (strict mode).
create or replace function public.rsvp_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare crec public.clients; dl text; alloc int;
begin
  -- Only guest (anon) writes are guarded. auth.role() reads the JWT role claim,
  -- so it is 'anon' even inside the SECURITY DEFINER rsvp_upsert RPC.
  if coalesce(auth.role(), 'anon') in ('authenticated', 'service_role') then
    return new;
  end if;

  select * into crec from public.clients where id = new.client_id;
  if not found then return new; end if;

  -- (a) Deadline — block once the window has passed. Unparseable value = open.
  dl := crec.content->>'rsvpDeadlineDate';
  if dl is not null and dl <> '' then
    begin
      if (dl)::timestamptz < now() then
        raise exception 'RSVPs are closed for this event' using errcode = '23514';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      null;
    end;
  end if;

  -- (b)+(c) Strict RSVP: the name must be on the guest list and (if attending)
  -- within that guest's allotment. Lax name match (first+last, middle equal /
  -- either-empty / same-initial); prefer an exact middle when duplicates exist.
  if coalesce((crec.content->>'strictRsvp')::boolean, false) then
    select g.allocation into alloc from public.guests g
     where g.client_id = new.client_id
       and public.norm_name(g.first_name) = public.norm_name(new.first_name)
       and public.norm_name(g.last_name)  = public.norm_name(new.last_name)
       and (
         public.norm_name(g.middle_name) = public.norm_name(new.middle_name)
         or public.norm_name(g.middle_name) = ''
         or public.norm_name(new.middle_name) = ''
         or left(public.norm_name(g.middle_name), 1) = left(public.norm_name(new.middle_name), 1)
       )
     order by (public.norm_name(g.middle_name) = public.norm_name(new.middle_name)) desc
     limit 1;
    if not found then
      raise exception 'This name is not on the guest list' using errcode = '23514';
    end if;
    if new.status = 'attending' and coalesce(new.count, 0) > coalesce(alloc, 0) then
      raise exception 'More than the seats allotted for this guest' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.rsvp_guard() from anon, authenticated, public;

drop trigger if exists rsvp_guard_trg on public.rsvps;
create trigger rsvp_guard_trg before insert or update on public.rsvps
  for each row execute function public.rsvp_guard();
