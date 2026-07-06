-- 0024_rsvp_middle_initial_guard.sql
-- Strict RSVP: two DIFFERENT full middle names that merely share a first letter
-- (e.g. "Ana" vs "Alma") must NOT match. rsvp_guard's middle clause used
-- left(a,1)=left(b,1) with no length guard, so any same-initial pair matched and
-- the gate wrongly ACCEPTED the RSVP. The client (guests.js middleMatches) and
-- the sibling DB fns (rsvp_upsert / rsvp_guest_allocation / rsvp_name_taken)
-- already guard this with (length=1 on one side); rsvp_guard is the last holdout.
-- Fix = same rule: initial-match only when one side is a single initial.
create or replace function public.rsvp_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare crec public.clients; dl text; alloc int;
begin
  if coalesce(auth.role(), 'anon') in ('authenticated', 'service_role') then
    return new;
  end if;

  select * into crec from public.clients where id = new.client_id;
  if not found then return new; end if;

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

  if coalesce((crec.content->>'strictRsvp')::boolean, false) then
    select g.allocation into alloc from public.guests g
     where g.client_id = new.client_id
       and public.norm_name(g.first_name) = public.norm_name(new.first_name)
       and public.norm_name(g.last_name)  = public.norm_name(new.last_name)
       and (
         public.norm_name(g.middle_name) = public.norm_name(new.middle_name)
         or public.norm_name(g.middle_name) = ''
         or public.norm_name(new.middle_name) = ''
         or (
           (length(public.norm_name(g.middle_name)) = 1 or length(public.norm_name(new.middle_name)) = 1)
           and left(public.norm_name(g.middle_name), 1) = left(public.norm_name(new.middle_name), 1)
         )
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
$function$;

-- audit-3 #11: pin search_path on the pure normalizer (Supabase linter:
-- function_search_path_mutable). It is IMMUTABLE + only uses regexp_replace/lower/
-- btrim, so this is a lint/hardening fix with no behavior change.
alter function public.norm_name(text) set search_path = public;
