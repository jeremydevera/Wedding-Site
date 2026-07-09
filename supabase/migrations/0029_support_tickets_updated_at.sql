-- 0029: updated_at drives the owner's "New reply from support" bell/badge — it
-- must bump whenever the superadmin flips status (esp. -> waiting_reply) and
-- whenever the reopen trigger fires. Backfill from created_at.
alter table public.support_tickets add column if not exists updated_at timestamptz not null default now();
update public.support_tickets set updated_at = greatest(created_at, coalesce(resolved_at, created_at)) where updated_at is null;

create or replace function public.support_reopen_on_owner_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sender_role = 'owner' then
    update public.support_tickets
      set status = 'open', resolved_at = null, updated_at = now()
      where id = new.ticket_id and status <> 'open';
  end if;
  return new;
end $function$;
