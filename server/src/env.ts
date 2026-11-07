export interface Env {
  DB: D1Database;
  PUBLIC_URL: string;
  /** Cloudflare API token (Zone:Read + DNS:Edit). Set as a Worker secret. */
  CF_API_TOKEN?: string;
  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience (AUD) tag. */
  ACCESS_AUD?: string;
  /** "true" disables Access checks on the admin API. Local development only (.dev.vars). */
  ALLOW_INSECURE_ADMIN?: string;
  /** R2 bucket with client release binaries (<version>/<asset>, latest.txt). */
  RELEASES?: R2Bucket;
  /** Workers rate-limit binding for registrations (per IP). Optional. */
  REGISTER_LIMITER?: RateLimit;
}

export type AppEnv = { Bindings: Env; Variables: { adminEmail?: string } };
