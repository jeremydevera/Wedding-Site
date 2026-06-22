-- Populate the demo client's content so the public site loads real data.
-- Run this in the Supabase SQL Editor (runs as the postgres role, bypassing RLS).
update clients set
  template_key = 'classic',
  theme = '{}'::jsonb,
  content = jsonb_build_object(
    'partnerA','Jeremy','partnerB','Irish',
    'weddingDate','2026-09-19T15:00','weddingDateLabel','Saturday, September 19, 2026',
    'tagline','We''re getting married',
    'venueName','Somewhere in Lipa, Batangas','venueAddress','Lipa, Batangas, Philippines',
    'ceremonyTime','3:00 PM','receptionTime','5:30 PM',
    'rsvpDeadline','August 15, 2026','hashtag','#JeremyAndIrish2026',
    'autoApproveGuestbook', true
  )
where subdomain = 'demo';
