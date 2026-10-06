// FIXTURE_ONLY: synthetic dispatch ids and abort signals; no process is started or stopped.
import { describe, expect, it, vi } from 'vitest'
import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import { createExecutorRegistry } from './executor-registry'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const

function registry(recorded: (dispatchId: string) => TreeProof | null = () => null) {
  return createExecutorRegistry({ recordedTree: recorded })
}

describe('executor registry', () => {
  it('stops a tracked child by aborting it and answers with the tree its run settled with', async () => {
    const executors = registry()
    const signal = executors.track('ctx_000000000001', 'codex_cli')
    expect(signal?.aborted).toBe(false)
    const stopping = executors.stopExecutor({ dispatchId: 'ctx_000000000001', kind: 'codex_cli' })
    expect(signal?.aborted).toBe(true)
    expect(executors.stopReason('ctx_000000000001')).toBe('stop_requested')
    executors.finish('ctx_000000000001', EXITED)
    await expect(stopping).resolves.toEqual(EXITED)
    expect(executors.holds('ctx_000000000001')).toBe(false)
  })

  it('answers for a dispatch it does not hold from the recorded tree, else as unverifiable', async () => {
    const recorded = vi.fn((dispatchId: string) => (dispatchId === 'ctx_recorded' ? EXITED : null))
    const executors = registry(recorded)
    await expect(
      executors.stopExecutor({ dispatchId: 'ctx_recorded', kind: 'agy_cli' })
    ).resolves.toEqual(EXITED)
    await expect(
      executors.stopExecutor({ dispatchId: 'ctx_unknown', kind: 'agy_cli' })
    ).resolves.toEqual({ verdict: 'unverifiable', method: 'root_exit_only' })
  })

  it('refuses to track one dispatch twice', () => {
    const executors = registry()
    executors.track('ctx_000000000002', 'agy_cli')
    expect(() => executors.track('ctx_000000000002', 'agy_cli')).toThrow()
  })

  it('aborts every child on quit, refuses new children, and resolves once all settled', async () => {
    const executors = registry()
    const first = executors.track('ctx_000000000003', 'codex_cli')
    const second = executors.track('ctx_000000000004', 'agy_cli')
    let settled = false
    const quitting = executors.abortAll().then(() => {
      settled = true
    })
    expect(first?.aborted).toBe(true)
    expect(second?.aborted).toBe(true)
    expect(executors.stopReason('ctx_000000000003')).toBe('app_quit')
    expect(executors.isClosed()).toBe(true)
    expect(executors.track('ctx_000000000005', 'codex_cli')).toBeNull()
    executors.finish('ctx_000000000003', EXITED)
    await Promise.resolve()
    expect(settled).toBe(false)
    executors.finish('ctx_000000000004', EXITED)
    await quitting
    expect(settled).toBe(true)
  })

  it('keeps the first stop reason when a quit follows a stop request', async () => {
    const executors = registry()
    executors.track('ctx_000000000006', 'codex_cli')
    void executors.stopExecutor({ dispatchId: 'ctx_000000000006', kind: 'codex_cli' })
    void executors.abortAll()
    expect(executors.stopReason('ctx_000000000006')).toBe('stop_requested')
    executors.finish('ctx_000000000006', EXITED)
  })

  it('resolves a quit at once when nothing runs', async () => {
    await expect(registry().abortAll()).resolves.toBeUndefined()
  })
})
