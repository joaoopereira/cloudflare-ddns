export interface Env {
  DB: D1Database;
  PUBLIC_URL: string;
  /** Cloudflare API token (Zone:Read + DNS:Edit). Set as a Worker secret. */
  CF_API_TOKEN?: string;
}
