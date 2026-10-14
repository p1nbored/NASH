import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiVaultScannerServiceClient } from './session-scanner-service-client'
import {
  AI_VAULT_SERVICE_READY_TIMEOUT_MS,
  AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS
} from './session-scanner-service-client-state'
import {
  AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS,
  AI_VAULT_SERVICE_SCAN_TIMEOUT_MS
} from './session-scanner-service-request-deadline'
import {
  AiVaultServiceTestChild,
  aiVaultServiceRequestId,
  readyAiVaultServiceChild
} from './session-scanner-service-test-child'

const SCAN = { type: 'request', operation: 'scan', options: {} } as const
const SCAN_VALUE = { result: { sessions: [], issues: [], scannedAt: '2026-10-12' }, durationMs: 1 }
const TIMED_OUT = `AI Vault service timed out after ${AI_VAULT_SERVICE_SCAN_TIMEOUT_MS}ms.`

function setup(): { children: AiVaultServiceTestChild[]; client: AiVaultScannerServiceClient } {
  const children: AiVaultServiceTestChild[] = []
  const client = new AiVaultScannerServiceClient({
    processFactory: () => {
      const child = new AiVaultServiceTestChild(12_345 + children.length)
      children.push(child)
      return child.asChildProcess()
    },
    init: () => ({ sessionParseCache: null, sessionSearch: null })
  })
  return { children, client }
}

/** Starts one scan on a ready child and returns its request id. */
async function startScan(
  client: AiVaultScannerServiceClient,
  children: AiVaultServiceTestChild[],
  signal?: AbortSignal
): Promise<{ scan: Promise<unknown>; child: AiVaultServiceTestChild; id: number }> {
  const scan = client.request(SCAN, signal)
  const child = children.at(-1)!
  readyAiVaultServiceChild(child)
  await Promise.resolve()
  return { scan, child, id: aiVaultServiceRequestId(child, 'scan') }
}

