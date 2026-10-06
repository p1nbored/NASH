import type { DotValidationView } from '../../../shared/dot-ingress/dot-ingress-validation'
import { DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX } from '../../../shared/dot-remote/dot-remote-limits'
import {
  finishedDotValidation,
  readDotValidationViews
} from '../dot-ingress/dot-ingress-validation-reads'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { createValidationDecisionService } from '../task-validation/validation-decision-service'
import type { DotRemoteValidationDecisionFact } from './dot-remote-event-source'

// G7: the validation decisions the event sync reports, through G6's decision service and the dot
// exposure (never the desktop view). One read per sync finds the waiting decisions of the followed
// requests, oldest first and at most the open cap; a reported one that stopped waiting is settled.

export type DotRemoteValidationFacts = {
  /** Starts a sync: the next read finds the waiting decisions of these requests again. */
  begin(followed: readonly string[]): void
  factsOf(
    owner: OrchestrationDb,
    dotRequestId: string,
    knownIds: readonly string[]
  ): DotRemoteValidationDecisionFact[]
}

function groupByRequest(views: readonly DotValidationView[]): Map<string, DotValidationView[]> {
  const groups = new Map<string, DotValidationView[]>()
  for (const view of views) {
    groups.set(view.dotRequestId, [...(groups.get(view.dotRequestId) ?? []), view])
  }
  return groups
}

export function createDotRemoteValidationFacts(
  options: { openMax?: number } = {}
): DotRemoteValidationFacts {
  const openMax = options.openMax ?? DOT_REMOTE_VALIDATION_DECISIONS_OPEN_MAX
  let followed: ReadonlySet<string> | undefined
  let open: Map<string, DotValidationView[]> | null = null

  function openOf(owner: OrchestrationDb, dotRequestId: string): DotValidationView[] {
    if (!open) {
      const decisions = createValidationDecisionService({ owner })
      const filter = { limit: openMax, ...(followed ? { within: followed } : {}) }
      open = groupByRequest(
        openMax > 0 ? readDotValidationViews(owner, decisions, filter).views : []
      )
    }
    return open.get(dotRequestId) ?? []
  }

  return {
    begin(ids) {
      followed = new Set(ids)
      open = null
    },
    factsOf(owner, dotRequestId, knownIds) {
      const pending = openOf(owner, dotRequestId)
      const waiting = new Set(pending.map((view) => view.validationId))
      const settled = knownIds.flatMap((validationId): DotRemoteValidationDecisionFact[] => {
        const finished = waiting.has(validationId)
          ? null
          : finishedDotValidation(owner, validationId)
        return finished ? [{ kind: 'settled', settled: finished }] : []
      })
      return [...pending.map((view) => ({ kind: 'pending' as const, view })), ...settled]
    }
  }
}
