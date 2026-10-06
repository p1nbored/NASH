import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type {
  RouteAvailabilityReason,
  RouteAvailabilityView,
  RoutingTableAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import { routingTableCallErrorMessage } from './routing-table-messages'

/** Plain English for each reason code the availability checks give; the code is never shown. */
export function routeReasonText(reason: RouteAvailabilityReason): string {
  switch (reason) {
    case 'cli_missing':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.cliMissing',
        'The CLI is not installed.'
      )
    case 'cli_disabled':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.cliDisabled',
        'The CLI is turned off in Settings.'
      )
    case 'cli_not_launchable':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.cliNotLaunchable',
        'The CLI is installed but cannot be started.'
      )
    case 'model_not_listed':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.modelNotListed',
        'This model is not offered to your account.'
      )
    case 'model_excluded':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.modelExcluded',
        'This model name is not allowed here (an alias or an excluded model).'
      )
    case 'reasoning_unsupported':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.reasoningUnsupported',
        'The model does not support this reasoning level.'
      )
    case 'auth_failed':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.authFailed',
        'Sign-in failed. Sign in to the CLI again, then use Check routes.'
      )
    case 'not_entitled':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.notEntitled',
        'Your plan does not include this model.'
      )
    case 'quota_exhausted':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.quotaExhausted',
        'The usage limit is reached. The block lifts when a new usage reading shows the limit reset, or use Check routes after it resets.'
      )
    case 'availability_record_damaged':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.recordDamaged',
        'The saved availability record was damaged. Use Check routes to read every route again.'
      )
    case 'workspace_not_git':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.workspaceNotGit',
        'Codex needs a workspace folder to run in; the floating terminal has none.'
      )
    case 'not_checked':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.notChecked',
        'Not checked recently. Use Check routes.'
      )
    case 'cli_unobserved':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.cliUnobserved',
        'The installed CLIs could not be detected.'
      )
    case 'model_list_unavailable':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.modelListUnavailable',
        'The model list could not be read.'
      )
    case 'reasoning_unverified':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.reasoningUnverified',
        'The reasoning level could not be confirmed for this model.'
      )
    case 'auth_unobserved':
      return translate(
        'auto.components.settings.routingTable.availability.reasons.authUnobserved',
        'The sign-in could not be confirmed.'
      )
  }
}

export type RouteAvailabilityTone = 'available' | 'unavailable' | 'unverified'
export type RouteAvailabilityLabel = { label: string; detail: string; tone: RouteAvailabilityTone }

function statusLabel(view: RouteAvailabilityView): string {
  switch (view.status) {
    case 'available':
      return translate('auto.components.settings.routingTable.availability.available', 'Available')
    case 'unavailable':
      return translate(
        'auto.components.settings.routingTable.availability.unavailable',
        'Unavailable'
      )
    case 'unverified':
      return view.reasons.includes('not_checked')
        ? translate('auto.components.settings.routingTable.availability.notChecked', 'Not checked')
        : translate('auto.components.settings.routingTable.availability.unverified', 'Not verified')
  }
}

/** A route's short status and the reasons behind it; "Not checked" needs no reason line of its own. */
export function routeAvailabilityLabel(view: RouteAvailabilityView): RouteAvailabilityLabel {
  const all: readonly RouteAvailabilityReason[] = view.reasons
  const reasons = all.filter((reason) => reason !== 'not_checked')
  const awaiting = view.awaitingUserConfirmation
    ? [
        translate(
          'auto.components.settings.routingTable.availability.awaiting',
          'This rests on a default awaiting your confirmation.'
        )
      ]
    : []
  return {
    label: statusLabel(view),
    detail: [...reasons.map(routeReasonText), ...awaiting].join(' '),
    tone: view.status
  }
}

/** One line for a finished check: how many entries are available, unavailable and unverified. */
export function routeCheckSummary(availability: RoutingTableAvailabilityView): string {
  const all = [
    availability.coordinator,
    ...availability.routes.map((row) => row.availability),
    ...availability.reviewers
  ]
  const count = (status: RouteAvailabilityTone): number =>
    all.filter((entry) => entry.status === status).length
  return translate(
    'auto.components.settings.routingTable.availability.summary',
    'Routes checked: {{available}} available, {{unavailable}} unavailable, {{unverified}} not verified.',
    {
      available: count('available'),
      unavailable: count('unavailable'),
      unverified: count('unverified')
    }
  )
}

/** For a check that did not return a result; never repeats the raw error text. */
export function routeCheckErrorMessage(error: unknown): string {
  if (
    error instanceof RuntimeRpcCallError &&
    error.code === 'workbench_route_availability_unavailable'
  ) {
    return translate(
      'auto.components.settings.routingTable.availability.checksUnavailable',
      'Route checks are not available in this session. Restart the app to install them.'
    )
  }
  return routingTableCallErrorMessage(error)
}
