import { z } from 'zod'
import type Database from '../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { ensureDotRemoteSchema, runDotRemoteWrite } from './dot-remote-schema'

// The remote switch (off by default), the Site origin and the current pairing record. The pairing
// record holds no secret: the session token lives only in memory and the service token is sealed.

export type DotRemoteSettings = {
  enabled: boolean
  origin: string | null
  lastSyncAt: string | null
  updatedAt: string | null
}

export type DotRemotePairingRecord = {
  origin: string
  deviceId: string
  generation: number
  pairedAt: string
  /** The pairing's absolute end on the Site; null when the Site named none. */
  lifetimeEndsAt: string | null
  revokedAt: string | null
}

const SettingsRowSchema = z.object({
  enabled: z.union([z.literal(0), z.literal(1)]),
  origin: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  updated_at: z.string()
})

const PairingRowSchema = z.object({
  origin: z.string(),
  device_id: z.string(),
  generation: z.number().int(),
  paired_at: z.string(),
  lifetime_ends_at: z.string().nullable(),
  revoked_at: z.string().nullable()
})

const LifetimeSchema = z.iso.datetime({ offset: true }).nullable()

const DEFAULT_SETTINGS: DotRemoteSettings = {
  enabled: false,
  origin: null,
  lastSyncAt: null,
  updatedAt: null
}

const stores = new WeakMap<OrchestrationDb, DotRemoteSettingsStore>()

export function getDotRemoteSettingsStore(owner: OrchestrationDb): DotRemoteSettingsStore {
  let store = stores.get(owner)
  if (!store) {
    store = new DotRemoteSettingsStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

export class DotRemoteSettingsStore {
  constructor(private readonly db: Database.Database) {
    ensureDotRemoteSchema(db)
  }

  getSettings(): DotRemoteSettings {
    const row = this.db
      .prepare('SELECT enabled, origin, last_sync_at, updated_at FROM dot_remote_settings')
      .get()
    if (!row) {
      return DEFAULT_SETTINGS
    }
    const stored = SettingsRowSchema.parse(row)
    return {
      enabled: stored.enabled === 1,
      origin: stored.origin,
      lastSyncAt: stored.last_sync_at,
      updatedAt: stored.updated_at
    }
  }

  setEnabled(enabled: boolean, timestamp: string): void {
    this.write({ ...this.getSettings(), enabled }, timestamp)
  }

  setOrigin(origin: string, timestamp: string): void {
    this.write({ ...this.getSettings(), origin }, timestamp)
  }

  recordSync(timestamp: string): void {
    this.write({ ...this.getSettings(), lastSyncAt: timestamp }, timestamp)
  }

  getPairing(): DotRemotePairingRecord | null {
    const row = this.db
      .prepare(
        'SELECT origin, device_id, generation, paired_at, lifetime_ends_at, revoked_at FROM dot_remote_pairing'
      )
      .get()
    if (!row) {
      return null
    }
    const stored = PairingRowSchema.parse(row)
    return {
      origin: stored.origin,
      deviceId: stored.device_id,
      generation: stored.generation,
      pairedAt: stored.paired_at,
      lifetimeEndsAt: stored.lifetime_ends_at,
      revokedAt: stored.revoked_at
    }
  }

  /** Replaces the pairing record: one binding per Site, the latest pairing wins. */
  recordPairing(input: {
    origin: string
    deviceId: string
    generation: number
    lifetimeEndsAt: string | null
    timestamp: string
  }): void {
    const lifetimeEndsAt = LifetimeSchema.parse(input.lifetimeEndsAt)
    runDotRemoteWrite(this.db, 'dot_remote_pairing', () => {
      this.db
        .prepare(
          `INSERT INTO dot_remote_pairing
             (id, origin, device_id, generation, paired_at, lifetime_ends_at, revoked_at)
           VALUES (1, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT (id) DO UPDATE SET origin = excluded.origin, device_id = excluded.device_id,
             generation = excluded.generation, paired_at = excluded.paired_at,
             lifetime_ends_at = excluded.lifetime_ends_at, revoked_at = NULL`
        )
        .run(input.origin, input.deviceId, input.generation, input.timestamp, lifetimeEndsAt)
    })
  }

  /** Fences the named generation only; a newer pairing is never revoked by an older generation. */
  markRevoked(generation: number, timestamp: string): boolean {
    return runDotRemoteWrite(this.db, 'dot_remote_pairing', () => {
      const result = this.db
        .prepare(
          'UPDATE dot_remote_pairing SET revoked_at = ? WHERE id = 1 AND generation = ? AND revoked_at IS NULL'
        )
        .run(timestamp, generation)
      return Number(result.changes) === 1
    })
  }

  private write(settings: DotRemoteSettings, timestamp: string): void {
    runDotRemoteWrite(this.db, 'dot_remote_settings', () => {
      this.db
        .prepare(
          `INSERT INTO dot_remote_settings (id, enabled, origin, last_sync_at, updated_at)
           VALUES (1, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, origin = excluded.origin,
             last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at`
        )
        .run(settings.enabled ? 1 : 0, settings.origin, settings.lastSyncAt, timestamp)
    })
  }
}
