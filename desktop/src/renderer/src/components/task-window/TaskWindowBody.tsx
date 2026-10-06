import { useMemo, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { transcriptRowsFrom, type TranscriptRowLog } from './task-window-row-log'
import type { TranscriptReadState } from './task-window-transcript-state'
import TaskWindowRecordRow from './TaskWindowRecordRow'
import { useTranscriptFollow } from './use-transcript-follow'

// Why a window: a long transcript renders its newest rows; earlier ones load on request.
const ROW_WINDOW = 1000

function TranscriptStatus({
  hasAttempt,
  transcript,
  empty
}: {
  hasAttempt: boolean
  transcript: TranscriptReadState | null
  empty: boolean
}): React.JSX.Element | null {
  if (!hasAttempt) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate('workbench.taskWindow.noAttempt', 'This task has no attempt yet.')}
      </p>
    )
  }
  if (!transcript?.loaded) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {translate('workbench.taskWindow.reading', 'Reading the transcript…')}
      </p>
    )
  }
  if (transcript.missing) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate('workbench.taskWindow.missing', 'No transcript was recorded for this attempt.')}
      </p>
    )
  }
  if (transcript.error) {
    return (
      <div role="alert" className="mb-2 space-y-0.5 text-sm text-destructive">
        <p className="break-words">{transcript.error.message}</p>
        <p className="break-words font-mono text-xs">{transcript.error.code}</p>
      </div>
    )
  }
  if (!empty) {
    return null
  }
  return (
    <p className="text-sm text-muted-foreground">
      {transcript.live
        ? translate('workbench.taskWindow.waiting', 'Waiting for the first output…')
        : translate('workbench.taskWindow.empty', 'The transcript is empty.')}
    </p>
  )
}

/** The read-only transcript: follows the newest row unless the user scrolls up. */
export default function TaskWindowBody({
  hasAttempt,
  transcript,
  rows
}: {
  hasAttempt: boolean
  transcript: TranscriptReadState | null
  rows: TranscriptRowLog
}): React.JSX.Element {
  const [limit, setLimit] = useState(ROW_WINDOW)
  const { scrollRef, following, onScroll, jumpToLatest } = useTranscriptFollow(rows)
  const hidden = Math.max(0, rows.length - limit)
  const visible = useMemo(() => transcriptRowsFrom(rows, hidden), [rows, hidden])
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label={translate('workbench.taskWindow.transcript', 'Transcript')}
        className="h-full overflow-y-auto px-5 py-3 scrollbar-sleek"
      >
        <TranscriptStatus
          hasAttempt={hasAttempt}
          transcript={transcript}
          empty={rows.length === 0}
        />
        {hidden > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setLimit((current) => current + ROW_WINDOW)}
          >
            {translate(
              'workbench.taskWindow.showEarlier',
              'Show earlier records ({{hidden}} hidden)',
              {
                hidden
              }
            )}
          </Button>
        )}
        <ol>
          {visible.map((row) => (
            <li key={row.key}>
              <TaskWindowRecordRow row={row} />
            </li>
          ))}
        </ol>
      </div>
      {!following && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="absolute bottom-4 right-6"
          onClick={jumpToLatest}
        >
          <ArrowDown />
          {translate('workbench.taskWindow.jumpToLatest', 'Jump to latest')}
        </Button>
      )}
    </div>
  )
}
