import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  ProposalSubmissionSchema,
  type ProposalChanges,
  type ProposalSubmission,
  type RoutingTableProposal
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import type { RoutingTable } from '../../../../shared/routing-table/routing-table-schema'
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
import {
  changesFromDraft,
  draftFromTable,
  withRouteEdit,
  type DraftError,
  type EditorDraft
} from './routing-table-editor-model'
import type { ActiveVersionRef } from './routing-table-import-parse'
import { taskTypeLabel } from './routing-table-labels'
import { RoutingTableRouteRows } from './routing-table-route-rows'

/** Edit a pending proposal before accepting it, or propose a change to the active table. */
export type RouteEditorMode =
  | { kind: 'modify'; proposal: RoutingTableProposal }
  | { kind: 'propose' }

type Props = {
  mode: RouteEditorMode
  active: RoutingTable
  activeRef: ActiveVersionRef
  busy: boolean
  /** Resolves true when the change was stored; the dialog then closes. */
  onAccept: (proposalId: string, modification: ProposalChanges) => Promise<boolean>
  onPropose: (submission: ProposalSubmission) => Promise<boolean>
  onClose: () => void
  /** The last refusal from the table, shown inside the dialog while it stays open. */
  refusal: string | null
}

function errorLine(error: DraftError): string {
  if (error.field === 'table') {
    return error.message
  }
  const field =
    error.field === 'coordinator'
      ? translate('auto.components.settings.routingTable.editor.coordinator', 'Coordinator')
      : taskTypeLabel(error.field)
  return `${field}: ${error.message}`
}

function proposalFrom(
  changes: ProposalChanges,
  rationale: string,
  activeRef: ActiveVersionRef
): ProposalSubmission | null {
  const parsed = ProposalSubmissionSchema.safeParse({
    schema_version: 1,
    proposer: 'user_import',
    base: { table_version: activeRef.version, sha256: activeRef.sha256 },
    ...changes,
    rationale,
    evidence: []
  })
  return parsed.success ? parsed.data : null
}

export function RoutingTableRouteEditor(props: Props): React.JSX.Element {
  const { mode } = props
  const [draft, setDraft] = useState<EditorDraft>(() =>
    draftFromTable(props.active, mode.kind === 'modify' ? mode.proposal : undefined)
  )
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<readonly DraftError[]>([])
  const modify = mode.kind === 'modify'

  const submit = async (): Promise<void> => {
    const result = changesFromDraft(props.active, draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors([])
    if (mode.kind === 'modify') {
      if (await props.onAccept(mode.proposal.proposal_id, result.changes)) {
        props.onClose()
      }
      return
    }
    const submission = proposalFrom(result.changes, reason.trim(), props.activeRef)
    if (submission === null) {
      const message = translate(
        'auto.components.settings.routingTable.editor.reasonMissing',
        'Enter a short English reason for the change.'
      )
      setErrors([{ field: 'table', message }])
      return
    }
    if (await props.onPropose(submission)) {
      props.onClose()
    }
  }

  const messages = [...errors.map(errorLine), ...(props.refusal ? [props.refusal] : [])]
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {modify
              ? translate(
                  'auto.components.settings.routingTable.editor.modifyTitle',
                  'Edit proposal {{id}} before accepting',
                  {
                    id: mode.kind === 'modify' ? mode.proposal.proposal_id : ''
                  }
                )
              : translate(
                  'auto.components.settings.routingTable.editor.proposeTitle',
                  'Edit routes'
                )}
          </DialogTitle>
          <DialogDescription>
            {modify
              ? translate(
                  'auto.components.settings.routingTable.editor.modifyBody',
                  'Your edits replace the proposed changes. Accepting activates the result as a new version.'
                )
              : translate(
                  'auto.components.settings.routingTable.editor.proposeBody',
                  'Your edits are saved as a proposal. Nothing changes until you accept it.'
                )}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto pr-1 scrollbar-sleek">
          <RoutingTableRouteRows
            draft={draft}
            errors={errors}
            onDraftChange={setDraft}
            onRouteEdit={(taskType, edit) =>
              setDraft((current) => withRouteEdit(current, taskType, edit))
            }
          />
        </div>
        {modify ? null : (
          <div className="space-y-1">
            <Label htmlFor="routing-table-propose-reason">
              {translate(
                'auto.components.settings.routingTable.editor.reasonLabel',
                'Reason for the change'
              )}
            </Label>
            <Input
              id="routing-table-propose-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        )}
        {messages.length > 0 ? (
          <ul role="alert" className="space-y-0.5 text-xs text-destructive">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {translate('auto.components.settings.routingTable.editor.cancel', 'Cancel')}
          </Button>
          <Button disabled={props.busy} onClick={() => void submit()}>
            {modify
              ? translate(
                  'auto.components.settings.routingTable.editor.acceptModified',
                  'Accept with changes'
                )
              : translate(
                  'auto.components.settings.routingTable.editor.saveProposal',
                  'Save as proposal'
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
