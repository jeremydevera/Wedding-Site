# templates/

Reserved for per-event-type **layout templates** — alternate page compositions
(beyond a recolor) that a theme/event type can select.

Today the one bespoke layout (the olive **envelope** hero/invite) lives in
`@/pages/PublicPages.jsx`. When a second distinct layout is added (e.g. a
birthday or corporate cover), extract it here as `templates/<name>/` and select
it from the client's `template`/`theme` record.

See `docs/STRUCTURE.md` → "How to add a new event type".
