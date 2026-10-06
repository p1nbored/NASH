/**
 * Minimal D1 subset used by this scaffold. Cloudflare D1Database is structurally
 * compatible; tests use node:sqlite to execute the generated migrations.
 * Each prepare() executes one statement. Atomic CAS/limiting is performed in a
 * single SQL statement; request code never creates or alters schema tables.
 */
export interface ScaffoldDatabase {
  prepare(query: string): ScaffoldStatement;
}

export interface ScaffoldStatement {
  bind(...values: (string | number | null)[]): ScaffoldStatement;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<ScaffoldResult<Row>>;
  run(): Promise<ScaffoldResult<unknown>>;
}

export interface ScaffoldResult<Row> {
  success: boolean;
  results: Row[];
  meta: { changes: number };
}

/** Identity must come from verified Sites context or the local-only fixture. */
export interface AuthenticatedOwner {
  userId: string;
}

export interface ScaffoldWorkspace {
  workspaceRef: string;
  label: string;
}

export interface ScaffoldChallenge {
  challengeId: string;
  deviceRef: string;
  expiresAt: number;
}

interface WorkspaceRow {
  workspace_ref: string;
  label: string;
}

interface ChallengeRow {
  device_ref: string;
  expires_at: number;
}

interface RateRow {
  calls: number;
  expires_at: number;
}

const challengeLifetimeMs = 5 * 60_000;
const rateWindowMs = 60_000;
const callsPerWindow = 30;

function ownerId(owner: AuthenticatedOwner): string {
  if (typeof owner?.userId !== "string" || owner.userId.trim().length === 0
    || owner.userId.length > 256 || /[\u0000-\u001f\u007f]/.test(owner.userId)) {
    throw new Error("A verified authenticated owner is required");
  }
  return owner.userId;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function challengeHash(challengeId: string): Promise<string | null> {
  if (!/^dch_[a-f0-9]{64}$/.test(challengeId)) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challengeId));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checkedResult<Row>(result: ScaffoldResult<Row>): ScaffoldResult<Row> {
  if (!result.success) throw new Error("Scaffold storage operation failed");
  return result;
}

/**
 * Local scaffold only: workspaces are opaque fixtures. Challenge approval
 * consumes a fixture intent; it neither pairs a real device nor issues session
 * credentials. Challenge knowledge alone grants no authority: the owner is
 * required for every read and approval.
 */
