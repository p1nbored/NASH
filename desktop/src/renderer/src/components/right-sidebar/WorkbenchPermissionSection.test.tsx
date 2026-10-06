// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  getDefaultNormalizer,
  render,
  screen,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred, resetQueueFixture, rpc, storeState } from './workbench-request-test-fixture'
import {
  callsTo as callsToRpc,
  permissionView,
  routeRpc as routeRpcCalls,
  runView,
  type RpcHandler
} from './workbench-run-test-fixture'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { WORKBENCH_PERMISSION_POLL_MS } from './use-workbench-permission-prompts'
import WorkbenchPermissionSection from './WorkbenchPermissionSection'

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

const SUMMARY = 'Bash: rm -rf ./build && echo "done"  # cwd C:/fixtures/autopilot'

beforeEach(() => {
  resetQueueFixture()
  activateTab.mockReset()
  storeState.tabsByWorktree = { 'local-workspace': [{ id: 'tab-primary' }] }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WorkbenchPermissionSection', () => {
  it('lists pending prompts with the tool and redacted summary exactly as given', async () => {
    routeRpc({
      'workbench.permission.list': () => ({
        decisions: [permissionView({ summary: SUMMARY, agentId: 'agent-7' })]
      })
    })
    render(<WorkbenchPermissionSection />)
    const row = await screen.findByRole('listitem')
    expect(callsTo('workbench.permission.list')).toEqual([{ statuses: ['pending'], limit: 50 }])
    expect(within(row).getByText('Bash')).toBeDefined()
    // Why no normalizer: the redacted summary must reach the screen byte for byte, spaces included.
    const exact = getDefaultNormalizer({ trim: false, collapseWhitespace: false })
    expect(within(row).getByText(SUMMARY, { normalizer: exact }).textContent).toBe(SUMMARY)
    expect(within(row).getByText('Waiting for an answer')).toBeDefined()
    expect(within(row).getByText('agent-7')).toBeDefined()
    expect(within(row).getByText('run-1')).toBeDefined()
    expect(within(row).queryByText('Desktop only')).toBeNull()
    for (const name of ['Allow Bash', 'Deny Bash']) {
      expect(within(row).getByRole('button', { name }).dataset.variant).toBe('outline')
    }
  })

  it('marks a desktop-only prompt as not sent to dot and names its run', async () => {
    routeRpc({
      'workbench.permission.list': () => ({
        decisions: [
          permissionView({ toolName: 'WebFetch', summary: 'WebFetch', desktopOnly: true })
        ]
      })
    })
    render(<WorkbenchPermissionSection findRun={() => runView(1)} />)
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Desktop only')).toBeDefined()
    expect(
      within(row).getByText('Not sent to dot. Answer it here or in the terminal.')
    ).toBeDefined()
    expect(within(row).getByText('Fixture objective 1')).toBeDefined()
  })

  it('allows a prompt once and keeps the answer visible after it leaves the pending list', async () => {
    const answer = deferred()
    let listed = [permissionView()]
    routeRpc({
      'workbench.permission.list': () => ({ decisions: listed }),
      'workbench.permission.answer': () => answer.promise
    })
    render(<WorkbenchPermissionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow Bash' }))
    expect(screen.getByRole('button', { name: 'Allow Bash' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Deny Bash' }).hasAttribute('disabled')).toBe(true)
    listed = []
    await act(async () =>
      answer.resolve({
        outcome: 'decided',
        decision: permissionView({ status: 'allowed', decidedBy: 'desktop', answerable: false })
      })
    )
    expect(callsTo('workbench.permission.answer')).toEqual([
      { decisionId: 'decision-1', decision: 'allow' }
    ])
    await screen.findByText('Allowed in the app.')
    expect(callsTo('workbench.permission.list')).toHaveLength(2)
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Allowed')).toBeDefined()
    expect(within(row).queryByRole('button', { name: /Allow|Deny/ })).toBeNull()
  })

  it('denies a prompt', async () => {
    routeRpc({
      'workbench.permission.list': () => ({ decisions: [permissionView()] }),
      'workbench.permission.answer': () => ({
        outcome: 'decided',
        decision: permissionView({ status: 'denied', decidedBy: 'desktop', answerable: false })
      })
    })
    render(<WorkbenchPermissionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny Bash' }))
    await screen.findByText('Denied in the app.')
    expect(callsTo('workbench.permission.answer')).toEqual([
      { decisionId: 'decision-1', decision: 'deny' }
    ])
  })

  it('says to answer in the terminal when the app can no longer answer', async () => {
    let listed = [permissionView()]
    routeRpc({
      'workbench.permission.list': () => ({ decisions: listed }),
      'workbench.permission.answer': () => {
        listed = [permissionView({ answerable: false })]
        return { outcome: 'closed', decision: permissionView({ answerable: false }) }
      }
    })
    render(<WorkbenchPermissionSection findRun={() => runView(1)} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Allow Bash' }))
    await screen.findByText('Answer it in the terminal. The app can no longer answer this prompt.')
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Answer in the terminal')).toBeDefined()
    expect(within(row).queryByRole('button', { name: 'Allow Bash' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Show terminal for run-1' }))
    expect(activateTab).toHaveBeenCalledExactlyOnceWith('tab-primary', null)
  })

  it('says a prompt was already answered elsewhere', async () => {
    let listed = [permissionView()]
    routeRpc({
      'workbench.permission.list': () => ({ decisions: listed }),
      'workbench.permission.answer': () => {
        listed = []
        return {
          outcome: 'already_decided',
          decision: permissionView({ status: 'allowed', decidedBy: 'dot', answerable: false })
        }
      }
    })
    render(<WorkbenchPermissionSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny Bash' }))
    await screen.findByText('Already answered: allowed by dot.')
  })

  it('shows a prompt only the terminal can answer without answer buttons', async () => {
    routeRpc({
      'workbench.permission.list': () => ({
        decisions: [permissionView({ answerable: false })]
      })
    })
    render(<WorkbenchPermissionSection />)
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('Answer it in the terminal.')).toBeDefined()
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('shows an empty state, polls for new prompts and reports listing errors with their code', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    routeRpc({ 'workbench.permission.list': () => ({ decisions: [] }) })
    const { unmount } = render(<WorkbenchPermissionSection />)
    await screen.findByText('No permission prompts are waiting.')
    routeRpc({
      'workbench.permission.list': () => {
        throw new RuntimeRpcCallError({
          id: 'call',
          ok: false,
          error: {
            code: 'autopilot_permission_relay_unavailable',
            message: 'The permission relay is not running.'
          }
        })
      }
    })
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_PERMISSION_POLL_MS)
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The permission relay is not running.')
    expect(alert.textContent).toContain('autopilot_permission_relay_unavailable')
    unmount()
    await act(async () => {
      vi.advanceTimersByTime(WORKBENCH_PERMISSION_POLL_MS * 2)
    })
    expect(callsTo('workbench.permission.list')).toHaveLength(2)
  })
})
