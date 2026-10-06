import { describe, expect, it } from 'vitest'
import type { ClefSpendReservationRow, ClefSpendSettlement } from './clef-spend-ledger'
import { createClefSpendMemoryStore } from './clef-spend-memory-store.test-fixture'

function row(overrides: Partial<ClefSpendReservationRow> = {}): ClefSpendReservationRow {
  return {
    reservationId: 'res-1',
    requestId: 'req-1',
    purpose: 'production',
    attempt: 1,
    utcDayKey: '2026-10-04',
    priceBasisVersion: 1,
    estimatedInputTokens: 1_000,
    reservedMicroUsd: 1_360,
    reservedNeurons: 124,
    reservedAt: '2026-10-04T12:00:00.000Z',
    ...overrides
  }
}

const settlement: ClefSpendSettlement = {
  basis: 'usage',
  spentMicroUsd: 216,
  spentNeurons: 20,
  inputTokens: 900,
  outputTokens: 4,
  outputCost: 'cost_unknown',
  settledAt: '2026-10-04T12:00:01.000Z'
}

describe('clef spend memory store', () => {
  it('sums reserved spend by purpose and neurons by UTC day', () => {
    const store = createClefSpendMemoryStore()
    store.insertReservation(row({ reservationId: 'a', purpose: 'test' }))
    store.insertReservation(row({ reservationId: 'b', purpose: 'verification' }))
    store.insertReservation(
      row({ reservationId: 'c', purpose: 'production', utcDayKey: '2026-10-05' })
    )
    expect(store.sumSpentMicroUsd(['test'])).toBe(1_360)
    expect(store.sumSpentMicroUsd(['verification', 'test'])).toBe(2_720)
    expect(store.sumSpentMicroUsd([])).toBe(0)
    expect(store.sumNeuronsForUtcDay('2026-10-04')).toBe(248)
    expect(store.sumNeuronsForUtcDay('2026-10-05')).toBe(124)
    expect(store.sumNeuronsForUtcDay('2026-10-06')).toBe(0)
  })

  it('sums neurons for the requested purposes only, and for every purpose when none are given', () => {
    const store = createClefSpendMemoryStore()
    store.insertReservation(row({ reservationId: 'a', purpose: 'production' }))
    store.insertReservation(
      row({ reservationId: 'b', purpose: 'verification', reservedNeurons: 50 })
    )
    store.insertReservation(row({ reservationId: 'c', purpose: 'test', reservedNeurons: 7 }))
    expect(store.sumNeuronsForUtcDay('2026-10-04', ['production'])).toBe(124)
    expect(store.sumNeuronsForUtcDay('2026-10-04', ['verification', 'test'])).toBe(57)
    expect(store.sumNeuronsForUtcDay('2026-10-04', [])).toBe(0)
    expect(store.sumNeuronsForUtcDay('2026-10-04')).toBe(181)
    expect(store.sumNeuronsForUtcDay('2026-10-05', ['production'])).toBe(0)
  })

  it('counts attempts per request', () => {
    const store = createClefSpendMemoryStore()
    store.insertReservation(row({ reservationId: 'a', requestId: 'r1' }))
    store.insertReservation(row({ reservationId: 'b', requestId: 'r1', attempt: 2 }))
    store.insertReservation(row({ reservationId: 'c', requestId: 'r2' }))
    store.insertReservation(
      row({ reservationId: 'd', requestId: null, purpose: 'verification', attempt: null })
    )
    expect(store.countAttemptsForRequest('r1')).toBe(2)
    expect(store.countAttemptsForRequest('r2')).toBe(1)
    expect(store.countAttemptsForRequest('r3')).toBe(0)
  })

  it('replaces the reserved amount with the settled amount', () => {
    const store = createClefSpendMemoryStore()
    store.insertReservation(row())
    store.settle('res-1', settlement)
    expect(store.sumSpentMicroUsd(['production'])).toBe(216)
    expect(store.sumNeuronsForUtcDay('2026-10-04')).toBe(20)
    expect(store.rows()).toEqual([{ ...row(), settlement }])
  })

  it('rejects duplicate reservations, unknown settlements and double settlement', () => {
    const store = createClefSpendMemoryStore()
    store.insertReservation(row())
    expect(() => store.insertReservation(row())).toThrow(/already exists/)
    expect(() => store.settle('missing', settlement)).toThrow(/unknown/)
    store.settle('res-1', settlement)
    expect(() => store.settle('res-1', settlement)).toThrow(/already settled/)
  })

  it('never exposes its internal rows for mutation', () => {
    const store = createClefSpendMemoryStore()
    const inserted = { ...row() }
    store.insertReservation(inserted)
    inserted.reservedMicroUsd = 999_999
    const [snapshot] = store.rows()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(store.rows())).toBe(true)
    expect(store.sumSpentMicroUsd(['production'])).toBe(1_360)
  })
})
