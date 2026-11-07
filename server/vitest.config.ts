import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirror wrangler's Text module rule for the installer scripts.
export default defineConfig({
  plugins: [
    {
      name: "text-modules",
      load(id) {
        if (id.endsWith(".sh") || id.endsWith(".ps1")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }
      },
    },
  ],
});
