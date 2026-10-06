// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deferred,
  publishScope,
  resetQueueFixture,
  rpc,
  storeState,
  uuid
} from './workbench-request-test-fixture'
import {
  callsTo as callsToRpc,
  FIXTURE_IDEMPOTENCY_KEY,
  primarySession,
  routeRpc as routeRpcCalls,
  runList,
  runView,
  type RpcHandler
} from './workbench-run-test-fixture'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { useWorkbenchRuns, WORKBENCH_RUN_POLL_MS } from './use-workbench-runs'
import WorkbenchRunsSection from './WorkbenchRunsSection'

const { activateTab } = vi.hoisted(() => ({
  activateTab: vi.fn<(tabId: string, leafId: string | null) => void>()
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: activateTab }))

function routeRpc(handlers: Record<string, RpcHandler>): void {
  routeRpcCalls(rpc, handlers)
}

function callsTo(method: string): unknown[] {
  return callsToRpc(rpc, method)
}

function RunsHost(): React.JSX.Element {
  const runs = useWorkbenchRuns()
  return <WorkbenchRunsSection runs={runs} />
}

beforeEach(() => {
  resetQueueFixture()
  activateTab.mockReset()
  storeState.tabsByWorktree = { 'local-workspace': [{ id: 'tab-primary' }] }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WorkbenchRunsSection', () => {
  it('lists the workspace runs passively with status, session state and live activity', async () => {
    const live = runView(1, {
      primary: primarySession({ live: { kind: 'live', activity: 'working' } })
    })
    routeRpc({
      'workbench.runs.list': () =>
        runList([
          runView(1),
          runView(2, { status: 'completed', primary: primarySession({ state: 'exited' }) })
        ]),
      'workbench.runs.show': () => ({ run: live })
    })
    render(<RunsHost />)
    await screen.findByText('Claude is working')
    expect(callsTo('workbench.runs.list')).toEqual([{ workspaceId: 'local-workspace', limit: 50 }])
    expect(callsTo('workbench.runs.show')).toEqual([{ runId: 'run-1' }])
    const [active, completed] = screen.getAllByRole('listitem')
    expect(within(active).getByText('Active')).toBeDefined()
    expect(within(active).getByText('Running')).toBeDefined()
    expect(within(active).getByText('Fixture objective 1')).toBeDefined()
    expect(within(active).getByText('claude-fixture-model')).toBeDefined()
    expect(within(completed).getByText('Completed')).toBeDefined()
    expect(within(completed).getByText('Exited')).toBeDefined()
    expect(within(completed).queryByRole('button', { name: /Stop run/ })).toBeNull()
    expect(uuid).not.toHaveBeenCalled()
  })

  it('reveals the primary terminal tab without moving keyboard focus', async () => {
    routeRpc({
      'workbench.runs.list': () =>
        runList([runView(1), runView(2, { primary: primarySession({ paneKey: null }) })]),
      'workbench.runs.show': (params) => ({
        run: params.runId === 'run-1' ? runView(1) : runView(2, { primary: null })
      })
    })
    render(<RunsHost />)
    const show = await screen.findByRole('button', { name: 'Show terminal for run-1' })
    show.focus()
    fireEvent.click(show)
    expect(activateTab).toHaveBeenCalledExactlyOnceWith('tab-primary', null)
    expect(document.activeElement).toBe(show)
    expect(screen.queryByRole('button', { name: 'Show terminal for run-2' })).toBeNull()
  })

  it('says when the terminal tab is not open in this window', async () => {
    storeState.tabsByWorktree = {}
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) })
    })
    render(<RunsHost />)
    await screen.findByText('The terminal tab is not open in this window.')
    expect(screen.queryByRole('button', { name: /Show terminal/ })).toBeNull()
  })

  it('stops a run and shows it as canceled', async () => {
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.runs.stop': () => ({
        run: runView(1, {
          status: 'canceled',
          endReason: 'user_canceled',
          primary: primarySession({ state: 'stopped', endReason: 'user_canceled' })
        }),
        changed: true
      })
    })
    render(<RunsHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run run-1' }))
    await screen.findByText('Canceled')
    expect(callsTo('workbench.runs.stop')).toEqual([{ runId: 'run-1' }])
    expect(screen.getByText('Stopped in the app')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Stop run run-1' })).toBeNull()
    expect(screen.queryByLabelText('Message to the session')).toBeNull()
  })

  it('keeps the run and shows the server explanation when a stop is refused', async () => {
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.runs.stop': () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: {
            code: 'workbench_run_stop_unconfirmed',
            message: 'The session could not be confirmed stopped, so the run is still open.'
          }
        })
      }
    })
    render(<RunsHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run run-1' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('could not be confirmed stopped')
    expect(alert.textContent).toContain('workbench_run_stop_unconfirmed')
    expect(screen.getByText('Active')).toBeDefined()
  })

  it.each([
    [
      'autopilot_owner_starting',
      'The session is still starting. Stop the run again once it is running.'
    ],
    [
      'autopilot_owner_identity_unverified',
      "The terminal could not be matched to this run's session, so nothing was stopped. Close the session's terminal tab and try again."
    ],
    ['autopilot_invalid_reason', 'The stop request was refused as invalid. Nothing was changed.'],
    ['autopilot_owner_new_code', 'The session could not be stopped now. Nothing was changed.']
  ])('explains a refused stop by its stop code %s', async (stopCode, shown) => {
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.runs.stop': () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: {
            code: 'workbench_run_stop_refused',
            message: 'The session could not be stopped now. Nothing was changed.',
            data: { stopCode }
          }
        })
      }
    })
    render(<RunsHost />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop run run-1' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(shown)
    expect(alert.textContent).toContain('workbench_run_stop_refused')
    expect(screen.getByText('Active')).toBeDefined()
  })

  it('offers the message box only while the session is running', async () => {
    routeRpc({
      'workbench.runs.list': () =>
        runList([
          runView(1),
          runView(2, { status: 'launching', primary: primarySession({ state: 'starting' }) })
        ]),
      'workbench.runs.show': (params) => ({
        run:
          params.runId === 'run-1'
            ? runView(1)
            : runView(2, { status: 'launching', primary: primarySession({ state: 'starting' }) })
      })
    })
    render(<RunsHost />)
    const [running, launching] = await screen.findAllByRole('listitem')
    expect(within(running).getByLabelText('Message to the session')).toBeDefined()
    expect(within(launching).queryByLabelText('Message to the session')).toBeNull()
  })

  it('sends each new message with a fresh UUID and reports the outcome in plain English', async () => {
    const sent: unknown[] = []
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.runs.message': (params) => {
        sent.push(params)
        return {
          outcome: 'queued',
          reason: 'agent_busy',
          messageId: 'm-1',
          state: 'delivered',
          duplicate: false
        }
      }
    })
    uuid
      .mockReturnValueOnce(FIXTURE_IDEMPOTENCY_KEY)
      .mockReturnValueOnce('9a294399-6bc4-49c8-b55e-05a5a09a687b')
    render(<RunsHost />)
    const box = await screen.findByLabelText('Message to the session')
    fireEvent.change(box, { target: { value: 'Also run the lint step.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('Queued. Claude is working, so the message waits in the session.')
    expect(box).toHaveProperty('value', '')
    fireEvent.change(box, { target: { value: 'Then summarize the result.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent).toEqual([
      { runId: 'run-1', idempotencyKey: FIXTURE_IDEMPOTENCY_KEY, text: 'Also run the lint step.' },
      {
        runId: 'run-1',
        idempotencyKey: '9a294399-6bc4-49c8-b55e-05a5a09a687b',
        text: 'Then summarize the result.'
      }
    ])
  })

  it('retries an unanswered send with the same key and keeps refused text for editing', async () => {
    const pending = deferred()
    const keys: unknown[] = []
    let calls = 0
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.runs.message': (params) => {
        keys.push(params.idempotencyKey)
        calls += 1
        if (calls === 1) {
          return pending.promise
        }
        return {
          outcome: 'refused',
          reason: 'not_english',
          messageId: 'm-2',
          state: 'refused',
          duplicate: false
        }
      }
    })
    render(<RunsHost />)
    const box = await screen.findByLabelText('Message to the session')
    fireEvent.change(box, { target: { value: 'Bitte prüfen.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
    await act(async () => pending.reject(new Error('Connection lost')))
    expect((await screen.findByRole('alert')).textContent).toContain('Connection lost')
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    const refused = await screen.findByRole('alert', { name: 'Message not sent' })
    expect(refused.textContent).toBe(
      'Message not sentWrite the message in English; put names or text in another language in quotes.'
    )
    expect(keys).toEqual([FIXTURE_IDEMPOTENCY_KEY, FIXTURE_IDEMPOTENCY_KEY])
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(box).toHaveProperty('value', 'Bitte prüfen.')
  })

  it('does not list runs for a remote workspace', () => {
    storeState.activeWorkspaceExecutionHostId = 'ssh:remote'
    render(<RunsHost />)
    expect(screen.getByText('Runs are unavailable for remote workspaces.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('offers the task validation check under the runs of a local workspace, on click only', async () => {
    routeRpc({
      'workbench.runs.list': () => runList([runView(1)]),
      'workbench.runs.show': () => ({ run: runView(1) }),
      'workbench.validation.checkPending': () => ({
        checked: 1,
        passed: 1,
        failed: 0,
        inconclusive: 0,
        skipped: 0
      })
    })
    render(<RunsHost />)
    await screen.findByText('Fixture objective 1')
    const section = screen.getByRole('region', { name: 'Task validation' })
    expect(callsTo('workbench.validation.checkPending')).toEqual([])
    fireEvent.click(within(section).getByRole('button', { name: 'Check now' }))
    expect(await within(section).findByText('Results checked: 1')).toBeDefined()
    expect(callsTo('workbench.validation.checkPending')).toEqual([{}])
  })

  it('shows an empty state and a listing error with its code', async () => {
    routeRpc({ 'workbench.runs.list': () => runList([]) })
    const { unmount } = render(<RunsHost />)
    await screen.findByText('No runs in this workspace yet.')
    unmount()
    routeRpc({
      'workbench.runs.list': () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: { code: 'method_not_found', message: 'Unknown method' }
        })
      }
    })
    render(<RunsHost />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Unknown method')
    expect(alert.textContent).toContain('method_not_found')
  })

  it('polls the run list while the section is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    routeRpc({ 'workbench.runs.list': () => runList([]) })
    const { unmount } = render(<RunsHost />)
    await screen.findByText('No runs in this workspace yet.')
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_RUN_POLL_MS)
    })
    expect(callsTo('workbench.runs.list')).toHaveLength(2)
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_RUN_POLL_MS * 2)
    })
    expect(callsTo('workbench.runs.list')).toHaveLength(2)
  })

  it('ignores a late run list after the workspace changes', async () => {
    const late = deferred()
    routeRpc({ 'workbench.runs.list': () => late.promise })
    render(<RunsHost />)
    storeState.activeWorkspaceKey = 'worktree:new-workspace'
    storeState.activeWorktreeId = 'new-workspace'
    routeRpc({ 'workbench.runs.list': () => runList([], false) })
    act(publishScope)
    await screen.findByText('No runs in this workspace yet.')
    await act(async () => late.resolve(runList([runView(1)])))
    expect(screen.queryByText('Fixture objective 1')).toBeNull()
  })
})
