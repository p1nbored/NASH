import { useId } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { RoutingTableProposal } from '../../../../shared/routing-table/routing-table-proposal-schema'
import type {
  Coordinator,
  RoutingTable,
  ValidationPolicy
} from '../../../../shared/routing-table/routing-table-schema'
import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { diffProposal, type RouteChange } from './routing-table-diff'
import {
  proposalDecisionLabel,
  proposerLabel,
  reasoningLevelLabel,
  reviewerTargetLabel,
  routeSummary,
  taskTypeLabel
} from './routing-table-labels'
import { formatRoutingTime } from './routing-table-time'
import { RoutingWarningCallout } from './routing-warning-callout'

type ProposalEntry = WorkbenchRoutingTableListResult['proposals'][number]

export type ProposalActions = {
  busy: boolean
  onAccept: (proposalId: string) => void
  onEdit: (proposal: RoutingTableProposal) => void
  onReject: (proposalId: string) => void
}

function BeforeAfter(props: { before: string; after: string }): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="text-muted-foreground">{props.before}</span>
      <ArrowRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
      <span className="sr-only">
        {translate('auto.components.settings.routingTable.proposals.becomes', 'becomes')}
      </span>
      <span className="text-foreground">{props.after}</span>
    </span>
  )
}

function coordinatorText(coordinator: Coordinator | null): string {
  return coordinator === null
    ? translate('auto.components.settings.routingTable.proposals.none', 'none')
    : `${coordinator.model} · ${reasoningLevelLabel(coordinator.reasoning_level)}`
}

function reviewersText(policy: ValidationPolicy | null): string {
  if (policy === null || policy.reviewers.length === 0) {
    return translate('auto.components.settings.routingTable.proposals.noReviewers', 'no reviewers')
  }
  return policy.reviewers
    .map((reviewer) => `${reviewerTargetLabel(reviewer.target)} ${reviewer.model}`)
    .join(', ')
}

function RouteChangeItem({ change }: { change: RouteChange }): React.JSX.Element {
  const before =
    change.before === null
      ? translate('auto.components.settings.routingTable.proposals.noRow', 'no active row')
      : routeSummary(change.before)
  return (
    <li className="space-y-0.5">
      <span className="block font-medium text-foreground">{taskTypeLabel(change.taskType)}</span>
      {change.policyChanged ? (
        <BeforeAfter before={before} after={routeSummary(change.after)} />
      ) : (
        <span className="block text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.notesOnly',
            'Same route; only its notes or sources change.'
          )}
        </span>
      )}
    </li>
  )
}

function ProposalDiffList(props: {
  active: RoutingTable | null
  proposal: RoutingTableProposal
}): React.JSX.Element {
  const diff = diffProposal(props.active, props.proposal)
  return (
    <ul className="space-y-2 text-xs">
      {diff.routes.map((change) => (
        <RouteChangeItem key={change.taskType} change={change} />
      ))}
      {diff.coordinator ? (
        <li className="space-y-0.5">
          <span className="block font-medium text-foreground">
            {translate(
              'auto.components.settings.routingTable.proposals.coordinator',
              'Coordinator'
            )}
          </span>
          <BeforeAfter
            before={coordinatorText(diff.coordinator.before)}
            after={coordinatorText(diff.coordinator.after)}
          />
        </li>
      ) : null}
      {diff.validation ? (
        <li className="space-y-0.5">
          <span className="block font-medium text-foreground">
            {translate(
              'auto.components.settings.routingTable.proposals.reviewers',
              'Validation reviewers'
            )}
          </span>
          <BeforeAfter
            before={reviewersText(diff.validation.before)}
            after={reviewersText(diff.validation.after)}
          />
        </li>
      ) : null}
    </ul>
  )
}

