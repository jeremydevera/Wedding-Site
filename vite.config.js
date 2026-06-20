import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// SPA build for Cloudflare Pages. Output -> dist/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    // "@/..." resolves from src/ so imports are location-independent
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: { outDir: "dist", sourcemap: false },
});
