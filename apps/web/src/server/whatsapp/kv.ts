import type { KeyValueStorage } from "@dilo/memory";

/**
 * Server-side key-value storage for DILO on WhatsApp: a Redis database reached
 * over HTTP (Upstash, also offered as "Redis" in the Vercel Marketplace).
 * No client library: one REST call per command.
 */
export interface ServerKv extends KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  /** Sets the key only if it does not exist yet; true when it was set. Used to skip duplicate deliveries. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export class RedisRestKv implements ServerKv {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async getItem(key: string): Promise<string | null> {
    return (await this.command(["GET", key])) as string | null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.command(["SET", key, value]);
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.command(["SET", key, "1", "NX", "EX", String(ttlSeconds)])) === "OK";
  }

  private async command(args: string[]): Promise<unknown> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !json || json.error) throw new Error(`Redis ${args[0]} failed: ${json?.error ?? res.status}`);
    return json.result ?? null;
  }
}

/** In-memory storage for tests. */
export class MemoryKv implements ServerKv {
  readonly data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async claim(key: string) {
    if (this.data.has(key)) return false;
    this.data.set(key, "1");
    return true;
  }
}

/** The database configured on the server, or null. Accepts the names Vercel and Upstash each use. */
export function kvFromEnv(env: NodeJS.ProcessEnv = process.env): ServerKv | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new RedisRestKv(url, token) : null;
}
