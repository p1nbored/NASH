import { useId } from 'react'
import { Info } from 'lucide-react'
import { getIntlLocale, translate } from '@/i18n/i18n'
import type { ClefBundleView } from '../../../../shared/clef/workbench-routing-status-view'
import {
  CLASSIFIER_ONLY_TASK_TYPES,
  ROUTING_TASK_TYPES
} from '../../../../shared/routing-table/routing-table-taxonomy'

/** Every routable task type plus the classifier-only "needs clarification" answer. */
const TASK_TYPE_OPTION_COUNT = ROUTING_TASK_TYPES.length + CLASSIFIER_ONLY_TASK_TYPES.length
/** needs_delegation is a yes-or-no question. */
const DELEGATION_ANSWER_COUNT = 2

function probability(value: number): string {
  return new Intl.NumberFormat(getIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

/**
 * D-020 defaults awaiting the user's confirmation, as main reports them in the status view; shown as
 * neutral information, not a warning.
 */
export function ClefAwaitingConfirmation({
  bundle
}: {
  bundle: ClefBundleView
}): React.JSX.Element | null {
  const labelId = useId()
  const pending = bundle.awaitingUserConfirmation
  if (pending.length === 0) {
    return null
  }
  const { thresholds } = bundle
  const wording =
    pending.includes('task_type_options') || pending.includes('needs_delegation_criteria')
  return (
    <div
      role="note"
      aria-labelledby={labelId}
      className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-xs text-foreground"
    >
      <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p id={labelId} className="font-medium">
          {translate(
            'auto.components.settings.clef.verification.pending.title',
            'Awaiting your confirmation'
          )}
        </p>
        <ul className="list-disc space-y-0.5 pl-4">
          {pending.includes('thresholds') ? (
            <li>
              {translate(
                'auto.components.settings.clef.verification.pending.thresholds',
                'Confidence thresholds: a task counts as delegated at {{yes}} or more and as kept at {{no}} or less; its task type must lead the runner-up by {{margin}}.',
                {
                  yes: probability(thresholds.delegationTrueMin),
                  no: probability(thresholds.delegationFalseMax),
                  margin: probability(thresholds.taskTypeMarginMin)
                }
              )}
            </li>
          ) : null}
          {wording ? (
            <li>
              {translate(
                'auto.components.settings.clef.verification.pending.wording',
                'Answer wording: the {{options}} task-type options and the {{answers}} delegation answers.',
                { options: TASK_TYPE_OPTION_COUNT, answers: DELEGATION_ANSWER_COUNT }
              )}
            </li>
          ) : null}
        </ul>
        <p className="text-muted-foreground">
          {translate(
            'auto.components.settings.clef.verification.pending.effect',
            'These are defaults. Changing any of them changes the question bundle, so a pinned profile stops applying and Verify runs again.'
          )}
        </p>
      </div>
    </div>
  )
}
