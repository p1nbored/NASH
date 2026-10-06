import type {
  ClassificationResult,
  RecordedClassificationAnswers
} from '../../../shared/clef/clef-classification-contract'
import type { ClassificationSpend } from '../../clef/clef-classification-spend'
import type { ClefCredentialSourcePort, ClefTransportPort } from '../../clef/clef-call-ports'
import type { ClefSpendLedger } from '../../clef/clef-spend-ledger'
import type {
  ClefVerifiedProfileFileStore,
  ClefVerifiedProfileRecord
} from '../../clef/clef-verified-profile'
import type { ResolvedRoutingTable } from '../../routing-table/routing-table-activation'
import type { RouteResolution, RouteResolveOptions } from '../../routing-table/route-resolver'
import type {
  TaskClassificationRecord,
  TaskClassificationStore
} from '../orchestration/db/task-classification-store'
import type { TaskRouteRecord, TaskRouteStore } from '../orchestration/db/task-route-store'
import type {
  WorkbenchRawResponseInput,
  WorkbenchRawResponseReceipt
} from '../orchestration/db/workbench-clef-raw-responses'
import type { ClassificationSubject } from './classification-subject'

/** The Routing Table as the classifier sees it: the active table, and one lookup per delegated TaskSpec. */
export type ClassificationRoutingPort = {
  activeTable(): ResolvedRoutingTable
  resolveRoute(input: RouteResolveOptions & { readonly taskType: string }): Promise<RouteResolution>
}

/** Stores the exchange bytes before anything parses them. */
export type ClassificationRawResponsePort = {
  insert(input: WorkbenchRawResponseInput): WorkbenchRawResponseReceipt
}

/** A classified answer kept for reuse; only `classified` outcomes are ever cached. */
export type CachedClassification = {
  readonly result: ClassificationResult
  readonly answers: RecordedClassificationAnswers
  readonly sourceClassificationId: string
}

export type ClassificationCache = {
  lookup(fingerprint: string): CachedClassification | null
  remember(fingerprint: string, entry: CachedClassification): void
  size(): number
}

/** Every capability one classification uses; the Clef call circuit has its single owner instead. */
export type TaskClassifierDeps = {
  readonly classifications: Pick<TaskClassificationStore, 'record' | 'nextAttempt'>
  readonly routes: Pick<TaskRouteStore, 'record'>
  readonly rawResponses: ClassificationRawResponsePort
  readonly spend: ClassificationSpend
  readonly ledger: Pick<ClefSpendLedger, 'settle'>
  readonly credentials: ClefCredentialSourcePort
  readonly verifiedProfile: Pick<ClefVerifiedProfileFileStore, 'read'>
  readonly transport: ClefTransportPort
  readonly cache: ClassificationCache
  readonly routing: ClassificationRoutingPort
  readonly clock: { now(): number }
  /** Unguessable tokens for raw-response ids. */
  readonly newId: () => string
}

/** One classification: everything it reads is fixed at its start, so its one record is coherent. */
export type ClassificationRun = {
  readonly deps: TaskClassifierDeps
  readonly subject: ClassificationSubject
  readonly signal: AbortSignal
  /** Read once; G0, the validator and the record all see this one profile. */
  readonly profile: ClefVerifiedProfileRecord | null
}

/** What happened to the route of a classified TaskSpec; nothing is ever substituted. */
export type ClassificationRouteOutcome =
  | { readonly kind: 'not_requested' }
  | { readonly kind: 'recorded'; readonly route: TaskRouteRecord }
  /** The active table refused (not installed, damaged, other taxonomy) or lacks the type: no row. */
  | { readonly kind: 'refused'; readonly reason: string }

export type ClassificationRunResult = {
  readonly classification: TaskClassificationRecord
  readonly route: ClassificationRouteOutcome
  readonly cacheHit: boolean
}
