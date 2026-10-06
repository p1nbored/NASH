import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { ProposalSubmission } from '../../../../shared/routing-table/routing-table-proposal-schema'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { parseImportedChangeSet, type ActiveVersionRef } from './routing-table-import-parse'

const EXAMPLE =
  '{\n  "changes": [\n    {\n      "task_type": "software_engineering",\n      "execution_target": "codex_cli",\n      "model": "gpt-6-astra",\n      "reasoning_level": "max"\n    }\n  ]\n}'

/** Paste a change set (or an exported proposal); it is stored as your pending proposal. */
export function RoutingTableImportDialog(props: {
  activeRef: ActiveVersionRef | null
  busy: boolean
  refusal: string | null
  onImport: (submission: ProposalSubmission) => Promise<boolean>
  onClose: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const parsed = parseImportedChangeSet(text, reason, props.activeRef)
    if (!parsed.ok) {
      setProblem(parsed.message)
      return
    }
    setProblem(null)
    if (await props.onImport(parsed.submission)) {
      props.onClose()
    }
  }

  const message = problem ?? props.refusal
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.routingTable.import.title', 'Import a change set')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.routingTable.import.body',
              'Paste JSON with "changes" (whole rows) and, if needed, "coordinator" or "validation". It is stored as your proposal on the active version; accepting it is a separate step.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="routing-table-import-json">
            {translate(
              'auto.components.settings.routingTable.import.jsonLabel',
              'Change set (JSON)'
            )}
          </Label>
          <Textarea
            id="routing-table-import-json"
            variant="code"
            rows={10}
            spellCheck={false}
            placeholder={EXAMPLE}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="routing-table-import-reason">
            {translate(
              'auto.components.settings.routingTable.import.reasonLabel',
              'Reason for the change'
            )}
          </Label>
          <Input
            id="routing-table-import-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {message === null ? null : (
          <p role="alert" className="text-xs text-destructive">
            {message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {translate('auto.components.settings.routingTable.import.cancel', 'Cancel')}
          </Button>
          <Button disabled={props.busy} onClick={() => void submit()}>
            {translate('auto.components.settings.routingTable.import.submit', 'Import as proposal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
