import { SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import type { PermissionPromptRow } from './use-workbench-permission-prompts'
import WorkbenchCallout from './WorkbenchCallout'
import WorkbenchCopyDetails from './WorkbenchCopyDetails'
import { errorDetails, type WorkbenchDetail } from './workbench-details'
import WorkbenchStateChip from './WorkbenchStateChip'
import {
  describeAnswerResult,
  permissionStatusChip,
  terminalOnlyText
} from './workbench-permission-copy'
import { formatWorkbenchRequestTime } from './workbench-request-time'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'

type Answer = (view: PermissionPromptRow['view'], decision: 'allow' | 'deny') => Promise<void>

function promptDetails(row: PermissionPromptRow): WorkbenchDetail[] {
  const { view } = row
  return [
    ['decision_id', view.decisionId],
    ['run_id', view.runId],
    ['subagent_id', view.agentId],
    ['tool', view.toolName],
    ['status', view.status],
    ['decided_by', view.decidedBy],
    ['asked_at', view.createdAt],
    ['answer_by', view.deadlineAt],
    ['desktop_only', String(view.desktopOnly)],
    ['answerable', String(view.answerable)],
    ['answer_outcome', row.answer?.result.outcome],
    ...errorDetails(row.error, 'answer')
  ]
}

function PromptContext({
  row,
  run
}: {
  row: PermissionPromptRow
  run: WorkflowRunView | null
}): React.JSX.Element {
  const { view } = row
  return (
    <div className="space-y-0.5 text-meta text-muted-foreground">
      {run?.objective && (
        <p className="line-clamp-2 break-words text-foreground">{run.objective}</p>
      )}
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
        {view.agentId && (
          <div>
            <dt className="sr-only">{translate('workbench.permissions.askedBy', 'Asked by')}</dt>
            <dd>{translate('workbench.permissions.fromSubagent', 'From a subagent')}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>{translate('workbench.permissions.asked', 'Asked')}</dt>
          <dd className="tabular-nums">
            <time dateTime={view.createdAt}>{formatWorkbenchRequestTime(view.createdAt)}</time>
          </dd>
        </div>
        {view.status === 'pending' && view.answerable && (
          <div className="flex gap-1">
            <dt>{translate('workbench.permissions.answerBy', 'Answer by')}</dt>
            <dd className="tabular-nums">
              <time dateTime={view.deadlineAt}>{formatWorkbenchRequestTime(view.deadlineAt)}</time>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function PromptActions({
  row,
  run,
  answer
}: {
  row: PermissionPromptRow
  run: WorkflowRunView | null
  answer: Answer
}): React.JSX.Element | null {
  const { view } = row
  const tabId = useAppStore((state) =>
    run
      ? findRunTerminalTabId(state.tabsByWorktree, run.workspaceId, run.primary?.paneKey ?? null)
      : null
  )
  const askable = view.status === 'pending' && view.answerable && !row.answer
  if (!askable && !(view.status === 'pending' && tabId)) {
    return null
  }
  const tool = { tool: view.toolName }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {askable && (
        <>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={row.answering}
            aria-label={translate('workbench.permissions.allowLabel', 'Allow {{tool}}', tool)}
            onClick={() => void answer(view, 'allow')}
          >
            {translate('workbench.permissions.allow', 'Allow')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={row.answering}
            aria-label={translate('workbench.permissions.denyLabel', 'Deny {{tool}}', tool)}
            onClick={() => void answer(view, 'deny')}
          >
            {translate('workbench.permissions.deny', 'Deny')}
          </Button>
        </>
      )}
      {view.status === 'pending' && tabId && (
        <Button type="button" variant="ghost" size="xs" onClick={() => showRunTerminal(tabId)}>
          <SquareTerminal />
          {translate('workbench.runs.showTerminal', 'Show terminal')}
        </Button>
      )}
    </div>
  )
}

function PromptOutcome({ row }: { row: PermissionPromptRow }): React.JSX.Element | null {
  if (row.error) {
    return (
      <WorkbenchCallout
        role="alert"
        tone="error"
        label={translate('workbench.permissions.answerError', 'Answer not recorded')}
      >
        <p className="break-words">{row.error.message}</p>
      </WorkbenchCallout>
    )
  }
  if (row.answer) {
    return (
      <p role="status" className="break-words text-meta text-foreground">
        {describeAnswerResult(row.answer.result)}
      </p>
    )
  }
  if (row.view.status === 'pending' && !row.view.answerable) {
    return <p className="text-meta text-foreground">{terminalOnlyText()}</p>
  }
  return null
}

// Why the summary is shown verbatim: it is the redacted text dot also gets (D-017); nothing is added.
export default function WorkbenchPermissionRow({
  row,
  run,
  answer
}: {
  row: PermissionPromptRow
  run: WorkflowRunView | null
  answer: Answer
}): React.JSX.Element {
  const { view } = row
  return (
    <li className="space-y-1.5 py-2 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <WorkbenchStateChip {...permissionStatusChip(view)} />
        <span className="min-w-0 flex-1 break-words font-mono text-meta text-foreground">
          {view.toolName}
        </span>
        <WorkbenchCopyDetails subject="permission prompt" entries={promptDetails(row)} />
      </div>
      <p className="whitespace-pre-wrap break-words rounded-md bg-background px-2 py-1.5 font-mono text-meta">
        {view.summary}
      </p>
      <PromptContext row={row} run={run} />
      {view.desktopOnly && view.status === 'pending' && (
        <p className="text-meta text-muted-foreground">
          {translate(
            'workbench.permissions.desktopOnlyHelp',
            'Not sent to dot. Answer it here or in the terminal.'
          )}
        </p>
      )}
      <PromptOutcome row={row} />
      <PromptActions row={row} run={run} answer={answer} />
    </li>
  )
}
