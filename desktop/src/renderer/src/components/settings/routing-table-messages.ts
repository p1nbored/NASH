import { ZodError } from 'zod'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { RoutingTableRefusalView } from '../../../../shared/workbench-routing-table-view'

function integrityPart(detail: string | null): string {
  switch (detail) {
    case 'index_missing':
      return translate(
        'auto.components.settings.routingTable.refusals.indexMissing',
        'the version index is missing'
      )
    case 'index_unreadable':
      return translate(
        'auto.components.settings.routingTable.refusals.indexUnreadable',
        'the version index cannot be read'
      )
    case 'index_invalid':
      return translate(
        'auto.components.settings.routingTable.refusals.indexInvalid',
        'the version index is not valid'
      )
    case 'version_missing':
      return translate(
        'auto.components.settings.routingTable.refusals.versionMissing',
        'the active version file is missing'
      )
    case 'version_unreadable':
      return translate(
        'auto.components.settings.routingTable.refusals.versionUnreadable',
        'the active version file cannot be read'
      )
    case 'version_invalid':
      return translate(
        'auto.components.settings.routingTable.refusals.versionInvalid',
        'the active version file is not valid'
      )
    case 'version_hash_mismatch':
      return translate(
        'auto.components.settings.routingTable.refusals.versionHashMismatch',
        'the active version file does not match its recorded hash'
      )
    case null:
    default:
      return translate(
        'auto.components.settings.routingTable.refusals.integrityUnknown',
        'a stored file failed its check'
      )
  }
}

function duplicateMessage(existingProposalId: string | null): string {
  return existingProposalId === null
    ? translate(
        'auto.components.settings.routingTable.refusals.duplicateActive',
        'The active table already has exactly this content, so nothing was stored.'
      )
    : translate(
        'auto.components.settings.routingTable.refusals.duplicatePending',
        'The same change is already waiting as proposal {{proposalId}}. Review that one instead.',
        { proposalId: existingProposalId }
      )
}

/** Plain English for every refusal the table store can return; an unknown code stays visible. */
export function routingTableRefusalMessage(refusal: RoutingTableRefusalView): string {
  switch (refusal.reason) {
    case 'routing_table_integrity_failed':
      return translate(
        'auto.components.settings.routingTable.refusals.integrityFailed',
        'The stored Routing Table is damaged: {{part}}. Nothing routes until it is repaired; no default table is used instead.',
        { part: integrityPart(refusal.detail) }
      )
    case 'routing_table_taxonomy_mismatch':
      return translate(
        'auto.components.settings.routingTable.refusals.taxonomyMismatch',
        'The active table was written for a different list of task types, so it cannot be used. Import a table for the current task types.'
      )
    case 'routing_table_not_installed':
      return translate(
        'auto.components.settings.routingTable.refusals.notInstalled',
        'No Routing Table is installed yet. The app installs its default table when it starts.'
      )
    case 'invalid_table':
      return translate(
        'auto.components.settings.routingTable.refusals.invalidTable',
        'The resulting table would not be valid, so it was not activated.'
      )
    case 'version_conflict':
      return translate(
        'auto.components.settings.routingTable.refusals.versionConflict',
        'The table changed while this was being saved. Refresh and try again.'
      )
    case 'forbidden_caller':
      return translate(
        'auto.components.settings.routingTable.refusals.forbiddenCaller',
        'Only you, from this desktop app, can change the Routing Table.'
      )
    case 'proposal_unknown':
      return translate(
        'auto.components.settings.routingTable.refusals.proposalUnknown',
        'This proposal no longer exists. Refresh the list.'
      )
    case 'proposal_invalid':
      return translate(
        'auto.components.settings.routingTable.refusals.proposalInvalid',
        'This proposal file is not valid, so it cannot be accepted.'
      )
    case 'already_decided':
      return translate(
        'auto.components.settings.routingTable.refusals.alreadyDecided',
        'This proposal was already decided.'
      )
    case 'proposal_superseded':
      return translate(
        'auto.components.settings.routingTable.refusals.proposalSuperseded',
        'This proposal was based on an older version, so it was recorded as superseded and the active table did not change.'
      )
    case 'no_change':
      return translate(
        'auto.components.settings.routingTable.refusals.noChange',
        'This would leave the active table as it is, so no new version was created.'
      )
    case 'forbidden_proposer':
      return translate(
        'auto.components.settings.routingTable.refusals.forbiddenProposer',
        'This kind of proposal cannot be submitted from the desktop.'
      )
    case 'invalid_proposal':
      return translate(
        'auto.components.settings.routingTable.refusals.invalidProposal',
        'The change set is not valid, so it was not stored.'
      )
    case 'base_not_active':
      return translate(
        'auto.components.settings.routingTable.refusals.baseNotActive',
        'The change set is based on a version that is no longer active. Refresh and base it on the active version.'
      )
    case 'too_many_pending':
      return translate(
        'auto.components.settings.routingTable.refusals.tooManyPending',
        'Too many proposals are waiting. Accept or reject some of them first.'
      )
    case 'duplicate_content':
      return duplicateMessage(refusal.existingProposalId)
    case 'version_unknown':
      return translate(
        'auto.components.settings.routingTable.refusals.versionUnknown',
        'That version does not exist. Refresh the list.'
      )
    default:
      return translate(
        'auto.components.settings.routingTable.refusals.unknown',
        'The Routing Table refused this ({{reason}}).',
        {
          reason: refusal.reason
        }
      )
  }
}

/** For a call that did not return a result; never repeats the raw error text. */
export function routingTableCallErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return translate(
      'auto.components.settings.routingTable.refusals.invalidResponse',
      'The app returned a Routing Table answer this screen cannot read.'
    )
  }
  const code = error instanceof RuntimeRpcCallError ? error.code : null
  switch (code) {
    case 'method_not_found':
      return translate(
        'auto.components.settings.routingTable.refusals.notConnected',
        'The Routing Table is not connected in this build yet, so it cannot be shown or changed.'
      )
    case 'workbench_routing_table_unavailable':
      return translate(
        'auto.components.settings.routingTable.refusals.unavailable',
        'The Routing Table is not available in this session. Restart the app to install it.'
      )
    case 'workbench_forbidden':
      return translate(
        'auto.components.settings.routingTable.refusals.untrustedCaller',
        'Only the desktop app on this computer can read or change the Routing Table.'
      )
    case null:
    default:
      return translate(
        'auto.components.settings.routingTable.refusals.callFailed',
        'The Routing Table request did not complete. Refresh to see the current state.'
      )
  }
}
