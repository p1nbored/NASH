import { ZodError } from 'zod'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { RoutingTableRefusalView } from '../../../../shared/workbench-routing-table-view'

/** Plain English for every refusal the table store can return; codes and ids go to the details. */
export function routingTableRefusalMessage(refusal: RoutingTableRefusalView): string {
  switch (refusal.reason) {
    case 'routing_table_integrity_failed':
      return translate(
        'auto.components.settings.routingTable.refusals.integrityFailedPlain',
        'The saved task routing could not be read, so no task is routed. No default is used instead.'
      )
    case 'routing_table_taxonomy_mismatch':
      return translate(
        'auto.components.settings.routingTable.refusals.taxonomyMismatchPlain',
        'The saved task routing was made for a different list of tasks, so it cannot be used.'
      )
    case 'routing_table_not_installed':
      return translate(
        'auto.components.settings.routingTable.refusals.notInstalledPlain',
        'Task routing is not set up yet. Restart the app to install the defaults.'
      )
    case 'invalid_table':
      return translate(
        'auto.components.settings.routingTable.refusals.invalidTablePlain',
        'This change would leave task routing invalid, so it was not saved.'
      )
    case 'version_conflict':
      return translate(
        'auto.components.settings.routingTable.refusals.versionConflictPlain',
        'Task routing changed while this was being saved. Try again.'
      )
    case 'forbidden_caller':
      return translate(
        'auto.components.settings.routingTable.refusals.forbiddenCallerPlain',
        'Task routing can only be changed in this app.'
      )
    case 'no_change':
      return translate(
        'auto.components.settings.routingTable.refusals.noChangePlain',
        'This leaves every choice as it is, so nothing changed.'
      )
    case 'base_not_active':
      return translate(
        'auto.components.settings.routingTable.refusals.baseNotActivePlain',
        'Task routing changed after this was prepared. Try again.'
      )
    default:
      return translate(
        'auto.components.settings.routingTable.refusals.unknownPlain',
        'Task routing refused this change.'
      )
  }
}

/** The refusal's codes and ids for "Copy details"; never shown on screen. */
export function routingTableRefusalDetails(refusal: RoutingTableRefusalView): string {
  return [`reason: ${refusal.reason}`, `detail: ${refusal.detail ?? '-'}`].join('\n')
}

/** For a call that did not return a result; never repeats the raw error text. */
export function routingTableCallErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return translate(
      'auto.components.settings.routingTable.refusals.invalidResponsePlain',
      'The answer from the app could not be read here.'
    )
  }
  const code = error instanceof RuntimeRpcCallError ? error.code : null
  switch (code) {
    case 'method_not_found':
      return translate(
        'auto.components.settings.routingTable.refusals.notConnectedPlain',
        'Task routing is not available in this build.'
      )
    case 'workbench_routing_table_unavailable':
      return translate(
        'auto.components.settings.routingTable.refusals.unavailablePlain',
        'Task routing is not available right now. Restart the app.'
      )
    case 'workbench_forbidden':
      return translate(
        'auto.components.settings.routingTable.refusals.untrustedCallerPlain',
        'Task routing can only be read or changed in the desktop app on this computer.'
      )
    case null:
    default:
      return translate(
        'auto.components.settings.routingTable.refusals.callFailedPlain',
        'The request did not complete. Try again.'
      )
  }
}

/** The failed call's code for "Copy details"; the raw message could quote what was sent. */
export function routingTableCallErrorDetails(error: unknown): string {
  if (error instanceof ZodError) {
    return 'error: unreadable_response'
  }
  return `error: ${error instanceof RuntimeRpcCallError ? error.code : 'call_failed'}`
}
