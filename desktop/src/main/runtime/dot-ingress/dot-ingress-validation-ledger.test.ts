import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  DOT_VALIDATION_LEDGER_MAX_ROWS,
  DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS,
  ensureDotValidationLedgerSchema,
  getDotValidationLedger,
  type DotValidationLedgerEntry
} from './dot-ingress-validation-ledger'
import { fixtureUuid } from './dot-ingress-service.test-fixture'

const AT = '2026-10-06T08:00:00.000Z'

function entry(
  n: number,
  overrides: Partial<DotValidationLedgerEntry> = {}
): DotValidationLedgerEntry {
  return {
    decisionId: fixtureUuid(n),
    validationId: `validation_${n}`,
    dotRequestId: fixtureUuid(9000),
    decision: 'waive',
    outcome: 'decided',
    decidedAt: AT,
    recordedAt: AT,
    ...overrides
  }
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

function familyObjects(owner: OrchestrationDb): string[] {
  return owner.db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dot_validation_%' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

describe('dot validation decision ledger', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('creates only its own objects and verifies them on the next start', () => {
    const before = owner.db
      .prepare("SELECT name FROM sqlite_master WHERE instr(name, 'dot_validation_') = 0")
      .all()
    ensureDotValidationLedgerSchema(owner.db)
    ensureDotValidationLedgerSchema(owner.db)
    expect(familyObjects(owner)).toEqual(
      DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(
      owner.db
        .prepare("SELECT name FROM sqlite_master WHERE instr(name, 'dot_validation_') = 0")
        .all()
    ).toEqual(before)
  })

  it('fails closed on a drifted or partial family and changes nothing', () => {
    ensureDotValidationLedgerSchema(owner.db)
    owner.db.exec('DROP TABLE dot_validation_decisions')
    expect(codeOf(() => ensureDotValidationLedgerSchema(owner.db))).toBe('dot_recovery_required')
    owner.db.exec('CREATE TABLE dot_validation_decisions (decision_id TEXT)')
    expect(codeOf(() => ensureDotValidationLedgerSchema(owner.db))).toBe('dot_recovery_required')
    owner.db.exec('UPDATE dot_validation_ledger_schema SET version = 99')
    expect(codeOf(() => ensureDotValidationLedgerSchema(owner.db))).toBe('dot_recovery_required')
  })

  it('keeps the first outcome of each decision id and refuses a second record', () => {
    const ledger = getDotValidationLedger(owner)
    expect(ledger.get(fixtureUuid(1))).toBeNull()
    ledger.record(entry(1))
    expect(ledger.get(fixtureUuid(1))).toEqual(entry(1))
    ledger.record(entry(2, { outcome: 'closed', decidedAt: null, decision: 'reject' }))
    expect(ledger.get(fixtureUuid(2))).toMatchObject({ outcome: 'closed', decidedAt: null })
    expect(() => ledger.record(entry(1, { decision: 'reject' }))).toThrow()
    expect(ledger.get(fixtureUuid(1))?.decision).toBe('waive')
  })

  it('keeps the first outcome when a concurrent call records the same id', () => {
    const ledger = getDotValidationLedger(owner)
    const first = entry(5)
    expect(ledger.recordFirst(first)).toBe(first)
    const later = entry(5, { outcome: 'already_decided', recordedAt: '2026-10-06T08:00:05.000Z' })
    expect(ledger.recordFirst(later)).toEqual(first)
    expect(ledger.get(fixtureUuid(5))).toEqual(first)
  })

  it('refuses a stored row that breaks the closed-without-time rule', () => {
    const ledger = getDotValidationLedger(owner)
    expect(() => ledger.record(entry(3, { outcome: 'closed' }))).toThrow()
    expect(() => ledger.record(entry(4, { decidedAt: null }))).toThrow()
  })

  it('counts recorded decisions for the rate caps', () => {
    const ledger = getDotValidationLedger(owner)
    ledger.record(entry(1, { recordedAt: '2026-10-06T07:59:00.000Z' }))
    ledger.record(entry(2, { recordedAt: '2026-10-06T08:00:30.000Z' }))
    expect(ledger.countRecordedSince('2026-10-06T08:00:00.000Z', false)).toBe(1)
    expect(ledger.countRecordedSince('2026-10-06T07:59:00.000Z', true)).toBe(2)
    expect(ledger.countRecordedSince('2026-10-06T07:59:00.000Z', false)).toBe(1)
  })

  it('keeps a bounded number of rows, dropping the oldest', () => {
    const ledger = getDotValidationLedger(owner)
    expect(DOT_VALIDATION_LEDGER_MAX_ROWS).toBe(10_000)
    const insert = owner.db.prepare(
      `INSERT INTO dot_validation_decisions (decision_id, validation_id, dot_request_id, decision, outcome, decided_at, recorded_at)
        VALUES (?, 'validation_bulk', ?, 'waive', 'decided', ?, ?)`
    )
    owner.db.exec('BEGIN')
    for (let n = 1; n <= DOT_VALIDATION_LEDGER_MAX_ROWS; n += 1) {
      insert.run(fixtureUuid(n), fixtureUuid(9000), AT, AT)
    }
    owner.db.exec('COMMIT')
    ledger.record(entry(DOT_VALIDATION_LEDGER_MAX_ROWS + 1))
    const count = owner.db.prepare('SELECT count(*) AS n FROM dot_validation_decisions').get()
    expect(count).toEqual({ n: DOT_VALIDATION_LEDGER_MAX_ROWS })
    expect(ledger.get(fixtureUuid(1))).toBeNull()
    expect(ledger.get(fixtureUuid(DOT_VALIDATION_LEDGER_MAX_ROWS + 1))).not.toBeNull()
  })
})
