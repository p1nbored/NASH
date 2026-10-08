// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { DotRateLimitsSchema } from '../../../../shared/dot-ingress/dot-ingress-settings'
import { DotIngressSection } from './dot-ingress-section'
import { fixtureListeningDotSettings } from './dot-ingress-settings.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

const SET_LIMITS = 'workbench.dotIngress.settings.setRateLimits'

/** `echoLimits` answers each cap change with the caps it was sent, like the real handler. */
function answer(byMethod: Record<string, unknown>, options: { echoLimits?: boolean } = {}): void {
  rpc.mockImplementation(async (_target, method, params) => {
    if (options.echoLimits === true && method === SET_LIMITS) {
      return fixtureListeningDotSettings({ rateLimits: DotRateLimitsSchema.parse(params) })
    }
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

function inputValue(element: HTMLElement): string {
  return element instanceof HTMLInputElement ? element.value : ''
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderCard(): Promise<HTMLElement> {
  render(<DotIngressSection />)
  await act(async () => {})
  return screen.getByRole('region', { name: 'Limits' })
}

async function commit(input: HTMLElement, value: string): Promise<void> {
  fireEvent.change(input, { target: { value } })
  await act(async () => {
    fireEvent.blur(input)
  })
}

describe('DotIngressSection submission limits', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the current caps with no defaults badge', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureListeningDotSettings() })
    const shell = await renderCard()

    expect(within(shell).queryByText('Defaults')).toBeNull()
    expect(inputValue(within(shell).getByLabelText('Tasks per minute'))).toBe('6')
    expect(inputValue(within(shell).getByLabelText('Tasks per UTC day'))).toBe('100')
    expect(shell.textContent).toMatch(/refused and nothing starts/)
  })

  it('shows changed caps as they are stored', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureListeningDotSettings({
        rateLimits: { ratePerMinute: 10, ratePerUtcDay: 250 }
      })
    })
    const shell = await renderCard()

    expect(inputValue(within(shell).getByLabelText('Tasks per minute'))).toBe('10')
    expect(inputValue(within(shell).getByLabelText('Tasks per UTC day'))).toBe('250')
  })

  it('saves a new per-minute cap together with the current daily cap', async () => {
    answer(
      { 'workbench.dotIngress.settings.get': fixtureListeningDotSettings() },
      { echoLimits: true }
    )
    const shell = await renderCard()

    await commit(within(shell).getByLabelText('Tasks per minute'), '10')

    expect(callsTo(SET_LIMITS)).toEqual([{ ratePerMinute: 10, ratePerUtcDay: 100 }])
    expect(inputValue(within(shell).getByLabelText('Tasks per minute'))).toBe('10')
  })

  it('keeps the caps inside the range the app accepts', async () => {
    answer(
      { 'workbench.dotIngress.settings.get': fixtureListeningDotSettings() },
      { echoLimits: true }
    )
    const shell = await renderCard()

    await commit(within(shell).getByLabelText('Tasks per minute'), '500')
    await commit(within(shell).getByLabelText('Tasks per UTC day'), '0')

    expect(callsTo(SET_LIMITS)).toEqual([
      { ratePerMinute: 60, ratePerUtcDay: 100 },
      { ratePerMinute: 60, ratePerUtcDay: 1 }
    ])
  })

  it('sends nothing when a cap is left unchanged', async () => {
    answer(
      { 'workbench.dotIngress.settings.get': fixtureListeningDotSettings() },
      { echoLimits: true }
    )
    const shell = await renderCard()

    await commit(within(shell).getByLabelText('Tasks per UTC day'), '100')

    expect(callsTo(SET_LIMITS)).toHaveLength(0)
  })

  it('shows a refused change in plain English', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureListeningDotSettings(),
      [SET_LIMITS]: new RuntimeRpcCallError({
        id: 't',
        ok: false,
        error: { code: 'invalid_argument', message: 'raw invalid' }
      })
    })
    const shell = await renderCard()

    await commit(within(shell).getByLabelText('Tasks per minute'), '12')

    const alert = within(shell).getByRole('alert')
    expect(alert.textContent).toMatch(/refused this value/)
    expect(alert.textContent).not.toContain('raw')
  })

  it('shows the stored cap again after a refused change', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureListeningDotSettings(),
      [SET_LIMITS]: new RuntimeRpcCallError({
        id: 't',
        ok: false,
        error: { code: 'dot_transaction_unavailable', message: 'raw busy' }
      })
    })
    const shell = await renderCard()

    await commit(within(shell).getByLabelText('Tasks per minute'), '12')

    expect(inputValue(within(shell).getByLabelText('Tasks per minute'))).toBe('6')
  })
})
