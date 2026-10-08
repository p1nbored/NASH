import type { EvidenceRef } from '../orchestration/db/task-validation-record'
import { recordLine } from './validation-record-text'

export type CheckStatus = 'pass' | 'fail' | 'inconclusive'

/** One decided check: the TaskSpec's kind, an English one-line note, and pointers to its evidence. */
export type CheckOutcome = {
  readonly kind: string
  readonly status: CheckStatus
  readonly note: string
  readonly evidence: readonly EvidenceRef[]
}

/** A local directory the validators may read; anything remote or unknown resolves to null upstream. */
export type ResolvedWorkspace = { readonly path: string; readonly kind: 'git' | 'folder' }

/** What the validators know about one claimed attempt, gathered before any check runs. */
export type AttemptEvidence = {
  readonly taskId: string
  readonly runId: string
  readonly dispatchId: string
  /** When the attempt began, in epoch milliseconds; null when no record dates it. */
  readonly startedAtMs: number | null
  /** The workspace of the primary session that reported the attempt. */
  readonly workspace: ResolvedWorkspace | null
}

const GENERIC_NOTES: Record<CheckStatus, string> = {
  pass: 'The check passed.',
  fail: 'The check failed.',
  inconclusive: 'The check could not decide.'
}

function outcome(
  kind: string,
  status: CheckStatus,
  note: string,
  evidence: readonly EvidenceRef[]
): CheckOutcome {
  return { kind, status, note: recordLine(note, { fallback: GENERIC_NOTES[status] }), evidence }
}

export function passed(kind: string, note: string, evidence: readonly EvidenceRef[]): CheckOutcome {
  return outcome(kind, 'pass', note, evidence)
}

export function failed(
  kind: string,
  note: string,
  evidence: readonly EvidenceRef[] = []
): CheckOutcome {
  return outcome(kind, 'fail', note, evidence)
}

export function undecided(
  kind: string,
  note: string,
  evidence: readonly EvidenceRef[] = []
): CheckOutcome {
  return outcome(kind, 'inconclusive', note, evidence)
}

/** A code-formatted name for a note; quoting keeps a path from reading as prose. */
export function quoted(name: string): string {
  return `\`${name.replaceAll('`', "'")}\``
}

/** An error's class name for a record; its message may hold paths or secrets, so it is never kept. */
export function errorNameOf(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error'
}
