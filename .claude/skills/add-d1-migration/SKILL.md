---
name: add-d1-migration
description: Add or change the cloudflare-ddns D1 database schema safely (new numbered migration, tests, docs). Use whenever a table, column, index or seeded setting changes.
---

# Add a D1 migration

1. Never edit a migration that is already on `development`. Create the next
   file: `cd server && npx wrangler d1 migrations create ddns <short_name>`
   (or add `migrations/NNNN_<short_name>.sql` by hand, NNNN = next number).
2. Write plain SQLite. D1 rules: no `BEGIN`/`COMMIT` (each migration already
   runs atomically), keep statements `;`-terminated, prefer additive changes
   (new columns need a default or must be nullable). New settings are
   `INSERT INTO settings (key, value) VALUES (...)`.
3. Apply locally: `npm run db:migrate:local`.
4. Tests load every file in `migrations/` in order (see
   `test/health.test.ts`), so `npm test` proves the migration applies. Add a
   test that exercises the new schema through the API where possible.
5. Update the `Env`/row types in `server/src` and mention the schema change in
   the commit message. Deploy applies migrations with
   `wrangler d1 migrations apply ddns --remote` before deploying code, so the
   new code must also work against the new schema immediately.
