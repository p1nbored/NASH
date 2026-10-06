import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getWorkbenchRequestStore } from './workbench-request-store'
import { WorkbenchClefSpendStore } from './workbench-clef-spend-store'
import type {
  ClefSpendReservationRow,
  ClefSpendSettlement,
  ClefSpendStore
} from '../../../clef/clef-spend-ledger'
import {
  routeFixturePrincipal,
  routeFixtureSubmitInput,
  routeFixtureWorkspace
} from './workbench-route-test-fixture'

// FIXTURE_ONLY: synthetic integer amounts; the ledger owns real price math.
describe('Workbench Clef spend rows', () => {
  let owner: OrchestrationDb
  let spend: WorkbenchClefSpendStore
  let requestId: string

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    requestId = getWorkbenchRequestStore(owner).submit(
      routeFixturePrincipal,
      routeFixtureSubmitInput(),
      routeFixtureWorkspace
    ).request.requestId
    spend = new WorkbenchClefSpendStore(owner.db)
  })
  afterEach(() => owner.close())

  let counter = 0
  const reservation = (
    overrides: Partial<ClefSpendReservationRow> = {}
  ): ClefSpendReservationRow => ({
    reservationId: `spend_fixture_${++counter}`,
    requestId,
    purpose: 'production',
    attempt: 1,
    utcDayKey: '2026-10-04',
    priceBasisVersion: 1,
    estimatedInputTokens: 1000,
    reservedMicroUsd: 500,
    reservedNeurons: 30,
    reservedAt: '2026-10-04T12:00:00.000Z',
    ...overrides
  })
  const verification = (overrides: Partial<ClefSpendReservationRow> = {}) =>
    reservation({ purpose: 'verification', requestId: null, attempt: null, ...overrides })
  const usage = (overrides: Partial<ClefSpendSettlement> = {}): ClefSpendSettlement => ({
    basis: 'usage',
    spentMicroUsd: 100,
    spentNeurons: 9,
    inputTokens: 400,
    outputTokens: 12,
    outputCost: 'cost_unknown',
    settledAt: '2026-10-04T12:00:05.000Z',
    ...overrides
  })
  const kept = (row: ClefSpendReservationRow): ClefSpendSettlement => ({
    basis: 'reservation_kept',
    spentMicroUsd: row.reservedMicroUsd,
    spentNeurons: row.reservedNeurons,
    inputTokens: null,
    outputTokens: null,
    outputCost: 'cost_unknown',
    settledAt: '2026-10-04T12:00:06.000Z'
  })
  const insert = (row: ClefSpendReservationRow) =>
    spend.atomically(() => spend.insertReservation(row))
  const rowCount = () => owner.db.prepare('SELECT count(*) AS n FROM workbench_clef_spend').get()?.n

  it('implements the ledger persistence port exactly', () => {
    const port: ClefSpendStore = new WorkbenchClefSpendStore(owner.db)
    expect(port.countAttemptsForRequest(requestId)).toBe(0)
    expect(port.sumSpentMicroUsd(['production'])).toBe(0)
    expect(port.sumNeuronsForUtcDay('2026-10-04')).toBe(0)
  })

  it('counts open reservations at their reserved amount, separated by purpose', () => {
    insert(reservation())
    insert(verification({ reservedMicroUsd: 1_250_000 }))
    insert(reservation({ purpose: 'test', requestId: null, attempt: null, reservedMicroUsd: 2 }))
    expect(spend.sumSpentMicroUsd(['production'])).toBe(500)
    expect(spend.sumSpentMicroUsd(['verification', 'test'])).toBe(1_250_002)
    expect(spend.sumSpentMicroUsd([])).toBe(0)
  })

  it('settles from usage, keeps usage-less attempts as spent and refuses a second settlement', () => {
    const settled = reservation()
    const keptRow = reservation({ attempt: 2 })
    insert(settled)
    insert(keptRow)
    spend.settle(settled.reservationId, usage())
    spend.settle(keptRow.reservationId, kept(keptRow))
    expect(spend.sumSpentMicroUsd(['production'])).toBe(600)
    expect(spend.sumNeuronsForUtcDay('2026-10-04')).toBe(39)
    expect(
      owner.db
        .prepare(
          `SELECT state, attempt, input_tokens, output_tokens, output_cost, spent_micro_usd, closed_at
          FROM workbench_clef_spend ORDER BY sequence`
        )
        .all()
    ).toEqual([
      {
        state: 'settled',
        attempt: 1,
        input_tokens: 400,
        output_tokens: 12,
        output_cost: 'cost_unknown',
        spent_micro_usd: 100,
        closed_at: '2026-10-04T12:00:05.000Z'
      },
      {
        state: 'kept',
        attempt: 2,
        input_tokens: null,
        output_tokens: null,
        output_cost: 'cost_unknown',
        spent_micro_usd: 500,
        closed_at: '2026-10-04T12:00:06.000Z'
      }
    ])
    expect(() => spend.settle(keptRow.reservationId, kept(keptRow))).toThrow('already closed')
    expect(() => spend.settle('spend_missing', kept(keptRow))).toThrow('already closed')
  })

  it('sums neurons by the stored UTC day key across every purpose when none are named', () => {
    insert(reservation({ reservedAt: '2026-10-04T23:59:59.999Z', reservedNeurons: 10 }))
    insert(
      reservation({
        attempt: 2,
        utcDayKey: '2026-10-05',
        reservedAt: '2026-10-05T00:00:00.000Z',
        reservedNeurons: 20
      })
    )
    insert(
      verification({
        utcDayKey: '2026-10-05',
        reservedAt: '2026-10-05T08:00:00Z',
        reservedNeurons: 5
      })
    )
    expect(spend.sumNeuronsForUtcDay('2026-10-04')).toBe(10)
    expect(spend.sumNeuronsForUtcDay('2026-10-05')).toBe(25)
    expect(() => spend.sumNeuronsForUtcDay('2026-13-01')).toThrow()
    expect(() => spend.sumNeuronsForUtcDay('today')).toThrow()
  })

  it('sums neurons for the requested purposes only, and for every purpose when none are given', () => {
    insert(reservation({ reservedNeurons: 10 }))
    insert(verification({ reservedNeurons: 5 }))
    insert(reservation({ purpose: 'test', requestId: null, attempt: null, reservedNeurons: 2 }))
    expect(spend.sumNeuronsForUtcDay('2026-10-04', ['production'])).toBe(10)
    expect(spend.sumNeuronsForUtcDay('2026-10-04', ['verification', 'test'])).toBe(7)
    expect(spend.sumNeuronsForUtcDay('2026-10-04', [])).toBe(0)
    expect(spend.sumNeuronsForUtcDay('2026-10-04')).toBe(17)
    expect(spend.sumNeuronsForUtcDay('2026-10-05', ['production'])).toBe(0)
    // @ts-expect-error -- a purpose outside the ledger vocabulary is refused, not interpolated.
    expect(() => spend.sumNeuronsForUtcDay('2026-10-04', ["production') OR 1=1 --"])).toThrow()
  })

  it('counts every billed attempt for a request, open or closed', () => {
    const first = reservation()
    insert(first)
    spend.settle(first.reservationId, kept(first))
    insert(reservation({ attempt: 2 }))
    expect(spend.countAttemptsForRequest(requestId)).toBe(2)
    expect(spend.countAttemptsForRequest('fixture-other')).toBe(0)
  })

  it.each([
    ['production spend without a request', { requestId: null, attempt: null }],
    ['request spend without an attempt number', { attempt: null }],
    ['an attempt number without a request', { purpose: 'test', requestId: null }],
    ['a zero attempt number', { attempt: 0 }],
    ['a negative amount', { reservedMicroUsd: -1 }],
    ['a fractional micro-dollar amount', { reservedMicroUsd: 0.5 }],
    ['fractional neurons', { reservedNeurons: 32.7 }],
    ['a non-finite amount', { reservedNeurons: Number.POSITIVE_INFINITY }],
    ['a fractional token estimate', { estimatedInputTokens: 1.5 }],
    ['an unknown purpose', { purpose: 'shadow' }],
    ['a malformed id', { reservationId: 'spend fixture' }],
    ['a local timestamp', { reservedAt: '2026-10-04 12:00:00' }],
    ['a day key outside the reservation day', { utcDayKey: '2026-10-05' }],
    ['an unknown field', { reservedUsd: 0.5 }]
  ])('refuses %s before writing', (_label, overrides) => {
    // Why: JSON round-trip stands in for an untyped caller that skipped the port's types.
    const candidate = JSON.parse(JSON.stringify({ ...reservation(), ...overrides }))
    expect(() => insert(candidate)).toThrow()
    expect(rowCount()).toBe(0)
  })

  it.each([
    ['usage without input tokens', { inputTokens: null }],
    ['a kept reservation carrying usage', { basis: 'reservation_kept' }],
    ['a priced output', { outputCost: 'priced' }],
    ['a fractional amount', { spentMicroUsd: 0.25 }],
    ['a local timestamp', { settledAt: 'yesterday' }],
    ['an unknown field', { spentUsd: 0.1 }]
  ])('refuses a settlement with %s and leaves the reservation open', (_label, overrides) => {
    const open = reservation()
    insert(open)
    // Why: JSON round-trip stands in for an untyped caller that skipped the port's types.
    const candidate = JSON.parse(JSON.stringify({ ...usage(), ...overrides }))
    expect(() => spend.settle(open.reservationId, candidate)).toThrow()
    expect(owner.db.prepare('SELECT state FROM workbench_clef_spend').get()?.state).toBe('reserved')
  })

  it('refuses a kept settlement that does not spend exactly the reservation', () => {
    const open = reservation()
    insert(open)
    expect(() => spend.settle(open.reservationId, { ...kept(open), spentMicroUsd: 1 })).toThrow(
      'CHECK'
    )
    expect(spend.sumSpentMicroUsd(['production'])).toBe(500)
  })

  it('stores amounts only as exact integers, even when written past the store', () => {
    expect(() =>
      owner.db.exec(`INSERT INTO workbench_clef_spend (reservation_id, purpose, price_basis_version,
        estimated_input_tokens, reserved_micro_usd, reserved_neurons, state, utc_day, reserved_at)
        VALUES ('spend_raw', 'test', 1, 10, 0.5, 1, 'reserved', '2026-10-04', '2026-10-04T12:00:00Z')`)
    ).toThrow('CHECK')
  })

  it('refuses a duplicate id, a duplicate attempt and a reservation for an unknown request', () => {
    const first = reservation()
    insert(first)
    expect(() => insert(first)).toThrow('UNIQUE')
    expect(() => insert(reservation())).toThrow('UNIQUE')
    expect(() => insert(reservation({ requestId: 'fixture-missing' }))).toThrow('FOREIGN KEY')
    expect(rowCount()).toBe(1)
  })

  it('writes reservations only inside a transaction so cap checks and insert are atomic', () => {
    expect(() => spend.insertReservation(reservation())).toThrow('transaction')
    expect(() =>
      spend.atomically(() => {
        spend.insertReservation(reservation())
        throw new Error('fixture cap refusal')
      })
    ).toThrow('fixture cap refusal')
    expect(rowCount()).toBe(0)
    expect(owner.db.isTransaction).toBe(false)
  })

  it('refuses to reserve inside an uncommitted outer transaction', () => {
    owner.db.exec('BEGIN IMMEDIATE')
    expect(() => insert(reservation())).toThrow('idle database')
    owner.db.exec('ROLLBACK')
    expect(rowCount()).toBe(0)
  })

  it('releases only open reservations and keeps their amount as spent', () => {
    const open = reservation()
    const closed = reservation({ attempt: 2 })
    insert(open)
    insert(closed)
    spend.settle(closed.reservationId, kept(closed))
    expect(spend.releaseUnsettled('2026-10-04T13:00:00.000Z')).toBe(1)
    expect(spend.releaseUnsettled('2026-10-04T13:00:01.000Z')).toBe(0)
    expect(spend.sumSpentMicroUsd(['production'])).toBe(1000)
    expect(
      owner.db
        .prepare('SELECT state, output_cost FROM workbench_clef_spend ORDER BY sequence')
        .all()
    ).toEqual([
      { state: 'released', output_cost: 'cost_unknown' },
      { state: 'kept', output_cost: 'cost_unknown' }
    ])
  })
})
