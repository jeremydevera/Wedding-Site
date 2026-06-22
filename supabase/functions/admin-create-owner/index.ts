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

  // 2. create/update the owner with the service role
  const { email, password, client_id } = await req.json();
  if (!email || !password || !client_id) return new Response("Bad request", { status: 400 });
  const admin = createClient(url, service);
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  let userId = created?.user?.id;
  if (error) {
    // user may already exist — find and reset their password instead
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list.users.find((x) => x.email === email);
    if (!existing) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password });
  }
  await admin.from("profiles").upsert({ id: userId, role: "owner", client_id });
  return new Response(JSON.stringify({ ok: true, userId }), { headers: { "Content-Type": "application/json" } });
});
