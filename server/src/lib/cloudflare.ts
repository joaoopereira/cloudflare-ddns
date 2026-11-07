const API = "https://api.cloudflare.com/client/v4";

export interface Zone {
  id: string;
  name: string;
}

export interface DnsRecord {
  id: string;
  name: string;
  content: string;
}

export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Minimal Cloudflare API client for zones and A records. */
export class CloudflareApi {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { success: boolean; result: T; errors?: { message: string }[] }
      | null;
    if (!res.ok || !json?.success) {
      const msg = json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new CloudflareError(`Cloudflare API ${method} ${path}: ${msg}`, res.status);
    }
    return json.result;
  }

  async listZones(): Promise<Zone[]> {
    const zones: Zone[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.call<Zone[]>("GET", `/zones?per_page=50&page=${page}`);
      zones.push(...batch.map(({ id, name }) => ({ id, name })));
      if (batch.length < 50) return zones;
    }
  }

  async getZone(zoneId: string): Promise<Zone> {
    const { id, name } = await this.call<Zone>("GET", `/zones/${encodeURIComponent(zoneId)}`);
    return { id, name };
  }

  async findARecord(zoneId: string, name: string): Promise<DnsRecord | null> {
    const records = await this.call<DnsRecord[]>(
      "GET",
      `/zones/${encodeURIComponent(zoneId)}/dns_records?type=A&name=${encodeURIComponent(name)}`,
    );
    return records[0] ?? null;
  }

  createARecord(zoneId: string, name: string, ip: string): Promise<DnsRecord> {
    return this.call<DnsRecord>("POST", `/zones/${encodeURIComponent(zoneId)}/dns_records`, {
      type: "A",
      name,
      content: ip,
      ttl: 60,
      proxied: false,
      comment: "managed by cloudflare-ddns",
    });
  }

  updateARecord(zoneId: string, recordId: string, ip: string): Promise<DnsRecord> {
    return this.call<DnsRecord>(
      "PATCH",
      `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { content: ip },
    );
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await this.call("DELETE", `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`);
  }

  /**
   * Point `name` at `ip`, reusing `recordId` when it still exists, otherwise
   * finding an existing A record by name or creating one. Returns the record id.
   */
  async upsertARecord(zoneId: string, name: string, ip: string, recordId: string | null): Promise<string> {
    if (recordId) {
      try {
        return (await this.updateARecord(zoneId, recordId, ip)).id;
      } catch (err) {
        if (!(err instanceof CloudflareError && err.status === 404)) throw err;
        // The record was deleted outside the app; fall through and recreate it.
      }
    }
    const existing = await this.findARecord(zoneId, name);
    if (existing) {
      return existing.content === ip ? existing.id : (await this.updateARecord(zoneId, existing.id, ip)).id;
    }
    return (await this.createARecord(zoneId, name, ip)).id;
  }
}
