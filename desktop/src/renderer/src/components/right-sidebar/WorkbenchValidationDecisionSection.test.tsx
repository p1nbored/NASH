// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { WorkbenchValidationDecisionView } from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import { deferred, resetQueueFixture, rpc } from './workbench-request-test-fixture'
import {
  callsTo as callsToRpc,
  routeRpc as routeRpcCalls,
  type RpcHandler
} from './workbench-run-test-fixture'
import { WORKBENCH_DECISION_POLL_MS } from './use-workbench-validation-decisions'
import { WORKBENCH_RUN_POLL_MS } from './use-workbench-runs'
import WorkbenchValidationDecisionSection from './WorkbenchValidationDecisionSection'

// FIXTURE_ONLY: synthetic ids, model and worktree.
function decisionView(
  overrides: Partial<WorkbenchValidationDecisionView> = {}
): WorkbenchValidationDecisionView {
  return {
    validationId: 'validation-1',
    runId: 'run-1',
    taskId: 'task-1',
    dispatchId: 'ctx-1',
    title: 'Write the release notes.',
    executorKind: 'codex',
    model: 'gpt-6.1-sol',
    reason: 'The attempt worktree is gone, so the artifact could not be checked.',
    inconclusiveAt: '2026-10-06T08:00:00.000Z',
    placement: 'own_worktree',
    worktree: {
      branch: 'nash-task-1',
      path: 'C:/fixture/workspaces/nash-task-1',
      baseCommit: '0123456789abcdef0123456789abcdef01234567'
    },
    ...overrides
  }
}

function routeRpc(handlers: Record<string, RpcHandler>): void {
  routeRpcCalls(rpc, handlers)
}
const callsTo = (method: string): unknown[] => callsToRpc(rpc, method)
const LIST = 'workbench.validation.listDecisions'
const DECIDE = 'workbench.validation.decide'

