// functions/api/neon-admin.js
// Superadmin console ↔ Neon bridge. The console authenticates with a FIREBASE ID
// token (verified below → Neon superadmin profile); Neon rows are read/written
// via the NEON_DATABASE_URL secret. POST {action, ...params}.
import { neon } from "@neondatabase/serverless";

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

const FB_PROJECT = "wedding-dc35d";

// Decode a JWT payload WITHOUT verifying — cheap enough for issuer routing and
// claim pre-checks. Signature is verified separately (Google, for Firebase).
function jwtPayload(token) {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { return null; }
}

// Firebase-authenticated superadmin. The console now signs in with Firebase
// (Google / email+password), not Supabase. Validate the ID token's claims,
// confirm Google actually signed it (accounts:lookup rejects forged/expired
// tokens — offloads RS256 verification), then require a NEON `profiles`
// superadmin row for that uid. Returns the uid or null.
async function firebaseSuperadmin(env, token) {
  const p = jwtPayload(token);
  if (!p || p.aud !== FB_PROJECT || p.iss !== `https://securetoken.google.com/${FB_PROJECT}`) return null;
  if (!p.exp || p.exp * 1000 < Date.now()) return null;
  const KEY = env.FIREBASE_WEB_API_KEY || "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k";
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }),
  });
  if (!r.ok) return null;
  const uid = (await r.json())?.users?.[0]?.localId;
  if (!uid) return null;
  const sql = neon(env.NEON_DATABASE_URL);
  const rows = await sql`select 1 from profiles where id = ${uid} and role = 'superadmin' limit 1`;
  return rows && rows[0] ? uid : null;
}

async function requireSuperadmin(env, request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  // Firebase console session → validate + require a Neon superadmin profile.
  return await firebaseSuperadmin(env, token).catch(() => null);
}

// Best-effort delete of a Firebase Auth user so a removed client's owner LOGIN
// is fully gone, not just their Neon profile. Uses a scoped service-account key
// (env.FIREBASE_SA_KEY = base64 of the SA JSON; role = firebaseauth.admin). Mints
// a token via the Worker's Web Crypto (RS256 JWT → jwt-bearer exchange), then
// calls accounts:delete. No-op (never throws) if the key is absent or the uid
// isn't a Firebase uid (legacy Neon-Auth owners).
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const FB_WEB_KEY = "AIzaSyC4zUcZH06Te0CQLwn9r3VdAeb3Rcf4K0k"; // public web API key (signUp/oobCode)

// Mint a Google OAuth access token from the platform service-account key
// (env.FIREBASE_SA_KEY = base64 of the SA JSON; role = firebaseauth.admin).
// Returns { token, projectId } or null if the key is absent/invalid.
async function firebaseAdminToken(env) {
  try {
    if (!env.FIREBASE_SA_KEY) return null;
    const sa = JSON.parse(atob(env.FIREBASE_SA_KEY));
    const now = Math.floor(Date.now() / 1000);
    const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const claim = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
    const signingInput = enc({ alg: "RS256", typ: "JWT" }) + "." + enc(claim);
    const pemBody = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
    const jwt = signingInput + "." + b64url(sig);
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
    if (!tr.ok) return null;
    const { access_token } = await tr.json();
    return { token: access_token, projectId: sa.project_id || FB_PROJECT };
  } catch (e) { return null; }
}
async function firebaseDeleteUser(env, uid) {
  try {
    if (!uid) return { purged: false, reason: "no-uid" };
    const admin = await firebaseAdminToken(env);
    if (!admin) return { purged: false, reason: "no-key" };
    const dr = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:delete`, { method: "POST", headers: { authorization: "Bearer " + admin.token, "content-type": "application/json" }, body: JSON.stringify({ localId: uid }) });
    return { purged: dr.ok, reason: dr.ok ? "ok" : "delete-" + dr.status };
  } catch (e) { return { purged: false, reason: String((e && e.message) || e).slice(0, 80) }; }
}
// Resolve a Firebase uid by email (admin lookup). null if not found.
async function firebaseUidByEmail(admin, email) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:lookup`, { method: "POST", headers: { authorization: "Bearer " + admin.token, "content-type": "application/json" }, body: JSON.stringify({ email: [email] }) });
  if (!r.ok) return null;
  const j = await r.json();
  return j.users && j.users[0] ? j.users[0].localId : null;
}

