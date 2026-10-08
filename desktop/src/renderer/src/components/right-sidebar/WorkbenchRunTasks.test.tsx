// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchRunTask } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { primarySession, runView } from './workbench-run-test-fixture'
import WorkbenchRunTasks from './WorkbenchRunTasks'

const { rpc, store, activateTab } = vi.hoisted(() => {
  const tabsByWorktree: Record<string, { id: string }[]> = {
    'local-workspace': [{ id: 'tab-primary' }]
  }
  return {
    rpc: vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>(),
    store: { openTaskWindow: vi.fn(), tabsByWorktree },
    activateTab: vi.fn()
  }
})

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const result = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: result.RuntimeRpcCallError }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: typeof store) => unknown) => selector(store), {
    getState: () => store
  })
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? '')),
  getIntlLocale: () => 'en-US'
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: activateTab }))

// FIXTURE_ONLY tasks; no runtime is read.
function task(overrides: Partial<WorkbenchRunTask>): WorkbenchRunTask {
  return {
    taskId: 'task_codex',
    title: 'Review the parser',
    executorKind: 'codex',
    attempts: [
      {
        dispatchId: 'ctx_first',
        state: 'failed',
        startedAt: '2026-10-05T18:00:00.000Z',
        settledAt: '2026-10-05T18:00:40.000Z',
        hasTranscript: true,
        worktree: null
      },
      {
        dispatchId: 'ctx_second',
        state: 'completed',
        startedAt: '2026-10-05T18:01:00.000Z',
        settledAt: '2026-10-05T18:03:10.000Z',
        hasTranscript: true,
        worktree: null
      }
    ],
    ...overrides
  }
}

const TASKS = [
  task({}),
  task({ taskId: 'task_agy', title: null, executorKind: 'agy', attempts: [] }),
  task({
    taskId: 'task_sub',
    title: 'Draft the notes',
    executorKind: 'claude_subagent',
    attempts: []
  }),
  task({ taskId: 'task_new', title: 'Future work', executorKind: 'robot_cli', attempts: [] })
]

function tasksCalls(): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === 'workbench.runs.tasks').map((call) => call[2])
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ tasks: TASKS })
  store.openTaskWindow.mockReset()
  activateTab.mockReset()
})
afterEach(() => cleanup())

describe('WorkbenchRunTasks', () => {
  it('lists each task with its state chip, executor and elapsed time', async () => {
    render(<WorkbenchRunTasks run={runView(1)} />)
    await settle()

    expect(tasksCalls()).toEqual([{ runId: 'run-1' }])
    const list = screen.getByRole('list', { name: 'Tasks' })
    const [codex, agy, subagent, unknown] = within(list).getAllByRole('listitem')
    expect(within(codex).getByText('Review the parser')).toBeDefined()
    expect(
      within(codex).getByText('Completed').closest('[data-kind]')?.getAttribute('data-kind')
    ).toBe('done')
    expect(within(codex).getByText('Codex · 2m 10s')).toBeDefined()
    expect(within(agy).getByText('Untitled task')).toBeDefined()
    expect(within(agy).getByText('Not started')).toBeDefined()
    expect(within(agy).getByText('agy')).toBeDefined()
    expect(within(subagent).getByText('Claude subagent')).toBeDefined()
    expect(within(unknown).getByText('Other executor')).toBeDefined()
    for (const id of ['task_codex', 'ctx_first', 'ctx_second', 'robot_cli']) {
      expect(list.textContent).not.toContain(id)
    }
  })

  it('marks a failed attempt with its own icon and label, never as success', async () => {
    rpc.mockResolvedValue({
      tasks: [
        task({
          attempts: [
            {
              dispatchId: 'ctx_only',
              state: 'failed',
              startedAt: '2026-10-05T18:00:00.000Z',
              settledAt: '2026-10-05T18:00:40.000Z',
              hasTranscript: true,
              worktree: null
            }
          ]
        }),
        task({
          taskId: 'task_odd',
          title: 'Odd state',
          attempts: [
            {
              dispatchId: 'ctx_odd',
              state: 'paused_by_host',
              startedAt: '2026-10-05T18:00:00.000Z',
              settledAt: null,
              hasTranscript: false,
              worktree: null
            }
          ]
        })
      ]
    })
    render(<WorkbenchRunTasks run={runView(1)} />)
    await settle()
    const failed = screen.getByText('Failed').closest('[data-kind]')
    expect(failed?.getAttribute('data-kind')).toBe('failed')
    expect(failed?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    const odd = screen.getByText('State unknown').closest('[data-kind]')
    expect(odd?.getAttribute('data-kind')).toBe('unknown')
    expect(odd?.getAttribute('data-tone')).not.toBe('success')
  })

  it('opens the task window on the newest attempt of a Codex task', async () => {
    const run = runView(1)
    render(<WorkbenchRunTasks run={run} />)
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'Open task window for Review the parser' }))
    expect(store.openTaskWindow).toHaveBeenCalledWith('local-workspace', {
      runId: 'run-1',
      taskId: 'task_codex',
      title: 'Review the parser',
      executorKind: 'codex',
      attempts: TASKS[0].attempts,
      selectedDispatchId: 'ctx_second'
    })
    // No attempt yet, a Claude task and an unknown executor have no task window.
    expect(screen.getAllByRole('button', { name: /Open task window/ })).toHaveLength(1)
  })

  it('shows the main session terminal for a Claude subagent task', async () => {
    const { rerender } = render(
      <WorkbenchRunTasks run={runView(1, { primary: primarySession({ paneKey: null }) })} />
    )
    await settle()
    expect(screen.queryByRole('button', { name: /Show terminal/ })).toBeNull()
    rerender(<WorkbenchRunTasks run={runView(1)} />)
    await settle()

    const row = screen.getByText('Draft the notes').closest('li')
    if (!row) {
      throw new Error('row')
    }
    fireEvent.click(within(row).getByRole('button', { name: 'Show terminal for Draft the notes' }))
    expect(activateTab).toHaveBeenCalledWith('tab-primary', null)
  })

  it('reads again on each Workbench poll while the run is open, and once after it ended', async () => {
    const view = render(<WorkbenchRunTasks run={runView(1)} />)
    await settle()
    view.rerender(<WorkbenchRunTasks run={runView(1)} />)
    await settle()
    expect(tasksCalls()).toHaveLength(2)

    const ended = runView(1, { status: 'completed' })
    view.rerender(<WorkbenchRunTasks run={ended} />)
    await settle()
    view.rerender(<WorkbenchRunTasks run={runView(1, { status: 'completed' })} />)
    await settle()
    expect(tasksCalls()).toHaveLength(3)
  })

  it('shows a quiet line, not an alert, when the task list cannot be read', async () => {
    const { RuntimeRpcCallError } = await vi.importActual<typeof RpcResult>(
      '@/runtime/runtime-rpc-result'
    )
    rpc.mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'r',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method.' }
      })
    )
    render(<WorkbenchRunTasks run={runView(1)} />)
    await settle()

    expect(
      screen.getByText(
        'Tasks could not be read: This version of the app does not support this action.'
      )
    ).toBeDefined()
    expect(screen.queryByText(/method_not_found|Unknown method/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeDefined()
  })

  it('says when a run has no tasks yet', async () => {
    rpc.mockResolvedValue({ tasks: [] })
    render(<WorkbenchRunTasks run={runView(1)} />)
    await settle()
    expect(screen.getByText('No tasks yet.')).toBeDefined()
  })
})
