import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public self-serve registration: creates the auth user, their client site row,
// and the owner profile in one call (service role). Invoked from the apex
// /register page with no session, so verify_jwt is disabled and CORS is open.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/; // 3-30 chars, no edge hyphens
const RESERVED = new Set([
  "www", "demo", "admin", "api", "app", "mail", "media", "assets", "static",
  "help", "support", "blog", "docs", "status", "celebrately", "staging", "test",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const partnerA = String(body.partnerA || "").trim();
  const partnerB = String(body.partnerB || "").trim();
  const weddingDate = String(body.weddingDate || "").trim(); // "YYYY-MM-DDTHH:mm" or ""
  const subdomain = String(body.subdomain || "").trim().toLowerCase();

  // availability probe from the form's live check
  if (body.action === "check_subdomain") {
    if (!SUB_RE.test(subdomain) || RESERVED.has(subdomain)) return json({ available: false, reason: "invalid" });
    const { data } = await admin.from("clients").select("id").eq("subdomain", subdomain).maybeSingle();
    return json({ available: !data });
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  if (!partnerA || !partnerB) return json({ error: "Please enter both names." }, 400);
  if (!SUB_RE.test(subdomain)) return json({ error: "Site address must be 3–30 characters: letters, numbers, hyphens." }, 400);
  if (RESERVED.has(subdomain)) return json({ error: "That site address is reserved — try another." }, 400);

  const { data: taken } = await admin.from("clients").select("id").eq("subdomain", subdomain).maybeSingle();
  if (taken) return json({ error: "That site address is already taken." }, 409);

  // 1. auth user (confirmed immediately so they can sign in right away)
  const { data: created, error: userErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userErr || !created?.user) {
    const raw = userErr?.message || ""; // keep the backend/auth internals server-side only
    console.error("self-signup: createUser failed", raw);
    const friendly = /already|registered|exists/i.test(raw)
      ? "An account with this email already exists — sign in instead."
      : "Could not create the account.";
    return json({ error: friendly }, 400);
  }
  const userId = created.user.id;

  // 2. client site row, seeded with their names/date; onboarded:false triggers
  //    the setup wizard on their first admin login.
  const label = (() => {
    if (!weddingDate) return undefined;
    const d = new Date(weddingDate);
    return isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  })();
  const content: Record<string, unknown> = {
    partnerA, partnerB,
    hashtag: `#${(partnerA + "And" + partnerB).replace(/[^A-Za-z0-9]/g, "")}`,
    onboarded: false,
  };
  if (weddingDate) content.weddingDate = weddingDate;
  if (label) content.weddingDateLabel = label;

  const { data: client, error: clientErr } = await admin.from("clients")
    .insert({ subdomain, event_type: "wedding", template_key: "classic", owner_email: email, content })
    .select("id").single();
  if (clientErr || !client) {
    await admin.auth.admin.deleteUser(userId); // roll back the orphan user
    const msg = /duplicate|unique/i.test(clientErr?.message || "") ? "That site address is already taken." : "Could not create your site.";
    return json({ error: msg }, 400);
  }

  // 3. owner profile
  const { error: profErr } = await admin.from("profiles").upsert({ id: userId, role: "owner", client_id: client.id });
  if (profErr) {
    await admin.from("clients").delete().eq("id", client.id);
    await admin.auth.admin.deleteUser(userId);
    return json({ error: "Could not finish setup — please try again." }, 400);
  }

  return json({ ok: true, subdomain, clientId: client.id });
});
