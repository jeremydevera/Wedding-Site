import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authHeader = req.headers.get("Authorization") || "";
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. verify the CALLER is a superadmin (using their JWT)
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: u } = await caller.auth.getUser();
  if (!u?.user) return new Response("Unauthorized", { status: 401 });
  const { data: prof } = await caller.from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "superadmin") return new Response("Forbidden", { status: 403 });

  const admin = createClient(url, service);
  const body = await req.json();
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

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
