import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  app.request(path, {}, { ...makeEnv(db, { PUBLIC_URL: "https://ddns.example.com" }), RELEASES: bucket, ...extra });

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
