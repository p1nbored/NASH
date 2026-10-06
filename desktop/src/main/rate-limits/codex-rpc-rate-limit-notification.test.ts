import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  readCodexRateLimitsViaRpc,
  type CodexRpcRateLimitChild
} from './codex-rpc-rate-limit-probe'

// FIXTURE_ONLY: an in-memory app-server that pushes `account/rateLimits/updated` before it answers
// `account/rateLimits/read`, shaped like the app-server reference (Codex 0.160.0 docs).
type ReadAnswer = 'ok' | 'error'

function pushingChild(readAnswer: ReadAnswer): CodexRpcRateLimitChild {
  const child = new EventEmitter() as EventEmitter & CodexRpcRateLimitChild
  const stdout = new EventEmitter()
  child.stdout = stdout
  child.stderr = new EventEmitter()
  const send = (message: unknown): void => {
    queueMicrotask(() => stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)))
  }
  child.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((line: string) => {
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.method === 'initialize') {
        send({ id: message.id, result: {} })
      }
      if (message.method === 'account/rateLimits/read') {
        send({
          method: 'account/rateLimits/updated',
          params: {
            rateLimits: { limitId: 'codex', primary: { usedPercent: 31, windowDurationMins: 300 } }
          }
        })
        send(
          readAnswer === 'ok'
            ? {
                id: message.id,
                result: { rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300 } } }
              }
            : { id: message.id, error: { code: -32000, message: 'fixture: read failed' } }
        )
      }
    })
  })
  return child
}

function read(readAnswer: ReadAnswer) {
  return readCodexRateLimitsViaRpc({
    child: pushingChild(readAnswer),
    codexCommand: 'codex',
    initTimeoutMs: 30_000,
    rpcTimeoutMs: 10_000,
    terminate: async () => {}
  })
}

describe('Codex app-server rate-limit notification', () => {
  it('prefers the account/rateLimits/read answer when both arrive', async () => {
    await expect(read('ok')).resolves.toMatchObject({
      status: 'ok',
      session: { usedPercent: 40 }
    })
  })

  it('falls back to the pushed account/rateLimits/updated reading when the read fails', async () => {
    await expect(read('error')).resolves.toMatchObject({
      provider: 'codex',
      status: 'ok',
      error: null,
      session: { usedPercent: 31, windowMinutes: 300 }
    })
  })
})
