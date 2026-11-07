import { Hono } from "hono";
import type { AppEnv } from "../env";
import installPs1 from "../../../install/install.ps1";
import installSh from "../../../install/install.sh";

/** Public, unauthenticated routes: installers and client binaries. */
export const publicRoutes = new Hono<AppEnv>();

const ASSET_RE = /^(ddns-client_(linux|darwin|windows)_(amd64|arm64|arm)(\.exe)?|checksums\.txt)$/;
const VERSION_RE = /^v\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/;

function script(body: string, publicUrl: string, type: string) {
  return new Response(body.replaceAll("__DDNS_SERVER_URL__", publicUrl), {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" },
  });
}

publicRoutes.get("/install.sh", (c) => script(installSh, c.env.PUBLIC_URL, "text/x-shellscript"));
publicRoutes.get("/install.ps1", (c) => script(installPs1, c.env.PUBLIC_URL, "text/plain"));

/** Latest released client version, as uploaded by the release workflow. */
export async function latestVersion(bucket: R2Bucket | undefined): Promise<string | null> {
  const obj = await bucket?.get("latest.txt");
  const v = obj ? (await obj.text()).trim() : "";
  return VERSION_RE.test(v) ? v : null;
}

/**
 * Client binaries from the RELEASES R2 bucket, laid out as
 * <version>/<asset> plus latest.txt. "latest" resolves to the newest release.
 */
publicRoutes.get("/download/:version/:asset", async (c) => {
  const bucket = c.env.RELEASES;
  if (!bucket) return c.json({ error: "downloads are not configured" }, 503);
  let version = c.req.param("version");
  const asset = c.req.param("asset");
  if (!ASSET_RE.test(asset)) return c.json({ error: "not found" }, 404);
  if (version === "latest") {
    const latest = await latestVersion(bucket);
    if (!latest) return c.json({ error: "no release published yet" }, 404);
    version = latest;
  } else if (!VERSION_RE.test(version)) {
    return c.json({ error: "not found" }, 404);
  }
  const obj = await bucket.get(`${version}/${asset}`);
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
