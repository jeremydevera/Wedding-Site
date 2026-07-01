-- Optional guest email on RSVPs. The admin UI already renders this column
-- (table, detail, CSV, results email); the public form + mappers now collect it.
alter table public.rsvps
  add column if not exists email text;
