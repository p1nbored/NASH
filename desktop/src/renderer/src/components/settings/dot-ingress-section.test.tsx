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

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})
// Why: the remote card has its own tests and RPC group; here only its place in the section counts.
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

function card(name: string): HTMLElement {
  const title = screen.getByText(name, { selector: 'p' })
  const shell = title.closest('[data-settings-section]')
  if (!(shell instanceof HTMLElement)) {
    throw new Error(`card ${name} is missing`)
  }
  return shell
}

const interfaceCard = (): HTMLElement => card('Local dot interface')

describe('DotIngressSection', () => {
  beforeEach(() => {
    rpc.mockReset()
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

  it('says that dot tasks start without confirmation and are limited by these settings', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const section = screen.getByRole('heading', { name: 'Tasks from dot' }).closest('section')
    expect(section?.textContent).toMatch(/starts without asking you first/)
    expect(section?.textContent).toMatch(/limited by the interface switch/)
  })

  it('shows an off interface as not listening', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const shell = interfaceCard()
    const toggle = within(shell).getByRole('switch', { name: 'Accept tasks from dot' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(within(shell).getByText('Not listening', { selector: 'span' })).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(/The switch is off/)
  })

  it('turns the interface on and shows the status the app reports back', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureDotSettings(),
      'workbench.dotIngress.settings.setEnabled': fixtureListeningDotSettings()
    })
    await renderSection()

    await act(async () => {
      fireEvent.click(
        within(interfaceCard()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    expect(callsTo('workbench.dotIngress.settings.setEnabled')).toEqual([{ enabled: true }])
    const shell = interfaceCard()
    expect(within(shell).getByText('Listening', { selector: 'span' })).toBeTruthy()
    expect(within(shell).getByRole('status').textContent).toMatch(
      /cannot tell whether dot is connected/
    )
  })

  it('explains a listening failure in plain English', async () => {
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
        within(interfaceCard()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const shell = interfaceCard()
    const alert = within(shell).getByRole('alert')
    expect(alert.textContent).toMatch(/could not restrict access/)
    expect(shell.textContent).not.toContain('metadata_not_secured')
    expect(within(shell).getByText('Not listening', { selector: 'span' })).toBeTruthy()
  })

  it('says when the switch is on but no endpoint is open in this session', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings({ enabled: true }) })
    await renderSection()

    expect(within(interfaceCard()).getByRole('status').textContent).toMatch(
      /not open in this session/
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
        within(interfaceCard()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const alert = within(interfaceCard()).getByRole('alert')
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
        within(interfaceCard()).getByRole('switch', { name: 'Accept tasks from dot' })
      )
    })

    const shell = interfaceCard()
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

  it('checks the endpoint again on Refresh', async () => {
    let reads = 0
    rpc.mockImplementation(async (_target, method) => {
      if (method !== 'workbench.dotIngress.settings.get') {
        throw new Error(`unexpected method ${method}`)
      }
      reads += 1
      return reads === 1 ? fixtureDotSettings({ enabled: true }) : fixtureListeningDotSettings()
    })
    await renderSection()
    expect(within(interfaceCard()).getByText('Not listening', { selector: 'span' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(interfaceCard()).getByRole('button', { name: 'Refresh' }))
    })

    expect(within(interfaceCard()).getByText('Listening', { selector: 'span' })).toBeTruthy()
  })

  it('reports an unregistered settings method as not connected and offers no controls', async () => {
    answer({ 'workbench.dotIngress.settings.get': refuse('method_not_found') })
    await renderSection()

    expect(within(interfaceCard()).getByRole('alert').textContent).toMatch(
      /not connected in this build/
    )
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(within(card('Workspaces for dot')).getByText('Unavailable')).toBeTruthy()
    expect(within(card('Submission limits')).getByText('Unavailable')).toBeTruthy()
  })

  it('ends with the remote access card in place of the placeholder', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureDotSettings() })
    await renderSection()

    const section = screen.getByRole('heading', { name: 'Tasks from dot' }).closest('section')
    expect(section?.textContent).toMatch(/Remote access card$/)
    expect(screen.queryByText('Coming soon')).toBeNull()
  })
})
