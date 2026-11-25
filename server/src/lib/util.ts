export const now = (): number => Math.floor(Date.now() / 1000);

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof input === "string" ? new TextEncoder().encode(input) : input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const isIPv4 = (ip: string): boolean => IPV4.test(ip);

/** Hostnames of a local `wrangler dev`; a deployed Worker never sees these. */
export const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
