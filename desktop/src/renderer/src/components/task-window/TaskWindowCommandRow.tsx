import { useState } from 'react'
import { ChevronRight, SquareTerminal } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TranscriptRow } from './task-window-records'

type CommandRow = Extract<TranscriptRow, { kind: 'command' }>

function commandStatus(row: CommandRow): string {
  const state =
    row.status === 'started'
      ? translate('workbench.taskWindow.command.running', 'Running')
      : row.status === 'failed'
        ? translate('workbench.taskWindow.command.failed', 'Failed')
        : translate('workbench.taskWindow.command.completed', 'Completed')
  const exit =
    row.exitCode === null
      ? null
      : translate('workbench.taskWindow.exitCode', 'exit code {{code}}', { code: row.exitCode })
  return [state, exit].filter(Boolean).join(' · ')
}

/** A command the CLI ran; its output tail stays folded so the run reads as a list of steps. */
export default function TaskWindowCommandRow({ row }: { row: CommandRow }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const output = row.output ?? ''
  const toggleLabel = open
    ? translate('workbench.taskWindow.command.hideOutputLabel', 'Hide output of {{command}}', {
        command: row.command
      })
    : translate('workbench.taskWindow.command.showOutputLabel', 'Show output of {{command}}', {
        command: row.command
      })
  return (
    <div className="py-1.5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-start gap-2">
          <SquareTerminal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-meta text-foreground">
            {row.command}
          </code>
          <span
            data-status={row.status}
            className="shrink-0 text-meta text-muted-foreground data-[status=failed]:text-destructive"
          >
            {commandStatus(row)}
          </span>
        </div>
        {output !== '' && (
          <>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="group ml-5 mt-1"
                aria-label={toggleLabel}
              >
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90" />
                {open
                  ? translate('workbench.taskWindow.command.hideOutput', 'Hide output')
                  : translate('workbench.taskWindow.command.showOutput', 'Show output')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="ml-5 mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-meta text-foreground scrollbar-sleek">
                {output}
              </pre>
            </CollapsibleContent>
          </>
        )}
      </Collapsible>
    </div>
  )
}