export function createScaffoldStorage(db: ScaffoldDatabase, options: { now?: () => number } = {}) {
  const clock = options.now ?? Date.now;
  function now(): number {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Scaffold clock must return a nonnegative integer timestamp");
    return value;
  }

  return {
    async listWorkspaces(owner: AuthenticatedOwner): Promise<ScaffoldWorkspace[]> {
      const rows = checkedResult(await db.prepare(
        "SELECT workspace_ref, label FROM scaffold_workspaces WHERE owner_id = ? ORDER BY created_at, workspace_ref",
      ).bind(ownerId(owner)).all<WorkspaceRow>()).results;
      return rows.map((row) => ({ workspaceRef: row.workspace_ref, label: row.label }));
    },

    async createWorkspace(owner: AuthenticatedOwner, label: string): Promise<ScaffoldWorkspace> {
      const authenticatedOwner = ownerId(owner);
      if (typeof label !== "string" || label.trim().length === 0 || label.length > 80
        || /[\u0000-\u001f\u007f\\/]/.test(label)) {
        throw new Error("Workspace label must be 1–80 characters without paths or control characters");
      }
      const workspace = { workspaceRef: `dws_${randomHex(12)}`, label: label.trim() };
      checkedResult(await db.prepare(
        "INSERT INTO scaffold_workspaces (workspace_ref, owner_id, label, created_at) VALUES (?, ?, ?, ?)",
      ).bind(workspace.workspaceRef, authenticatedOwner, workspace.label, now()).run());
      return workspace;
    },

    async beginChallenge(owner: AuthenticatedOwner, deviceRef: string): Promise<ScaffoldChallenge> {
      const authenticatedOwner = ownerId(owner);
      if (typeof deviceRef !== "string" || !/^dev_[A-Za-z0-9_-]{1,64}$/.test(deviceRef)) {
        throw new Error("deviceRef must use dev_ followed by 1–64 letters, digits, underscores or hyphens");
      }
      const createdAt = now();
      const challenge = { challengeId: `dch_${randomHex(32)}`, deviceRef, expiresAt: createdAt + challengeLifetimeMs };
      const hash = await challengeHash(challenge.challengeId);
      checkedResult(await db.prepare(
        "INSERT INTO scaffold_challenges (challenge_hash, owner_id, device_ref, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(hash, authenticatedOwner, deviceRef, createdAt, challenge.expiresAt).run());
      return challenge;
    },

    async getChallenge(owner: AuthenticatedOwner, challengeId: string): Promise<ScaffoldChallenge | null> {
      const authenticatedOwner = ownerId(owner);
      const hash = await challengeHash(challengeId);
      if (hash === null) return null;
      const row = await db.prepare(
        "SELECT device_ref, expires_at FROM scaffold_challenges WHERE challenge_hash = ? AND owner_id = ? AND expires_at > ?",
      ).bind(hash, authenticatedOwner, now()).first<ChallengeRow>();
      return row === null ? null : { challengeId, deviceRef: row.device_ref, expiresAt: row.expires_at };
    },

    async approveChallenge(owner: AuthenticatedOwner, challengeId: string): Promise<(ScaffoldChallenge & { state: "approved" }) | null> {
      const authenticatedOwner = ownerId(owner);
      const hash = await challengeHash(challengeId);
      if (hash === null) return null;
      // DELETE RETURNING is the single-use approval CAS; no separate read/write race.
      const row = await db.prepare(
        "DELETE FROM scaffold_challenges WHERE challenge_hash = ? AND owner_id = ? AND expires_at > ? RETURNING device_ref, expires_at",
      ).bind(hash, authenticatedOwner, now()).first<ChallengeRow>();
      return row === null ? null : { challengeId, deviceRef: row.device_ref, expiresAt: row.expires_at, state: "approved" };
    },

    async consumeMcpCall(owner: AuthenticatedOwner): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number; resetAt: number }> {
      const authenticatedOwner = ownerId(owner);
      const timestamp = now();
      const windowStart = Math.floor(timestamp / rateWindowMs) * rateWindowMs;
      const resetAt = windowStart + rateWindowMs;
      // Atomic UPSERT bounds the persisted count, including simultaneous callers.
      const row = await db.prepare(`
        INSERT INTO scaffold_rate_windows (owner_id, window_start, expires_at, calls) VALUES (?, ?, ?, 1)
        ON CONFLICT (owner_id) DO UPDATE SET
          calls = CASE WHEN scaffold_rate_windows.expires_at <= ? THEN 1 ELSE scaffold_rate_windows.calls + 1 END,
          window_start = CASE WHEN scaffold_rate_windows.expires_at <= ? THEN excluded.window_start ELSE scaffold_rate_windows.window_start END,
          expires_at = CASE WHEN scaffold_rate_windows.expires_at <= ? THEN excluded.expires_at ELSE scaffold_rate_windows.expires_at END
        WHERE scaffold_rate_windows.expires_at <= ? OR scaffold_rate_windows.calls < ?
        RETURNING calls, expires_at
      `).bind(authenticatedOwner, windowStart, resetAt, timestamp, timestamp, timestamp, timestamp, callsPerWindow).first<RateRow>();
      return row === null
        ? { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((resetAt - timestamp) / 1_000), resetAt }
        : { allowed: true, remaining: callsPerWindow - row.calls, retryAfterSeconds: 0, resetAt: row.expires_at };
    },

    async purgeExpired(limit = 100): Promise<{ challenges: number; rateWindows: number; total: number }> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("Purge limit must be an integer between 1 and 1000");
      const timestamp = now();
      const challenges = checkedResult(await db.prepare(`
        DELETE FROM scaffold_challenges WHERE challenge_hash IN (
          SELECT challenge_hash FROM scaffold_challenges WHERE expires_at <= ? ORDER BY expires_at LIMIT ?
        )
      `).bind(timestamp, limit).run()).meta.changes;
      const remaining = limit - challenges;
      const rateWindows = remaining === 0 ? 0 : checkedResult(await db.prepare(`
        DELETE FROM scaffold_rate_windows WHERE owner_id IN (
          SELECT owner_id FROM scaffold_rate_windows WHERE expires_at <= ? ORDER BY expires_at LIMIT ?
        )
      `).bind(timestamp, remaining).run()).meta.changes;
      return { challenges, rateWindows, total: challenges + rateWindows };
    },
  };
}