function PendingProposal(props: {
  entry: ProposalEntry
  active: RoutingTable | null
  activeVersion: number | null
  actions: ProposalActions
}): React.JSX.Element {
  const labelId = useId()
  const { proposal, stale } = props.entry
  const { actions } = props
  const evidence = proposal.evidence.map((source) => source.name).join(', ')
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="space-y-2 rounded-md border border-border/60 p-3"
    >
      <div className="space-y-0.5">
        <p id={labelId} className="text-xs font-medium text-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.title',
            '{{proposer}} proposal {{id}}',
            {
              proposer: proposerLabel(proposal.proposer),
              id: proposal.proposal_id
            }
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.meta',
            '{{time}} · based on version {{version}}',
            {
              time: formatRoutingTime(proposal.created_at),
              version: proposal.base.table_version
            }
          )}
        </p>
      </div>
      <p className="text-xs text-foreground">{proposal.rationale}</p>
      {evidence ? (
        <p className="text-[11px] text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.evidence',
            'Sources: {{sources}}',
            { sources: evidence }
          )}
        </p>
      ) : null}
      <ProposalDiffList active={props.active} proposal={proposal} />
      {stale ? (
        <RoutingWarningCallout
          label={translate(
            'auto.components.settings.routingTable.proposals.staleTitle',
            'Made for an older version'
          )}
        >
          <p>
            {translate(
              'auto.components.settings.routingTable.proposals.staleBody',
              'Version {{active}} is active now, so accepting would only record this as superseded. Reject it, or make the change again with Edit routes.',
              { active: props.activeVersion ?? '?' }
            )}
          </p>
        </RoutingWarningCallout>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={actions.busy || stale}
          onClick={() => actions.onAccept(proposal.proposal_id)}
        >
          {translate('auto.components.settings.routingTable.proposals.accept', 'Accept')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={actions.busy || stale}
          onClick={() => actions.onEdit(proposal)}
        >
          {translate('auto.components.settings.routingTable.proposals.edit', 'Edit and accept')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={actions.busy}
          onClick={() => actions.onReject(proposal.proposal_id)}
        >
          {translate('auto.components.settings.routingTable.proposals.reject', 'Reject')}
        </Button>
      </div>
    </div>
  )
}

function DecidedProposals({ entries }: { entries: readonly ProposalEntry[] }): React.JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" className="group">
          <ChevronRight
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-90"
          />
          {translate(
            'auto.components.settings.routingTable.proposals.history',
            'Decided proposals ({{count}})',
            { count: entries.length }
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-1 pl-6 text-xs">
          {entries.map(({ proposal, decision }) => (
            <li key={proposal.proposal_id} className="text-muted-foreground">
              <span className="text-foreground">{proposerLabel(proposal.proposer)}</span>{' '}
              <span className="font-mono text-[11px]">{proposal.proposal_id}</span>
              {decision
                ? ` · ${proposalDecisionLabel(decision.decision)} · ${formatRoutingTime(decision.decided_at)}`
                : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Pending proposals first, each with its reason and a before and after reading; decided ones folded. */
export function RoutingTableProposals(props: {
  list: WorkbenchRoutingTableListResult
  active: RoutingTable | null
  actions: ProposalActions
}): React.JSX.Element {
  const pending = props.list.proposals.filter((entry) => entry.decision === null)
  const decided = props.list.proposals.filter((entry) => entry.decision !== null)
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">
        {translate(
          'auto.components.settings.routingTable.proposals.pendingTitle',
          'Proposals to review'
        )}
      </p>
      {pending.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.noneWaiting',
            'Nothing is waiting. App updates and agents propose changes here; nothing changes until you accept one.'
          )}
        </p>
      ) : (
        pending.map((entry) => (
          <PendingProposal
            key={entry.proposal.proposal_id}
            entry={entry}
            active={props.active}
            activeVersion={props.list.activeVersion}
            actions={props.actions}
          />
        ))
      )}
      {decided.length > 0 ? <DecidedProposals entries={decided} /> : null}
    </div>
  )
}