function progress(child: AiVaultServiceTestChild, id: number, units: number): void {
  child.emit('message', { type: 'progress', id, units })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AI Vault service scan watchdog', () => {
  it('keeps a scan that keeps advancing alive past several windows', async () => {
    const { children, client } = setup()
    const { scan, child, id } = await startScan(client, children)

    for (let units = 1; units <= 4; units++) {
      vi.advanceTimersByTime(AI_VAULT_SERVICE_SCAN_TIMEOUT_MS - 1)
      progress(child, id, units)
    }
    expect(child.sent).not.toContainEqual({ type: 'shutdown' })
    child.emit('message', { type: 'result', id, operation: 'scan', value: SCAN_VALUE })

    await expect(scan).resolves.toEqual(SCAN_VALUE)
    expect(child.killed).toBe(false)
    client.dispose()
  })

  it('faults a silent scan after the window', async () => {
    const { children, client } = setup()
    const { scan, child } = await startScan(client, children)
    const rejected = expect(scan).rejects.toThrow(TIMED_OUT)

    vi.advanceTimersByTime(AI_VAULT_SERVICE_SCAN_TIMEOUT_MS - 1)
    expect(child.sent).not.toContainEqual({ type: 'shutdown' })
    vi.advanceTimersByTime(1)

    await rejected
    expect(child.sent).toContainEqual({ type: 'shutdown' })
    client.dispose()
  })

  it('faults a scan one window after its counter last advanced', async () => {
    const { children, client } = setup()
    const { scan, child, id } = await startScan(client, children)
    const rejected = expect(scan).rejects.toThrow(TIMED_OUT)

    vi.advanceTimersByTime(10_000)
    progress(child, id, 5)
    for (let repeat = 0; repeat < 3; repeat++) {
      vi.advanceTimersByTime(40_000)
      progress(child, id, 5)
      progress(child, id, 2)
    }
    vi.advanceTimersByTime(AI_VAULT_SERVICE_SCAN_TIMEOUT_MS - 120_001)
    expect(child.sent).not.toContainEqual({ type: 'shutdown' })
    vi.advanceTimersByTime(1)

    await rejected
    expect(child.sent).toContainEqual({ type: 'shutdown' })
    client.dispose()
  })

  it('ignores progress for another request id', async () => {
    const { children, client } = setup()
    const { scan, child, id } = await startScan(client, children)
    const rejected = expect(scan).rejects.toThrow(TIMED_OUT)

    vi.advanceTimersByTime(AI_VAULT_SERVICE_SCAN_TIMEOUT_MS - 1)
    progress(child, id + 100, 1)
    vi.advanceTimersByTime(1)

    await rejected
    client.dispose()
  })

  it('keeps the fixed bound on a non-scan call that reports progress', async () => {
    const { children, client } = setup()
    const subagents = client.request({
      type: 'request',
      operation: 'subagents',
      request: { agent: 'claude', parentFilePath: '/tmp/parent.jsonl' }
    })
    const child = children[0]!
    readyAiVaultServiceChild(child)
    await Promise.resolve()
    const id = aiVaultServiceRequestId(child, 'subagents')
    const rejected = expect(subagents).rejects.toThrow(
      `timed out after ${AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS}ms`
    )

    vi.advanceTimersByTime(AI_VAULT_SERVICE_INTERACTIVE_TIMEOUT_MS - 1)
    progress(child, id, 1)
    vi.advanceTimersByTime(1)

    await rejected
    client.dispose()
  })

  it('does not extend the cancel acknowledgement bound', async () => {
    const { children, client } = setup()
    const controller = new AbortController()
    const { scan, child, id } = await startScan(client, children, controller.signal)

    controller.abort()
    await expect(scan).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.sent).toContainEqual({ type: 'cancel', id })
    vi.advanceTimersByTime(AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS - 1)
    progress(child, id, 1)
    expect(child.killed).toBe(false)
    vi.advanceTimersByTime(1)

    expect(child.killed).toBe(true)
    client.dispose()
  })

  it('keeps the startup bound when progress arrives before ready', async () => {
    const { children, client } = setup()
    const scan = client.request(SCAN)
    const rejected = expect(scan).rejects.toThrow('did not become ready')
    const child = children[0]!

    vi.advanceTimersByTime(AI_VAULT_SERVICE_READY_TIMEOUT_MS - 1)
    progress(child, 1, 1)
    vi.advanceTimersByTime(1)
    expect(child.killed).toBe(true)
    // The cold-start retry gets the same bound on the respawned child.
    vi.advanceTimersByTime(250 + AI_VAULT_SERVICE_READY_TIMEOUT_MS)

    await rejected
    client.dispose()
  })

  it('retires a stalled child with shutdown first, records the fault, and never retries the scan', async () => {
    const { children, client } = setup()
    const { scan, child, id } = await startScan(client, children)
    const rejected = expect(scan).rejects.toThrow(TIMED_OUT)

    vi.advanceTimersByTime(AI_VAULT_SERVICE_SCAN_TIMEOUT_MS)
    await rejected
    expect(child.sent).toContainEqual({ type: 'shutdown' })
    expect(child.killed).toBe(false)

    // The fault went through the restart policy: the next start waits out its delay.
    const next = client.request(SCAN)
    vi.advanceTimersByTime(249)
    expect(children).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(2)
    readyAiVaultServiceChild(children[1]!)
    await Promise.resolve()
    expect(children[1]!.sent).toContainEqual(
      expect.objectContaining({ operation: 'scan', id: id + 1 })
    )
    expect(children[1]!.sent).not.toContainEqual(expect.objectContaining({ id }))

    // A late frame from the retiring child reaches nothing; the kill waits out the grace.
    progress(child, id, 9)
    vi.advanceTimersByTime(AI_VAULT_SERVICE_SHUTDOWN_TIMEOUT_MS - 251)
    expect(child.killed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(child.killed).toBe(true)

    client.dispose()
    await expect(next).rejects.toThrow('disposed')
  })

  it('kills a child at once on a malformed progress frame', async () => {
    const { children, client } = setup()
    const { scan, child, id } = await startScan(client, children)
    const rejected = expect(scan).rejects.toThrow('malformed')

    progress(child, id, 0)

    await rejected
    expect(child.killed).toBe(true)
    expect(child.sent).not.toContainEqual({ type: 'shutdown' })
    client.dispose()
  })
})
