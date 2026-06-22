// Supabase client. Reads public env vars (VITE_*). The publishable/anon key is
// safe in the browser — Row-Level Security is what protects the data.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn("[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env");
}

export const supabase = createClient(url, key);
