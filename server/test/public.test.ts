import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { makeEnv, setupDb } from "./helpers";

let db: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db, bucket, dispose } = await setupDb());
  await bucket.put("latest.txt", "v1.2.3\n");
  await bucket.put("v1.2.3/ddns-client_linux_amd64", "binary-123");
  await bucket.put("v1.2.3/checksums.txt", "abc  ddns-client_linux_amd64\n");
});
afterAll(async () => dispose?.());

const get = (path: string, extra = {}) =>
  app.request(`https://ddns.example.com${path}`, {}, { ...makeEnv(db), RELEASES: bucket, ...extra });

describe("installers", () => {
  it.each(["/install.sh", "/install.ps1"])("%s is served with the server URL filled in", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("https://ddns.example.com");
    expect(body).not.toContain("__DDNS_SERVER_URL__");
  });
});

describe("GET /download", () => {
  it("resolves latest and reports the version", async () => {
    const res = await get("/download/latest/ddns-client_linux_amd64");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Release-Version")).toBe("v1.2.3");
    expect(await res.text()).toBe("binary-123");
  });

  it("serves a specific version's checksums", async () => {
    const res = await get("/download/v1.2.3/checksums.txt");
    expect(await res.text()).toContain("ddns-client_linux_amd64");
  });

  it("rejects unknown assets, bad versions and missing files", async () => {
    expect((await get("/download/latest/evil.sh")).status).toBe(404);
    expect((await get("/download/..%2F..%2Fx/checksums.txt")).status).toBe(404);
    expect((await get("/download/v9.9.9/checksums.txt")).status).toBe(404);
  });

  it("returns 503 when the bucket is not configured", async () => {
    expect((await get("/download/latest/checksums.txt", { RELEASES: undefined })).status).toBe(503);
  });

  it("exposes the latest version to the dashboard", async () => {
    const res = await get("/api/admin/releases/latest");
    expect(await res.json()).toEqual({ version: "v1.2.3" });
  });
});

describe("GET /download with RELEASES_REPO", () => {
  const upstream = { RELEASES_REPO: "owner/repo" };
  const binary = "binary-200";
  const sha = "0".repeat(64); // deliberately wrong
  let sums = "";
  let calls: string[] = [];

  beforeAll(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(binary));
    sums = `${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}  ddns-client_linux_arm64\n${sha}  ddns-client_linux_arm\n`;
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubGitHub() {
    calls = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url === "https://github.com/owner/repo/releases/latest") {
        return new Response(null, { status: 302, headers: { Location: "https://github.com/owner/repo/releases/tag/v2.0.0" } });
      }
      if (url.endsWith("/v2.0.0/checksums.txt")) return new Response(sums);
      if (url.endsWith("/v2.0.0/ddns-client_linux_arm64") || url.endsWith("/v2.0.0/ddns-client_linux_arm")) return new Response(binary);
      return new Response("nope", { status: 404 });
    });
  }

  it("copies a missing release from GitHub into the bucket once", async () => {
    stubGitHub();
    const res = await get("/download/v2.0.0/ddns-client_linux_arm64", upstream);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(binary);
    expect(await (await bucket.get("v2.0.0/ddns-client_linux_arm64"))!.text()).toBe(binary);
    calls = [];
    expect((await get("/download/v2.0.0/ddns-client_linux_arm64", upstream)).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("refuses a binary that doesn't match the release checksums", async () => {
    stubGitHub();
    expect((await get("/download/v2.0.0/ddns-client_linux_arm", upstream)).status).toBe(404);
    expect(await bucket.get("v2.0.0/ddns-client_linux_arm")).toBeNull();
  });

  it("learns the latest version from GitHub when the bucket has none, and keeps it for an hour", async () => {
    stubGitHub();
    await bucket.delete("latest.txt");
    expect(await (await get("/api/admin/releases/latest", upstream)).json()).toEqual({ version: "v2.0.0" });
    calls = [];
    expect(await (await get("/api/admin/releases/latest", upstream)).json()).toEqual({ version: "v2.0.0" });
    expect(calls).toEqual([]);
  });

  it("keeps serving the bucket when GitHub is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await bucket.put("latest.txt", "v1.2.3\n");
    expect((await get("/download/latest/ddns-client_linux_amd64", upstream)).headers.get("X-Release-Version")).toBe("v1.2.3");
    expect((await get("/download/v9.9.9/checksums.txt", upstream)).status).toBe(404);
  });
});
