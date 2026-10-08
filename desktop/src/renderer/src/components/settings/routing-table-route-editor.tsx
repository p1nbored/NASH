import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type {
  ProposalChanges,
  RoutingTableProposal
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
import {
  changesFromDraft,
  draftFromTable,
  withRouteEdit,
  type DraftError,
  type EditorDraft
} from './routing-table-editor-model'
import { taskTypeLabel } from './routing-table-labels'
import { RoutingTableRouteRows } from './routing-table-route-rows'

type Props = {
  proposal: RoutingTableProposal
  active: RoutingTable
  busy: boolean
  /** Resolves true when the change was stored; the dialog then closes. */
  onAccept: (proposalId: string, modification: ProposalChanges) => Promise<boolean>
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
      ? translate('auto.components.settings.routingTable.editor.coordinator', 'Primary')
      : taskTypeLabel(error.field)
  return `${field}: ${error.message}`
}

/** Edit a suggested change before accepting it; accepting activates the edited result. */
export function RoutingTableRouteEditor(props: Props): React.JSX.Element {
  const [draft, setDraft] = useState<EditorDraft>(() =>
    draftFromTable(props.active, props.proposal)
  )
  const [errors, setErrors] = useState<readonly DraftError[]>([])

  const submit = async (): Promise<void> => {
    const result = changesFromDraft(props.active, draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors([])
    if (await props.onAccept(props.proposal.proposal_id, result.changes)) {
      props.onClose()
    }
  }

  const messages = [...errors.map(errorLine), ...(props.refusal ? [props.refusal] : [])]
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.routingTable.editor.modifyTitlePlain',
              'Edit before accepting'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.routingTable.editor.modifyBodyPlain',
              'Your edits replace the suggested change. Accepting puts them into use.'
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
        {messages.length > 0 ? (
          <ul role="alert" className="space-y-0.5 text-meta text-destructive">
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
            {translate(
              'auto.components.settings.routingTable.editor.acceptModified',
              'Accept with changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
