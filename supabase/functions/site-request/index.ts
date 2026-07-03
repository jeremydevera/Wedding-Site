import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public prospect intake from the apex /apply wizard. Writes a pending
// site_requests row (service role) for the superadmin to approve. Also serves
// the wizard's live subdomain availability probe (checks live clients AND
// pending requests). verify_jwt is off — this is a public form by design.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set([
  "www", "demo", "admin", "api", "app", "mail", "media", "assets", "static",
  "help", "support", "blog", "docs", "status", "celebrately", "staging", "test",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const subdomain = String(body.subdomain || "").trim().toLowerCase();
  const isFree = async () => {
    const { data: c } = await admin.from("clients").select("id").eq("subdomain", subdomain).maybeSingle();
    if (c) return false;
    const { data: r } = await admin.from("site_requests").select("id").eq("subdomain", subdomain).eq("status", "pending").maybeSingle();
    return !r;
  };

  if (body.action === "check_subdomain") {
    if (!SUB_RE.test(subdomain) || RESERVED.has(subdomain)) return json({ available: false, reason: "invalid" });
    return json({ available: await isFree() });
  }

  // submit
  const email = String(body.email || "").trim().toLowerCase();
  const partnerA = String(body.partnerA || "").trim();
  const partnerB = String(body.partnerB || "").trim();
  const templateKey = String(body.templateKey || "classic").trim();
  const content = (body.content && typeof body.content === "object") ? body.content as Record<string, unknown> : {};

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Please enter a valid email." }, 400);
  if (!partnerA || !partnerB) return json({ error: "Please enter both names." }, 400);
  if (!SUB_RE.test(subdomain)) return json({ error: "Site address must be 3–30 characters: letters, numbers, hyphens." }, 400);
  if (RESERVED.has(subdomain)) return json({ error: "That site address is reserved — try another." }, 400);
  if (!(await isFree())) return json({ error: "That site address is already taken or requested." }, 409);
  if (JSON.stringify(content).length > 60000) return json({ error: "Request too large." }, 400);

  const { data, error } = await admin.from("site_requests")
    .insert({ email, partner_a: partnerA, partner_b: partnerB, subdomain, template_key: templateKey, content })
    .select("id").single();
  if (error || !data) return json({ error: "Could not submit — please try again." }, 400);

  return json({ ok: true, id: data.id });
});
