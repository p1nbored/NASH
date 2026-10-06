// FIXTURE_ONLY: synthetic runner reports; no process is started.
import { describe, expect, it } from 'vitest'
import { decideSettlement } from './executor-run-report'
import { completedReport } from './task-execution.test-fixture'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const UNVERIFIABLE = { verdict: 'unverifiable', method: 'root_exit_only' } as const
const LIVE = { verdict: 'live', method: 'windows_descendant_snapshot' } as const

describe('decideSettlement', () => {
  it('turns a completed read-only run into a claim that keeps the tree and the secret-shape flag', () => {
    const decision = decideSettlement(
      completedReport({ lastMessage: { sha256: 'a'.repeat(64), bytes: 9, secretLike: true } }),
      null
    )
    expect(decision).toMatchObject({
      kind: 'claim',
      evidence: {
        exitCode: 0,
        tree: UNVERIFIABLE,
        lastMessage: { sha256: 'a'.repeat(64), bytes: 9, secretLike: true },
        threadId: 'thread-fixture-1',
        verdict: { status: 'completed', versionProbe: 'ok' }
      }
    })
  })

  it.each([
    [{ requested: 'read_only', applied: 'workspace_write' }],
    [{ requested: 'workspace_write', applied: 'read_only' }],
    [{ requested: 'read_only', applied: null }],
    [{ requested: 'workspace_write', applied: null }]
  ] as const)(
    'fails a claim whose applied sandbox is not the one the access level asks for (%o)',
    (sandbox) => {
      expect(decideSettlement(completedReport({ sandbox }), null)).toMatchObject({
        kind: 'failure',
        outcome: 'failed',
        reason: 'sandbox_mismatch',
        latch: null
      })
    }
  )

  it.each(['read_only', 'workspace_write'] as const)(
    'accepts a claim whose applied sandbox matches the %s access level',
    (access) => {
      const decision = decideSettlement(
        completedReport({ sandbox: { requested: access, applied: access } }),
        null
      )
      expect(decision).toMatchObject({
        kind: 'claim',
        evidence: { verdict: { sandbox: { requested: access, applied: access } } }
      })
    }
  )

  it('checks the sandbox before the claim evidence', () => {
    expect(
      decideSettlement(
        completedReport({
          sandbox: { requested: 'read_only', applied: 'workspace_write' },
          lastMessage: null
        }),
        null
      )
    ).toMatchObject({ kind: 'failure', reason: 'sandbox_mismatch' })
  })

  it('refuses a claim without a last message or a zero exit', () => {
    expect(decideSettlement(completedReport({ lastMessage: null }), null)).toMatchObject({
      kind: 'failure',
      reason: 'claim_evidence_incomplete'
    })
    expect(decideSettlement(completedReport({ exitCode: 3 }), null)).toMatchObject({
      kind: 'failure',
      reason: 'claim_evidence_incomplete'
    })
  })

  it('fails with the primary failure kind and keeps every kind without any detail text', () => {
    const decision = decideSettlement(
      completedReport({
        verdict: { status: 'failed', failureKinds: ['nonzero_exit', 'last_message_missing'] },
        exitCode: 1,
        lastMessage: null
      }),
      null
    )
    expect(decision).toMatchObject({
      kind: 'failure',
      outcome: 'failed',
      reason: 'nonzero_exit',
      latch: null,
      evidence: {
        verdict: { status: 'failed', failures: ['nonzero_exit', 'last_message_missing'] }
      }
    })
  })

  it.each([
    ['quota', 'executor_blocked_quota'],
    ['auth', 'executor_blocked_auth']
  ] as const)(
    'latches the route on a %s block and fails the attempt as blocked',
    (kind, reason) => {
      const decision = decideSettlement(
        completedReport({
          verdict: { status: 'blocked', reason: kind, failureKinds: ['nonzero_exit'] },
          exitCode: 1,
          lastMessage: null
        }),
        null
      )
      expect(decision).toMatchObject({ kind: 'failure', outcome: 'blocked', reason, latch: kind })
    }
  )

  it.each([
    [EXITED, 'exited'],
    [UNVERIFIABLE, 'unverifiable'],
    [LIVE, 'live']
  ] as const)('maps a requested stop with a %o cancel to a %s stop verdict', (proof, verdict) => {
    const decision = decideSettlement(
      completedReport({
        verdict: { status: 'failed', failureKinds: ['cancelled'] },
        cancellation: { requested: true, trigger: 'abort_signal', proof },
        treeProof: proof
      }),
      'stop_requested'
    )
    expect(decision).toMatchObject({
      kind: 'stop',
      stopVerdict: verdict,
      reason: 'stop_requested',
      tree: proof
    })
  })

  it('names the quit as the reason when the app aborted the run', () => {
    const decision = decideSettlement(
      completedReport({
        verdict: { status: 'failed', failureKinds: ['cancelled'] },
        cancellation: { requested: true, trigger: 'abort_signal', proof: UNVERIFIABLE }
      }),
      'app_quit'
    )
    expect(decision).toMatchObject({
      kind: 'stop',
      stopVerdict: 'unverifiable',
      reason: 'app_quit'
    })
  })

  it('honours a stop that arrived after the run had already ended', () => {
    const decision = decideSettlement(completedReport({ treeProof: EXITED }), 'stop_requested')
    expect(decision).toMatchObject({ kind: 'stop', stopVerdict: 'exited', tree: EXITED })
  })

  it('fails a timed-out run whose tree is proven gone', () => {
    const decision = decideSettlement(
      completedReport({
        verdict: { status: 'failed', failureKinds: ['timed_out'] },
        cancellation: { requested: true, trigger: 'timeout', proof: EXITED },
        treeProof: EXITED,
        lastMessage: null
      }),
      null
    )
    expect(decision).toMatchObject({ kind: 'failure', outcome: 'failed', reason: 'timed_out' })
  })

  it('keeps a timed-out run unknown while its tree is not proven gone', () => {
    const decision = decideSettlement(
      completedReport({
        verdict: { status: 'failed', failureKinds: ['timed_out'] },
        cancellation: { requested: true, trigger: 'timeout', proof: UNVERIFIABLE }
      }),
      null
    )
    expect(decision).toMatchObject({
      kind: 'stop',
      stopVerdict: 'unverifiable',
      reason: 'timed_out'
    })
  })

  it('never settles a run as finished while its tree is known to be live', () => {
    const decision = decideSettlement(completedReport({ treeProof: LIVE }), null)
    expect(decision).toMatchObject({
      kind: 'stop',
      stopVerdict: 'live',
      reason: 'process_tree_live'
    })
  })

  it('reads a runner that threw as an unverifiable stop', () => {
    expect(decideSettlement(null, null)).toEqual({
      kind: 'stop',
      stopVerdict: 'unverifiable',
      reason: 'executor_error',
      tree: null,
      verdict: { status: 'executor_error' },
      threadId: null
    })
  })
})
