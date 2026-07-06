// Supabase client. Reads public env vars (VITE_*). The publishable/anon key is
// safe in the browser — Row-Level Security is what protects the data.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: createClient(undefined, undefined) throws synchronously at import
// ("supabaseUrl is required."), which would white-screen the whole app instead
// of degrading. Only construct the client when both env vars are present;
// otherwise export null so callers can detect the missing-config state.
if (!url || !key) {
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — the app cannot reach the backend until these are set."
  );
}

export const supabase = url && key ? createClient(url, key) : null;
