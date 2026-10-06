import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DOT_REMOTE_RPC_ERROR_CODES,
  WorkbenchDotRemotePairingStartResultSchema,
  WorkbenchDotRemotePairingViewSchema,
  WorkbenchDotRemoteRevokeResultSchema,
  WorkbenchDotRemoteStatusViewSchema
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import {
  createAgentHarness,
  type AgentHarness
} from '../../dot-remote/dot-remote-agent.test-fixture'
import { registerDotRemoteControl } from '../../dot-remote/dot-remote-port'
import { FIXTURE_ORIGIN, FIXTURE_SERVICE_VALUE } from '../../dot-remote/dot-remote.test-fixture'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import { issueWorkbenchDesktopCaller } from '../../workbench-caller'
import type { RpcContext } from '../core'
import { mapRuntimeError } from '../errors'
import { WORKBENCH_DOT_REMOTE_METHODS } from './workbench-dot-remote'

async function failureOf(operation: () => unknown): Promise<unknown> {
  try {
    await operation()
    return null
  } catch (error) {
    return error
  }
}

describe('desktop remote access methods (workbench.dotRemote.*)', () => {
  let h: AgentHarness
  let runtime: object
  let unregister: () => void
  beforeEach(() => {
    h = createAgentHarness()
    runtime = { fixtureRuntime: true }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the registry keys by identity only.
    unregister = registerDotRemoteControl(runtime as never, h.agent)
  })
  afterEach(() => {
    unregister()
    h.close()
  })

  function invoke(name: string, params: unknown, caller: Partial<RpcContext> = {}) {
    const method = WORKBENCH_DOT_REMOTE_METHODS.find((entry) => entry.name === name)
    if (!method) {
      throw new Error(`no method ${name}`)
    }
    const context: RpcContext = {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods read only the registry key.
      runtime: runtime as never,
      workbenchCaller: issueWorkbenchDesktopCaller(),
      ...caller
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each case passes the params its method parses.
    return method.handler(
      (method.params ? method.params.parse(params) : undefined) as never,
      context
    )
  }

  it('names every method workbench.dotRemote.* and keeps them unary', () => {
    expect(WORKBENCH_DOT_REMOTE_METHODS.map((method) => method.name)).toEqual([
      'workbench.dotRemote.status',
      'workbench.dotRemote.enable',
      'workbench.dotRemote.disable',
      'workbench.dotRemote.setConnection',
      'workbench.dotRemote.pairing.start',
      'workbench.dotRemote.pairing.status',
      'workbench.dotRemote.revoke'
    ])
    expect(WORKBENCH_DOT_REMOTE_METHODS.some((method) => 'stream' in method)).toBe(false)
  })

  it.each(WORKBENCH_DOT_REMOTE_METHODS.map((method) => method.name))(
    '%s refuses any caller but the desktop',
    async (name) => {
      const params = name.endsWith('setConnection')
        ? { origin: FIXTURE_ORIGIN, serviceToken: FIXTURE_SERVICE_VALUE }
        : undefined
      const error = await failureOf(() => invoke(name, params, { workbenchCaller: undefined }))
      expect(error instanceof OrchestrationError ? error.code : null).toBe('workbench_forbidden')
      expect(h.credentials.status().present).toBe(false)
    }
  )

  it('refuses with a stable code while remote access is not installed', async () => {
    unregister()
    const error = await failureOf(() => invoke('workbench.dotRemote.status', undefined))
    expect(error instanceof OrchestrationError ? error.code : null).toBe(
      DOT_REMOTE_RPC_ERROR_CODES.unavailable
    )
  })

  it('switches remote access on and off and reports the status view', async () => {
    expect(
      WorkbenchDotRemoteStatusViewSchema.parse(
        await invoke('workbench.dotRemote.status', undefined)
      ).state
    ).toBe('off')
    expect(
      WorkbenchDotRemoteStatusViewSchema.parse(
        await invoke('workbench.dotRemote.enable', undefined)
      )
    ).toMatchObject({ state: 'unpaired', enabled: true })
    expect(
      WorkbenchDotRemoteStatusViewSchema.parse(
        await invoke('workbench.dotRemote.disable', undefined)
      )
    ).toMatchObject({ state: 'off' })
  })

  it('stores the connection without ever answering with the token', async () => {
    const view = await invoke('workbench.dotRemote.setConnection', {
      origin: FIXTURE_ORIGIN,
      serviceToken: FIXTURE_SERVICE_VALUE
    })
    expect(WorkbenchDotRemoteStatusViewSchema.parse(view)).toMatchObject({
      origin: FIXTURE_ORIGIN,
      serviceToken: 'sealed'
    })
    expect(JSON.stringify(view)).not.toContain(FIXTURE_SERVICE_VALUE)
  })

  it('passes a refusal through the RPC error map with its code and no pasted value', async () => {
    const error = await failureOf(() =>
      invoke('workbench.dotRemote.setConnection', {
        origin: 'http://fixture.example.test',
        serviceToken: FIXTURE_SERVICE_VALUE
      })
    )
    const wire = mapRuntimeError('id-1', { runtimeId: 'runtime-fixture' }, error)
    expect(wire.error.code).toBe(DOT_REMOTE_RPC_ERROR_CODES.originInvalid)
    expect(JSON.stringify(wire)).not.toContain(FIXTURE_SERVICE_VALUE)
    expect(JSON.stringify(wire)).not.toContain('fixture.example.test')
    const shape = await failureOf(() =>
      invoke('workbench.dotRemote.setConnection', { origin: FIXTURE_ORIGIN, serviceToken: 'short' })
    )
    expect(mapRuntimeError('id-2', { runtimeId: 'runtime-fixture' }, shape).error).toMatchObject({
      code: DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid,
      data: { reason: 'token_too_short' }
    })
  })

  it('starts pairing, shows the user code and its status, then revokes', async () => {
    await invoke('workbench.dotRemote.enable', undefined)
    await invoke('workbench.dotRemote.setConnection', {
      origin: FIXTURE_ORIGIN,
      serviceToken: FIXTURE_SERVICE_VALUE
    })
    const started = WorkbenchDotRemotePairingStartResultSchema.parse(
      await invoke('workbench.dotRemote.pairing.start', undefined)
    )
    expect(started.pairing.userCode).toBe('BCDF-GHJK')
    expect(
      WorkbenchDotRemotePairingViewSchema.parse(
        await invoke('workbench.dotRemote.pairing.status', undefined)
      ).state
    ).toBe('waiting_for_approval')
    h.site.approve()
    await h.timers.advance(5_000)
    const revoked = WorkbenchDotRemoteRevokeResultSchema.parse(
      await invoke('workbench.dotRemote.revoke', undefined)
    )
    expect(revoked).toMatchObject({ siteConfirmed: true, status: { state: 'unpaired' } })
  })
})
