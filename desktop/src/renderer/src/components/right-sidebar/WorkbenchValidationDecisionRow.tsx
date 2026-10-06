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

const SHORT_COMMIT_CHARS = 12

function Detail({
  term,
  mono = false,
  children
}: {
  term: string
  mono?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0">{term}</dt>
      <dd
        data-mono={mono}
        className="min-w-0 break-words text-foreground data-[mono=true]:font-mono"
      >
        {children}
      </dd>
    </div>
  )
}

function DecisionDetails({ view }: { view: WorkbenchValidationDecisionView }): React.JSX.Element {
  const { worktree } = view
  return (
    <dl className="space-y-0.5 text-xs text-muted-foreground">
      <Detail term={translate('workbench.decisions.run', 'Run')} mono>
        <IdentifierText value={view.runId} />
      </Detail>
      <Detail term={translate('workbench.decisions.executor', 'Executor')}>
        {decisionExecutorText(view)}
      </Detail>
      <Detail term={translate('workbench.decisions.since', 'Undecided since')}>
        <time dateTime={view.inconclusiveAt}>
          {formatWorkbenchRequestTime(view.inconclusiveAt)}
        </time>
      </Detail>
      {worktree ? (
        <>
          <Detail term={translate('workbench.decisions.branch', 'Branch')} mono>
            {worktree.branch}
          </Detail>
          <Detail term={translate('workbench.decisions.worktree', 'Worktree')} mono>
            <IdentifierText value={worktree.path} />
          </Detail>
          <Detail term={translate('workbench.decisions.baseCommit', 'Base commit')} mono>
            {worktree.baseCommit.slice(0, SHORT_COMMIT_CHARS)}
          </Detail>
        </>
      ) : (
        <Detail term={translate('workbench.decisions.workspace', 'Workspace')}>
          {decisionPlacementLabel(view.placement)}
        </Detail>
      )}
      <Detail term={translate('workbench.decisions.reason', 'Why undecided')}>{view.reason}</Detail>
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
    <div className="space-y-2">
      <p className="break-words text-xs text-foreground">
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
  const task = { taskId: row.view.taskId }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.decisions.waiveLabel', 'Waive {{taskId}}', task)}
        onClick={() => setConfirming('waive')}
      >
        {translate('workbench.decisions.waive', 'Waive')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={translate('workbench.decisions.rejectLabel', 'Reject {{taskId}}', task)}
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
    <li className="space-y-2 border-t border-border pt-3">
      <p className="break-words text-xs font-medium text-foreground">{view.title}</p>
      <DecisionDetails view={view} />
      {!row.outcome && <DecisionActions row={row} decide={decide} />}
      {row.outcome && (
        <p role="status" className="break-words text-xs text-foreground">
          {decisionOutcomeText(row.outcome)}
        </p>
      )}
      {row.error && (
        <WorkbenchCallout
          role="alert"
          label={translate('workbench.decisions.decideErrorTitle', 'Decision not recorded')}
        >
          <p className="break-words">{row.error.message}</p>
          <p className="break-words font-mono">{row.error.code}</p>
        </WorkbenchCallout>
      )}
    </li>
  )
}
