import { SquareTerminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { WorkflowRunView } from '../../../../shared/workflow-run/workflow-run-view'
import IdentifierText from './IdentifierText'
import type { PermissionPromptRow } from './use-workbench-permission-prompts'
import WorkbenchCallout from './WorkbenchCallout'
import WorkbenchStateChip from './WorkbenchStateChip'
import {
  describeAnswerResult,
  permissionStatusChip,
  terminalOnlyText
} from './workbench-permission-copy'
import { formatWorkbenchRequestTime } from './workbench-request-time'
import { findRunTerminalTabId, showRunTerminal } from './workbench-run-terminal'

type Answer = (view: PermissionPromptRow['view'], decision: 'allow' | 'deny') => Promise<void>

function PromptDetails({
  row,
  run
}: {
  row: PermissionPromptRow
  run: WorkflowRunView | null
}): React.JSX.Element {
  const { view } = row
  return (
    <dl className="space-y-0.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 gap-1">
        <dt className="shrink-0">{translate('workbench.permissions.run', 'Run')}</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          <IdentifierText value={view.runId} />
        </dd>
      </div>
      {run?.objective && (
        <div className="flex min-w-0 gap-1">
          <dt className="sr-only">{translate('workbench.permissions.objective', 'Objective')}</dt>
          <dd className="min-w-0 break-words text-foreground">{run.objective}</dd>
        </div>
      )}
      {view.agentId && (
        <div className="flex min-w-0 gap-1">
          <dt className="shrink-0">{translate('workbench.permissions.subagent', 'Subagent')}</dt>
          <dd className="min-w-0 break-words font-mono text-foreground">{view.agentId}</dd>
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
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
      </div>
    </dl>
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
  const showTerminal = view.status === 'pending' && tabId !== null
  if (!askable && !showTerminal) {
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
      {showTerminal && tabId && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={translate('workbench.runs.showTerminalLabel', 'Show terminal for {{runId}}', {
            runId: view.runId
          })}
          onClick={() => showRunTerminal(tabId)}
        >
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
        label={translate('workbench.permissions.answerError', 'Answer not recorded')}
      >
        <p className="break-words">{row.error.message}</p>
        <p className="break-words font-mono">{row.error.code}</p>
      </WorkbenchCallout>
    )
  }
  if (row.answer) {
    return (
      <p role="status" className="break-words text-xs text-foreground">
        {describeAnswerResult(row.answer.result)}
      </p>
    )
  }
  if (row.view.status === 'pending' && !row.view.answerable) {
    return <p className="text-xs text-foreground">{terminalOnlyText()}</p>
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
    <li className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <WorkbenchStateChip status={view.status} {...permissionStatusChip(view)} />
        <span className="min-w-0 break-words font-mono text-xs text-foreground">
          {view.toolName}
        </span>
        {view.desktopOnly && (
          <Badge variant="outline">
            {translate('workbench.permissions.desktopOnly', 'Desktop only')}
          </Badge>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words rounded-md border border-border px-2 py-1.5 font-mono text-xs">
        {view.summary}
      </p>
      <PromptDetails row={row} run={run} />
      {view.desktopOnly && view.status === 'pending' && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'workbench.permissions.desktopOnlyHelp',
            'Not sent to dot. Answer it here or in the terminal.'
          )}
        </p>
      )}
      <PromptActions row={row} run={run} answer={answer} />
      <PromptOutcome row={row} />
    </li>
  )
}
