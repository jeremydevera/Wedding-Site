-- Fuzzy RSVP duplicate detection. Store name parts separately so the check can
-- ignore spacing/punctuation ("De Vera" = "devera") and treat a middle initial
-- as matching the full middle ("P" = "Perez").
alter table public.rsvps
  add column if not exists first_name  text,
  add column if not exists middle_name text,
  add column if not exists last_name   text;

-- Normalize a name part: lowercase, strip everything but letters/digits.
create or replace function public.norm_name(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(btrim(coalesce(t, ''))), '[^a-z0-9]', '', 'g')
$$;

-- Duplicate if same normalized first + last, and the middle matches exactly OR
-- one side is an initial of the other (both non-empty). Returns only a boolean —
-- guests never read the RSVP list (RLS). Granted to anon for the public form.
create or replace function public.rsvp_name_taken(p_client_id uuid, p_first text, p_middle text, p_last text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rsvps r
    where r.client_id = p_client_id
      and public.norm_name(r.first_name) = public.norm_name(p_first)
      and public.norm_name(r.last_name)  = public.norm_name(p_last)
      and (
        public.norm_name(r.middle_name) = public.norm_name(p_middle)
        or (
          public.norm_name(r.middle_name) <> '' and public.norm_name(p_middle) <> ''
          and left(public.norm_name(r.middle_name), 1) = left(public.norm_name(p_middle), 1)
          and (length(public.norm_name(r.middle_name)) = 1 or length(public.norm_name(p_middle)) = 1)
        )
      )
  );
$$;

drop function if exists public.rsvp_name_taken(uuid, text);
revoke all on function public.rsvp_name_taken(uuid, text, text, text) from public;
grant execute on function public.rsvp_name_taken(uuid, text, text, text) to anon, authenticated;
