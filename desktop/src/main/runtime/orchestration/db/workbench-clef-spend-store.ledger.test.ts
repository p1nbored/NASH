import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getWorkbenchRequestStore } from './workbench-request-store'
import { WorkbenchClefSpendStore } from './workbench-clef-spend-store'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { createClefSpendLedger, type ClefSpendPurpose } from '../../../clef/clef-spend-ledger'
import {
  routeFixturePrincipal,
  routeFixtureSubmitInput,
  routeFixtureWorkspace
} from './workbench-route-test-fixture'

// FIXTURE_ONLY: isolated temporary storage and synthetic token estimates; no Clef call is made.
const FIXTURE_DIRECTORY_PREFIX = 'orca-workbench-spend-fixture-'
// 1,000,000 estimated tokens reserve 1.5M at US$0.24/M plus US$0.001: 361,000 micro-dollars.
const LARGE_ESTIMATE = 1_000_000
const LARGE_RESERVATION_MICRO_USD = 361_000
// 40,000 estimated tokens reserve 60,000 x 21,818/M rounded up, plus the 91-neuron margin.
const DAILY_ESTIMATE = 40_000
const DAILY_RESERVATION_NEURONS = 1_401

describe('Clef spend ledger over the workbench_clef_spend table', () => {
  let directory: string
  let path: string
  let owner: OrchestrationDb | undefined
  let clock = 0

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), FIXTURE_DIRECTORY_PREFIX))
    path = join(directory, 'orchestration.db')
  })
  afterEach(() => {
    owner?.close()
    owner = undefined
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith(FIXTURE_DIRECTORY_PREFIX)
    ) {
      throw new Error('Fixture cleanup escaped its temporary directory.')
    }
    rmSync(directory, { recursive: true, force: true })
  })

  const open = () => {
    owner?.close()
    const db = new OrchestrationDb(path)
    owner = db
    ensureWorkbenchRequestSchema(db.db)
    const spend = new WorkbenchClefSpendStore(db.db)
    const ledger = createClefSpendLedger({ store: spend, now: () => clock })
    const reserve = (
      purpose: ClefSpendPurpose,
      estimatedInputTokens: number,
      requestId: string | null = null
    ) => spend.atomically(() => ledger.reserve({ requestId, purpose, estimatedInputTokens }))
    return { db: db.db, spend, ledger, reserve, submitRequest: () => submitRequest(db) }
  }
  const submitRequest = (db: OrchestrationDb) =>
    getWorkbenchRequestStore(db).submit(
      routeFixturePrincipal,
      routeFixtureSubmitInput(),
      routeFixtureWorkspace
    ).request.requestId
  const refusalOf = (result: { ok: boolean; refusal?: string }) =>
    result.ok ? null : result.refusal

  it('records verification spend past US$5 with no cap, and keeps the record across a reopen', () => {
    clock = Date.parse('2026-10-04T12:00:00.000Z')
    const first = open()
    for (let attempt = 1; attempt <= 16; attempt++) {
      const result = first.reserve(attempt % 2 === 0 ? 'test' : 'verification', LARGE_ESTIMATE)
      expect(result.ok).toBe(true)
      if (result.ok && attempt % 2 === 0) {
        first.ledger.settle(result.reservation, null)
      }
    }
    expect(first.ledger.snapshot().verificationMicroUsdSpent).toBe(16 * LARGE_RESERVATION_MICRO_USD)

    clock = Date.parse('2027-03-01T08:00:00.000Z')
    const reopened = open()
    expect(reopened.ledger.snapshot().verificationMicroUsdSpent).toBe(5_776_000)
    expect(reopened.reserve('verification', LARGE_ESTIMATE).ok).toBe(true)
    expect(reopened.spend.sumSpentMicroUsd(['verification', 'test'])).toBe(
      17 * LARGE_RESERVATION_MICRO_USD
    )
  })

  it('records production neurons past 2,000 a day with no cap, apart from verification spend', () => {
    clock = Date.parse('2026-10-04T12:00:00.000Z')
    const first = open()
    for (let call = 0; call < 4; call++) {
      expect(first.reserve(call % 2 === 0 ? 'verification' : 'test', DAILY_ESTIMATE).ok).toBe(true)
    }
    const reopened = open()
    expect(reopened.ledger.snapshot().dailyNeuronsSpent).toBe(0)
    for (let call = 0; call < 3; call++) {
      expect(reopened.reserve('production', DAILY_ESTIMATE, reopened.submitRequest()).ok).toBe(true)
    }
    expect(reopened.ledger.snapshot().dailyNeuronsSpent).toBe(3 * DAILY_RESERVATION_NEURONS)
    expect(reopened.spend.sumNeuronsForUtcDay('2026-10-04')).toBe(7 * DAILY_RESERVATION_NEURONS)
  })

  it('keeps production spend out of the verification record', () => {
    clock = Date.parse('2026-10-04T12:00:00.000Z')
    const opened = open()
    const requestId = opened.submitRequest()
    expect(opened.reserve('production', LARGE_ESTIMATE, requestId).ok).toBe(true)
    expect(opened.ledger.snapshot().verificationMicroUsdSpent).toBe(0)
    expect(opened.spend.sumSpentMicroUsd(['production'])).toBe(LARGE_RESERVATION_MICRO_USD)
  })

  it('holds the two-attempt retry bound across a reopen and keys the day at 00:00 UTC', () => {
    clock = Date.parse('2026-10-04T23:59:59.000Z')
    const first = open()
    const requestA = first.submitRequest()
    const requestB = first.submitRequest()
    const reserved = first.reserve('production', DAILY_ESTIMATE, requestA)
    expect(reserved.ok && reserved.reservation.reservedNeurons).toBe(DAILY_RESERVATION_NEURONS)
    if (reserved.ok) {
      // 30,000 billed tokens settle at 655 neurons.
      first.ledger.settle(reserved.reservation, { inputTokens: 30_000, outputTokens: 50 })
    }

    clock = Date.parse('2026-10-04T23:59:59.999Z')
    const reopened = open()
    expect(reopened.ledger.snapshot().dailyNeuronsSpent).toBe(655)

    clock = Date.parse('2026-10-05T00:00:00.000Z')
    expect(reopened.reserve('production', DAILY_ESTIMATE, requestB).ok).toBe(true)
    expect(reopened.reserve('production', 1000, requestA).ok).toBe(true)
    expect(refusalOf(reopened.reserve('production', 1000, requestA))).toBe(
      'request_attempts_exhausted'
    )
    expect(reopened.ledger.snapshot().dailyNeuronsSpent).toBe(DAILY_RESERVATION_NEURONS + 124)
    expect(
      reopened.db
        .prepare(
          'SELECT request_id, attempt, utc_day, state FROM workbench_clef_spend ORDER BY sequence'
        )
        .all()
    ).toEqual([
      { request_id: requestA, attempt: 1, utc_day: '2026-10-04', state: 'settled' },
      { request_id: requestB, attempt: 1, utc_day: '2026-10-05', state: 'reserved' },
      { request_id: requestA, attempt: 2, utc_day: '2026-10-05', state: 'reserved' }
    ])
  })
})
