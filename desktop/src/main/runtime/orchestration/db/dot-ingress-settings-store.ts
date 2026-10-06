import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import {
  DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
  DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import { DotWorkspaceRefSchema } from '../../../../shared/dot-ingress/dot-ingress-params'
import { DotWorkspaceLabelSchema } from '../../../../shared/dot-ingress/dot-ingress-request'
import { DotRateLimitsSchema } from '../../../../shared/dot-ingress/dot-ingress-settings'
import { WorkbenchWorkspaceIdSchema } from '../../../../shared/workbench-request'
import type { OrchestrationDb } from './orchestration-db'
import { Sha256HexSchema, UtcTimestampSchema, changedRowCount } from './autopilot-store-input'
import {
  insertDotIngressEvent,
  listDotIngressEvents,
  type DotIngressEvent
} from './dot-ingress-event-log'
import { ensureDotIngressSchema } from './dot-ingress-schema'
import { refuseInvisibleWorkspaceLabel } from './dot-ingress-workspace-label'
import { dotIngressError, parseDotInput, parseDotRow, runDotWrite } from './dot-ingress-store-input'
import {
  DotMaxAccessSchema,
  readDotWorkspaceMaxAccess,
  writeDotWorkspaceMaxAccess,
  type DotMaxAccess
} from './dot-ingress-workspace-access'

export type { DotIngressEvent } from './dot-ingress-event-log'

/** What the user controls: the switch and the two submission caps. */
export type DotIngressSettings = {
  enabled: boolean
  ratePerMinute: number
  ratePerUtcDay: number
  updatedAt: string | null
}

export type DotWorkspaceEntry = {
  workspaceRef: string
  workspaceId: string
  workspaceBinding: string
  label: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const SetEnabledSchema = z.object({ enabled: z.boolean(), timestamp: UtcTimestampSchema }).strict()
const SetRateLimitsSchema = DotRateLimitsSchema.extend({ timestamp: UtcTimestampSchema }).strict()
const EnableWorkspaceSchema = z
  .object({
    workspaceId: WorkbenchWorkspaceIdSchema,
    workspaceBinding: Sha256HexSchema,
    label: DotWorkspaceLabelSchema,
    // The access ceiling for dot requests to this workspace; set on every enable, read_only by default.
    maxAccess: DotMaxAccessSchema,
    timestamp: UtcTimestampSchema
  })
  .strict()
const DisableWorkspaceSchema = z
  .object({ workspaceRef: DotWorkspaceRefSchema, timestamp: UtcTimestampSchema })
  .strict()

const SettingsRowSchema = z.object({
  enabled: z.number().int().min(0).max(1),
  rate_per_minute: z.number().int(),
  rate_per_utc_day: z.number().int(),
  updated_at: z.string()
})
const WorkspaceRowSchema = z.object({
  workspace_ref: DotWorkspaceRefSchema,
  workspace_id: z.string(),
  workspace_binding: z.string(),
  label: z.string(),
  enabled: z.number().int().min(0).max(1),
  created_at: z.string(),
  updated_at: z.string()
})

const WORKSPACE_COLUMNS =
  'workspace_ref, workspace_id, workspace_binding, label, enabled, created_at, updated_at'

/** The interface is off, and the caps are the defaults, until the user changes them. */
export function readDotIngressSettings(db: Database.Database): DotIngressSettings {
  const row = db
    .prepare(
      'SELECT enabled, rate_per_minute, rate_per_utc_day, updated_at FROM dot_ingress_settings WHERE id = 1'
    )
    .get()
  if (!row) {
    return {
      enabled: false,
      ratePerMinute: DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
      ratePerUtcDay: DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY,
      updatedAt: null
    }
  }
  const stored = parseDotRow(SettingsRowSchema, row)
  return {
    enabled: stored.enabled === 1,
    ratePerMinute: stored.rate_per_minute,
    ratePerUtcDay: stored.rate_per_utc_day,
    updatedAt: stored.updated_at
  }
}

function toWorkspaceEntry(row: unknown): DotWorkspaceEntry {
  const stored = parseDotRow(WorkspaceRowSchema, row)
  return {
    workspaceRef: stored.workspace_ref,
    workspaceId: stored.workspace_id,
    workspaceBinding: stored.workspace_binding,
    label: stored.label,
    enabled: stored.enabled === 1,
    createdAt: stored.created_at,
    updatedAt: stored.updated_at
  }
}

export function readDotWorkspace(
  db: Database.Database,
  workspaceRef: string
): DotWorkspaceEntry | null {
  const row = db
    .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM dot_ingress_workspaces WHERE workspace_ref = ?`)
    .get(workspaceRef)
  return row ? toWorkspaceEntry(row) : null
}

const stores = new WeakMap<OrchestrationDb, DotIngressSettingsStore>()

export function getDotIngressSettingsStore(owner: OrchestrationDb): DotIngressSettingsStore {
  let store = stores.get(owner)
  if (!store) {
    store = new DotIngressSettingsStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/**
 * The interface switch, the two submission caps and the per-workspace allowlist. They live in the
 * dot_ingress tables and change only through the desktop, never through GlobalSettings, which mobile
 * and any CLI-token holder can reach.
 */
export class DotIngressSettingsStore {
  constructor(private readonly db: Database.Database) {
    ensureDotIngressSchema(db)
  }

  getSettings(): DotIngressSettings {
    return readDotIngressSettings(this.db)
  }

  setEnabled(input: { enabled: boolean; timestamp: string }): {
    settings: DotIngressSettings
    changed: boolean
  } {
    const params = parseDotInput(SetEnabledSchema, input, 'interface switch')
    return runDotWrite(this.db, 'dot_ingress_settings', () => {
      const current = readDotIngressSettings(this.db)
      if (current.enabled === params.enabled) {
        return { settings: current, changed: false }
      }
      const settings = { ...current, enabled: params.enabled, updatedAt: params.timestamp }
      this.writeSettings(settings)
      insertDotIngressEvent(this.db, {
        kind: params.enabled ? 'ingress_enabled' : 'ingress_disabled',
        timestamp: params.timestamp
      })
      return { settings, changed: true }
    })
  }

  /** Default caps are DOT_INGRESS_DEFAULT_*; this is how the user changes them. */
  setRateLimits(input: { ratePerMinute: number; ratePerUtcDay: number; timestamp: string }): {
    settings: DotIngressSettings
    changed: boolean
  } {
    const params = parseDotInput(SetRateLimitsSchema, input, 'submission caps')
    return runDotWrite(this.db, 'dot_ingress_settings', () => {
      const current = readDotIngressSettings(this.db)
      if (
        current.ratePerMinute === params.ratePerMinute &&
        current.ratePerUtcDay === params.ratePerUtcDay
      ) {
        return { settings: current, changed: false }
      }
      const settings = {
        ...current,
        ratePerMinute: params.ratePerMinute,
        ratePerUtcDay: params.ratePerUtcDay,
        updatedAt: params.timestamp
      }
      this.writeSettings(settings)
      insertDotIngressEvent(this.db, { kind: 'rate_limits_changed', timestamp: params.timestamp })
      return { settings, changed: true }
    })
  }

  getWorkspace(workspaceRef: string): DotWorkspaceEntry | null {
    return readDotWorkspace(
      this.db,
      parseDotInput(DotWorkspaceRefSchema, workspaceRef, 'workspace reference')
    )
  }

  /** The access ceiling for dot requests to the workspace; read_only unless the user raised it. */
  getWorkspaceMaxAccess(workspaceRef: string): DotMaxAccess {
    return readDotWorkspaceMaxAccess(this.db, workspaceRef)
  }

  /** Oldest first, so the order is stable while the user enables and disables workspaces. */
  listWorkspaces(options: { enabledOnly?: boolean } = {}): DotWorkspaceEntry[] {
    const filter = options.enabledOnly ? 'WHERE enabled = 1' : ''
    return this.db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM dot_ingress_workspaces ${filter} ORDER BY rowid`)
      .all()
      .map(toWorkspaceEntry)
  }

  /** The one-time per-workspace setting; the same workspace always keeps the same opaque reference. */
  enableWorkspace(input: {
    workspaceId: string
    workspaceBinding: string
    label: string
    maxAccess?: DotMaxAccess
    timestamp: string
  }): { workspace: DotWorkspaceEntry; changed: boolean } {
    refuseInvisibleWorkspaceLabel(input.label)
    const params = parseDotInput(EnableWorkspaceSchema, input, 'workspace')
    return runDotWrite(this.db, 'dot_ingress_workspace', () => {
      const existing = this.db
        .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM dot_ingress_workspaces WHERE workspace_id = ?`)
        .get(params.workspaceId)
      if (!existing) {
        const workspaceRef = `dws_${randomBytes(12).toString('hex')}`
        this.db
          .prepare(
            `INSERT INTO dot_ingress_workspaces (${WORKSPACE_COLUMNS}) VALUES (?, ?, ?, ?, 1, ?, ?)`
          )
          .run(
            workspaceRef,
            params.workspaceId,
            params.workspaceBinding,
            params.label,
            params.timestamp,
            params.timestamp
          )
        writeDotWorkspaceMaxAccess(this.db, { workspaceRef, ...params })
        return this.recordedWorkspace(workspaceRef, params.timestamp, true)
      }
      const current = toWorkspaceEntry(existing)
      if (
        current.enabled &&
        current.workspaceBinding === params.workspaceBinding &&
        current.label === params.label &&
        readDotWorkspaceMaxAccess(this.db, current.workspaceRef) === params.maxAccess
      ) {
        return { workspace: current, changed: false }
      }
      this.db
        .prepare(
          `UPDATE dot_ingress_workspaces SET enabled = 1, workspace_binding = ?, label = ?, updated_at = ?
            WHERE workspace_ref = ?`
        )
        .run(params.workspaceBinding, params.label, params.timestamp, current.workspaceRef)
      writeDotWorkspaceMaxAccess(this.db, { workspaceRef: current.workspaceRef, ...params })
      return this.recordedWorkspace(current.workspaceRef, params.timestamp, true)
    })
  }

  /** Keeps the reference and the row: pending history stays readable and a re-enable reuses the reference. */
  disableWorkspace(input: { workspaceRef: string; timestamp: string }): {
    workspace: DotWorkspaceEntry
    changed: boolean
  } {
    const params = parseDotInput(DisableWorkspaceSchema, input, 'workspace')
    return runDotWrite(this.db, 'dot_ingress_workspace', () => {
      const current = readDotWorkspace(this.db, params.workspaceRef)
      if (!current) {
        throw dotIngressError('dot_workspace_unknown')
      }
      if (!current.enabled) {
        return { workspace: current, changed: false }
      }
      const updated = this.db
        .prepare(
          'UPDATE dot_ingress_workspaces SET enabled = 0, updated_at = ? WHERE workspace_ref = ? AND enabled = 1'
        )
        .run(params.timestamp, params.workspaceRef)
      if (changedRowCount(updated) !== 1) {
        throw dotIngressError('dot_recovery_required')
      }
      return this.recordedWorkspace(params.workspaceRef, params.timestamp, false)
    })
  }

  listEvents(options: { limit: number; beforeSequence?: number }): DotIngressEvent[] {
    return listDotIngressEvents(this.db, options)
  }

  private writeSettings(settings: DotIngressSettings): void {
    this.db
      .prepare(
        `INSERT INTO dot_ingress_settings (id, enabled, rate_per_minute, rate_per_utc_day, updated_at)
          VALUES (1, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, rate_per_minute = excluded.rate_per_minute,
            rate_per_utc_day = excluded.rate_per_utc_day, updated_at = excluded.updated_at`
      )
      .run(
        settings.enabled ? 1 : 0,
        settings.ratePerMinute,
        settings.ratePerUtcDay,
        settings.updatedAt
      )
  }

  private recordedWorkspace(
    workspaceRef: string,
    timestamp: string,
    enabled: boolean
  ): { workspace: DotWorkspaceEntry; changed: boolean } {
    const workspace = readDotWorkspace(this.db, workspaceRef)
    if (!workspace) {
      throw dotIngressError('dot_recovery_required')
    }
    insertDotIngressEvent(this.db, {
      kind: enabled ? 'workspace_enabled' : 'workspace_disabled',
      workspaceRef,
      timestamp
    })
    return { workspace, changed: true }
  }
}
