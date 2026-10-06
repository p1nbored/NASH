import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as routeContract from './clef-route-contract'
import {
  ClefRecordIdSchema,
  D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS,
  PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS,
  R33_ROUTE_BLOCKER_DETAILS,
  ROUTE_BLOCKER_DETAILS,
  ROUTE_BLOCKER_REASONS,
  ROUTING_STATUSES,
  RouteBlockerSchema
} from './clef-route-contract'

describe('routing vocabularies', () => {
  it('pins the spec section 3 enumerations', () => {
    expect(ROUTING_STATUSES).toEqual([
      'not_configured',
      'sealing_unavailable',
      'contract_unverified',
      'identity_unpinned',
      'ready',
      'unreachable',
      'circuit_open',
      'quota_latched',
      'auth_failed'
    ])
    expect(ROUTE_BLOCKER_REASONS).toEqual([
      'classifier_unavailable',
      'invalid_output',
      'missing_inputs',
      'ambiguous',
      'no_eligible_profile',
      'launch_blocked'
    ])
    expect(R33_ROUTE_BLOCKER_DETAILS).toHaveLength(13)
    expect(R33_ROUTE_BLOCKER_DETAILS).toContain('needs_clarification')
    expect(PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS).toEqual([
      'contract_unverified',
      'interrupted',
      'choice_outside_legal_set',
      'inconsistent_type_profile',
      'required_profile_unavailable',
      'non_english_objective',
      'estimate_exceeded',
      'routing_in_progress',
      'empty_set',
      'response_schema_violation'
    ])
    expect(D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS).toEqual([
      'inconsistent_delegation',
      'coordinator_route_unavailable',
      'launch_refused',
      'launch_unverifiable'
    ])
    expect(ROUTE_BLOCKER_DETAILS).toEqual([
      ...R33_ROUTE_BLOCKER_DETAILS,
      ...PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS,
      ...D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS
    ])
  })

  it('accepts exactly one reason and one detail per blocker', () => {
    const blocker = { reason: 'ambiguous', detail: 'low_margin' }
    expect(RouteBlockerSchema.parse(blocker)).toEqual(blocker)
    expect(RouteBlockerSchema.safeParse({ ...blocker, note: 'x' }).success).toBe(false)
    expect(
      RouteBlockerSchema.safeParse({ reason: 'CLEF_NOT_CONFIGURED', detail: 'x' }).success
    ).toBe(false)
    expect(RouteBlockerSchema.safeParse({ reason: 'ambiguous', detail: 'next_best' }).success).toBe(
      false
    )
  })

  it('accepts the D-016 classification and launch blockers additively', () => {
    for (const blocker of [
      { reason: 'ambiguous', detail: 'inconsistent_delegation' },
      { reason: 'launch_blocked', detail: 'coordinator_route_unavailable' },
      { reason: 'launch_blocked', detail: 'launch_refused' },
      { reason: 'launch_blocked', detail: 'launch_unverifiable' }
    ]) {
      expect(RouteBlockerSchema.parse(blocker)).toEqual(blocker)
    }
  })

  it('accepts the empty-set and response-schema details the classifier and validator emit', () => {
    for (const blocker of [
      { reason: 'no_eligible_profile', detail: 'empty_set' },
      { reason: 'invalid_output', detail: 'response_schema_violation' }
    ]) {
      expect(RouteBlockerSchema.parse(blocker)).toEqual(blocker)
    }
  })

  it('no longer knows the codex-plugin-cc binding blocker', () => {
    expect(ROUTE_BLOCKER_DETAILS).not.toContain('plugin_binding_unverified')
    expect(
      RouteBlockerSchema.safeParse({
        reason: 'classifier_unavailable',
        detail: 'plugin_binding_unverified'
      }).success
    ).toBe(false)
  })
})

describe('retired route decision contract (D-016)', () => {
  it('exports no route decision, tuple guard, rejected candidate or route outcome', () => {
    expect(Object.keys(routeContract).sort()).toEqual([
      'ClefRecordIdSchema',
      'D016_ROUTE_BLOCKER_DETAIL_EXTENSIONS',
      'PHASE1_ROUTE_BLOCKER_DETAIL_EXTENSIONS',
      'R33_ROUTE_BLOCKER_DETAILS',
      'ROUTE_BLOCKER_DETAILS',
      'ROUTE_BLOCKER_REASONS',
      'ROUTING_STATUSES',
      'RouteBlockerDetailSchema',
      'RouteBlockerReasonSchema',
      'RouteBlockerSchema',
      'RoutingStatusSchema'
    ])
  })

  it.each([
    'execution-tuple',
    'route-binding-contract',
    'clef-route-decision-answers',
    'workbench-route-results',
    'model-pin-policy'
  ])('keeps the retired shared/clef module %s deleted, with its test', (name) => {
    // Why the control: a wrong base path would make every absence check pass.
    expect(existsSync(join(process.cwd(), 'src/shared/clef', 'clef-route-contract.ts'))).toBe(true)
    for (const file of [`${name}.ts`, `${name}.test.ts`]) {
      expect(existsSync(join(process.cwd(), 'src/shared/clef', file))).toBe(false)
    }
  })
})

describe('ClefRecordIdSchema', () => {
  it.each(['rd_01', 'spend_fixture_1_d059ca24-0f93-4c06-b317-dc2a95d6920b', 'raw.1:a', 'x'])(
    'accepts the plain record id %s',
    (id) => {
      expect(ClefRecordIdSchema.parse(id)).toBe(id)
    }
  )

  it.each(['', 'raw fixture', 'raw/1', 'x'.repeat(129), 'rd_é'])(
    'rejects %j, which is not a plain record id',
    (id) => {
      expect(ClefRecordIdSchema.safeParse(id).success).toBe(false)
    }
  )
})
