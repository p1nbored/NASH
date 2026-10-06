import {
  DotDecisionViewSchema,
  type DotDecisionView
} from '../../../../shared/dot-ingress/dot-ingress-decision'
import {
  DOT_DECISION_SUMMARY_MAX_CHARS,
  DOT_INGRESS_CONTRACT_VERSION
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  DotRequestViewSchema,
  type DotRequestView,
  type DotRunView,
  type DotWorkspaceView
} from '../../../../shared/dot-ingress/dot-ingress-request'
import {
  DotIngressSettingsViewSchema,
  type DotIngressSettingsView
} from '../../../../shared/dot-ingress/dot-ingress-settings'
import { DOT_REQUEST_STATUS_TEXT } from '../../../../shared/dot-ingress/dot-ingress-status-text'
import { maskSecretLikeText } from '../../../agent-exec-shared/secret-shapes'
import { parseDotRow } from './dot-ingress-store-input'
import type { DotRequestRecord } from './dot-ingress-request-row'
import type { DotIngressSettings, DotWorkspaceEntry } from './dot-ingress-settings-store'
import type { PermissionDecisionRecord } from './permission-decision-record'

const NOT_STARTED: DotRunView = { state: 'not_started', blocker: null }
const CONTROL_OR_LINE_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]/gu

function viewRun(record: DotRequestRecord, run: DotRunView | null | undefined): DotRunView | null {
  switch (record.state) {
    case 'received':
      // Why: the intake call has not finished, so no run can exist yet whatever the caller supplies.
      return NOT_STARTED
    case 'submitted':
      return run ?? NOT_STARTED
    case 'canceled':
    case 'failed':
      return null
  }
}

/**
 * The dot-facing view of a request. It is built from a record that never held the objective, the
 * workspace id or the Workbench request id, so none of them can appear. `run` is the coarse run
 * state from the app's run projection.
 */
export function toDotRequestView(
  record: DotRequestRecord,
  run?: DotRunView | null
): DotRequestView {
  return parseDotRow(DotRequestViewSchema, {
    contractVersion: DOT_INGRESS_CONTRACT_VERSION,
    dotRequestId: record.dotRequestId,
    sequence: record.sequence,
    revision: record.revision,
    state: record.state,
    workspaceRef: record.workspaceRef,
    deliverableLanguage: record.deliverableLanguage,
    reply: record.replyCorrelationId === null ? null : { correlationId: record.replyCorrelationId },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    statusText: DOT_REQUEST_STATUS_TEXT[record.state],
    result: null,
    artifacts: [],
    run: viewRun(record, run)
  })
}

/** Enabled workspaces only, by opaque reference and label: no workspace id, binding or path. */
export function toDotWorkspaceViews(entries: readonly DotWorkspaceEntry[]): DotWorkspaceView[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({ workspaceRef: entry.workspaceRef, label: entry.label }))
}

/** The desktop's settings view; it carries the workspace id, never the binding hash, and no connection claim. */
export function toDotSettingsView(
  settings: DotIngressSettings,
  entries: readonly DotWorkspaceEntry[]
): DotIngressSettingsView {
  return parseDotRow(DotIngressSettingsViewSchema, {
    enabled: settings.enabled,
    connection: 'not_connected',
    rateLimits: { ratePerMinute: settings.ratePerMinute, ratePerUtcDay: settings.ratePerUtcDay },
    updatedAt: settings.updatedAt,
    workspaces: entries.map((entry) => ({
      workspaceRef: entry.workspaceRef,
      workspaceId: entry.workspaceId,
      label: entry.label,
      enabled: entry.enabled
    }))
  })
}

/** Defense in depth: the permission store already refuses an unmasked summary, and a tampered row is masked again here. */
function redactedSummary(summary: string): string {
  const flattened = maskSecretLikeText(summary).replace(CONTROL_OR_LINE_SEPARATOR, ' ')
  return Array.from(flattened).slice(0, DOT_DECISION_SUMMARY_MAX_CHARS).join('')
}

/**
 * D-017: dot sees the tool, agent id and one redacted line of command and file names, never file
 * contents and never any text of a request. Fields are copied by name, so a record that carries
 * anything else (a tool input, contents) cannot leak it.
 */
export function toDotDecisionView(
  record: PermissionDecisionRecord,
  dotRequestId: string
): DotDecisionView {
  return parseDotRow(DotDecisionViewSchema, {
    decisionId: record.decisionId,
    dotRequestId,
    toolName: record.toolName,
    agentId: record.agentId,
    summary: redactedSummary(record.summary),
    status: record.status,
    decidedBy: record.decidedBy,
    createdAt: record.createdAt,
    deadlineAt: record.deadlineAt,
    decidedAt: record.decidedAt
  })
}
