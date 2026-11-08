import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Run a git command, or return null outside a git checkout. */
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

// The deploy workflow sets APP_VERSION / APP_COMMIT and passes the same
// values to the Worker, so the footer can tell when the bundle is stale.
const appVersion = process.env.APP_VERSION || git("describe --tags --abbrev=0") || "dev";
const appCommit = process.env.APP_COMMIT || git("rev-parse --short HEAD") || "";

// The Worker serves dist/ as static assets (see server/wrangler.toml).
// In development, run the Worker on :8787 (with ALLOW_INSECURE_ADMIN=true)
// and `npm run dev` here; API calls are proxied to it.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/health": "http://localhost:8787",
      "/install.sh": "http://localhost:8787",
      "/install.ps1": "http://localhost:8787",
    },
  },
});
