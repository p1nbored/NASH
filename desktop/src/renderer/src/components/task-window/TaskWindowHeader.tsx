import { useEffect, useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { WorkbenchRunTaskAttempt } from '../../../../shared/rpc-contract/workbench-task-window-params'
import WorkbenchStateChip from '../right-sidebar/WorkbenchStateChip'
import type { WorkbenchError } from '../right-sidebar/workbench-rpc-error'
import { formatWorkbenchRequestTime } from '../right-sidebar/workbench-request-time'
import {
  attemptStateLabel,
  elapsedBetween,
  isAttemptStateWarning,
  sandboxLabel
} from './task-window-copy'
import type { TranscriptRecord, TranscriptWorktree } from './task-window-records'
import { getTaskWindowTabLabel, type OpenTaskWindowState } from './task-window-tab'
import { findWorktreeIdByPath } from './task-window-worktree'

type StartRecord = Extract<TranscriptRecord, { kind: 'start' }>
type EndRecord = Extract<TranscriptRecord, { kind: 'end' }>

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 gap-1">
      <dt>{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

function WorktreeLine({ worktree }: { worktree: TranscriptWorktree }): React.JSX.Element {
  const worktreeId = useAppStore((s) => findWorktreeIdByPath(s.worktreesByRepo, worktree.path))
  return (
    <dl className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Field label={translate('workbench.taskWindow.branch', 'Branch')}>
        <span className="font-mono">{worktree.branch}</span>
      </Field>
      <Field label={translate('workbench.taskWindow.baseCommit', 'Base commit')}>
        <span className="font-mono">{worktree.baseCommit.slice(0, 12)}</span>
      </Field>
      {worktreeId && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => activateAndRevealWorktree(worktreeId)}
        >
          <FolderGit2 />
          {translate('workbench.taskWindow.openWorktree', 'Open worktree')}
        </Button>
      )}
    </dl>
  )
}

function AttemptSelect({
  attempts,
  selected,
  onSelect
}: {
  attempts: readonly WorkbenchRunTaskAttempt[]
  selected: string
  onSelect: (dispatchId: string) => void
}): React.JSX.Element {
  return (
    <Select value={selected} onValueChange={onSelect}>
      <SelectTrigger size="sm" aria-label={translate('workbench.taskWindow.attempt', 'Attempt')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {attempts.map((entry, index) => (
          <SelectItem key={entry.dispatchId} value={entry.dispatchId}>
            {translate('workbench.taskWindow.attemptOption', 'Attempt {{number}} · {{state}}', {
              number: index + 1,
              state: attemptStateLabel(entry.state)
            })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default function TaskWindowHeader({
  state,
  attempt,
  start,
  end,
  live,
  truncated,
  attemptsError,
  onSelectAttempt
}: {
  state: OpenTaskWindowState
  attempt: WorkbenchRunTaskAttempt | null
  start: StartRecord | null
  end: EndRecord | null
  live: boolean
  truncated: boolean
  attemptsError: WorkbenchError | null
  onSelectAttempt: (dispatchId: string) => void
}): React.JSX.Element {
  const status = end?.state ?? attempt?.state ?? null
  const startedAt = start?.at ?? attempt?.startedAt ?? null
  const settledAt = end?.at ?? attempt?.settledAt ?? null
  const now = useNow(live && settledAt === null)
  const elapsed = startedAt ? elapsedBetween(startedAt, settledAt, now) : null
  const worktree = start?.worktree ?? attempt?.worktree ?? null
  const tone = isAttemptStateWarning(status)
    ? 'warning'
    : status === 'completed' || status === 'stopped'
      ? 'muted'
      : 'neutral'
  return (
    <header className="border-b border-border px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <h1 className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
          {getTaskWindowTabLabel(state)}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {state.attempts.length > 1 && attempt && (
            <AttemptSelect
              attempts={state.attempts}
              selected={attempt.dispatchId}
              onSelect={onSelectAttempt}
            />
          )}
          <WorkbenchStateChip
            status={status ?? 'none'}
            label={attemptStateLabel(status)}
            tone={tone}
          />
        </div>
      </div>
      <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Field label={translate('workbench.taskWindow.model', 'Model')}>
          {start?.model ? (
            <span className="font-mono">{start.model}</span>
          ) : (
            translate('workbench.taskWindow.notRecorded', 'Not recorded')
          )}
        </Field>
        <Field label={translate('workbench.taskWindow.effort', 'Effort')}>
          {start?.effort ?? translate('workbench.taskWindow.effortDefault', 'Default')}
        </Field>
        <Field label={translate('workbench.taskWindow.sandboxLabel', 'Sandbox')}>
          {sandboxLabel(start?.sandbox ?? null, worktree !== null)}
        </Field>
        {startedAt && (
          <Field label={translate('workbench.taskWindow.started', 'Started')}>
            <time dateTime={startedAt}>{formatWorkbenchRequestTime(startedAt)}</time>
          </Field>
        )}
        {elapsed && (
          <Field label={translate('workbench.taskWindow.elapsed', 'Elapsed')}>
            <span className="tabular-nums">{elapsed}</span>
          </Field>
        )}
      </dl>
      {worktree && <WorktreeLine worktree={worktree} />}
      {truncated && (
        <p className="mt-2 rounded-md border border-status-warning-border bg-status-warning-background px-2 py-1 text-xs text-foreground">
          {translate(
            'workbench.taskWindow.truncatedNotice',
            'This transcript reached its size limit, so it ends before the attempt did.'
          )}
        </p>
      )}
      {attemptsError && (
        <p className="mt-2 text-xs text-muted-foreground">
          {translate(
            'workbench.taskWindow.attemptsStale',
            'The attempt list could not be refreshed: {{message}}',
            { message: attemptsError.message }
          )}
        </p>
      )}
    </header>
  )
}
