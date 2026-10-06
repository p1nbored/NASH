import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { mapRuntimeError } from './errors'
import { mapDispatcherError } from './dispatcher-error-response'
import { OrchestrationError } from '../orchestration/orchestration-error'

const meta = { runtimeId: 'runtime-1' }
// FIXTURE_ONLY: the token below is fake; it only has the shape the masker recognizes.
const FAKE_SECRET_FLAG = '--token=FIXTURE_ONLY_NOT_A_TOKEN'

describe('mapRuntimeError workbench passthrough', () => {
  it.each([
    'workbench_request_not_found',
    'workbench_revision_conflict',
    'workbench_invalid_transition',
    'workbench_recovery_required',
    'workbench_run_stop_refused'
  ])('keeps the code, message and data of an OrchestrationError %s', (code) => {
    const response = mapRuntimeError(
      'req_1',
      meta,
      new OrchestrationError(code, 'fixture refusal', { stopCode: 'autopilot_fixture_code' })
    )
    expect(response).toEqual({
      id: 'req_1',
      ok: false,
      error: { code, message: 'fixture refusal', data: { stopCode: 'autopilot_fixture_code' } },
      _meta: meta
    })
  })

  it('masks secret-shaped text in the message and data, as for autopilot and dot refusals', () => {
    const response = mapRuntimeError(
      'req_1',
      meta,
      new OrchestrationError('workbench_run_stop_refused', `Refused ${FAKE_SECRET_FLAG}.`, {
        stopCode: 'autopilot_fixture_code',
        detail: `ran ${FAKE_SECRET_FLAG}`
      })
    )
    const wire = JSON.stringify(response)
    expect(wire).not.toContain('FIXTURE_ONLY_NOT_A_TOKEN')
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'workbench_run_stop_refused',
        data: { stopCode: 'autopilot_fixture_code', detail: 'ran --token=[redacted]' }
      }
    })
  })

  it('sends no data key when a workbench refusal has none', () => {
    const response = mapRuntimeError(
      'req_1',
      meta,
      new OrchestrationError('workbench_run_not_found', 'The run was not found.')
    )
    expect(response.ok ? {} : Object.keys(response.error)).toEqual(['code', 'message'])
  })

  it('keeps the code and message of unsupported_host and sends no data', () => {
    const response = mapRuntimeError(
      'req_1',
      meta,
      new OrchestrationError('unsupported_host', 'fixture refusal', { secret: 'must not travel' })
    )
    expect(response).toEqual({
      id: 'req_1',
      ok: false,
      error: { code: 'unsupported_host', message: 'fixture refusal' },
      _meta: meta
    })
  })

  it('still flattens an OrchestrationError outside the workbench codes', () => {
    expect(
      mapRuntimeError('req_1', meta, new OrchestrationError('fixture_unrelated_code', 'fixture'))
    ).toMatchObject({ ok: false, error: { code: 'runtime_error', message: 'fixture' } })
  })

  it.each(['workbench_request_not_found', 'unsupported_host'])(
    'does not trust a plain Error that only carries the code %s',
    (code) => {
      const impostor = Object.assign(new Error('fixture impostor'), { code })
      expect(mapRuntimeError('req_1', meta, impostor)).toMatchObject({
        ok: false,
        error: { code: 'runtime_error', message: 'fixture impostor' }
      })
    }
  )

  it('does not trust a plain object that only looks like an OrchestrationError', () => {
    expect(
      mapRuntimeError('req_1', meta, { code: 'workbench_request_not_found', message: 'fixture' })
    ).toMatchObject({ ok: false, error: { code: 'runtime_error' } })
  })
})

describe('mapDispatcherError workbench passthrough', () => {
  const request = (method: string) => ({
    id: 'req_2',
    authToken: 'fixture-token',
    method,
    params: null
  })

  it('routes workbench refusals through the shared runtime mapping', () => {
    expect(
      mapDispatcherError(
        request('workbench.list'),
        meta,
        new OrchestrationError('workbench_workspace_unavailable', 'fixture workspace')
      )
    ).toMatchObject({
      ok: false,
      error: { code: 'workbench_workspace_unavailable', message: 'fixture workspace' }
    })
  })

  it('hands a refused run stop to the client with the stop code that explains it', () => {
    expect(
      mapDispatcherError(
        request('workbench.runs.stop'),
        meta,
        new OrchestrationError(
          'workbench_run_stop_refused',
          'The session could not be stopped now. Nothing was changed.',
          { stopCode: 'autopilot_owner_not_running' }
        )
      )
    ).toMatchObject({
      ok: false,
      error: {
        code: 'workbench_run_stop_refused',
        data: { stopCode: 'autopilot_owner_not_running' }
      }
    })
  })

  it('maps validation failures on workbench methods to invalid_argument as before', () => {
    const invalid = z.string().safeParse(1)
    expect(invalid.success).toBe(false)
    expect(mapDispatcherError(request('workbench.submit'), meta, invalid.error)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
  })
})
