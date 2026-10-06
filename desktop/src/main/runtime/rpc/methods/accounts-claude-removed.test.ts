import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../../runtime-rpc/runtime-rpc-mobile-method-allowlist'
import { eraseRpcMethods, isStreamingMethod } from '../core'
import { mapRuntimeError } from '../errors'
import { ACCOUNT_METHODS } from './accounts'

async function captureRejection(run: () => unknown): Promise<unknown> {
  try {
    await run()
    return null
  } catch (caught: unknown) {
    return caught
  }
}

function requestMethod(name: string) {
  const found = eraseRpcMethods(ACCOUNT_METHODS).find((candidate) => candidate.name === name)
  if (!found || isStreamingMethod(found)) {
    throw new Error(`Missing request method ${name}`)
  }
  return found
}

// Why an empty runtime: no Claude stub may reach the runtime, so any call would throw a TypeError.
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the stubs must not touch the runtime at all.
const runtime = {} as unknown as OrcaRuntimeService

describe('removed Claude account RPCs', () => {
  it('treats accounts.selectClaude(null) as a no-op that returns the empty Claude roster', async () => {
    const select = requestMethod('accounts.selectClaude')

    await expect(select.handler({ accountId: null }, { runtime })).resolves.toEqual({
      accounts: [],
      activeAccountId: null
    })
  })

  it.each([
    ['accounts.selectClaude', { accountId: 'retired-account' }],
    ['accounts.removeClaude', { accountId: 'retired-account' }],
    ['accounts.addClaudeFromConfigDir', { configDir: join(tmpdir(), 'claude-login') }]
  ])('refuses %s with the claude_accounts_removed code', async (name, params) => {
    const method = requestMethod(name)

    const error = await captureRejection(() => method.handler(params, { runtime }))

    expect(error).toMatchObject({ code: 'claude_accounts_removed' })
    const wire = mapRuntimeError('request-1', { runtimeId: 'test-runtime' }, error)
    expect(wire.error.code).toBe('claude_accounts_removed')
    expect(wire.error.message).toContain('claude /login')
  })

  it('still refuses a paired device before reporting the removal', async () => {
    const add = requestMethod('accounts.addClaudeFromConfigDir')

    await expect(
      add.handler({ configDir: join(tmpdir(), 'claude-login') }, { runtime, clientKind: 'mobile' })
    ).rejects.toThrow(/only available on the Orca host runtime/)
  })

  it('keeps the mobile allowlist entry so old phones get the clear code', () => {
    expect(MOBILE_RPC_METHOD_ALLOWLIST.has('accounts.selectClaude')).toBe(true)
  })
})
