-- Make deleting a client clean up its data automatically.
-- Run in the Supabase SQL Editor. Without this, deleting a client that has
-- any RSVPs / guestbook / quiz rows fails with a foreign-key error.

alter table rsvps        drop constraint if exists rsvps_client_id_fkey;
alter table rsvps        add  constraint rsvps_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;

alter table guestbook    drop constraint if exists guestbook_client_id_fkey;
alter table guestbook    add  constraint guestbook_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;

alter table quiz_answers drop constraint if exists quiz_answers_client_id_fkey;
alter table quiz_answers add  constraint quiz_answers_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;

-- Keep the owner's auth account but unlink it when its client is deleted.
alter table profiles     drop constraint if exists profiles_client_id_fkey;
alter table profiles     add  constraint profiles_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;
