import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// SPA build for Cloudflare Pages. Output -> dist/.
export default defineConfig(({ mode }) => {
  // Read env from .env files (local) AND the build environment (Cloudflare Pages
  // exposes dashboard vars as process.env). Accept either the VITE_-prefixed name
  // or the bare SUPABASE_* name, so the build works regardless of how the Pages
  // project names them — the bare names were what actually broke the build.
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const pick = (...keys) => {
    for (const k of keys) {
      const v = process.env[k] != null ? process.env[k] : fileEnv[k];
      if (v) return v;
    }
    return "";
  };
  const SUPABASE_URL = pick("VITE_SUPABASE_URL", "SUPABASE_URL");
  const SUPABASE_ANON_KEY = pick("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");

  return {
    plugins: [react()],
    resolve: {
      // "@/..." resolves from src/ so imports are location-independent
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: { outDir: "dist", sourcemap: false },
    // Inject the resolved values where the client reads them.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
    },
  };
});
