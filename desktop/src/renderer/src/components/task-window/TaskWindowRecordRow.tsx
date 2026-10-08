import { CircleAlert, FileDiff, MessageSquare, Wrench } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  attemptStateLabel,
  formatCount,
  stepStatusLabel,
  taskExecutorLabel,
  toolStepLabel
} from './task-window-copy'
import type { TranscriptRow, TurnUsage } from './task-window-records'
import TaskWindowCommandRow from './TaskWindowCommandRow'

type RowOf<K extends TranscriptRow['kind']> = Extract<TranscriptRow, { kind: K }>

function usageText(usage: TurnUsage | null): string | null {
  if (!usage || (usage.input === null && usage.output === null)) {
    return null
  }
  return translate(
    'workbench.taskWindow.turn.usage',
    '{{input}} input · {{cached}} cached · {{output}} output tokens',
    {
      input: formatCount(usage.input ?? 0),
      cached: formatCount(usage.cachedInput ?? 0),
      output: formatCount(usage.output ?? 0)
    }
  )
}

function turnText(row: RowOf<'turn'>): string {
  const phase =
    row.phase === 'started'
      ? translate('workbench.taskWindow.turn.started', 'Turn started')
      : row.phase === 'failed'
        ? translate('workbench.taskWindow.turn.failed', 'Turn failed')
        : translate('workbench.taskWindow.turn.completed', 'Turn completed')
  return [phase, usageText(row.usage), row.error].filter(Boolean).join(' · ')
}

// Why no code: an unknown note code is a writer internal; the line still marks that one was kept.
function noteText(row: RowOf<'note'>): string {
  if (row.code === 'truncated') {
    return translate(
      'workbench.taskWindow.note.truncated',
      'The transcript reached its size limit. Later output was not recorded.'
    )
  }
  if (row.code === 'records_dropped') {
    return translate(
      'workbench.taskWindow.note.dropped',
      '{{dropped}} records were dropped while output arrived faster than it could be saved.',
      { dropped: formatCount(row.count ?? 0) }
    )
  }
  return translate(
    'workbench.taskWindow.note.unknown',
    'The transcript recorded a note this version cannot show.'
  )
}

// Why no reason code: it is a runner verdict code, kept for the header's "Copy details".
function endText(row: RowOf<'end'>): string {
  const exit =
    row.exitCode === null
      ? null
      : translate('workbench.taskWindow.exitCode', 'exit code {{code}}', { code: row.exitCode })
  const ended = translate('workbench.taskWindow.end', 'Ended')
  return [ended, attemptStateLabel(row.state), exit].filter(Boolean).join(' · ')
}

function startText(row: RowOf<'start'>): string {
  return translate('workbench.taskWindow.start', 'Started {{executor}}', {
    executor: taskExecutorLabel(row.executor ?? '')
  })
}

function fileChangeText(row: RowOf<'file_change'>): string {
  const status = stepStatusLabel(row.status)
  return status === null
    ? translate('workbench.taskWindow.filesChanged', 'Files changed')
    : translate('workbench.taskWindow.fileChange', 'Files changed · {{status}}', { status })
}

function toolText(row: RowOf<'tool'>): string {
  return [toolStepLabel(row.itemType), stepStatusLabel(row.status)].filter(Boolean).join(' · ')
}

/** One transcript row; anything this build does not recognize stays a neutral, readable line. */
export default function TaskWindowRecordRow({ row }: { row: TranscriptRow }): React.JSX.Element {
  switch (row.kind) {
    case 'command':
      return <TaskWindowCommandRow row={row} />
    case 'message':
      return (
        <div className="flex min-w-0 gap-2 py-1.5">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 whitespace-pre-wrap break-words text-body text-foreground">
            {row.text}
          </p>
        </div>
      )
    case 'file_change':
      return (
        <div className="flex min-w-0 gap-2 py-1.5">
          <FileDiff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="text-meta text-muted-foreground">{fileChangeText(row)}</p>
            <ul className="space-y-0.5">
              {row.paths.map((path, index) => (
                <li
                  key={`${index}:${path}`}
                  className="break-all font-mono text-meta text-foreground"
                >
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )
    case 'tool':
      return (
        <div className="flex min-w-0 items-center gap-2 py-1 text-meta text-muted-foreground">
          <Wrench className="size-3.5 shrink-0" aria-hidden />
          <span className="break-words">{toolText(row)}</span>
        </div>
      )
    case 'output':
      return (
        <p
          data-stream={row.stream}
          className="whitespace-pre-wrap break-words font-mono text-meta text-foreground data-[stream=stderr]:text-muted-foreground"
        >
          {/* Why a no-break space: agy keeps blank lines, and an empty paragraph has no height. */}
          {row.text === '' ? ' ' : row.text}
        </p>
      )
    case 'error':
      return (
        <div className="flex min-w-0 gap-2 py-1.5 text-meta text-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-status-error" aria-hidden />
          <p className="min-w-0 whitespace-pre-wrap break-words">{row.text}</p>
        </div>
      )
    case 'turn':
      return <p className="py-1 text-meta text-muted-foreground">{turnText(row)}</p>
    case 'note':
      return <p className="py-1 text-meta text-muted-foreground">{noteText(row)}</p>
    case 'start':
      return <p className="py-1 text-meta text-muted-foreground">{startText(row)}</p>
    case 'end':
      return <p className="py-1.5 text-meta font-medium text-foreground">{endText(row)}</p>
    case 'unknown':
      return (
        <p className="py-1 text-meta text-muted-foreground">
          {translate(
            'workbench.taskWindow.unknownRecordShort',
            'A record this version cannot show.'
          )}
        </p>
      )
    case 'malformed':
      return (
        <div className="py-1 text-meta text-muted-foreground">
          <p>{translate('workbench.taskWindow.malformed', 'Unreadable line')}</p>
          <p className="break-all font-mono">{row.text}</p>
        </div>
      )
  }
}
