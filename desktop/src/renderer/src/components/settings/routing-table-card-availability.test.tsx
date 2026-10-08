// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { RoutingTableCard } from './routing-table-card'
import { useRoutingTable } from './use-routing-table'
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

it('refreshes the actual model options without offering another CLI catalog', async () => {
  answer({
    'workbench.routingTable.list': fixtureListResult({
      models: { claude: null, codex: null, agy: null }
    }),
    'workbench.routingTable.checkRoutes': {
      ...fixtureCheckResult(),
      models: {
        claude: [{ id: 'claude-fixture-model-1', label: 'CLI returned model', efforts: ['high'] }],
        codex: [{ id: 'gpt-fixture-model-1', label: 'Other CLI model', efforts: ['high'] }],
        agy: null
      }
    }
  })
  await renderCard()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' })))
  fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Coordinator model' }))
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'CLI returned model'
  ])
})

function routeRow(taskType: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Agent for each task' })
  return within(list).getByRole('listitem', { name: taskType })
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
    expect(routeRow('Coordinator').textContent).toContain('Not checked')
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
    expect(screen.getByRole('button', { name: 'Refresh model list' })).toBeTruthy()
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
      fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))
    })
    const checking = screen.getByRole('button', { name: 'Refreshing…' })
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
    expect(screen.getByRole('button', { name: 'Refresh model list' })).toHaveProperty(
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
      fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))
    })

    for (const name of ['Edit Software engineering', 'Edit Coordinator', 'Edit Reviewer 1']) {
      expect(screen.getByRole('button', { name }), name).toHaveProperty('disabled', true)
    }
  })

  it('reads the table again after a refused check, and says why it was refused', async () => {
    answer({
      'workbench.routingTable.list': LISTED,
      'workbench.routingTable.checkRoutes': {
        ok: false,
        reason: 'routing_table_integrity_failed',
        detail: 'version_hash_mismatch'
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))
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
    const { result } = renderHook(() => useRoutingTable())
    await act(async () => {})
    await act(async () => {
      void result.current.refresh()
    })
    await act(async () => {
      await result.current.checkRoutes()
    })
    await act(async () => {
      finishList(LISTED)
    })

    expect(
      result.current.availability?.routes.find((row) => row.taskType === 'high_quality_writing')
        ?.availability.status
    ).toBe('available')
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
      fireEvent.click(screen.getByRole('button', { name: 'Refresh model list' }))
    })

    expect(routeRow('High-quality writing').textContent).toContain('Not checked')
    expect(callsTo('workbench.routingTable.list').length).toBeGreaterThanOrEqual(2)
  })
})
