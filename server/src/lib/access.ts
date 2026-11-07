import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

interface Jwk extends JsonWebKey {
  kid: string;
}

let cachedKeys: { domain: string; keys: Jwk[]; fetchedAt: number } | null = null;

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  if (cachedKeys && cachedKeys.domain === teamDomain && Date.now() - cachedKeys.fetchedAt < 3600_000) {
    return cachedKeys.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`failed to fetch Access certs: HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  cachedKeys = { domain: teamDomain, keys, fetchedAt: Date.now() };
  return keys;
}

function b64urlDecode(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Verify a Cloudflare Access JWT (RS256). Returns its payload, or null if invalid. */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string; [k: string]: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  const jwk = (await getKeys(teamDomain)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlDecode(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;
  const nowSec = Date.now() / 1000;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowSec) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  return payload;
}

/** Require a valid Cloudflare Access identity on admin routes. */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ALLOW_INSECURE_ADMIN === "true") {
    c.set("adminEmail", "dev@localhost");
    return next();
  }
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = c.env;
  if (!team || !aud) {
    return c.json({ error: "Cloudflare Access is not configured (ACCESS_TEAM_DOMAIN / ACCESS_AUD)" }, 503);
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  const payload = token ? await verifyAccessJwt(token, team, aud) : null;
  if (!payload) return c.json({ error: "unauthorized" }, 401);
  c.set("adminEmail", typeof payload.email === "string" ? payload.email : undefined);
  return next();
};
