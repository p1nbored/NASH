import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchPermissionAnswerParams,
  WorkbenchPermissionListParams
} from '../../../../shared/rpc-contract/permission-relay-params'
import { OrcaRuntimeService } from '../../orca-runtime'
import { registerPermissionRelay } from '../../permission-relay/permission-relay-registry'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  createRelayHarness,
  relayRequest,
  type RelayHarness
} from '../../permission-relay/permission-relay.test-fixture'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import type { RpcContext } from '../core'
import {
  WORKBENCH_PERMISSION_ANSWER_METHOD,
  WORKBENCH_PERMISSION_LIST_METHOD,
  WORKBENCH_PERMISSION_METHODS
} from './workbench-permission'

describe('workbench permission methods', () => {
  let harness: RelayHarness
  let runtime: OrcaRuntimeService
  let unregister: () => void

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness()
    runtime = new OrcaRuntimeService()
    unregister = registerPermissionRelay(runtime, harness.service)
  })
  afterEach(() => {
    unregister()
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  it('declares list and answer with the shared params', () => {
    expect(WORKBENCH_PERMISSION_METHODS.map((entry) => entry.name)).toEqual([
      'workbench.permission.list',
      'workbench.permission.answer'
    ])
    expect(WORKBENCH_PERMISSION_LIST_METHOD.params).toBe(WorkbenchPermissionListParams)
    expect(WORKBENCH_PERMISSION_ANSWER_METHOD.params).toBe(WorkbenchPermissionAnswerParams)
  })

  it('refuses any caller that is not the desktop UI', () => {
    const forged = Object.freeze({ principalId: 'local-desktop-ui', source: 'desktop_ui' as const })
    const contexts: RpcContext[] = [{ runtime }, { runtime, workbenchCaller: forged }]
    for (const context of contexts) {
      expect(() => WORKBENCH_PERMISSION_LIST_METHOD.handler({}, context)).toThrow(
        expect.objectContaining({ code: 'workbench_forbidden' })
      )
      expect(() =>
        WORKBENCH_PERMISSION_ANSWER_METHOD.handler(
          { decisionId: 'decision_1', decision: 'allow' },
          context
        )
      ).toThrow(expect.objectContaining({ code: 'workbench_forbidden' }))
    }
  })

  it('lists the prompts and lets the desktop answer one', async () => {
    const created = harness.service.request(FIXTURE_EVIDENCE, relayRequest())
    const decisionId = created.outcome === 'relayed' ? created.decisionId : ''
    const waiting = harness.service.wait(FIXTURE_EVIDENCE, { decisionId, waitMs: 20_000 })
    const context: RpcContext = { runtime, workbenchCaller: issueWorkbenchDesktopCaller() }
    expect(WORKBENCH_PERMISSION_LIST_METHOD.handler({}, context)).toMatchObject({
      decisions: [{ decisionId, summary: 'Bash: git status', desktopOnly: false, answerable: true }]
    })
    expect(
      WORKBENCH_PERMISSION_ANSWER_METHOD.handler({ decisionId, decision: 'allow' }, context)
    ).toMatchObject({ outcome: 'decided', decision: { status: 'allowed', decidedBy: 'desktop' } })
    await expect(waiting).resolves.toMatchObject({ state: 'decided' })
  })
})
