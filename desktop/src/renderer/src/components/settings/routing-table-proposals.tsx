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
  primaryAgentLabel,
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
    : `${primaryAgentLabel(coordinator.agent)} · ${coordinator.model} · ${reasoningLevelLabel(coordinator.reasoning_level)}`
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
      ? translate('auto.components.settings.routingTable.proposals.noRowPlain', 'not set')
      : routeSummary(change.before)
  return (
    <li className="space-y-0.5">
      <span className="block font-medium text-foreground">{taskTypeLabel(change.taskType)}</span>
      {change.policyChanged ? (
        <BeforeAfter before={before} after={routeSummary(change.after)} />
      ) : (
        <span className="block text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.notesOnlyPlain',
            'Same choice; only its notes change.'
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
    <ul className="space-y-row text-meta">
      {diff.routes.map((change) => (
        <RouteChangeItem key={change.taskType} change={change} />
      ))}
      {diff.coordinator ? (
        <li className="space-y-0.5">
          <span className="block font-medium text-foreground">
            {translate('auto.components.settings.routingTable.proposals.coordinator', 'Primary')}
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
            {translate('auto.components.settings.routingTable.inline.reviewersTitle', 'Reviewers')}
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
    <li className="py-row">
      <div role="group" aria-labelledby={labelId} className="space-y-row">
        <div>
          <p id={labelId} className="text-body text-foreground">
            {proposerLabel(proposal.proposer)}
          </p>
          <p className="text-caption text-muted-foreground">
            {translate(
              'auto.components.settings.routingTable.proposals.metaPlain',
              '{{time}} · based on version {{version}}',
              {
                time: formatRoutingTime(proposal.created_at),
                version: proposal.base.table_version
              }
            )}
          </p>
        </div>
        <p className="text-meta text-foreground">{proposal.rationale}</p>
        {evidence ? (
          <p className="text-caption text-muted-foreground">
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
                'auto.components.settings.routingTable.proposals.staleBodyPlain',
                'Version {{active}} is in use now, so this can no longer be accepted. Reject it, or make the change again in the list above.',
                { active: props.activeVersion ?? '?' }
              )}
            </p>
          </RoutingWarningCallout>
        ) : null}
        <div className="flex flex-wrap gap-row">
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
    </li>
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
            'auto.components.settings.routingTable.proposals.historyPlain',
            'Decided ({{count}})',
            { count: entries.length }
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-1 pl-6 text-meta">
          {entries.map(({ proposal, decision }) => (
            <li key={proposal.proposal_id} className="text-muted-foreground">
              <span className="text-foreground">{proposerLabel(proposal.proposer)}</span>
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

/** Suggested changes waiting first, each with its reason and a before and after; decided ones folded. */
export function RoutingTableProposals(props: {
  list: WorkbenchRoutingTableListResult
  active: RoutingTable | null
  actions: ProposalActions
}): React.JSX.Element {
  const headingId = useId()
  const pending = props.list.proposals.filter((entry) => entry.decision === null)
  const decided = props.list.proposals.filter((entry) => entry.decision !== null)
  return (
    <div className="space-y-1">
      <p id={headingId} className="text-meta font-medium text-foreground">
        {translate(
          'auto.components.settings.routingTable.proposals.pendingTitlePlain',
          'Suggested changes'
        )}
      </p>
      {pending.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.proposals.noneWaitingPlain',
            'None waiting. Nothing changes until you accept a suggestion.'
          )}
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="divide-y divide-border/50">
          {pending.map((entry) => (
            <PendingProposal
              key={entry.proposal.proposal_id}
              entry={entry}
              active={props.active}
              activeVersion={props.list.activeVersion}
              actions={props.actions}
            />
          ))}
        </ul>
      )}
      {decided.length > 0 ? <DecidedProposals entries={decided} /> : null}
    </div>
  )
}
