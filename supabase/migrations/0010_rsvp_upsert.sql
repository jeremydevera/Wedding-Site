-- Insert-or-update an RSVP by fuzzy name match (same predicate as
-- rsvp_name_taken, migration 0008). Lets an anonymous guest UPDATE their own
-- prior response without RLS read access to the rsvps table. SECURITY DEFINER;
-- callers pass the same client_id + name parts used for the duplicate check.
create or replace function public.rsvp_upsert(
  p_client_id uuid, p_first text, p_middle text, p_last text,
  p_full_name text, p_email text, p_phone text, p_status text, p_count int,
  p_plus_one text, p_diet text, p_diet_notes text, p_song text, p_notes text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select r.id into v_id from public.rsvps r
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
   limit 1;

  if v_id is null then
    insert into public.rsvps
      (client_id, full_name, first_name, middle_name, last_name, email, phone, status, count, plus_one, diet, diet_notes, song, notes)
    values
      (p_client_id, p_full_name, p_first, p_middle, p_last, p_email, p_phone, p_status, p_count, p_plus_one, p_diet, p_diet_notes, p_song, p_notes);
  else
    update public.rsvps set
      full_name = p_full_name, email = p_email, phone = p_phone, status = p_status,
      count = p_count, plus_one = p_plus_one, diet = p_diet, diet_notes = p_diet_notes,
      song = p_song, notes = p_notes
    where id = v_id;
  end if;
end;
$$;

revoke all on function public.rsvp_upsert(uuid,text,text,text,text,text,text,text,int,text,text,text,text,text) from public;
grant execute on function public.rsvp_upsert(uuid,text,text,text,text,text,text,text,int,text,text,text,text,text) to anon, authenticated;
