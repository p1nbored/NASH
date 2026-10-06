import { describe, expect, it } from 'vitest'
import {
  CLEF_BILLED_ATTEMPTS_PER_SUBJECT,
  CLEF_PRICE_BASIS,
  CLEF_PRODUCTION_PURPOSES,
  CLEF_RESERVATION_MARGIN_MICRO_USD,
  CLEF_RESERVATION_MARGIN_NEURONS,
  CLEF_SPEND_PURPOSES,
  CLEF_SPEND_REFUSALS,
  CLEF_VERIFICATION_PURPOSES,
  clefInputCostMicroUsd,
  clefInputNeurons,
  clefSpendRefusalBlocker,
  clefUtcDayKey,
  createClefSpendLedger,
  estimateClefReservation,
  type ClefSpendPurpose,
  type ClefSpendStore
} from './clef-spend-ledger'
import * as ledgerModule from './clef-spend-ledger'
import { createClefSpendMemoryStore } from './clef-spend-memory-store.test-fixture'

const DAY_END = Date.parse('2026-10-04T23:59:59.999Z')
const NEXT_DAY_START = Date.parse('2026-10-05T00:00:00.000Z')
let ledgerSerial = 0

function ledgerOver(
  store: ClefSpendStore,
  options: { now?: () => number } = {}
): ReturnType<typeof createClefSpendLedger> {
  const serial = ++ledgerSerial
  let next = 0
  return createClefSpendLedger({
    store,
    now: options.now ?? (() => DAY_END),
    newId: () => `res-${serial}-${++next}`
  })
}

function stubStore(sums: { spentMicroUsd?: number; dayNeurons?: number; attempts?: number }) {
  const inserted: unknown[] = []
  const store: ClefSpendStore = {
    sumSpentMicroUsd: () => sums.spentMicroUsd ?? 0,
    sumNeuronsForUtcDay: () => sums.dayNeurons ?? 0,
    countAttemptsForRequest: () => sums.attempts ?? 0,
    countAttemptsForSubject: () => sums.attempts ?? 0,
    nextAttemptForRequest: () => (sums.attempts ?? 0) + 1,
    insertReservation: (row) => {
      inserted.push(row)
    },
    settle: () => {}
  }
  return { store, inserted }
}

describe('clef spend pricing', () => {
  it('pins the versioned input price basis and leaves output cost unknown', () => {
    expect(CLEF_PRICE_BASIS).toEqual({
      version: 1,
      inputMicroUsdPerMillionTokens: 240_000,
      inputNeuronsPerMillionTokens: 21_818,
      outputCost: 'cost_unknown'
    })
    expect(CLEF_RESERVATION_MARGIN_MICRO_USD).toBe(1_000)
    expect(CLEF_RESERVATION_MARGIN_NEURONS).toBe(91)
  })

  it('rounds input cost and neurons up to whole integer units', () => {
    expect(clefInputCostMicroUsd(1_000_000)).toBe(240_000)
    expect(clefInputCostMicroUsd(1)).toBe(1)
    expect(clefInputCostMicroUsd(900)).toBe(216)
    expect(clefInputCostMicroUsd(0)).toBe(0)
    expect(clefInputNeurons(1_000_000)).toBe(21_818)
    expect(clefInputNeurons(900)).toBe(20)
    expect(clefInputNeurons(0)).toBe(0)
  })

  it('reserves 1.5x the estimate at the input rate plus US$0.001', () => {
    expect(estimateClefReservation(1_000)).toEqual({
      reservedTokens: 1_500,
      reservedMicroUsd: 360 + 1_000,
      reservedNeurons: 33 + 91
    })
    expect(estimateClefReservation(12_000)).toEqual({
      reservedTokens: 18_000,
      reservedMicroUsd: 4_320 + 1_000,
      reservedNeurons: 393 + 91
    })
    expect(estimateClefReservation(3)?.reservedTokens).toBe(5)
  })

  it('refuses estimates that are not positive bounded integers', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001]) {
      expect(estimateClefReservation(bad)).toBeNull()
    }
  })
})

describe('clef UTC day key', () => {
  it('keys spend by the 00:00 UTC day', () => {
    expect(clefUtcDayKey(DAY_END)).toBe('2026-10-04')
    expect(clefUtcDayKey(NEXT_DAY_START)).toBe('2026-10-05')
  })
})

