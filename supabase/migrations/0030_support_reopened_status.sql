-- 0030: distinct "reopened" status. A client reply on a RESOLVED or
-- WAITING_REPLY ticket flips it to 'reopened' (its own console tab) instead of
-- folding back into 'open' — Open is reserved for NEW tickets from clients.
-- A client reply on an open/reopened ticket leaves the status alone.
create or replace function public.support_reopen_on_owner_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sender_role = 'owner' then
    update public.support_tickets
      set status = 'reopened', resolved_at = null, updated_at = now()
      where id = new.ticket_id and status in ('resolved', 'waiting_reply');
  end if;
  return new;
end $function$;