beforeEach(() => resetQueueFixture())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WorkbenchValidationDecisionSection', () => {
  it('shows an empty state under its own heading when nothing waits for a decision', async () => {
    routeRpc({ [LIST]: () => ({ decisions: [], hasMore: false }) })
    render(<WorkbenchValidationDecisionSection />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Waiting for your decision' })
    ).toBeDefined()
    await screen.findByText('No task results are waiting for your decision.')
    expect(callsTo(LIST)).toEqual([{ limit: 50 }])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows what each result is and why validation could not decide it', async () => {
    routeRpc({ [LIST]: () => ({ decisions: [decisionView()], hasMore: false }) })
    render(<WorkbenchValidationDecisionSection />)
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Write the release notes.')).toBeDefined()
    expect(within(row).getByText('run-1')).toBeDefined()
    expect(within(row).getByText('Codex · gpt-6.1-sol')).toBeDefined()
    expect(
      within(row).getByText('The attempt worktree is gone, so the artifact could not be checked.')
    ).toBeDefined()
    expect(within(row).getByText('nash-task-1')).toBeDefined()
    expect(within(row).getByText('C:/fixture/workspaces/nash-task-1')).toBeDefined()
    expect(within(row).getByText('0123456789ab')).toBeDefined()
    for (const name of ['Waive task-1', 'Reject task-1']) {
      expect(within(row).getByRole('button', { name }).dataset.variant).toBe('outline')
    }
  })

  it('asks for a short confirmation, then waives once and shows the outcome', async () => {
    const decided = deferred()
    let listed = [decisionView()]
    routeRpc({
      [LIST]: () => ({ decisions: listed, hasMore: false }),
      [DECIDE]: () => decided.promise
    })
    render(<WorkbenchValidationDecisionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Waive task-1' }))
    expect(callsTo(DECIDE)).toEqual([])
    expect(
      screen.getByText(
        'Accept this result as done? The task completes, and the main Claude session is told to merge branch nash-task-1.'
      )
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Waive' }))
    expect(screen.getByRole('button', { name: 'Waive' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Waive' }))
    expect(callsTo(DECIDE)).toEqual([{ validationId: 'validation-1', decision: 'waive' }])
    listed = []
    await act(async () =>
      decided.resolve({
        validationId: 'validation-1',
        taskId: 'task-1',
        runId: 'run-1',
        decision: 'waived',
        taskStatus: 'completed',
        noticeFiled: true
      })
    )
    await screen.findByText(
      'Waived. The task is completed, and a notice was filed for the main Claude session.'
    )
    expect(callsTo(LIST)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Waive|Reject/ })).toBeNull()
  })

  it('warns in the waive confirmation when a process of the attempt may still run', async () => {
    routeRpc({
      [LIST]: () => ({ decisions: [decisionView({ processMayRun: true })], hasMore: false })
    })
    render(<WorkbenchValidationDecisionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Waive task-1' }))
    expect(
      screen.getByText(
        'Accept this result as done? The task completes, but a process of this attempt may still be running. The main Claude session is told to wait until it has ended before merging or keeping its changes.'
      )
    ).toBeDefined()
    expect(screen.queryByText(/is told to merge branch/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject task-1' }))
    expect(
      screen.getByText('Reject this result? The task fails, and its branch is left for inspection.')
    ).toBeDefined()
    expect(callsTo(DECIDE)).toEqual([])
  })

  it('backs out of a rejection without deciding anything', async () => {
    routeRpc({ [LIST]: () => ({ decisions: [decisionView()], hasMore: false }) })
    render(<WorkbenchValidationDecisionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject task-1' }))
    expect(
      screen.getByText('Reject this result? The task fails, and its branch is left for inspection.')
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel' }).dataset.variant).toBe('ghost')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Reject task-1' })).toBeDefined()
    expect(callsTo(DECIDE)).toEqual([])
  })

  it('words the confirmation for a folder write and for a task without its own place', async () => {
    routeRpc({
      [LIST]: () => ({
        decisions: [
          decisionView({ placement: 'folder', worktree: null }),
          decisionView({
            validationId: 'validation-2',
            taskId: 'task-2',
            placement: 'in_session',
            executorKind: 'claude_primary',
            model: null,
            worktree: null
          })
        ],
        hasMore: false
      })
    })
    render(<WorkbenchValidationDecisionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject task-1' }))
    expect(
      screen.getByText(
        'Reject this result? The task fails; its changes stay in the workspace folder until you decide what to keep.'
      )
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Waive task-2' }))
    expect(screen.getByText('Accept this result as done? The task completes.')).toBeDefined()
    expect(screen.getByText('Main Claude session')).toBeDefined()
  })

  it('reports a decision someone else already made with its code', async () => {
    routeRpc({
      [LIST]: () => ({ decisions: [decisionView()], hasMore: false }),
      [DECIDE]: () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: {
            code: 'autopilot_validation_conflict',
            message: 'The validation is already settled or was waived.'
          }
        })
      }
    })
    render(<WorkbenchValidationDecisionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reject task-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Decision not recorded')
    expect(alert.textContent).toContain('This result was already decided.')
    expect(alert.textContent).toContain('autopilot_validation_conflict')
  })

  it('refreshes on the run list cadence and reports a listing error with its code', async () => {
    expect(WORKBENCH_DECISION_POLL_MS).toBe(WORKBENCH_RUN_POLL_MS)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    routeRpc({ [LIST]: () => ({ decisions: [], hasMore: false }) })
    const { unmount } = render(<WorkbenchValidationDecisionSection />)
    await screen.findByText('No task results are waiting for your decision.')
    routeRpc({
      [LIST]: () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: { code: 'autopilot_recovery_required', message: 'The store needs recovery.' }
        })
      }
    })
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_DECISION_POLL_MS)
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Decisions unavailable')
    expect(alert.textContent).toContain('autopilot_recovery_required')
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_DECISION_POLL_MS * 2)
    })
    expect(callsTo(LIST)).toHaveLength(2)
  })
})
