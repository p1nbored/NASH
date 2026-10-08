import { describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  genericErrorMessage,
  launchBlockerMessage,
  unexpectedResponseMessage,
  WORKBENCH_MAPPED_ERROR_CODES,
  workbenchErrorMessage
} from './workbench-error-copy'
import { toWorkbenchError, WorkbenchResponseError } from './workbench-rpc-error'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

function rpcFailure(code: string, message: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'call', ok: false, error: { code, message } })
}

describe('workbenchErrorMessage', () => {
  it('words every mapped code as a sentence that never contains the code itself', () => {
    expect(WORKBENCH_MAPPED_ERROR_CODES.length).toBeGreaterThan(20)
    for (const code of WORKBENCH_MAPPED_ERROR_CODES) {
      const message = workbenchErrorMessage(code)
      expect(message, code).toMatch(/^[A-Z].*\.$/)
      expect(message).not.toContain(code)
      expect(message).not.toMatch(/[a-z]+_[a-z]+/)
    }
  })

  it('maps the refusals the Workbench sections meet most', () => {
    expect(workbenchErrorMessage('autopilot_validation_conflict')).toBe(
      'This result was already decided.'
    )
    expect(workbenchErrorMessage('workbench_validation_pass_running')).toBe(
      'A validation pass is already running. Check again when it finishes.'
    )
    expect(workbenchErrorMessage('autopilot_permission_relay_unavailable')).toBe(
      'Permission prompts are not available right now.'
    )
    expect(workbenchErrorMessage('workbench_run_stop_unconfirmed')).toBe(
      'The stop could not be confirmed, so the run is still open. Close its terminal tab and try again.'
    )
  })

  it('returns null for an unknown code, including object prototype names', () => {
    expect(workbenchErrorMessage('runtime_error')).toBeNull()
    expect(workbenchErrorMessage('some_future_code')).toBeNull()
    expect(workbenchErrorMessage('toString')).toBeNull()
    expect(workbenchErrorMessage('__proto__')).toBeNull()
  })
})

describe('launchBlockerMessage', () => {
  it('words the three launch blockers without naming internal tables or codes', () => {
    const noModel = launchBlockerMessage({
      reason: 'launch_blocked',
      detail: 'coordinator_route_unavailable'
    })
    expect(noModel).toBe('No model is available to start this run. Check Task routing in Settings.')
    expect(noModel).not.toMatch(/Routing Table|coordinator/)
    expect(launchBlockerMessage({ reason: 'launch_blocked', detail: 'launch_refused' })).toBe(
      'The run could not be started.'
    )
    expect(launchBlockerMessage({ reason: 'launch_blocked', detail: 'launch_unverifiable' })).toBe(
      'A run was created, but its start could not be confirmed.'
    )
  })

  it('gives any other blocker one generic sentence', () => {
    for (const blocker of [
      { reason: 'classifier_unavailable', detail: 'not_configured' },
      { reason: 'launch_blocked', detail: 'some_future_detail' },
      { reason: 'ambiguous', detail: 'launch_refused' }
    ]) {
      expect(launchBlockerMessage(blocker)).toBe('This request could not start a run.')
    }
  })
})

describe('toWorkbenchError', () => {
  it('shows the mapped sentence for a known code and keeps the server text for details only', () => {
    const error = toWorkbenchError(
      rpcFailure('autopilot_validation_conflict', 'Validation val_7 is already waived.')
    )
    expect(error).toEqual({
      code: 'autopilot_validation_conflict',
      message: 'This result was already decided.',
      detail: 'Validation val_7 is already waived.'
    })
  })

  it('falls back to the caller sentence, or a generic one, for an unknown code', () => {
    const failure = rpcFailure('method_gone_away', 'Unknown method workbench.runs.tasks')
    expect(toWorkbenchError(failure, 'The task list could not be read.')).toEqual({
      code: 'method_gone_away',
      message: 'The task list could not be read.',
      detail: 'Unknown method workbench.runs.tasks'
    })
    expect(toWorkbenchError(failure).message).toBe(genericErrorMessage())
    expect(genericErrorMessage()).toBe('Something went wrong.')
  })

  it('never shows a raw runtime error message', () => {
    const error = toWorkbenchError(new Error('ECONNRESET at ipc channel 7'))
    expect(error).toEqual({
      code: 'request_failed',
      message: 'Something went wrong.',
      detail: 'ECONNRESET at ipc channel 7'
    })
    expect(toWorkbenchError('not an error')).toEqual({
      code: 'request_failed',
      message: 'Something went wrong.'
    })
  })

  it('words a contradicting or unparsable response the same way and keeps the specifics apart', () => {
    const mismatch = toWorkbenchError(
      new WorkbenchResponseError('The run store returned a different run.')
    )
    expect(mismatch).toEqual({
      code: 'invalid_response',
      message: unexpectedResponseMessage(),
      detail: 'The run store returned a different run.'
    })
    expect(unexpectedResponseMessage()).toBe('The app returned an unexpected response.')
  })
})
