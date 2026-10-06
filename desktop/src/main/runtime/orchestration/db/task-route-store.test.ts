import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTaskClassificationStore } from './task-classification-store'
import { getTaskRouteStore, type TaskRouteInput } from './task-route-store'
import { createAppRunHarness, seedTask, type AppRunHarness } from './app-attempt.test-fixture'
import { FIXTURE_HASH_A, errorCodeOf, fixtureTime } from './autopilot-runtime.test-fixture'

// FIXTURE_ONLY: the secret-shaped value below is synthetic and matches no real credential.
const FAKE_SECRET = `sk-${'x'.repeat(24)}`

function codexRoute(
  classificationId: string,
  overrides: Partial<TaskRouteInput> = {}
): TaskRouteInput {
  return {
    classificationId,
    routingTableVersion: 1,
    routingTableSha256: FIXTURE_HASH_A,
    target: 'codex_cli',
    model: 'gpt-6.1-sol',
    policyLevel: 'max',
    cliSetting: { reasoningEffort: 'max' },
    status: 'available',
    reasons: [],
    availability: { cli: 'present', auth: 'ok' },
    timestamp: fixtureTime(4),
    ...overrides
  }
}

describe('task route store', () => {
  let harness: AppRunHarness
  let taskId: string
  let classificationId: string
  beforeEach(() => {
    harness = createAppRunHarness()
    taskId = seedTask(harness).taskId
    classificationId = getTaskClassificationStore(harness.owner).record({
      taskId,
      attempt: 1,
      outcome: 'classified',
      detail: null,
      needsDelegation: true,
      taskType: 'software_engineering',
      answers: null,
      bundleSha256: null,
      taxonomyVersion: null,
      profileSha256: null,
      classifierModel: null,
      rawResponseId: null,
      spendReservationId: null,
      timestamp: fixtureTime(3)
    }).classificationId
  })
  afterEach(() => harness.owner.close())

  const store = () => getTaskRouteStore(harness.owner)
  const rowCount = () => harness.owner.db.prepare('SELECT count(*) AS n FROM task_routes').get()?.n

  it('is one store per database', () => {
    expect(getTaskRouteStore(harness.owner)).toBe(store())
  })

  describe('record', () => {
    it.each(['ultra', 'none', 'minimal'] as const)(
      'stores a route at the policy level %s (D-027)',
      (policyLevel) => {
        const record = store().record(
          codexRoute(classificationId, {
            policyLevel,
            cliSetting: { reasoningEffort: policyLevel }
          })
        )
        expect(record.policyLevel).toBe(policyLevel)
      }
    )

    it('stores an available route with its table version, setting and availability snapshot', () => {
      const record = store().record(codexRoute(classificationId))
      expect(record).toMatchObject({
        classificationId,
        taskId,
        routingTableVersion: 1,
        routingTableSha256: FIXTURE_HASH_A,
        target: 'codex_cli',
        model: 'gpt-6.1-sol',
        policyLevel: 'max',
        cliSetting: { reasoningEffort: 'max' },
        status: 'available',
        reasons: [],
        availability: { cli: 'present', auth: 'ok' },
        createdAt: fixtureTime(4),
        orphaned: false
      })
      expect(record.routeId).toMatch(/^route_/)
    })

    it('stores a task that is not delegated with no target, model or setting', () => {
      const record = store().record(
        codexRoute(classificationId, {
          target: null,
          model: null,
          policyLevel: null,
          cliSetting: null,
          availability: null,
          status: 'not_delegated'
        })
      )
      expect(record).toMatchObject({ target: null, model: null, status: 'not_delegated' })
    })

    it('stores an unavailable or unverified route with its reasons and substitutes nothing', () => {
      const unavailable = store().record(
        codexRoute(classificationId, {
          status: 'unavailable',
          reasons: ['workspace_not_git', 'auth_failed']
        })
      )
      expect(unavailable).toMatchObject({
        status: 'unavailable',
        target: 'codex_cli',
        model: 'gpt-6.1-sol',
        reasons: ['workspace_not_git', 'auth_failed']
      })
      expect(
        store().record(
          codexRoute(classificationId, { status: 'unverified', reasons: ['auth_unobserved'] })
        ).status
      ).toBe('unverified')
    })

    it('stores an inheriting route with no model of its own', () => {
      const record = store().record(
        codexRoute(classificationId, {
          target: 'claude_workflow',
          model: null,
          policyLevel: 'inherit',
          cliSetting: null
        })
      )
      expect(record).toMatchObject({
        target: 'claude_workflow',
        model: null,
        policyLevel: 'inherit'
      })
    })

    it('refuses combinations of status, target and model that cannot be dispatched', () => {
      const bad: TaskRouteInput[] = [
        codexRoute(classificationId, { status: 'not_delegated' }),
        codexRoute(classificationId, { target: null, status: 'available' }),
        codexRoute(classificationId, { target: null, status: 'unavailable' }),
        codexRoute(classificationId, {
          status: 'not_delegated',
          target: null,
          model: 'gpt-6.1-sol',
          policyLevel: null,
          cliSetting: null
        }),
        codexRoute(classificationId, { model: null, policyLevel: 'max' }),
        // Why: only the targets that run inside the primary session's configuration may inherit.
        codexRoute(classificationId, { policyLevel: 'inherit', model: null, cliSetting: null }),
        codexRoute(classificationId, { target: 'gemini_cli' as never }),
        codexRoute(classificationId, { policyLevel: 'extreme' as never }),
        codexRoute(classificationId, { status: 'maybe' as never }),
        codexRoute(classificationId, { routingTableVersion: 0 }),
        codexRoute(classificationId, { routingTableSha256: 'abc' }),
        codexRoute(classificationId, { model: 'bad model' }),
        codexRoute(classificationId, { reasons: ['Not A Code'] }),
        codexRoute(classificationId, { reasons: Array.from({ length: 17 }, () => 'a_reason') }),
        codexRoute(classificationId, { cliSetting: ['max'] as never }),
        codexRoute(classificationId, { cliSetting: { note: 'x'.repeat(2049) } }),
        codexRoute(classificationId, { availability: { note: 'x'.repeat(8193) } })
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store().record(input))).toBe('autopilot_invalid_input')
      }
      expect(rowCount()).toBe(0)
    })

    it('refuses a snapshot that still holds a secret', () => {
      expect(
        errorCodeOf(() =>
          store().record(codexRoute(classificationId, { availability: { note: FAKE_SECRET } }))
        )
      ).toBe('autopilot_unredacted_text')
      expect(rowCount()).toBe(0)
    })

    it('refuses a classification that does not exist', () => {
      expect(errorCodeOf(() => store().record(codexRoute('classification_unknown')))).toBe(
        'autopilot_classification_not_found'
      )
    })
  })

  describe('reads', () => {
    it('keeps every re-check as a new row and reads the newest as the route', () => {
      const first = store().record(codexRoute(classificationId))
      const second = store().record(
        codexRoute(classificationId, {
          status: 'unavailable',
          reasons: ['quota_exhausted'],
          timestamp: fixtureTime(9)
        })
      )
      expect(store().get(first.routeId)).toEqual(first)
      expect(store().latestForClassification(classificationId)).toEqual(second)
      expect(store().latestForTask(taskId)).toEqual(second)
      expect(rowCount()).toBe(2)
    })

    it('returns null for unknown ids', () => {
      expect(store().get('route_unknown')).toBeNull()
      expect(store().latestForClassification('classification_unknown')).toBeNull()
      expect(store().latestForTask('task_unknown')).toBeNull()
    })

    it('reads a route as orphaned once Orca no longer holds its task', () => {
      const route = store().record(codexRoute(classificationId))
      harness.owner.resetAll()
      expect(store().get(route.routeId)?.orphaned).toBe(true)
    })
  })
})
