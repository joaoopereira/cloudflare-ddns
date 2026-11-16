import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { sha256Hex } from "../lib/util";
import installPs1 from "../../../install/install.ps1";
import installSh from "../../../install/install.sh";

/** Public, unauthenticated routes: installers and client binaries. */
export const publicRoutes = new Hono<AppEnv>();

const ASSET_RE = /^(ddns-client_(linux|darwin|windows)_(amd64|arm64|arm)(\.exe)?|checksums\.txt)$/;
const VERSION_RE = /^v\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * An installer pointing at the address it was requested from, so no hostname
 * needs configuring. Always https (except on loopback, for local development):
 * the client sends its secret and downloads binaries from this URL.
 */
function installerOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  if (!LOOPBACK.has(url.hostname)) url.protocol = "https:";
  return url.origin;
}

function script(body: string, requestUrl: string, type: string) {
  return new Response(body.replaceAll("__DDNS_SERVER_URL__", installerOrigin(requestUrl)), {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" },
  });
}

publicRoutes.get("/install.sh", (c) => script(installSh, c.req.url, "text/x-shellscript"));
publicRoutes.get("/install.ps1", (c) => script(installPs1, c.req.url, "text/plain"));

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const LATEST_TTL_MS = 60 * 60 * 1000;

/** The validated RELEASES_REPO, or null when releases only come from the bucket. */
function releasesRepo(env: Env): string | null {
  return env.RELEASES_REPO && REPO_RE.test(env.RELEASES_REPO) ? env.RELEASES_REPO : null;
}

/** Newest release tag of a GitHub repo, read from the redirect of /releases/latest (no API quota). */
async function upstreamLatest(repo: string): Promise<string | null> {
  const res = await fetch(`https://github.com/${repo}/releases/latest`, { redirect: "manual" });
  const tag = res.headers.get("Location")?.split("/releases/tag/")[1] ?? "";
  return VERSION_RE.test(tag) ? tag : null;
}

/** One release asset from GitHub; binaries must match the release's checksums.txt. */
async function fetchUpstream(repo: string, version: string, asset: string): Promise<ArrayBuffer | null> {
  const url = (name: string) => `https://github.com/${repo}/releases/download/${version}/${name}`;
  const res = await fetch(url(asset));
  if (!res.ok) return null;
  const body = await res.arrayBuffer();
  if (asset !== "checksums.txt") {
    const sums = await fetch(url("checksums.txt"));
    const line = sums.ok ? (await sums.text()).split("\n").find((l) => l.trim().split(/\s+/)[1] === asset) : undefined;
    if (!line || line.trim().split(/\s+/)[0] !== (await sha256Hex(body))) return null;
  }
  return body;
}

/**
 * Latest released client version: latest.txt in the bucket, written by the
 * release workflow or, with RELEASES_REPO, refreshed from GitHub once an hour.
 */
export async function latestVersion(env: Env): Promise<string | null> {
  const bucket = env.RELEASES;
  const obj = await bucket?.get("latest.txt");
  let v = obj ? (await obj.text()).trim() : "";
  const repo = releasesRepo(env);
  if (bucket && repo && (!obj || Date.now() - obj.uploaded.getTime() > LATEST_TTL_MS)) {
    v = (await upstreamLatest(repo).catch(() => null)) ?? v;
    // Rewritten even when GitHub had nothing new, so it isn't asked again for an hour.
    if (VERSION_RE.test(v)) await bucket.put("latest.txt", v);
  }
  return VERSION_RE.test(v) ? v : null;
}

/**
 * Client binaries from the RELEASES R2 bucket, laid out as
 * <version>/<asset> plus latest.txt. "latest" resolves to the newest release.
 * With RELEASES_REPO, a release missing from the bucket is copied from GitHub
 * first, so clients still only ever download from this Worker.
 */
publicRoutes.get("/download/:version/:asset", async (c) => {
  const bucket = c.env.RELEASES;
  if (!bucket) return c.json({ error: "downloads are not configured" }, 503);
  let version = c.req.param("version");
  const asset = c.req.param("asset");
  if (!ASSET_RE.test(asset)) return c.json({ error: "not found" }, 404);
  if (version === "latest") {
    const latest = await latestVersion(c.env);
    if (!latest) return c.json({ error: "no release published yet" }, 404);
    version = latest;
  } else if (!VERSION_RE.test(version)) {
    return c.json({ error: "not found" }, 404);
  }
  let obj = await bucket.get(`${version}/${asset}`);
  const repo = releasesRepo(c.env);
  if (!obj && repo) {
    // shortcut: a version GitHub doesn't have is asked for again on every request; cache misses if that gets abused.
    const body = await fetchUpstream(repo, version, asset).catch(() => null);
    if (body) {
      await bucket.put(`${version}/${asset}`, body);
      obj = await bucket.get(`${version}/${asset}`);
    }
  }
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": asset.endsWith(".txt") ? "text/plain; charset=utf-8" : "application/octet-stream",
      "Content-Length": String(obj.size),
      "Cache-Control": c.req.param("version") === "latest" ? "no-store" : "public, max-age=31536000, immutable",
      "X-Release-Version": version,
    },
  });
});
