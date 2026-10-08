import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  ValidationDecisionChoice,
  WorkbenchValidationDecisionView
} from '../../../../shared/rpc-contract/workbench-validation-decision-params'
import IdentifierText from './IdentifierText'
import type { ValidationDecisionRow } from './use-workbench-validation-decisions'
import WorkbenchCallout from './WorkbenchCallout'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import { errorDetails, type WorkbenchDetail } from './workbench-details'
import {
  decisionConfirmText,
  decisionExecutorText,
  decisionOutcomeText,
  decisionPlacementLabel
} from './workbench-validation-decision-copy'
import { formatWorkbenchRequestTime } from './workbench-request-time'

type Decide = (
  view: WorkbenchValidationDecisionView,
  decision: ValidationDecisionChoice
) => Promise<void>

function decisionDetails(row: ValidationDecisionRow): WorkbenchDetail[] {
  const { view, outcome } = row
  return [
    ['validation_id', view.validationId],
    ['run_id', view.runId],
    ['task_id', view.taskId],
    ['dispatch_id', view.dispatchId],
    ['executor', view.executorKind],
    ['model', view.model],
    ['placement', view.placement],
    ['branch', view.worktree?.branch],
    ['worktree_path', view.worktree?.path],
    ['base_commit', view.worktree?.baseCommit],
    ['inconclusive_at', view.inconclusiveAt],
    ['process_may_run', view.processMayRun === undefined ? null : String(view.processMayRun)],
    ['decision', outcome?.decision],
    ['notice_filed', outcome ? String(outcome.noticeFiled) : null],
    ...errorDetails(row.error, 'decision')
  ]
}

// Why the branch stays visible: a waive tells the main session to merge it; the base commit and
// worktree path are for "Copy details".
function DecisionFacts({ view }: { view: WorkbenchValidationDecisionView }): React.JSX.Element {
  return (
    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-meta text-muted-foreground">
      <div className="flex min-w-0 gap-1">
        <dt className="sr-only">{translate('workbench.decisions.executor', 'Executor')}</dt>
        <dd className="min-w-0 break-words text-foreground">{decisionExecutorText(view)}</dd>
      </div>
      <div className="flex gap-1">
        <dt>{translate('workbench.decisions.since', 'Undecided since')}</dt>
        <dd className="tabular-nums">
          <time dateTime={view.inconclusiveAt}>
            {formatWorkbenchRequestTime(view.inconclusiveAt)}
          </time>
        </dd>
      </div>
      {view.worktree ? (
        <div className="flex min-w-0 gap-1">
          <dt>{translate('workbench.decisions.branch', 'Branch')}</dt>
          <dd className="min-w-0 break-words font-mono text-foreground">
            <IdentifierText value={view.worktree.branch} />
          </dd>
        </div>
      ) : (
        <div className="flex gap-1">
          <dt>{translate('workbench.decisions.workspace', 'Workspace')}</dt>
          <dd className="text-foreground">{decisionPlacementLabel(view.placement)}</dd>
        </div>
      )}
    </dl>
  )
}

function DecisionConfirm({
  row,
  decision,
  decide,
  close
}: {
  row: ValidationDecisionRow
  decision: ValidationDecisionChoice
  decide: Decide
  close: () => void
}): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Why focus: Enter then confirms and Esc backs out, without reaching for the pointer.
  useEffect(() => confirmRef.current?.focus(), [])
  const confirm = async (): Promise<void> => {
    await decide(row.view, decision)
    close()
  }
  const backOut = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape' && !row.deciding) {
      close()
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="break-words text-meta text-foreground">
        {decisionConfirmText(row.view, decision)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={confirmRef}
          type="button"
          size="xs"
          disabled={row.deciding}
          aria-busy={row.deciding}
          onClick={() => void confirm()}
          onKeyDown={backOut}
        >
          {decision === 'waive'
            ? translate('workbench.decisions.waive', 'Waive')
            : translate('workbench.decisions.reject', 'Reject')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={row.deciding}
          onClick={close}
          onKeyDown={backOut}
        >
          {translate('workbench.decisions.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

function DecisionActions({
  row,
  decide
}: {
  row: ValidationDecisionRow
  decide: Decide
}): React.JSX.Element {
  const [confirming, setConfirming] = useState<ValidationDecisionChoice | null>(null)
  if (confirming) {
    return (
      <DecisionConfirm
        row={row}
        decision={confirming}
        decide={decide}
        close={() => setConfirming(null)}
      />
    )
  }
  const title = { title: row.view.title }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.decisions.waiveTitleLabel', 'Waive {{title}}', title)}
        onClick={() => setConfirming('waive')}
      >
        {translate('workbench.decisions.waive', 'Waive')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.decisions.rejectTitleLabel', 'Reject {{title}}', title)}
        onClick={() => setConfirming('reject')}
      >
        {translate('workbench.decisions.reject', 'Reject')}
      </Button>
    </div>
  )
}

// Why title and reason verbatim: both were masked and bounded in main; nothing is added here.
export default function WorkbenchValidationDecisionRow({
  row,
  decide
}: {
  row: ValidationDecisionRow
  decide: Decide
}): React.JSX.Element {
  const { view } = row
  return (
    <li className="space-y-1.5 py-2 first:pt-0">
      <div className="flex min-w-0 items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-body font-medium text-foreground">
          {view.title}
        </p>
        <WorkbenchCopyDetails subject="validation decision" entries={decisionDetails(row)} />
      </div>
      <p className="break-words text-meta text-foreground">{view.reason}</p>
      <DecisionFacts view={view} />
      {!row.outcome && <DecisionActions row={row} decide={decide} />}
      {row.outcome && (
        <p role="status" className="break-words text-meta text-foreground">
          {decisionOutcomeText(row.outcome)}
        </p>
      )}
      {row.error && (
        <WorkbenchCallout
          role="alert"
          tone="error"
          label={translate('workbench.decisions.decideErrorTitle', 'Decision not recorded')}
        >
          <p className="break-words">{row.error.message}</p>
        </WorkbenchCallout>
      )}
    </li>
  )
}
