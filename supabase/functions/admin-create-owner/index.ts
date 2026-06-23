import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Browser-invoked from the app's own domain → needs CORS + OPTIONS preflight.
// Auth is enforced inside the function (caller must be a superadmin), so this is
// deployed with verify_jwt disabled (otherwise the OPTIONS preflight is rejected).
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. verify the CALLER is a superadmin (using their JWT)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return json({ error: "Unauthorized" }, 401);
  const { data: prof } = await caller.from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "superadmin") return json({ error: "Forbidden" }, 403);

  const admin = createClient(url, service);
  const body = await req.json();

  async function findByEmail(email: string) {
    const { data: list, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    return list.users.find((x) => x.email === email);
  }

  // 2a. change an existing owner's login email
  if (body.action === "update_email") {
    const { old_email, new_email } = body;
    if (!old_email || !new_email) return json({ error: "Bad request" }, 400);
    const existing = await findByEmail(old_email);
    if (!existing) return json({ error: "Owner not found" }, 400);
    const { error } = await admin.auth.admin.updateUserById(existing.id, { email: new_email, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, userId: existing.id });
  }

  // 2b. create the owner, or reset the password of an existing owner
  const { email, password, client_id } = body;
  if (!email || !password || !client_id) return json({ error: "Bad request" }, 400);
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  let userId = created?.user?.id;
  if (error) {
    const existing = await findByEmail(email);
    if (!existing) return json({ error: error.message }, 400);
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password });
  }
  await admin.from("profiles").upsert({ id: userId, role: "owner", client_id });
  return json({ ok: true, userId });
});
