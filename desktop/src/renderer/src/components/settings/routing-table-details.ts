import type { WorkbenchRoutingTableListResult } from '../../../../shared/workbench-routing-table-view'

/**
 * Everything technical about the stored task routing, for "Copy details": versions, hashes and
 * suggestion ids stay out of the visible text but remain one click away for support.
 */
export function routingTableDetails(list: WorkbenchRoutingTableListResult): string {
  const { active } = list
  const lines = active.ok
    ? [
        `active_version: ${active.version}`,
        `active_sha256: ${active.sha256}`,
        `source: ${active.source}`,
        `taxonomy_version: ${active.table.taxonomy_version}`,
        `created_at: ${active.table.created_at}`,
        `based_on: ${
          active.table.based_on === null
            ? '-'
            : `${active.table.based_on.table_version} ${active.table.based_on.sha256}`
        }`
      ]
    : [
        `active: refused ${active.reason}`,
        `detail: ${active.detail ?? '-'}`,
        `active_version: ${list.activeVersion ?? '-'}`
      ]
  const versions = list.versions.map(
    (entry) =>
      `version ${entry.version}: ${entry.sha256} ${entry.source} ${entry.acceptedAt} ${entry.proposalId ?? '-'}`
  )
  const proposals = list.proposals.map(({ proposal, decision, stale }) => {
    const state = decision === null ? (stale ? 'pending_stale' : 'pending') : decision.decision
    return `proposal ${proposal.proposal_id}: ${proposal.proposer} base ${proposal.base.table_version} ${state}`
  })
  const unreadable = list.unreadableProposalIds.map((id) => `unreadable_proposal: ${id}`)
  return [...lines, ...versions, ...proposals, ...unreadable].join('\n')
}
