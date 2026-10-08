// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { RoutingTableCard } from './routing-table-card'
import {
  FIXTURE_SHA_V4,
  fixtureAvailability,
  fixtureCheckResult,
  fixtureListResult
} from './routing-table-view.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

function answer(
  byMethod: Record<string, unknown>,
  later: Record<string, () => Promise<unknown>> = {}
): void {
  rpc.mockImplementation(async (_target, method) => {
    const deferred = later[method]
    if (deferred !== undefined) {
      return deferred()
    }
    const value = byMethod[method]
    if (value === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    return value
  })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderCard(): Promise<void> {
  render(<RoutingTableCard />)
  await act(async () => {})
}

function routeRow(taskType: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Agent for each task' })
  return within(list).getByRole('listitem', { name: taskType })
}

function openAdvanced(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
}

const LISTED = fixtureListResult({
  availability: fixtureAvailability({
    software_engineering: { status: 'available', reasons: [], awaitingUserConfirmation: false },
    routine_analysis_batch: {
      status: 'unavailable',
      reasons: ['model_not_listed'],
      awaitingUserConfirmation: false
    },
    complex_pdf_evidence_analysis: {
      status: 'unavailable',
      reasons: ['workspace_not_git'],
      awaitingUserConfirmation: true
    }
  })
})

describe('RoutingTableCard route availability', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows each choice with an icon and a status label, and its reasons in plain English', async () => {
    answer({ 'workbench.routingTable.list': LISTED })
    await renderCard()

    expect(routeRow('Software engineering').textContent).toContain('Available')
    expect(
      routeRow('Software engineering').querySelector('[data-status-tone="success"] svg')
    ).not.toBeNull()
    const batch = routeRow('Routine analysis batch')
    expect(batch.textContent).toContain('Unavailable')
    expect(batch.textContent).toMatch(/model is not offered/i)
    expect(batch.textContent).not.toContain('model_not_listed')
    expect(routeRow('Complex PDF and evidence analysis').textContent).toMatch(
      /awaiting your confirmation/i
    )
    expect(routeRow('High-quality writing').textContent).toContain('Not checked')
    expect(routeRow('Primary').textContent).toContain('Not checked')
    const reviewers = screen.getByRole('list', { name: 'Reviewers' })
    expect(within(reviewers).getAllByText('Not checked')).toHaveLength(2)
  })

  it('leaves out developer notes on where usage readings come from', async () => {
    answer({ 'workbench.routingTable.list': LISTED })
    await renderCard()

    expect(document.body.textContent).not.toMatch(/app-server|status line|10 minutes/)
  })

  it('shows no status when the list carries no availability', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    expect(routeRow('Software engineering').querySelector('[data-status-tone]')).toBeNull()
    expect(screen.queryByText('Not checked')).toBeNull()
    // Why: without installed checks there is nothing to run, so the button is not offered.
    expect(screen.queryByRole('button', { name: 'Check availability' })).toBeNull()
  })

  it('checks the routes on request, shows that it is checking, then the result', async () => {
    let finish: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      finish = resolve
    })
    answer(
      { 'workbench.routingTable.list': LISTED },
      { 'workbench.routingTable.checkRoutes': () => pending }
    )
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })
    const checking = screen.getByRole('button', { name: 'Checking…' })
    expect(checking).toHaveProperty('disabled', true)
    expect(callsTo('workbench.routingTable.checkRoutes')).toEqual([{}])

    await act(async () => {
      finish(
        fixtureCheckResult({
          routine_analysis_batch: {
            status: 'unverified',
            reasons: ['model_list_unavailable'],
            awaitingUserConfirmation: false
          }
        })
      )
    })

    expect(screen.getByRole('status').textContent).toBe(
      'Checked: 12 available, 0 unavailable, 1 not verified.'
    )
    expect(routeRow('High-quality writing').textContent).toContain('Available')
    expect(routeRow('Routine analysis batch').textContent).toMatch(/model list could not be read/i)
    expect(screen.getByRole('button', { name: 'Check availability' })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('reports a check that could not run, without its raw text', async () => {
    answer(
      { 'workbench.routingTable.list': LISTED },
      {
        'workbench.routingTable.checkRoutes': () =>
          Promise.reject(
            new RuntimeRpcCallError({
              id: 'rpc-1',
              ok: false,
              error: {
                code: 'workbench_route_availability_unavailable',
                message: 'FIXTURE_ONLY raw text'
              }
            })
          )
      }
    )
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/not available/i)
    expect(alert.textContent).not.toContain('FIXTURE_ONLY')
    expect(routeRow('Routine analysis batch').textContent).toContain('Unavailable')
  })

  it('keeps every table action disabled while a check runs', async () => {
    answer(
      { 'workbench.routingTable.list': LISTED },
      { 'workbench.routingTable.checkRoutes': () => new Promise(() => {}) }
    )
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })

    openAdvanced()
    for (const name of ['Refresh', 'Import…', 'Edit Software engineering', 'Edit Primary']) {
      expect(screen.getByRole('button', { name }), name).toHaveProperty('disabled', true)
    }
    const proposal = screen.getByRole('group', { name: 'App update' })
    expect(within(proposal).getByRole('button', { name: 'Accept' })).toHaveProperty(
      'disabled',
      true
    )
  })

  it('reads the table again after a refused check, and says why it was refused', async () => {
    answer({
      'workbench.routingTable.list': LISTED,
      'workbench.routingTable.checkRoutes': {
        ok: false,
        reason: 'routing_table_integrity_failed',
        detail: 'version_hash_mismatch',
        existingProposalId: null
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })

    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/)
    expect(screen.getByRole('alert').textContent).not.toMatch(/hash/)
    expect(callsTo('workbench.routingTable.list')).toHaveLength(2)
  })

  it('keeps a check result when a read that began before it returns afterwards', async () => {
    let listCalls = 0
    let finishList: (value: unknown) => void = () => {}
    answer(
      { 'workbench.routingTable.checkRoutes': fixtureCheckResult() },
      {
        'workbench.routingTable.list': () => {
          listCalls += 1
          return listCalls === 1
            ? Promise.resolve(LISTED)
            : new Promise((resolve) => {
                finishList = resolve
              })
        }
      }
    )
    await renderCard()
    openAdvanced()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })
    await act(async () => {
      finishList(LISTED)
    })

    expect(routeRow('High-quality writing').textContent).toContain('Available')
  })

  it('shows a refused check, and ignores a result for a version that is no longer active', async () => {
    answer({
      'workbench.routingTable.list': LISTED,
      'workbench.routingTable.checkRoutes': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        availability: fixtureAvailability(
          {},
          { status: 'available', reasons: [], awaitingUserConfirmation: false }
        )
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Check availability' }))
    })

    expect(routeRow('High-quality writing').textContent).toContain('Not checked')
    expect(callsTo('workbench.routingTable.list').length).toBeGreaterThanOrEqual(2)
  })
})
