import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SPA build for Cloudflare Pages. Output -> dist/.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