describe('clef spend ledger has no spend limit (D-022)', () => {
  it('exports no cap check, no cap status and no remaining figure', () => {
    expect(Object.keys(ledgerModule)).not.toContain('clefSpendCapsAreSet')
    expect(Object.keys(ledgerModule)).not.toContain('CLEF_CAPPED_TEST_PURPOSES')
    expect(Object.keys(ledgerModule)).not.toContain('nextClefUtcDayStartMs')
    expect(CLEF_SPEND_REFUSALS).toEqual([
      'invalid_estimate',
      'request_id_required',
      'request_attempts_exhausted'
    ])
  })

  it('lets verification and test calls through any total spend', () => {
    for (const purpose of ['verification', 'test'] as const) {
      const { store, inserted } = stubStore({ spentMicroUsd: 99_000_000_000 })
      const result = ledgerOver(store).reserve({
        requestId: null,
        purpose,
        estimatedInputTokens: 1_000_000
      })
      expect(result.ok).toBe(true)
      expect(inserted).toHaveLength(1)
    }
  })

  it('lets production through any daily neuron total', () => {
    const { store, inserted } = stubStore({ dayNeurons: 1_000_000_000 })
    const result = ledgerOver(store).reserve({
      requestId: 'req-1',
      purpose: 'production',
      estimatedInputTokens: 12_000
    })
    expect(result.ok).toBe(true)
    expect(inserted).toHaveLength(1)
  })

  it('reads no spend total before a reservation, only the attempt counts of a request', () => {
    const { store, kinds } = recordingStore()
    const ledger = ledgerOver(store)
    expect(
      ledger.reserve({ requestId: null, purpose: 'verification', estimatedInputTokens: 500 }).ok
    ).toBe(true)
    expect(kinds()).toEqual(new Set())
    expect(
      ledger.reserve({ requestId: 'req-1', purpose: 'production', estimatedInputTokens: 500 }).ok
    ).toBe(true)
    expect(kinds()).toEqual(new Set(['attempts']))
  })

  it('takes no cap option and exports no default caps', () => {
    expect(Object.keys(ledgerModule)).not.toContain('CLEF_DEFAULT_SPEND_CAPS')
    const store = createClefSpendMemoryStore()
    const ledger = createClefSpendLedger({ store, now: () => DAY_END })
    const reserve = (purpose: ClefSpendPurpose, requestId: string | null) =>
      ledger.reserve({ requestId, purpose, estimatedInputTokens: 12_000 })
    expect(reserve('verification', null).ok).toBe(true)
    expect(reserve('test', null).ok).toBe(true)
    expect(reserve('production', 'req-a').ok).toBe(true)
    expect(reserve('production', 'req-a').ok).toBe(true)
    expect(reserve('production', 'req-a')).toEqual({
      ok: false,
      refusal: 'request_attempts_exhausted'
    })
  })
})