export async function onRequestPost({ request, env }) {
  if (!(await requireSuperadmin(env, request))) return json({ error: "forbidden" }, 403);
  if (!env.NEON_DATABASE_URL) return json({ error: "NEON_DATABASE_URL not configured" }, 500);
  const sql = neon(env.NEON_DATABASE_URL);
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "list_requests":
        return json({ rows: await sql`select id, created_at, status, email, partner_a, partner_b, subdomain, template_key, requested_by from site_requests where status = 'pending' order by created_at desc` });
      case "list_clients":
        return json({ rows: await sql`select id, subdomain, event_type, template_key, is_active, owner_email, status, created_at, content from clients order by created_at desc` });
      case "create_client": {
        const sub = String(body.subdomain || "").trim().toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(sub)) return json({ error: "invalid subdomain" }, 400);
        const [{ subdomain_free: free }] = await sql`select public.subdomain_free(${sub}) as subdomain_free`;
        if (!free) return json({ error: "subdomain already taken" }, 409);
        const [row] = await sql`insert into clients (subdomain, event_type, template_key, owner_email, status, content)
          values (${sub}, ${body.event_type || "wedding"}, ${body.template_key || "classic"}, ${body.owner_email || null}, 'not_paid', ${JSON.stringify(body.content || {})}::jsonb)
          returning id`;
        return json({ ok: true, id: row.id });
      }
      case "approve_request": {
        // Single SECURITY DEFINER fn = one transaction + the same content
        // enrichment register_site uses (names, hashtag, modules, accessV2).
        const [row] = await sql`select public.approve_site_request(${body.id}) as res`;
        const res = row?.res || {};
        if (res.error) return json({ error: res.error }, res.error === "subdomain already taken" ? 409 : 404);
        return json({ ok: true, subdomain: res.subdomain });
      }
      case "reject_request":
        await sql`update site_requests set status = 'rejected' where id = ${body.id}`;
        return json({ ok: true });
      // Console Requests/Approved/Rejected tabs (all statuses, incl. content).
      case "list_all_requests":
        return json({ rows: await sql`select id, created_at, status, email, partner_a, partner_b, subdomain, template_key, content from site_requests order by created_at desc` });
      case "set_request_status":
        if (!body.id || !body.status) return json({ error: "id and status required" }, 400);
        await sql`update site_requests set status = ${body.status} where id = ${body.id}`;
        return json({ ok: true });
      case "update_request": {
        if (!body.id) return json({ error: "id required" }, 400);
        const p = body.patch || {};
        await sql`update site_requests set
          email = coalesce(${p.email ?? null}, email),
          partner_a = coalesce(${p.partner_a ?? null}, partner_a),
          partner_b = coalesce(${p.partner_b ?? null}, partner_b),
          subdomain = coalesce(${p.subdomain ?? null}, subdomain),
          template_key = coalesce(${p.template_key ?? null}, template_key),
          content = coalesce(${p.content ? JSON.stringify(p.content) : null}::jsonb, content)
          where id = ${body.id}`;
        return json({ ok: true });
      }
      case "delete_request":
        if (!body.id) return json({ error: "id required" }, 400);
        await sql`delete from site_requests where id = ${body.id}`;
        return json({ ok: true });
      case "set_status":
        await sql`update clients set status = ${body.status} where id = ${body.id}`;
        return json({ ok: true });
      case "set_template":
        if (!body.id || !body.template_key) return json({ error: "id and template_key required" }, 400);
        await sql`update clients set template_key = ${body.template_key} where id = ${body.id}`;
        return json({ ok: true });
      case "set_event_type":
        if (!body.id || !body.event_type) return json({ error: "id and event_type required" }, 400);
        await sql`update clients set event_type = ${body.event_type}, template_key = coalesce(${body.template_key || null}, template_key) where id = ${body.id}`;
        return json({ ok: true });
      case "set_active":
        await sql`update clients set is_active = ${body.active === true} where id = ${body.id}`;
        return json({ ok: true });
      case "toggle_donate": {
        const [c] = await sql`select content from clients where id = ${body.id}`;
        if (!c) return json({ error: "client not found" }, 404);
        const hidden = !(c.content && c.content.hideDonateAd === true);
        await sql`update clients set content = content || ${JSON.stringify({ hideDonateAd: hidden })}::jsonb where id = ${body.id}`;
        return json({ ok: true, hidden });
      }
      // Permanently remove a Neon client site: unlink/remove owner profiles first
      // (profiles.client_id references the client), then the client row. Guest
      // rows (rsvps/guestbook/quiz) cascade via their client_id FKs where defined;
      // delete explicitly to be safe. Removing the owner PROFILE is what frees
      // the account to register again (register_site keys off the profile, not
      // the identity provider) — so a Google owner can sign up fresh afterward
      // WITHOUT their Firebase record being purged. We return owner_uid so the
      // caller can additionally delete the Firebase identity when configured.
      case "delete_client": {
        if (!body.id) return json({ error: "id required" }, 400);
        const [own] = await sql`select id from profiles where client_id = ${body.id} and role = 'owner'`;
        const ownerUid = own?.id || null;
        await sql`delete from rsvps where client_id = ${body.id}`;
        await sql`delete from guestbook where client_id = ${body.id}`;
        await sql`delete from quiz_answers where client_id = ${body.id}`;
        await sql`delete from guests where client_id = ${body.id}`.catch(() => {});
        await sql`delete from profiles where client_id = ${body.id} and role = 'owner'`;
        // Legacy Neon-Auth owners also had a neon_auth.user row (Firebase owners
        // don't) — drop it so the email is free to register again on that path.
        if (ownerUid) await sql`delete from neon_auth."user" where id = ${String(ownerUid)}::uuid`.catch(() => {});
        // Also purge the owner's Firebase login (best-effort) so a deleted client
        // can't still reset/sign in — closes the "deleted client's email still
        // exists in Firebase" gap. No-op if FIREBASE_SA_KEY isn't configured.
        const fb = await firebaseDeleteUser(env, ownerUid);
        const del = await sql`delete from clients where id = ${body.id} returning subdomain`;
        return json({ ok: true, deleted: del[0]?.subdomain || null, owner_uid: ownerUid, firebase_purged: fb.purged });
      }
      // ── Superadmin owner-lifecycle (Firebase Admin) ──────────────────────
      case "create_owner": {
        // Create the owner login (or reset an existing owner's password) and link
        // a Neon 'owner' profile to the client. Uses the platform SA key.
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) return json({ error: "email and password required" }, 400);
        const admin = await firebaseAdminToken(env);
        if (!admin) return json({ error: "owner management isn't configured (no Firebase key)" }, 500);
        let uid = await firebaseUidByEmail(admin, email);
        if (uid) {
          const ur = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:update`, { method: "POST", headers: { authorization: "Bearer " + admin.token, "content-type": "application/json" }, body: JSON.stringify({ localId: uid, password }) });
          if (!ur.ok) return json({ error: "couldn't set the password" }, 502);
        } else {
          const sr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_WEB_API_KEY || FB_WEB_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: false }) });
          const sj = await sr.json();
          if (!sj.localId) return json({ error: sj.error?.message || "couldn't create the owner login" }, 502);
          uid = sj.localId;
        }
        if (body.client_id) {
          await sql`insert into profiles (id, role, client_id) values (${uid}, 'owner', ${body.client_id})
            on conflict (id) do update set role = 'owner', client_id = ${body.client_id}`;
          await sql`update clients set owner_email = ${email} where id = ${body.client_id}`.catch(() => {});
        }
        return json({ ok: true, uid });
      }
      case "update_owner_email": {
        const oldEmail = String(body.old_email || "").trim().toLowerCase();
        const newEmail = String(body.new_email || "").trim().toLowerCase();
        if (!oldEmail || !newEmail) return json({ error: "old_email and new_email required" }, 400);
        const admin = await firebaseAdminToken(env);
        if (!admin) return json({ error: "owner management isn't configured (no Firebase key)" }, 500);
        const uid = await firebaseUidByEmail(admin, oldEmail);
        if (!uid) return json({ error: "no account for that email" }, 404);
        const ur = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${admin.projectId}/accounts:update`, { method: "POST", headers: { authorization: "Bearer " + admin.token, "content-type": "application/json" }, body: JSON.stringify({ localId: uid, email: newEmail }) });
        if (!ur.ok) return json({ error: "couldn't update the email" }, 502);
        await sql`update clients set owner_email = ${newEmail} where owner_email = ${oldEmail}`.catch(() => {});
        return json({ ok: true, uid });
      }
      case "delete_owner_account": {
        let uid = body.user_id || null;
        if (!uid && body.client_id) { const [own] = await sql`select id from profiles where client_id = ${body.client_id} and role = 'owner'`; uid = own?.id || null; }
        if (!uid && body.email) { const admin = await firebaseAdminToken(env); if (admin) uid = await firebaseUidByEmail(admin, String(body.email).trim().toLowerCase()); }
        if (!uid) return json({ error: "couldn't resolve the owner" }, 404);
        const fb = await firebaseDeleteUser(env, uid);
        await sql`delete from profiles where id = ${uid}`.catch(() => {});
        return json({ ok: true, uid, firebase_purged: fb.purged });
      }
      case "send_setup_email": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "email required" }, 400);
        const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${env.FIREBASE_WEB_API_KEY || FB_WEB_KEY}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestType: "PASSWORD_RESET", email }) });
        if (!r.ok) { const e = await r.json().catch(() => ({})); return json({ error: e.error?.message || "couldn't send the email" }, 502); }
        return json({ ok: true });
      }
      // ── Support tickets (Neon clients) ────────────────────────────────────
      // The superadmin console runs on the apex with a SUPABASE session, so it
      // can't hit Neon's Data API as a Neon superadmin — these bridge actions
      // give it the same ticket operations it has on Supabase. Owners talk to
      // Neon directly (RLS-scoped) from their own subdomain; see api.js.
      case "list_tickets": {
        const rows = await sql`select t.*, c.subdomain from support_tickets t
          left join clients c on c.id = t.client_id order by t.created_at desc limit 500`;
        return json({ ok: true, rows });
      }
      case "set_ticket_status": {
        if (!body.id || !body.status) return json({ error: "id and status required" }, 400);
        await sql`update support_tickets set status = ${body.status},
          resolved_at = ${body.status === "resolved" ? new Date().toISOString() : null},
          updated_at = now() where id = ${body.id}`;
        return json({ ok: true });
      }
      case "update_ticket": {
        if (!body.id) return json({ error: "id required" }, 400);
        // Only the fields the console edits; unknown keys are ignored on purpose.
        await sql`update support_tickets set
          admin_note = coalesce(${body.patch?.admin_note ?? null}, admin_note),
          status = coalesce(${body.patch?.status ?? null}, status),
          updated_at = now() where id = ${body.id}`;
        return json({ ok: true });
      }
      case "delete_ticket": {
        if (!body.id) return json({ error: "id required" }, 400);
        await sql`delete from support_ticket_messages where ticket_id = ${body.id}`;
        await sql`delete from support_tickets where id = ${body.id}`;
        return json({ ok: true });
      }
      case "list_ticket_messages": {
        if (!body.ticket_id) return json({ error: "ticket_id required" }, 400);
        const rows = await sql`select * from support_ticket_messages
          where ticket_id = ${body.ticket_id} order by created_at asc`;
        return json({ ok: true, rows });
      }
      case "post_ticket_message": {
        if (!body.ticket_id || !String(body.body || "").trim()) return json({ error: "ticket_id and body required" }, 400);
        // Superadmin replies only — the owner posts directly via Neon RLS.
        await sql`insert into support_ticket_messages (ticket_id, sender_role, sender_name, body, attachment_url)
          values (${body.ticket_id}, 'superadmin', ${body.sender_name || "Support"}, ${String(body.body).trim()}, ${body.attachment_url || null})`;
        return json({ ok: true });
      }
      case "list_recent_client_replies": {
        const lim = Math.min(Number(body.limit) || 20, 100);
        const rows = await sql`select m.*, t.subject from support_ticket_messages m
          join support_tickets t on t.id = m.ticket_id
          where m.sender_role = 'owner' order by m.created_at desc limit ${lim}`;
        return json({ ok: true, rows });
      }
      // Full row incl. content for the console Edit modal (list_clients trims it).
      case "get_client": {
        if (!body.id) return json({ error: "id required" }, 400);
        const [row] = await sql`select id, subdomain, event_type, template_key, is_active, owner_email, status, content from clients where id = ${body.id}`;
        if (!row) return json({ error: "client not found" }, 404);
        return json({ ok: true, client: row });
      }
      // Edit → Design tab: identity fields (subdomain / owner email / status) +
      // a merged content patch (couple names, theme, date, venue, schedule…).
      case "update_client_identity": {
        if (!body.id) return json({ error: "id required" }, 400);
        const sub = String(body.subdomain || "").trim().toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(sub)) return json({ error: "invalid subdomain" }, 400);
        const [cur] = await sql`select subdomain, content from clients where id = ${body.id}`;
        if (!cur) return json({ error: "client not found" }, 404);
        // Only validate availability on an ACTUAL rename (keeping the same name
        // must never trip the "taken" guard). subdomain_free rejects reserved
        // names (demo/www/…) + other Neon clients + pending requests; a separate
        // Supabase lookup catches names already used by an existing Supabase
        // client (different database — subdomain_free can't see those).
        if (sub !== cur.subdomain) {
          // subdomain_free covers reserved names + Neon clients + pending requests
          // (all clients live in Neon now — no separate Supabase check needed).
          const [{ subdomain_free: free }] = await sql`select public.subdomain_free(${sub}) as subdomain_free`;
          if (!free) return json({ error: "subdomain already taken" }, 409);
        }
        const merged = { ...(cur.content || {}), ...(body.content || {}) };
        await sql`update clients set subdomain = ${sub},
          template_key = coalesce(${body.template_key || null}, template_key),
          owner_email = ${body.owner_email ?? null},
          status = coalesce(${body.status || null}, status),
          content = ${JSON.stringify(merged)}::jsonb where id = ${body.id}`;
        return json({ ok: true });
      }
      // Edit → Access tab: merge the feature/access keys into content + status.
      case "update_client_access": {
        if (!body.id) return json({ error: "id required" }, 400);
        const [cur] = await sql`select content from clients where id = ${body.id}`;
        if (!cur) return json({ error: "client not found" }, 404);
        const merged = { ...(cur.content || {}), ...(body.content || {}) };
        await sql`update clients set content = ${JSON.stringify(merged)}::jsonb,
          status = coalesce(${body.status || null}, status) where id = ${body.id}`;
        return json({ ok: true });
      }
      // Registered accounts that never finished the wizard: no client, no pending
      // request. Surfaced in the console so signups aren't invisible.
      case "list_signups": {
        // neon_auth."user".id is UUID; profiles.id / site_requests.requested_by
        // are TEXT (Better Auth ids) — cast for the joins or Postgres errors
        // with "operator does not exist: text = uuid".
        const rows = await sql`select u.id, u.email, u.name, u."createdAt" as created_at
          from neon_auth."user" u
          left join profiles p on p.id = u.id::text
          left join site_requests r on r.requested_by = u.id::text and r.status = 'pending'
          where (p.id is null or (p.client_id is null and p.role <> 'superadmin')) and r.id is null
          order by u."createdAt" desc`;
        return json({ rows });
      }
      // Remove an unfinished signup's auth account (never one with a client or
      // the superadmin).
      case "delete_signup": {
        if (!body.user_id) return json({ error: "user_id required" }, 400);
        const [p] = await sql`select role, client_id from profiles where id = ${String(body.user_id)}`;
        if (p && (p.role === "superadmin" || p.client_id)) return json({ error: "refusing: account has a site or is the admin" }, 400);
        await sql`delete from profiles where id = ${String(body.user_id)}`.catch(() => {});
        await sql`delete from neon_auth."user" where id = ${String(body.user_id)}::uuid`;
        return json({ ok: true });
      }
      case "set_config":
        await sql`insert into app_config (key, value) values (${body.key}, ${JSON.stringify(body.value)}::jsonb)
          on conflict (key) do update set value = excluded.value, updated_at = now()`;
        return json({ ok: true });
      // Console overview (SuperOverview): platform-wide counts + recent clients.
      case "overview_stats": {
        const [c] = await sql`select
          (select count(*) from clients)::int as clients,
          (select count(*) from clients where is_active)::int as active,
          (select count(*) from clients where owner_email is not null and owner_email <> '')::int as logins,
          (select count(*) from rsvps)::int as rsvps,
          (select count(*) from guestbook)::int as guestbook,
          (select count(*) from quiz_answers)::int as quiz`;
        const byType = await sql`select event_type, count(*)::int as n from clients group by event_type`;
        const recent = await sql`select id, subdomain, event_type, is_active, owner_email, created_at from clients order by created_at desc limit 6`;
        return json({ ok: true, stats: c, byType, recent });
      }
      // Superadmin private per-client notes (migrated off Supabase).
      case "list_client_notes":
        return json({ rows: await sql`select client_id, note from client_notes` });
      case "set_client_note":
        if (!body.client_id) return json({ error: "client_id required" }, 400);
        if (body.note && String(body.note).trim()) {
          await sql`insert into client_notes (client_id, note, updated_at) values (${body.client_id}, ${body.note}, now())
            on conflict (client_id) do update set note = excluded.note, updated_at = now()`;
        } else {
          await sql`delete from client_notes where client_id = ${body.client_id}`;
        }
        return json({ ok: true });
      // One-time per shard: link the (already signed-up) Neon Auth account for
      // `email` to a superadmin profile row, so the platform owner can sign in
      // to ANY Neon client's /admin with the same credentials (plan: "superadmin
      // will need an account per shard"). Returns RLS diagnostics so we can
      // verify the ported superadmin policies actually cover admin writes.
      // Read-only: current definition of register_site (fixed identifier — used to
      // build the superadmin-demote guard patch against the LIVE body, not the
      // stale plan-doc copy).
      case "inspect_register_site": {
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, def: r?.def || null });
      }
      // Read-only: live subdomain_free definition (same always-inspect-live rule).
      case "inspect_subdomain_free": {
        const [r] = await sql`select pg_get_functiondef('public.subdomain_free(text)'::regprocedure) as def`;
        return json({ ok: true, def: r?.def || null });
      }
      // Idempotent hardening batch (fixed statements):
      //  1. clients column grants — ANONYMOUS loses owner_email (guests could
      //     harvest client login emails via the public Data API). The explicit
      //     column list matches NEON_CLIENT_COLS in src/lib/api.js.
      //  2. reserved_subdomains TABLE seeded from the canonical union
      //     (src/config/site.js RESERVED_SUBDOMAINS) + subdomain_free reads the
      //     table — reserving a name becomes a data write, not three code edits.
      case "harden_minors": {
        await sql`revoke select on public.clients from anonymous`;
        await sql`grant select (id, subdomain, event_type, template_key, theme, content, is_active, created_at, status) on public.clients to anonymous`;
        await sql`create table if not exists public.reserved_subdomains (name text primary key)`;
        await sql`insert into public.reserved_subdomains (name) values
          ('www'),('app'),('admin'),('api'),('demo'),('mail'),('media'),('static'),('assets'),('cdn'),
          ('help'),('support'),('blog'),('docs'),('status'),('celebrately'),('staging'),('test'),
          ('sandbox'),('register'),('apply')
          on conflict (name) do nothing`;
        await sql`CREATE OR REPLACE FUNCTION public.subdomain_free(p_sub text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare s text := lower(btrim(coalesce(p_sub,''))); begin if s !~ '^[a-z0-9](?:[a-z0-9-]{1,61})?[a-z0-9]$' then return false; end if; if exists (select 1 from public.reserved_subdomains r where r.name = s) then return false; end if; if exists (select 1 from public.clients c where lower(c.subdomain) = s) then return false; end if; if exists (select 1 from public.site_requests r where lower(r.subdomain) = s and r.status = 'pending') then return false; end if; return true; end $function$`;
        const [chk] = await sql`select
          (select count(*) from public.reserved_subdomains) as reserved_count,
          has_column_privilege('anonymous','public.clients','owner_email','select') as anon_sees_owner_email,
          has_column_privilege('anonymous','public.clients','content','select') as anon_sees_content`;
        return json({ ok: true, ...chk });
      }
      // Fixed DDL patch (idempotent): register_site refuses a SUPERADMIN caller —
      // its on-conflict profile upsert would demote the platform admin to 'owner'.
      // Body = the LIVE definition (fetched via inspect_register_site) + the guard;
      // everything else byte-identical (_enrich_site_content path preserved).
      case "apply_register_site_guard": {
        await sql`CREATE OR REPLACE FUNCTION public.register_site(p_subdomain text, p_event_type text, p_template_key text, p_email text, p_partner_a text, p_partner_b text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid text; v_sub text := lower(btrim(coalesce(p_subdomain,''))); v_auto boolean; v_client uuid; v_etype text := case when coalesce(nullif(p_event_type,''),'wedding') = 'birthday' then 'birthday' else 'wedding' end; begin begin v_uid := auth.user_id(); exception when others then v_uid := null; end; if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'superadmin') then raise exception 'platform admin account cannot register a client site' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.client_id is not null) or exists (select 1 from public.site_requests r where r.requested_by = v_uid and r.status = 'pending') then raise exception 'you already have a site or a pending request' using errcode = '23505'; end if; if not public.subdomain_free(v_sub) then raise exception 'that site address is taken or not allowed' using errcode = '23505'; end if; if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 200000 then raise exception 'content too large' using errcode = '22001'; end if; select coalesce((value->>'enabled')::boolean, false) into v_auto from public.app_config where key = 'auto_approve_requests'; if coalesce(v_auto, false) then insert into public.clients (subdomain, event_type, template_key, content, is_active, owner_email, status) values (v_sub, v_etype, coalesce(nullif(p_template_key,''),'classic'), public._enrich_site_content(p_content, p_event_type, p_partner_a, p_partner_b), true, nullif(btrim(coalesce(p_email,'')),''), 'not_paid') returning id into v_client; insert into public.profiles (id, role, client_id) values (v_uid, 'owner', v_client) on conflict (id) do update set role = 'owner', client_id = excluded.client_id; return jsonb_build_object('result','created','subdomain',v_sub); else insert into public.site_requests (status, email, partner_a, partner_b, subdomain, template_key, content, requested_by) values ('pending', coalesce(nullif(btrim(p_email),''),'unknown@unknown'), coalesce(p_partner_a,''), coalesce(p_partner_b,''), v_sub, coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), v_uid); return jsonb_build_object('result','pending','subdomain',v_sub); end if; end $function$`;
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, guarded: /superadmin/.test(r?.def || "") });
      }
      // Fixed DDL patch (idempotent): register_site with BOTH the superadmin
      // guard AND an hourly registration cap — new clients + new pending
      // requests in the last hour must stay under app_config
      // ('registration_limits').perHour (default 5). Blunt global throttle: a
      // bot burst can't mass-create sites even with valid CAPTCHA tokens; legit
      // volume never comes close. Body pinned from the LIVE guarded definition.
      case "apply_register_rate_limit": {
        await sql`CREATE OR REPLACE FUNCTION public.register_site(p_subdomain text, p_event_type text, p_template_key text, p_email text, p_partner_a text, p_partner_b text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid text; v_sub text := lower(btrim(coalesce(p_subdomain,''))); v_auto boolean; v_client uuid; v_cap int; v_etype text := case when coalesce(nullif(p_event_type,''),'wedding') = 'birthday' then 'birthday' else 'wedding' end; begin begin v_uid := auth.user_id(); exception when others then v_uid := null; end; if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'superadmin') then raise exception 'platform admin account cannot register a client site' using errcode = '42501'; end if; select coalesce((select (value->>'perHour')::int from public.app_config where key = 'registration_limits'), 5) into v_cap; if v_cap >= 0 and ((select count(*) from public.clients c where c.created_at > now() - interval '1 hour') + (select count(*) from public.site_requests r where r.created_at > now() - interval '1 hour')) >= v_cap then raise exception 'registration is busy right now — please try again shortly' using errcode = '53400'; end if; if exists (select 1 from public.profiles p where p.id = v_uid and p.client_id is not null) or exists (select 1 from public.site_requests r where r.requested_by = v_uid and r.status = 'pending') then raise exception 'you already have a site or a pending request' using errcode = '23505'; end if; if not public.subdomain_free(v_sub) then raise exception 'that site address is taken or not allowed' using errcode = '23505'; end if; if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 200000 then raise exception 'content too large' using errcode = '22001'; end if; select coalesce((value->>'enabled')::boolean, false) into v_auto from public.app_config where key = 'auto_approve_requests'; if coalesce(v_auto, false) then insert into public.clients (subdomain, event_type, template_key, content, is_active, owner_email, status) values (v_sub, v_etype, coalesce(nullif(p_template_key,''),'classic'), public._enrich_site_content(p_content, p_event_type, p_partner_a, p_partner_b), true, nullif(btrim(coalesce(p_email,'')),''), 'not_paid') returning id into v_client; insert into public.profiles (id, role, client_id) values (v_uid, 'owner', v_client) on conflict (id) do update set role = 'owner', client_id = excluded.client_id; return jsonb_build_object('result','created','subdomain',v_sub); else insert into public.site_requests (status, email, partner_a, partner_b, subdomain, template_key, content, requested_by) values ('pending', coalesce(nullif(btrim(p_email),''),'unknown@unknown'), coalesce(p_partner_a,''), coalesce(p_partner_b,''), v_sub, coalesce(nullif(p_template_key,''),'classic'), coalesce(p_content,'{}'::jsonb), v_uid); return jsonb_build_object('result','pending','subdomain',v_sub); end if; end $function$`;
        const [r] = await sql`select pg_get_functiondef('public.register_site(text,text,text,text,text,text,jsonb)'::regprocedure) as def`;
        return json({ ok: true, hasGuard: /superadmin/.test(r?.def || ""), hasCap: /registration_limits/.test(r?.def || "") });
      }
      case "ensure_superadmin": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "email required" }, 400);
        let u;
        try { [u] = await sql`select id, email from neon_auth.users where lower(email) = ${email} limit 1`; }
        catch { [u] = await sql`select id, email from neon_auth."user" where lower(email) = ${email} limit 1`; } // Better Auth names it "user" on some versions
        if (!u) return json({ error: "no Neon Auth account with that email on this shard — sign up first" }, 404);
        await sql`insert into profiles (id, role, client_id) values (${u.id}, 'superadmin', null)
          on conflict (id) do update set role = 'superadmin'`;
        const policies = await sql`select tablename, policyname, cmd from pg_policies
          where schemaname = 'public' and tablename in ('clients','rsvps','guestbook','guests','profiles','quiz_answers') order by tablename, policyname`;
        return json({ ok: true, userId: u.id, policies });
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: e.message || "neon error" }, 500);
  }
}
