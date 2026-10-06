import type { ScaffoldDatabase } from './scaffold-storage.ts';

type StoredSnapshot = { revision: number; state_json: string };
const KEY = 'local-conformance-v1';
const MAX_BYTES = 1_048_576;
const REVOCATION_RESERVE_BYTES = 65_536;
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function parsedSnapshot(json: string): Record<string, unknown> {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new Error('Invalid scaffold state');
  return value;
}

export function createRemoteStateStore(db: ScaffoldDatabase) {
  async function snapshot(): Promise<StoredSnapshot> {
    const existing = await db.prepare('SELECT revision, state_json FROM remote_scaffold_state WHERE key = ?').bind(KEY).first<StoredSnapshot>();
    if (existing) return existing;
    await db.prepare('INSERT INTO remote_scaffold_state (key, revision, state_json) VALUES (?, 0, ?) ON CONFLICT (key) DO NOTHING').bind(KEY, '{}').run();
    const initialized = await db.prepare('SELECT revision, state_json FROM remote_scaffold_state WHERE key = ?').bind(KEY).first<StoredSnapshot>();
    if (!initialized) throw new Error('Scaffold state unavailable');
    return initialized;
  }
  return {
    async read(): Promise<Record<string, unknown>> { return parsedSnapshot((await snapshot()).state_json); },
    async mutate<T>(transition: (state: Record<string, unknown>) => T | Promise<T>, canUseRevocationReserve?: (result: T) => boolean): Promise<T> {
      // Transitions are pure: no HTTP, terminal effects or credentials outside this snapshot.
      for (let attempt = 0; attempt < 64; attempt++) {
        const previous = await snapshot();
        const state = parsedSnapshot(previous.state_json);
        const result = await transition(state);
        const json = JSON.stringify(state);
        const limit = canUseRevocationReserve?.(result) === true ? MAX_BYTES : MAX_BYTES - REVOCATION_RESERVE_BYTES;
        if (new TextEncoder().encode(json).length > limit) throw new Error('Remote snapshot capacity exceeded');
        const changed = await db.prepare('UPDATE remote_scaffold_state SET state_json = ?, revision = revision + 1 WHERE key = ? AND revision = ?')
          .bind(json, KEY, previous.revision).run();
        if (!changed.success) throw new Error('Scaffold state unavailable');
        if (changed.meta.changes === 1) return result;
      }
      throw new Error('Local scaffold contention exceeded');
    },
  };
}