describe('clef spend retry bound and request checks', () => {
  it('bounds a request or a TaskSpec at two billed attempts', () => {
    expect(CLEF_BILLED_ATTEMPTS_PER_SUBJECT).toBe(2)
  })

  it('refuses the third billed attempt for one request', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    const reserve = (requestId: string) =>
      ledger.reserve({ requestId, purpose: 'production', estimatedInputTokens: 500 })
    const first = reserve('req-a')
    const second = reserve('req-a')
    expect(first.ok && first.reservation.attempt).toBe(1)
    expect(second.ok && second.reservation.attempt).toBe(2)
    expect(reserve('req-a')).toEqual({ ok: false, refusal: 'request_attempts_exhausted' })
    expect(reserve('req-b').ok).toBe(true)
    expect(store.rows()).toHaveLength(3)
  })

  it('counts a TaskSpec subject on its own, while the row still numbers attempts per request', () => {
    const { store, inserted } = stubStore({ attempts: 2 })
    const refused = ledgerOver(store).reserve({
      requestId: 'req-1',
      subjectId: 'task-1',
      purpose: 'production',
      estimatedInputTokens: 100
    })
    expect(refused).toEqual({ ok: false, refusal: 'request_attempts_exhausted' })
    expect(inserted).toEqual([])
    const fresh = stubStore({ attempts: 1 })
    const allowed = ledgerOver(fresh.store).reserve({
      requestId: 'req-1',
      subjectId: 'task-2',
      purpose: 'production',
      estimatedInputTokens: 100
    })
    expect(allowed.ok && allowed.reservation.attempt).toBe(2)
  })

  it.each<ClefSpendPurpose>(['verification', 'test'])(
    'never applies the retry bound to a %s call, even with a request id',
    (purpose) => {
      const { store, inserted } = stubStore({ attempts: 50 })
      const result = ledgerOver(store).reserve({
        requestId: 'req-t',
        purpose,
        estimatedInputTokens: 100
      })
      expect(result.ok && result.reservation.attempt).toBe(51)
      expect(inserted).toHaveLength(1)
    }
  )

  it('refuses a malformed estimate without inserting', () => {
    const { store, inserted } = stubStore({})
    const result = ledgerOver(store).reserve({
      requestId: 'req-1',
      purpose: 'production',
      estimatedInputTokens: 0
    })
    expect(result).toEqual({ ok: false, refusal: 'invalid_estimate' })
    expect(inserted).toEqual([])
  })

  it('requires a request id for production but not for verification or test calls', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    expect(
      ledger.reserve({ requestId: null, purpose: 'production', estimatedInputTokens: 100 })
    ).toEqual({ ok: false, refusal: 'request_id_required' })
    for (let index = 0; index < 3; index++) {
      const result = ledger.reserve({
        requestId: null,
        purpose: 'verification',
        estimatedInputTokens: 100
      })
      expect(result.ok && result.reservation.attempt).toBeNull()
    }
    expect(store.rows()).toHaveLength(3)
  })

  it('maps each refusal to a classifier_unavailable blocker', () => {
    expect(clefSpendRefusalBlocker('request_attempts_exhausted')).toEqual({
      reason: 'classifier_unavailable',
      detail: 'budget_exhausted'
    })
    expect(clefSpendRefusalBlocker('invalid_estimate')).toEqual({
      reason: 'classifier_unavailable',
      detail: 'estimate_exceeded'
    })
    expect(clefSpendRefusalBlocker('request_id_required')).toEqual({
      reason: 'classifier_unavailable',
      detail: 'request_rejected'
    })
  })
})

