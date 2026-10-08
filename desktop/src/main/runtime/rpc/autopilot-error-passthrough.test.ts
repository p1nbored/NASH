import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_ERROR_CODES } from '../../../shared/dot-ingress/dot-ingress-errors'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { PERMISSION_RELAY_ERROR_CODES } from '../permission-relay/permission-relay-caller'
import { APP_RUN_POLICY_ERROR_CODES } from '../workflow-run/app-run-policy'
import { mapDispatcherError } from './dispatcher-error-response'
import { mapRuntimeError } from './errors'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './methods/orchestration/autopilot/autopilot-task-api'

// FIXTURE_ONLY: the token below is fake; it only has the shape the masker recognizes.
const FAKE_SECRET_FLAG = '--token=FIXTURE_ONLY_NOT_A_TOKEN'
const meta = { runtimeId: 'runtime-1' }

const AUTOPILOT_CODES = [
  ...Object.values(APP_RUN_POLICY_ERROR_CODES),
  ...Object.values(AUTOPILOT_TASK_API_ERROR_CODES),
  ...Object.values(PERMISSION_RELAY_ERROR_CODES),
  // Codes the stores, the launcher, the executors and the classifier raise (A2, B3, C2, C3, C4).
  'autopilot_recovery_required',
  'autopilot_run_not_live',
  'autopilot_primary_session_not_configured',
  'autopilot_coordinator_route_unavailable',
  'autopilot_route_not_available',
  'autopilot_classification_failed'
]
const DOT_CODES = [...DOT_INGRESS_ERROR_CODES, 'dot_invalid_input', 'dot_transaction_unavailable']

describe('autopilot and dot error passthrough', () => {
  it.each([...AUTOPILOT_CODES, ...DOT_CODES])('keeps %s with its message and data', (code) => {
    const response = mapRuntimeError(
      'req_1',
      meta,
      new OrchestrationError(code, 'Fixture refusal. No effects were applied.', {
        effectsApplied: false,
        reason: 'fixture_reason'
      })
    )
    expect(response).toEqual({
      id: 'req_1',
      ok: false,
      error: {
        code,
        message: 'Fixture refusal. No effects were applied.',
        data: { effectsApplied: false, reason: 'fixture_reason' }
      },
      _meta: meta
    })
  })

  it('keeps the next-step arguments a policy refusal carries', () => {
    const nextCommandArgs = ['orchestration', 'task-start', '--task', 'task_1']
    const response = mapDispatcherError(
      { id: 'req_2', authToken: 'fixture', method: 'orchestration.taskUpdate', params: {} },
      meta,
      new OrchestrationError(APP_RUN_POLICY_ERROR_CODES.taskStatusRefused, 'Use task-start.', {
        nextCommandArgs
      })
    )
    expect(response).toMatchObject({
      ok: false,
      error: { code: APP_RUN_POLICY_ERROR_CODES.taskStatusRefused, data: { nextCommandArgs } }
    })
  })

  it('sends no data key when the refusal has none', () => {
    const response = mapRuntimeError(
      'req_3',
      meta,
      new OrchestrationError('autopilot_run_not_found', 'The run was not found.')
    )
    expect(response.ok).toBe(false)
    expect(Object.keys(response.ok ? {} : response.error)).toEqual(['code', 'message'])
  })

  it('masks secret-shaped text in the message and in every data string', () => {
    const response = mapRuntimeError(
      'req_4',
      meta,
      new OrchestrationError('autopilot_invalid_input', `Invalid input ${FAKE_SECRET_FLAG}`, {
        fields: [`command ${FAKE_SECRET_FLAG}`],
        nested: { detail: FAKE_SECRET_FLAG, count: 2, ok: true, none: null }
      })
    )
    const text = JSON.stringify(response)
    expect(text).not.toContain('FIXTURE_ONLY_NOT_A_TOKEN')
    expect(response).toMatchObject({
      error: {
        code: 'autopilot_invalid_input',
        data: { nested: { count: 2, ok: true, none: null } }
      }
    })
  })

  it('bounds a long message', () => {
    const response = mapRuntimeError(
      'req_5',
      meta,
      new OrchestrationError('dot_request_not_found', 'x'.repeat(5_000))
    )
    expect(response.ok ? '' : response.error.message.length).toBeLessThanOrEqual(500)
  })

  it('drops data it cannot carry as JSON instead of failing the response', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    const response = mapRuntimeError(
      'req_6',
      meta,
      new OrchestrationError('autopilot_owner_conflict', 'Fixture.', {
        cyclic,
        when: new Date(0),
        run: () => 'never'
      })
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'autopilot_owner_conflict' } })
    expect(JSON.stringify(response)).not.toContain('never')
  })

  it('does not trust a plain Error that only carries an autopilot or dot code', () => {
    for (const code of ['autopilot_run_not_live', 'dot_ingress_disabled']) {
      const impostor = Object.assign(new Error(`fixture ${FAKE_SECRET_FLAG}`), { code })
      expect(mapRuntimeError('req_7', meta, impostor)).toMatchObject({
        ok: false,
        error: { code: 'runtime_error' }
      })
    }
  })

  it('does not pass a code that only looks like the namespace', () => {
    for (const code of ['autopilot_', 'dot_', 'autopilot_Bad Code', 'dotIngress_x']) {
      expect(mapRuntimeError('req_8', meta, new OrchestrationError(code, 'fixture'))).toMatchObject(
        { ok: false, error: { code: 'runtime_error' } }
      )
    }
  })

  it('gives the workbench codes the same masked data, so a refused run stop keeps its stopCode', () => {
    const response = mapRuntimeError(
      'req_9',
      meta,
      new OrchestrationError('workbench_run_stop_refused', 'Refused.', { stopCode: 'x' })
    )
    expect(response).toEqual({
      id: 'req_9',
      ok: false,
      error: { code: 'workbench_run_stop_refused', message: 'Refused.', data: { stopCode: 'x' } },
      _meta: meta
    })
  })
})
