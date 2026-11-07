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
