import { afterEach, describe, expect, it } from 'vitest'
import { isOrcaSessionId } from '../../../../../../shared/orca-session-address'
import { readSchemaEntries } from '../../../../orchestration/db/autopilot-runtime.test-fixture'
import { getPrimarySessionStore } from '../../../../orchestration/db/primary-session-store'
import { OTHER_PANE_KEY } from '../../../../workflow-run/app-run-policy.test-fixture'
import { resolveAutopilotPrimaryCaller } from './autopilot-primary-caller'
import type { RpcContext } from '../../../core'
import { AUTOPILOT_TASK_API_ERROR_CODES } from './autopilot-task-api'
import {
  PRIMARY_EVIDENCE,
  PRIMARY_HANDLE,
  PRIMARY_PANE,
  createTaskApiHarness,
  primaryAuthority,
  type TaskApiHarness
} from './autopilot-task-api.test-fixture'

const CALLER_REFUSED = AUTOPILOT_TASK_API_ERROR_CODES.callerRefused

type CallerContext = Pick<RpcContext, 'orchestrationCompatibilityEvidence' | 'orchestrationCaller'>

function refused(reason: string) {
  return {
    code: CALLER_REFUSED,
    message: expect.stringMatching(/^Only the primary session of an app run/),
    data: expect.objectContaining({ reason, effectsApplied: false })
  }
}

function sessionCaller() {
  const id = '11111111-2222-4333-8444-555555555555'
  if (!isOrcaSessionId(id)) {
    throw new Error('fixture session id is not an Orca session id')
  }
  return {
    address: `orca_session_id:${id}`,
    terminalHandle: null,
    paneKey: null,
    orcaSessionId: id,
    sessionId: id,
    workspaceId: 'fixture-repo::/fixture/repo'
  }
}

describe('resolveAutopilotPrimaryCaller', () => {
  let harness: TaskApiHarness | undefined

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  function resolve(requireActiveRun: boolean, context?: CallerContext) {
    const current = harness
    if (!current) {
      throw new Error('no harness')
    }
    return () =>
      resolveAutopilotPrimaryCaller(current.runtime, context ?? current.context, {
        requireActiveRun
      })
  }

  it('accepts the attested primary of an active app run', () => {
    harness = createTaskApiHarness()
    const caller = resolve(true)()
    expect(caller).toMatchObject({
      runId: harness.runId,
      terminalHandle: PRIMARY_HANDLE,
      paneKey: PRIMARY_PANE,
      processIncarnation: `incarnation_${harness.runId}`,
      runStatus: 'active'
    })
    expect(caller.ownerId).toBe(
      getPrimarySessionStore(harness.db).findLiveByRun(harness.runId)?.ownerId
    )
  })

  it('refuses a caller without attested evidence', () => {
    harness = createTaskApiHarness()
    expect(resolve(true, {})).toThrow(expect.objectContaining(refused('not_attested')))
    harness.setAuthority(null)
    expect(resolve(true, { orchestrationCompatibilityEvidence: PRIMARY_EVIDENCE })).toThrow(
      expect.objectContaining(refused('not_attested'))
    )
  })

  it('refuses a structured session caller, which is never a primary', () => {
    harness = createTaskApiHarness()
    const context = {
      orchestrationCompatibilityEvidence: PRIMARY_EVIDENCE,
      orchestrationCaller: sessionCaller()
    }
    expect(resolve(false, context)).toThrow(expect.objectContaining(refused('session_caller')))
  })

  it('refuses native adoption without live host evidence and creates no table', () => {
    harness = createTaskApiHarness({ appRun: false })
    const before = readSchemaEntries(harness.db.db)
    expect(resolve(true)).toThrow(
      expect.objectContaining({ code: 'autopilot_native_coordinator_refused' })
    )
    expect(readSchemaEntries(harness.db.db)).toEqual(before)
  })

  it('refuses a pane that is bound to no run', () => {
    harness = createTaskApiHarness()
    harness.setAuthority(primaryAuthority(harness.runId, { paneKey: OTHER_PANE_KEY }))
    expect(resolve(true)).toThrow(expect.objectContaining(refused('run_required')))
  })

  it('refuses a pane that coordinates the run but is not its recorded primary', () => {
    harness = createTaskApiHarness({ ownerPane: OTHER_PANE_KEY })
    expect(resolve(true)).toThrow(expect.objectContaining(refused('not_run_primary')))
  })

  it('refuses another process in the primary pane', () => {
    harness = createTaskApiHarness()
    harness.setAuthority(primaryAuthority(harness.runId, { processIncarnation: 'incarnation_x' }))
    expect(resolve(true)).toThrow(expect.objectContaining(refused('process_mismatch')))
  })

  it('refuses mutations outside an active run but lets a read through', () => {
    harness = createTaskApiHarness({ runStatus: 'completing' })
    expect(resolve(true)).toThrow(
      expect.objectContaining({
        code: 'autopilot_run_not_live',
        data: expect.objectContaining({ runStatus: 'completing', effectsApplied: false })
      })
    )
    expect(resolve(false)().runStatus).toBe('completing')
  })
})
