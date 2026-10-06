import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE } from '../../../../shared/dot-ingress/dot-ingress-request'
import { OrchestrationDb } from './orchestration-db'
import {
  getDotIngressSettingsStore,
  type DotIngressSettingsStore
} from './dot-ingress-settings-store'
import {
  FIXTURE_BINDING,
  FIXTURE_WORKSPACE_ID,
  errorCodeOf,
  fixtureTime
} from './dot-ingress.test-fixture'

const enable = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: FIXTURE_WORKSPACE_ID,
  workspaceBinding: FIXTURE_BINDING,
  label: 'fixture-repo',
  timestamp: fixtureTime(1),
  ...overrides
})

describe('dot ingress settings store', () => {
  let owner: OrchestrationDb
  let store: DotIngressSettingsStore
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    store = getDotIngressSettingsStore(owner)
  })
  afterEach(() => owner.close())

  it('is one store per database and creates the schema on first use', () => {
    expect(getDotIngressSettingsStore(owner)).toBe(store)
    expect(owner.db.prepare('SELECT version FROM dot_ingress_schema').get()).toEqual({ version: 1 })
  })

  describe('the interface switch', () => {
    it('is off by default, with the default caps and no write on read', () => {
      expect(store.getSettings()).toEqual({
        enabled: false,
        ratePerMinute: 6,
        ratePerUtcDay: 100,
        updatedAt: null
      })
      expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_settings').get()).toEqual({
        n: 0
      })
      expect(owner.db.prepare('SELECT count(*) AS n FROM dot_ingress_events').get()).toEqual({
        n: 0
      })
    })

    it('turns on and off, recording one event per real change', () => {
      expect(store.setEnabled({ enabled: true, timestamp: fixtureTime(1) })).toEqual({
        changed: true,
        settings: { enabled: true, ratePerMinute: 6, ratePerUtcDay: 100, updatedAt: fixtureTime(1) }
      })
      expect(store.setEnabled({ enabled: true, timestamp: fixtureTime(2) }).changed).toBe(false)
      expect(store.getSettings().updatedAt).toBe(fixtureTime(1))
      expect(store.setEnabled({ enabled: false, timestamp: fixtureTime(3) }).settings).toEqual({
        enabled: false,
        ratePerMinute: 6,
        ratePerUtcDay: 100,
        updatedAt: fixtureTime(3)
      })
      expect(store.listEvents({ limit: 10 }).map((event) => event.kind)).toEqual([
        'ingress_disabled',
        'ingress_enabled'
      ])
    })

    it('refuses a non-boolean flag and a malformed timestamp without writing', () => {
      // @ts-expect-error a string is not a boolean
      const notBoolean = () => store.setEnabled({ enabled: 'yes', timestamp: fixtureTime() })
      expect(errorCodeOf(notBoolean)).toBe('dot_invalid_input')
      expect(errorCodeOf(() => store.setEnabled({ enabled: true, timestamp: 'now' }))).toBe(
        'dot_invalid_input'
      )
      expect(store.getSettings().enabled).toBe(false)
      expect(store.listEvents({ limit: 10 })).toEqual([])
    })
  })

  describe('the submission caps (a default the user can change)', () => {
    it('changes both caps, records one event per real change and keeps them across on and off', () => {
      const changed = store.setRateLimits({
        ratePerMinute: 3,
        ratePerUtcDay: 40,
        timestamp: fixtureTime(1)
      })
      expect(changed).toEqual({
        changed: true,
        settings: { enabled: false, ratePerMinute: 3, ratePerUtcDay: 40, updatedAt: fixtureTime(1) }
      })
      expect(
        store.setRateLimits({ ratePerMinute: 3, ratePerUtcDay: 40, timestamp: fixtureTime(2) })
          .changed
      ).toBe(false)
      store.setEnabled({ enabled: true, timestamp: fixtureTime(3) })
      expect(store.getSettings()).toEqual({
        enabled: true,
        ratePerMinute: 3,
        ratePerUtcDay: 40,
        updatedAt: fixtureTime(3)
      })
      store.setEnabled({ enabled: false, timestamp: fixtureTime(4) })
      expect(store.getSettings()).toMatchObject({ ratePerMinute: 3, ratePerUtcDay: 40 })
      expect(store.listEvents({ limit: 10 }).map((event) => event.kind)).toEqual([
        'ingress_disabled',
        'ingress_enabled',
        'rate_limits_changed'
      ])
    })

    it('restores the defaults when the user sets them again', () => {
      store.setRateLimits({ ratePerMinute: 1, ratePerUtcDay: 1, timestamp: fixtureTime(1) })
      store.setRateLimits({ ratePerMinute: 6, ratePerUtcDay: 100, timestamp: fixtureTime(2) })
      expect(store.getSettings()).toMatchObject({ ratePerMinute: 6, ratePerUtcDay: 100 })
    })

    it.each([
      ['a per-minute cap of 0', { ratePerMinute: 0, ratePerUtcDay: 100 }],
      ['a per-minute cap above 60', { ratePerMinute: 61, ratePerUtcDay: 100 }],
      ['a per-day cap of 0', { ratePerMinute: 6, ratePerUtcDay: 0 }],
      ['a per-day cap above 10,000', { ratePerMinute: 6, ratePerUtcDay: 10_001 }],
      ['a fractional cap', { ratePerMinute: 2.5, ratePerUtcDay: 100 }],
      ['a missing cap', { ratePerMinute: 6 }],
      ['an unknown field', { ratePerMinute: 6, ratePerUtcDay: 100, unlimited: true }]
    ])('refuses %s and changes nothing', (_label, override) => {
      // @ts-expect-error the cases deliberately break the input type
      const attempt = () => store.setRateLimits({ timestamp: fixtureTime(1), ...override })
      expect(errorCodeOf(attempt)).toBe('dot_invalid_input')
      expect(store.getSettings().updatedAt).toBeNull()
      expect(store.listEvents({ limit: 10 })).toEqual([])
    })
  })

  describe('the workspace allowlist (a default the user can change, one workspace at a time)', () => {
    it('is empty by default', () => {
      expect(store.listWorkspaces()).toEqual([])
      expect(store.getWorkspace('dws_0123456789abcdef01234567')).toBeNull()
    })

    it('enables a workspace under a random opaque reference that carries no path material', () => {
      const { workspace, changed } = store.enableWorkspace(enable())
      expect(changed).toBe(true)
      expect(workspace.workspaceRef).toMatch(/^dws_[0-9a-f]{24}$/)
      expect(workspace.workspaceRef).not.toContain('fixture')
      expect(workspace).toEqual({
        workspaceRef: workspace.workspaceRef,
        workspaceId: FIXTURE_WORKSPACE_ID,
        workspaceBinding: FIXTURE_BINDING,
        label: 'fixture-repo',
        enabled: true,
        createdAt: fixtureTime(1),
        updatedAt: fixtureTime(1)
      })
      expect(store.getWorkspace(workspace.workspaceRef)).toEqual(workspace)
    })

    it('gives two workspaces two different references', () => {
      const a = store.enableWorkspace(enable()).workspace.workspaceRef
      const b = store.enableWorkspace(enable({ workspaceId: 'other-repo::/other' })).workspace
        .workspaceRef
      expect(a).not.toBe(b)
      expect(store.listWorkspaces().map((entry) => entry.workspaceRef)).toEqual([a, b])
    })

    it('keeps the same reference when the same workspace is enabled again', () => {
      const first = store.enableWorkspace(enable()).workspace
      const again = store.enableWorkspace(enable({ timestamp: fixtureTime(5) }))
      expect(again.changed).toBe(false)
      expect(again.workspace).toEqual(first)
      expect(store.listEvents({ limit: 10 })).toHaveLength(1)
    })

    it('disables a workspace without deleting its reference, and re-enables under the same reference', () => {
      const { workspaceRef } = store.enableWorkspace(enable()).workspace
      const off = store.disableWorkspace({ workspaceRef, timestamp: fixtureTime(2) })
      expect(off.changed).toBe(true)
      expect(off.workspace).toMatchObject({
        workspaceRef,
        enabled: false,
        updatedAt: fixtureTime(2)
      })
      expect(store.disableWorkspace({ workspaceRef, timestamp: fixtureTime(3) }).changed).toBe(
        false
      )
      expect(store.listWorkspaces({ enabledOnly: true })).toEqual([])
      expect(store.listWorkspaces()).toHaveLength(1)
      const back = store.enableWorkspace(enable({ timestamp: fixtureTime(4) }))
      expect(back.changed).toBe(true)
      expect(back.workspace).toMatchObject({ workspaceRef, enabled: true })
    })

    it('records a changed binding or label as a change under the same reference', () => {
      const { workspaceRef } = store.enableWorkspace(enable()).workspace
      const rebound = store.enableWorkspace(
        enable({ workspaceBinding: 'e'.repeat(64), label: 'renamed', timestamp: fixtureTime(6) })
      )
      expect(rebound.changed).toBe(true)
      expect(rebound.workspace).toMatchObject({
        workspaceRef,
        workspaceBinding: 'e'.repeat(64),
        label: 'renamed'
      })
    })

    it('refuses to disable an unknown reference', () => {
      expect(
        errorCodeOf(() =>
          store.disableWorkspace({
            workspaceRef: 'dws_ffffffffffffffffffffffff',
            timestamp: fixtureTime()
          })
        )
      ).toBe('dot_workspace_unknown')
    })

    it.each([
      ['a blank workspace id', { workspaceId: '  ' }],
      ['a short binding', { workspaceBinding: 'abc' }],
      ['an empty label', { label: '' }],
      ['a label with a path separator', { label: 'work/billing' }],
      ['a label with a backslash', { label: 'work\\billing' }],
      ['a label with a line break', { label: 'a\nb' }],
      ['a label over 120 characters', { label: 'x'.repeat(121) }],
      ['an unknown field', { extra: true }]
    ])('refuses %s and stores nothing', (_label, override) => {
      expect(errorCodeOf(() => store.enableWorkspace(enable(override)))).toBe('dot_invalid_input')
      expect(store.listWorkspaces()).toEqual([])
    })

    it.each([
      ['a bidi override', 'fixture‮repo'],
      ['a zero-width space', 'fixture​repo'],
      ['a tag character', 'fixture\u{E0041}repo']
    ])('refuses a label with %s, says why and stores nothing', (_name, label) => {
      let refusal: unknown = null
      try {
        store.enableWorkspace(enable({ label }))
      } catch (error) {
        refusal = error
      }
      expect(refusal).toMatchObject({
        code: 'dot_invalid_input',
        message: DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE,
        data: { fields: ['label'], reason: 'label_invisible_characters' }
      })
      expect(store.listWorkspaces()).toEqual([])
    })

    it('records allowlist changes as audit events with ids only', () => {
      const { workspaceRef } = store.enableWorkspace(enable()).workspace
      store.disableWorkspace({ workspaceRef, timestamp: fixtureTime(2) })
      store.setEnabled({ enabled: true, timestamp: fixtureTime(3) })
      const events = store.listEvents({ limit: 10 })
      expect(events.map((event) => [event.kind, event.workspaceRef, event.dotRequestId])).toEqual([
        ['ingress_enabled', null, null],
        ['workspace_disabled', workspaceRef, null],
        ['workspace_enabled', workspaceRef, null]
      ])
      expect(events.map((event) => event.recordedAt)).toEqual([
        fixtureTime(3),
        fixtureTime(2),
        fixtureTime(1)
      ])
      expect(JSON.stringify(events)).not.toContain(FIXTURE_WORKSPACE_ID)
      expect(JSON.stringify(events)).not.toContain('fixture-repo')
    })
  })

  describe('events paging', () => {
    it('pages newest first with a before cursor and refuses a bad limit', () => {
      for (let i = 0; i < 5; i += 1) {
        store.setEnabled({ enabled: i % 2 === 0, timestamp: fixtureTime(i + 1) })
      }
      const firstPage = store.listEvents({ limit: 2 })
      expect(firstPage).toHaveLength(2)
      const next = store.listEvents({ limit: 10, beforeSequence: firstPage[1]?.sequence })
      expect(next.map((event) => event.sequence)).toEqual([3, 2, 1].slice(0, next.length))
      expect(next).toHaveLength(3)
      expect(errorCodeOf(() => store.listEvents({ limit: 0 }))).toBe('dot_invalid_input')
      expect(errorCodeOf(() => store.listEvents({ limit: 1001 }))).toBe('dot_invalid_input')
    })
  })
})
