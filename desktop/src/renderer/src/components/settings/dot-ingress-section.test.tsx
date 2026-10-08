// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { DotIngressSection } from './dot-ingress-section'
import {
  fixtureDotSettings,
  fixtureListeningDotSettings
} from './dot-ingress-settings.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)
const clipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>())

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})
// Why: the remote group has its own tests and RPC group; here only its place in the section counts.
vi.mock('./dot-remote-access-card', () => ({
  DotRemoteAccessCard: () => <div>Remote access card</div>
}))

/** Each method answers its value; a RuntimeRpcCallError value is thrown as the refusal. */
function answer(byMethod: Record<string, unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    const value = byMethod[method]
    if (value === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    if (value instanceof RuntimeRpcCallError) {
      throw value
    }
    return value
  })
}

function refuse(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 't', ok: false, error: { code, message: `raw ${code}` } })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderSection(): Promise<void> {
  render(<DotIngressSection />)
  await act(async () => {})
}

const group = (name: string): HTMLElement => screen.getByRole('region', { name })
const interfaceGroup = (): HTMLElement => group('Tasks from dot')
const statusLabel = (shell: HTMLElement, label: string): HTMLElement =>
  within(shell).getByText(label, { selector: '[data-status-tone] > span' })

describe('DotIngressSection', () => {
  beforeEach(() => {
    rpc.mockReset()
    clipboard.mockReset()
    clipboard.mockResolvedValue(undefined)
    Object.assign(window, { api: { ui: { writeClipboardText: clipboard } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('reads the dot settings through the local desktop runtime only', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    expect(rpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'workbench.dotIngress.settings.get',
      undefined
    )
  })

  it('says that dot tasks start without confirmation and are bounded by these settings', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const text = interfaceGroup().textContent
    expect(text).toMatch(/starts without asking you/)
    expect(text).toMatch(/only the workspaces enabled below, within your limits/)
  })

  it('shows plain groups with headings and no "endpoint" wording', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureListeningDotSettings() })
    await renderSection()

    const section = document.querySelector('[data-settings-section="integrations-dot"]')
    expect(section?.textContent).not.toMatch(/endpoint/i)
    for (const name of ['Tasks from dot', 'Workspaces', 'Limits']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
  })

  it('shows an off switch as off, with an icon and a label', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const shell = interfaceGroup()
    const toggle = within(shell).getByRole('switch', { name: 'Accept tasks from dot' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(statusLabel(shell, 'Off').parentElement?.querySelector('svg')).not.toBeNull()
    expect(within(shell).getByRole('status').textContent).toBe('')
  })

  it('turns tasks from dot on and shows the status the app reports back', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureDotSettings(),
      'workbench.dotIngress.settings.setEnabled': fixtureListeningDotSettings()
    })
    await renderSection()

    await act(async () => {
      fireEvent.click(
        within(interfaceGroup()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    expect(callsTo('workbench.dotIngress.settings.setEnabled')).toEqual([{ enabled: true }])
    const shell = interfaceGroup()
    expect(statusLabel(shell, 'Ready')).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(
      /cannot tell whether dot is connected/
    )
  })

  it('explains a failure in plain English and keeps its code behind Copy details', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureDotSettings(),
      'workbench.dotIngress.settings.setEnabled': fixtureDotSettings({
        enabled: true,
        failure: 'metadata_not_secured'
      })
    })
    await renderSection()

    await act(async () => {
      fireEvent.click(
        within(interfaceGroup()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const shell = interfaceGroup()
    const alert = within(shell).getByRole('alert')
    expect(alert.textContent).toMatch(/could not protect the connection details/)
    expect(shell.textContent).not.toContain('metadata_not_secured')
    expect(statusLabel(shell, 'Not ready')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Copy details' }))
    })
    expect(clipboard).toHaveBeenCalledWith('failure: metadata_not_secured')
  })

  it('says when the switch is on but tasks from dot are not ready in this session', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings({ enabled: true }) })
    await renderSection()

    expect(within(interfaceGroup()).getByRole('status').textContent).toMatch(
      /not ready in this session/
    )
  })

  it('shows a refused switch change and re-reads the real state', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureDotSettings(),
      'workbench.dotIngress.settings.setEnabled': refuse('workbench_dot_ingress_unavailable')
    })
    await renderSection()

    await act(async () => {
      fireEvent.click(
        within(interfaceGroup()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const alert = within(interfaceGroup()).getByRole('alert')
    expect(alert.textContent).toMatch(/not available in this session/)
    expect(alert.textContent).not.toContain('raw')
    expect(callsTo('workbench.dotIngress.settings.get')).toHaveLength(2)
  })

  it('keeps the last known settings when the re-read after a refusal fails', async () => {
    let reads = 0
    rpc.mockImplementation(async (_target, method) => {
      if (method === 'workbench.dotIngress.settings.get') {
        reads += 1
        if (reads === 1) {
          return fixtureListeningDotSettings()
        }
        throw refuse('runtime_error')
      }
      throw refuse('dot_transaction_unavailable')
    })
    await renderSection()

    await act(async () => {
      fireEvent.click(
        within(interfaceGroup()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const shell = interfaceGroup()
    expect(within(shell).getByRole('switch', { name: 'Accept tasks from dot' })).toBeTruthy()
    expect(
      within(shell)
        .getAllByRole('alert')
        .map((node) => node.textContent)
    ).toEqual([
      expect.stringMatching(/settings store was busy/),
      expect.stringMatching(/did not complete/)
    ])
  })

  it('checks again on Refresh', async () => {
    let reads = 0
    rpc.mockImplementation(async (_target, method) => {
      if (method !== 'workbench.dotIngress.settings.get') {
        throw new Error(`unexpected method ${method}`)
      }
      reads += 1
      return reads === 1 ? fixtureDotSettings({ enabled: true }) : fixtureListeningDotSettings()
    })
    await renderSection()
    expect(statusLabel(interfaceGroup(), 'Not ready')).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(interfaceGroup()).getByRole('button', { name: 'Refresh' }))
    })

    expect(statusLabel(interfaceGroup(), 'Ready')).toBeTruthy()
  })

  it('reports an unregistered settings method as not connected and offers no controls', async () => {
    answer({ 'workbench.dotIngress.settings.get': refuse('method_not_found') })
    await renderSection()

    expect(within(interfaceGroup()).getByRole('alert').textContent).toMatch(
      /not connected in this build/
    )
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(statusLabel(group('Workspaces'), 'Unavailable')).toBeTruthy()
    expect(statusLabel(group('Limits'), 'Unavailable')).toBeTruthy()
  })

  it('ends with the remote access group', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const section = document.querySelector('[data-settings-section="integrations-dot"]')
    expect(section?.textContent).toMatch(/Remote access card$/)
    expect(screen.queryByText('Coming soon')).toBeNull()
  })
})
