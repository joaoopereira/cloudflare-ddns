import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Worker serves dist/ as static assets (see server/wrangler.toml).
// In development, run the Worker on :8787 (with ALLOW_INSECURE_ADMIN=true)
// and `npm run dev` here; API calls are proxied to it.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/install.sh": "http://localhost:8787",
      "/install.ps1": "http://localhost:8787",
    },
  },
});
