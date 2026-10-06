// FIXTURE_ONLY: in-memory spend store for offline tests; production code must never import this file.
// Spend kept in memory is lost on restart, which would reset the record; production persists through
// the `workbench_clef_spend` table (spec sections 8, 11 and 15).
import type { ClassificationSpendLink, ClassificationSpendStore } from './clef-classification-spend'
import type {
  ClefSpendPurpose,
  ClefSpendReservationRow,
  ClefSpendSettlement,
  ClefSpendStore
} from './clef-spend-ledger'

export type ClefSpendLedgerRow = Readonly<
  ClefSpendReservationRow & { settlement: Readonly<ClefSpendSettlement> | null }
>

export type ClefSpendMemoryStore = ClefSpendStore &
  ClassificationSpendStore & {
    rows(): readonly ClefSpendLedgerRow[]
    links(): readonly ClassificationSpendLink[]
  }

function spentMicroUsd(row: ClefSpendLedgerRow): number {
  return row.settlement ? row.settlement.spentMicroUsd : row.reservedMicroUsd
}

function spentNeurons(row: ClefSpendLedgerRow): number {
  return row.settlement ? row.settlement.spentNeurons : row.reservedNeurons
}

export function createClefSpendMemoryStore(): ClefSpendMemoryStore {
  let rowsById: ReadonlyMap<string, ClefSpendLedgerRow> = new Map()
  let linkList: readonly ClassificationSpendLink[] = []

  const allRows = (): ClefSpendLedgerRow[] => [...rowsById.values()]
  const withRow = (row: ClefSpendLedgerRow): void => {
    rowsById = new Map([...rowsById, [row.reservationId, row]])
  }

  return {
    // Why no rollback: the fixture's callers either finish or throw before writing anything.
    atomically: (operation) => operation(),

    sumSpentMicroUsd(purposes: readonly ClefSpendPurpose[]): number {
      return allRows()
        .filter((row) => purposes.includes(row.purpose))
        .reduce((total, row) => total + spentMicroUsd(row), 0)
    },

    sumNeuronsForUtcDay(utcDayKey: string, purposes?: readonly ClefSpendPurpose[]): number {
      return allRows()
        .filter((row) => row.utcDayKey === utcDayKey)
        .filter((row) => purposes === undefined || purposes.includes(row.purpose))
        .reduce((total, row) => total + spentNeurons(row), 0)
    },

    countAttemptsForRequest(requestId: string): number {
      return allRows().filter((row) => row.requestId === requestId).length
    },

    countAttemptsForSubject(subjectId: string): number {
      return linkList.filter((link) => link.taskId === subjectId).length
    },

    nextAttemptForRequest(requestId: string): number {
      const attempts = allRows()
        .filter((row) => row.requestId === requestId)
        .map((row) => row.attempt ?? 0)
      return Math.max(0, ...attempts) + 1
    },

    insertClassificationLink(link: ClassificationSpendLink): void {
      if (!rowsById.has(link.reservationId)) {
        throw new Error('A classification link needs its spend reservation')
      }
      linkList = [...linkList, Object.freeze({ ...link })]
    },

    insertReservation(row: ClefSpendReservationRow): void {
      if (rowsById.has(row.reservationId)) {
        throw new Error('Clef spend reservation already exists')
      }
      withRow(Object.freeze({ ...row, settlement: null }))
    },

    settle(reservationId: string, settlement: ClefSpendSettlement): void {
      const row = rowsById.get(reservationId)
      if (!row) {
        throw new Error('Cannot settle an unknown Clef spend reservation')
      }
      if (row.settlement) {
        throw new Error('Clef spend reservation already settled')
      }
      withRow(Object.freeze({ ...row, settlement: Object.freeze({ ...settlement }) }))
    },

    rows(): readonly ClefSpendLedgerRow[] {
      return Object.freeze(allRows())
    },

    links(): readonly ClassificationSpendLink[] {
      return Object.freeze([...linkList])
    }
  }
}
