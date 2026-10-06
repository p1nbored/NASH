import type { DotDecisionViewV2 } from '../../shared/dot-ingress/dot-ingress-v2'
import type {
  DotDecisionAnswerResultV3,
  DotHelloResultV3,
  DotMessageResultV3,
  DotRequestViewV3,
  DotWorkspacesResultV3
} from '../../shared/dot-ingress/dot-ingress-v3'
import type {
  DotValidationDecideResultV3,
  DotValidationsListResultV3
} from '../../shared/dot-ingress/dot-ingress-validation'

// Short English lines for a person at a terminal; --json prints the contract result instead.

export function formatDotHello(hello: DotHelloResultV3): string {
  return [
    `Dot interface contract versions: ${hello.supportedContractVersions.join(', ')}.`,
    `Methods: ${hello.methods.join(', ')}.`,
    `Caps: ${hello.limits.maxSubmissionsPerMinute} per minute, ${hello.limits.maxSubmissionsPerUtcDay} per UTC day.`
  ].join('\n')
}

export function formatDotWorkspaces(result: DotWorkspacesResultV3): string {
  if (result.workspaces.length === 0) {
    return 'No workspace is enabled for dot.'
  }
  return result.workspaces
    .map(
      (workspace) =>
        `${workspace.workspaceRef}  ${workspace.label}  (max access: ${workspace.maxAccess})`
    )
    .join('\n')
}

export function formatDotRequest(request: DotRequestViewV3): string {
  const run = request.run
    ? `, run ${request.run.state}${request.run.blocker ? ` (${request.run.blocker})` : ''}`
    : ''
  return `Request ${request.dotRequestId}: ${request.state}${run}, access ${request.requestedAccess}`
}

export function formatDotDecision(decision: DotDecisionViewV2): string {
  const answers = decision.dotMayAllow ? 'allow or deny' : 'deny only'
  return `${decision.decisionId}  ${decision.summary}  [${decision.status}; dot may ${answers}]`
}

export function formatDotDecisionAnswer(result: DotDecisionAnswerResultV3): string {
  return `${result.decision.decisionId}: ${result.outcome}, ${result.decision.status}`
}

export function formatDotMessage(result: DotMessageResultV3): string {
  const reason = result.reason ? ` (${result.reason})` : ''
  return `Message ${result.messageId}: ${result.outcome}${reason}${result.duplicate ? ', sent before' : ''}`
}

/** One line per waiting decision: id, request, reason, title and the masked summary or that it was withheld. */
export function formatDotValidations(result: DotValidationsListResultV3): string {
  if (result.validations.length === 0) {
    return 'No validation decisions are waiting.'
  }
  const lines = result.validations.map((view) => {
    const summary = view.summaryWithheld ? 'summary withheld' : (view.summary ?? 'no summary')
    return `${view.validationId}  request ${view.dotRequestId}  [${view.reason}]  ${view.title}: ${summary}`
  })
  return result.hasMore
    ? [...lines, 'More decisions are waiting; use --limit to list more.'].join('\n')
    : lines.join('\n')
}

export function formatDotValidationDecision(result: DotValidationDecideResultV3): string {
  const when = result.decidedAt ? ` at ${result.decidedAt}` : ''
  return `${result.validationId}: ${result.outcome}${when}${result.duplicate ? ', decided before' : ''}`
}
