export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round(now - ts));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function countdown(deadline: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(deadline - now));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fullDate(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "";
}

export function osLabel(os: string | null, arch: string | null): string {
  const names: Record<string, string> = { linux: "Linux", darwin: "macOS", windows: "Windows" };
  return [os ? (names[os] ?? os) : null, arch].filter(Boolean).join(" · ") || "unknown";
}

/** Main label for a client: friendly name, then hostname, then a short id. */
export function clientLabel(c: { name?: string | null; hostname?: string | null; id: string }): string {
  return c.name || c.hostname || c.id.slice(0, 8);
}

/** "3 on v1.0.0, 1 on v0.9.0", most common version first. */
export function versionSummary(versions: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of versions) counts.set(v ?? "unknown", (counts.get(v ?? "unknown") ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0], undefined, { numeric: true }))
    .map(([v, n]) => `${n} on ${v}`)
    .join(", ");
}
