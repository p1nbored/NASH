import { describe, expect, it } from 'vitest'
import { runPermissionRequestHook, type PermissionHookRpc } from './permission-request-handler'

const INPUT = JSON.stringify({
  toolCall: { name: 'view_file', args: { AbsolutePath: '/fixture/a' } }
})
const RELAYED = {
  outcome: 'relayed',
  decisionId: 'decision_fixture',
  deadlineAt: '2026-10-08T00:00:00.000Z'
}

async function execute(rpc: PermissionHookRpc): Promise<string> {
  const stdout: string[] = []
  let now = 0
  await runPermissionRequestHook(
    rpc,
    {
      stdin: (async function* () {
        yield INPUT
      })(),
      writeStdout: (text) => stdout.push(text),
      writeStderr: () => {},
      now: () => now,
      sleep: async (ms) => {
        now += ms
      }
    },
    'agy'
  )
  return stdout.join('').trim()
}

describe('AGY fallback after delegation to permission review', () => {
  it('forces a native prompt when the relayed request closes without a decision', async () => {
    const result = await execute(async (method) =>
      method.endsWith('Request') ? RELAYED : { state: 'no_decision' }
    )
    expect(JSON.parse(result)).toEqual({ decision: 'force_ask' })
  })

  it('forces a native prompt when waiting loses contact after a request was relayed', async () => {
    const result = await execute(async (method) => {
      if (method.endsWith('Request')) {
        return RELAYED
      }
      throw new Error('Fixture connection loss')
    })
    expect(JSON.parse(result)).toEqual({ decision: 'force_ask' })
  })

  it('preserves normal AGY permission settings for a request that never entered the relay', async () => {
    const result = await execute(async () => ({
      outcome: 'not_relayed',
      reason: 'terminal_only_tool'
    }))
    expect(JSON.parse(result)).toEqual({ decision: 'ask' })
  })
})
