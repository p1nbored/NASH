import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { spawnProcess } from '../../shared/child-process/run-process'
import { probeCodexAuthPresence } from './codex-auth-presence'
import {
  fetchCodexRateLimitsViaBackend,
  supplementCodexSessionWindow
} from './codex-backend-usage-client'
import { fetchCodexUsageFromCli } from './codex-cli-usage-fetch'

// FIXTURE_ONLY: a fake `codex app-server` child answers JSON-RPC in memory; nothing is spawned,
// no auth file is touched and every vendor HTTP path is a spy.
const rpc = vi.hoisted(() => ({
  answer: 'ok' as 'ok' | 'error',
  spawnSpecs: [] as { program: string; args?: readonly string[]; env?: NodeJS.ProcessEnv }[]
}))

vi.mock('../../shared/child-process/run-process', () => ({ spawnProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveCodexCommand: () => 'codex' }))
vi.mock('./codex-auth-presence', () => ({ probeCodexAuthPresence: vi.fn() }))
vi.mock('./codex-backend-usage-client', () => ({
  fetchCodexRateLimitsViaBackend: vi.fn(),
  supplementCodexSessionWindow: vi.fn()
}))
vi.mock('../windows-process-tree-kill', () => ({ terminateWindowsProcessTree: vi.fn() }))
vi.mock('../codex/codex-state-db', () => ({ isCodexStateDbBackfillPending: vi.fn(() => false) }))
vi.mock('../codex/codex-state-db-backfill-recovery', () => ({
  startCodexStateDbBackfillRecoveryInBackground: vi.fn()
}))

function reply(child: EventEmitter & { stdout: EventEmitter }, message: unknown): void {
  queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)))
}

function fakeAppServer(): EventEmitter {
  const exit = (): void => queueMicrotask(() => child.emit('close', 0, null))
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 4242,
    exitCode: null,
    kill: vi.fn(() => {
      exit()
      return true
    })
  })
  // Why stdin EOF closes it: that is the graceful stop the probe sends first, so no tree kill runs.
  const stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(exit),
    write: vi.fn((line: string) => {
      const message = JSON.parse(line) as { id?: number; method?: string }
      if (message.method === 'initialize') {
        reply(child, { id: message.id, result: {} })
      }
      if (message.method === 'account/rateLimits/read') {
        reply(
          child,
          rpc.answer === 'error'
            ? { id: message.id, error: { code: -32000, message: 'fixture: server unavailable' } }
            : {
                id: message.id,
                result: {
                  rateLimits: {
                    primary: { usedPercent: 17, windowDurationMins: 300, resetsAt: 1_900_000_000 },
                    secondary: { usedPercent: 29, windowDurationMins: 10080 }
                  },
                  rateLimitResetCredits: { availableCount: 2, credits: null }
                }
              }
        )
      }
      return true
    })
  })
  return Object.assign(child, { stdin })
}

describe('Codex usage through codex app-server only', () => {
  const vendorHttp = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    rpc.answer = 'ok'
    rpc.spawnSpecs = []
    vi.stubGlobal('fetch', vendorHttp)
    vi.mocked(spawnProcess).mockImplementation((spec) => {
      rpc.spawnSpecs.push(spec)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake implements the stdio surface the probe uses.
      return fakeAppServer() as unknown as ReturnType<typeof spawnProcess>
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads account/rateLimits/read in the given Codex home and nothing else', async () => {
    const reading = await fetchCodexUsageFromCli({ codexHomePath: '/fixture/codex-home' })
    expect(reading).toMatchObject({
      provider: 'codex',
      status: 'ok',
      error: null,
      session: { usedPercent: 17, windowMinutes: 300, resetsAt: 1_900_000_000_000 },
      weekly: { usedPercent: 29, windowMinutes: 10080 },
      usageMetadata: { source: 'cli', attemptedSources: ['cli'], lastSuccessfulSource: 'cli' }
    })
    expect(reading.rateLimitResetCredits).toBeUndefined()
    expect(rpc.spawnSpecs).toHaveLength(1)
    expect(rpc.spawnSpecs[0]?.args).toEqual([...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS])
    expect(rpc.spawnSpecs[0]?.env?.CODEX_HOME).toBe('/fixture/codex-home')
    expect(probeCodexAuthPresence).not.toHaveBeenCalled()
    expect(fetchCodexRateLimitsViaBackend).not.toHaveBeenCalled()
    expect(supplementCodexSessionWindow).not.toHaveBeenCalled()
    expect(vendorHttp).not.toHaveBeenCalled()
  })

  it("keeps the app-server's error as the answer, with no vendor HTTP fallback", async () => {
    rpc.answer = 'error'
    const reading = await fetchCodexUsageFromCli({ codexHomePath: null })
    expect(reading).toMatchObject({
      provider: 'codex',
      status: 'error',
      session: null,
      weekly: null,
      usageMetadata: { source: 'cli', attemptedSources: ['cli'] }
    })
    expect(reading.usageMetadata?.lastSuccessfulSource).toBeUndefined()
    expect(fetchCodexRateLimitsViaBackend).not.toHaveBeenCalled()
    expect(vendorHttp).not.toHaveBeenCalled()
  })

  it('lets Codex use its own home when NASH names none', async () => {
    vi.stubEnv('CODEX_HOME', '')
    await fetchCodexUsageFromCli({})
    expect(rpc.spawnSpecs[0]?.env?.CODEX_HOME).toBe('')
    vi.unstubAllEnvs()
  })

  it('answers an aborted read without starting codex', async () => {
    const controller = new AbortController()
    controller.abort()
    const reading = await fetchCodexUsageFromCli({ signal: controller.signal })
    expect(reading.status).toBe('error')
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