describe('clef spend reservation and settlement', () => {
  it('records a versioned reservation row', () => {
    const store = createClefSpendMemoryStore()
    const result = ledgerOver(store).reserve({
      requestId: 'req-1',
      purpose: 'production',
      estimatedInputTokens: 1_000
    })
    expect(result).toEqual({
      ok: true,
      reservation: {
        reservationId: expect.stringMatching(/^res-\d+-1$/),
        requestId: 'req-1',
        purpose: 'production',
        attempt: 1,
        utcDayKey: '2026-10-04',
        priceBasisVersion: 1,
        estimatedInputTokens: 1_000,
        reservedMicroUsd: 1_360,
        reservedNeurons: 124,
        reservedAt: '2026-10-04T23:59:59.999Z'
      }
    })
    expect(store.rows()).toHaveLength(1)
  })

  it('settles from usage input tokens and records output tokens as cost unknown', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    const result = ledger.reserve({
      requestId: 'req-1',
      purpose: 'test',
      estimatedInputTokens: 1_000
    })
    if (!result.ok) {
      throw new Error('expected a reservation')
    }
    const settlement = ledger.settle(result.reservation, { inputTokens: 900, outputTokens: 12 })
    expect(settlement).toEqual({
      basis: 'usage',
      spentMicroUsd: 216,
      spentNeurons: 20,
      inputTokens: 900,
      outputTokens: 12,
      outputCost: 'cost_unknown',
      settledAt: '2026-10-04T23:59:59.999Z'
    })
    expect(store.sumSpentMicroUsd(['test'])).toBe(216)
    expect(store.sumNeuronsForUtcDay('2026-10-04')).toBe(20)
  })

  it('keeps the reservation as spent when usage is missing or malformed', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    const usages = [
      null,
      { inputTokens: -1, outputTokens: 0 },
      { inputTokens: 1.5, outputTokens: 0 },
      { inputTokens: 2_000_000_000, outputTokens: 0 }
    ]
    for (const [index, usage] of usages.entries()) {
      const result = ledger.reserve({
        requestId: `req-${index}`,
        purpose: 'production',
        estimatedInputTokens: 1_000
      })
      if (!result.ok) {
        throw new Error('expected a reservation')
      }
      const settlement = ledger.settle(result.reservation, usage)
      expect(settlement).toMatchObject({
        basis: 'reservation_kept',
        spentMicroUsd: 1_360,
        spentNeurons: 124,
        inputTokens: null,
        outputCost: 'cost_unknown'
      })
    }
    expect(store.sumSpentMicroUsd(['production'])).toBe(usages.length * 1_360)
  })

  it('records a usage above the reservation at its real cost', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    const result = ledger.reserve({ requestId: 'r', purpose: 'test', estimatedInputTokens: 10 })
    if (!result.ok) {
      throw new Error('expected a reservation')
    }
    const settlement = ledger.settle(result.reservation, { inputTokens: 50_000, outputTokens: 1 })
    expect(settlement.spentMicroUsd).toBe(12_000)
    expect(settlement.spentNeurons).toBe(1_091)
  })

  it('keeps amounts as exact integers across many reservations', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    for (let index = 0; index < 3_000; index++) {
      const result = ledger.reserve({
        requestId: `req-${index}`,
        purpose: 'test',
        estimatedInputTokens: 7
      })
      if (result.ok) {
        ledger.settle(result.reservation, { inputTokens: 7, outputTokens: 1 })
      }
    }
    const spent = store.sumSpentMicroUsd(['test'])
    expect(Number.isInteger(spent)).toBe(true)
    expect(spent).toBe(3_000 * clefInputCostMicroUsd(7))
  })

  it('records what was spent, with no cap and no remainder', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    ledger.reserve({ requestId: 'v', purpose: 'verification', estimatedInputTokens: 1_000 })
    ledger.reserve({ requestId: 'p', purpose: 'production', estimatedInputTokens: 1_000 })
    expect(ledger.snapshot()).toEqual({
      utcDayKey: '2026-10-04',
      verificationMicroUsdSpent: 1_360,
      // Only production spend counts toward the day's production neurons.
      dailyNeuronsSpent: 124
    })
  })

  it('partitions the purposes into production and verification spend', () => {
    expect(CLEF_PRODUCTION_PURPOSES).toEqual(['production'])
    expect(CLEF_VERIFICATION_PURPOSES).toEqual(['verification', 'test'])
    const covered = [...CLEF_PRODUCTION_PURPOSES, ...CLEF_VERIFICATION_PURPOSES].sort()
    expect(covered).toEqual([...CLEF_SPEND_PURPOSES].sort())
  })

  it('records the purpose of every reservation and keeps it through settlement', () => {
    const store = createClefSpendMemoryStore()
    const ledger = ledgerOver(store)
    const reservations = [
      ledger.reserve({ requestId: 'req-1', purpose: 'production', estimatedInputTokens: 100 }),
      ledger.reserve({ requestId: null, purpose: 'verification', estimatedInputTokens: 100 }),
      ledger.reserve({ requestId: null, purpose: 'test', estimatedInputTokens: 100 })
    ]
    expect(store.rows().map((row) => row.purpose)).toEqual(['production', 'verification', 'test'])
    for (const result of reservations) {
      if (result.ok) {
        ledger.settle(result.reservation, { inputTokens: 90, outputTokens: 1 })
      }
    }
    expect(store.rows().map((row) => [row.purpose, row.settlement?.basis])).toEqual([
      ['production', 'usage'],
      ['verification', 'usage'],
      ['test', 'usage']
    ])
    expect(store.rows().map((row) => row.attempt)).toEqual([1, null, null])
  })
})

type SumCall = { kind: 'micro_usd' | 'neurons' | 'attempts'; args: readonly unknown[] }

/** The memory store with every spend lookup recorded, so a test sees what a reservation reads. */
function recordingStore() {
  const inner = createClefSpendMemoryStore()
  const calls: SumCall[] = []
  const store: ClefSpendStore = {
    ...inner,
    sumSpentMicroUsd: (purposes) => {
      calls.push({ kind: 'micro_usd', args: [purposes] })
      return inner.sumSpentMicroUsd(purposes)
    },
    sumNeuronsForUtcDay: (utcDayKey, purposes) => {
      calls.push({ kind: 'neurons', args: [utcDayKey, purposes] })
      return inner.sumNeuronsForUtcDay(utcDayKey, purposes)
    },
    countAttemptsForRequest: (requestId) => {
      calls.push({ kind: 'attempts', args: [requestId] })
      return inner.countAttemptsForRequest(requestId)
    }
  }
  return { store, inner, calls, kinds: () => new Set(calls.map((call) => call.kind)) }
}
