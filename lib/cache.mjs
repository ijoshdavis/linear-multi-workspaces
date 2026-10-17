import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_DIR = join(homedir(), ".cache", "linear-cli");

/**
 * Name -> ID resolution cache for one profile. One process = one in-memory
 * layer (avoids repeat lookups within a single command); the on-disk layer
 * survives across CLI invocations within a session, since each invocation
 * is a fresh process.
 */
export class Cache {
  constructor(profile) {
    this.profile = profile;
    this.path = join(CACHE_DIR, `${profile}.json`);
    this.mem = this._loadDisk();
  }

  _loadDisk() {
    if (!existsSync(this.path)) return {};
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      const now = Date.now();
      const fresh = {};
      for (const [key, entry] of Object.entries(raw)) {
        if (entry.expires > now) fresh[key] = entry;
      }
      return fresh;
    } catch {
      return {};
    }
  }

  _saveDisk() {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.mem), { mode: 0o600 });
  }

  get(key) {
    const entry = this.mem[key];
    if (!entry || entry.expires <= Date.now()) return undefined;
    return entry.value;
  }

  set(key, value) {
    this.mem[key] = { value, expires: Date.now() + TTL_MS };
    this._saveDisk();
  }

  /** Fetch-or-resolve helper: cache.wrap("team:OOR", () => lookupTeam()) */
  async wrap(key, resolver) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await resolver();
    this.set(key, value);
    return value;
  }
}
