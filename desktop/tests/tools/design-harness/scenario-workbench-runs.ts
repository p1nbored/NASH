import type {
  PrimarySessionView,
  RunMessageSendResult,
  WorkflowRunView
} from '../../../src/shared/workflow-run/workflow-run-view'
import type { WorkbenchPermissionDecisionView } from '../../../src/shared/rpc-contract/permission-relay-params'

// FIXTURE_ONLY runs and permission prompts for the Workbench design captures (D-016 UI-1, UI-2).
// Nothing here reads a runtime, terminal or database; every id and time is synthetic.
export const FIXTURE_PANE_KEY = 'fixture-tab-coordinator:0f6b8a52-3c1d-4e7a-9b2c-5d4e3f2a1b0c'
const COORDINATOR = { model: 'claude-opus-5-5', effort: 'high' } as const

function at(minute: number, second = 0): string {
  return new Date(Date.UTC(2026, 9, 3, 10, minute, second)).toISOString()
}

function primary(overrides: Partial<PrimarySessionView>): PrimarySessionView {
  return {
    generation: 1,
    state: 'running',
    permissionMode: 'manual',
    model: COORDINATOR.model,
    effort: COORDINATOR.effort,
    paneKey: FIXTURE_PANE_KEY,
    endReason: null,
    startedAt: at(30),
    updatedAt: at(44),
    endedAt: null,
    live: null,
    ...overrides
  }
}

function run(
  workspaceId: string,
  sequence: number,
  overrides: Partial<WorkflowRunView>
): WorkflowRunView {
  return {
    runId: `fixture-run-${String(sequence).padStart(3, '0')}`,
    requestId: `fixture-request-${String(sequence).padStart(3, '0')}`,
    origin: 'desktop',
    workspaceId,
    objective: null,
    status: 'active',
    revision: 2,
    requestedAccess: 'read_only',
    deliverableLanguage: null,
    routingTable: { version: 1, sha256: '0123456789abcdef'.repeat(4) },
    coordinator: COORDINATOR,
    endReason: null,
    createdAt: at(30 - sequence),
    updatedAt: at(44),
    endedAt: null,
    primary: primary({}),
    ...overrides
  }
}

export function overviewRuns(workspaceId: string): WorkflowRunView[] {
  return [
    run(workspaceId, 6, {
      origin: 'dot',
      objective: 'Review the receipt parser changes and list the risky edge cases.',
      primary: primary({ live: { kind: 'live', activity: 'working' } })
    }),
    run(workspaceId, 5, {
      status: 'launching',
      objective: 'Bind progress claims to validated execution receipts.',
      primary: primary({ state: 'starting', paneKey: null, live: { kind: 'starting' } })
    }),
    run(workspaceId, 4, {
      status: 'unverifiable',
      objective: 'Draft the protected validator handoff notes.',
      primary: primary({
        state: 'unverifiable',
        paneKey: 'fixture-tab-closed:7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
        live: { kind: 'unverifiable', reason: 'handle_unresolved' }
      })
    })
  ]
}

export function endedRuns(workspaceId: string): WorkflowRunView[] {
  const ended = (minute: number, endReason: string, state: 'stopped' | 'exited') =>
    primary({ state, endReason, endedAt: at(minute), live: null })
  return [
    run(workspaceId, 9, {
      requestedAccess: 'workspace_write',
      objective: 'Answer the open review comments on the receipt contract.',
      primary: primary({ live: { kind: 'live', activity: 'dialog_open' } })
    }),
    run(workspaceId, 8, {
      status: 'completed',
      objective: 'Summarize the failing receipt tests.',
      endedAt: at(41),
      primary: ended(41, 'primary_exited', 'exited')
    }),
    run(workspaceId, 7, {
      status: 'canceled',
      origin: 'dot',
      objective: 'Rename the receipt fixtures.',
      endReason: 'user_canceled',
      endedAt: at(39),
      primary: ended(39, 'user_canceled', 'stopped')
    }),
    run(workspaceId, 3, {
      status: 'failed',
      objective: 'Port the receipt checks to the CLI.',
      endReason: 'primary_exited',
      endedAt: at(35),
      primary: ended(35, 'primary_exited', 'exited')
    })
  ]
}

function prompt(
  sequence: number,
  overrides: Partial<WorkbenchPermissionDecisionView>
): WorkbenchPermissionDecisionView {
  return {
    decisionId: `fixture-decision-${sequence}`,
    runId: 'fixture-run-006',
    agentId: null,
    toolName: 'Bash',
    summary: 'Bash: pnpm test contracts/receipt',
    status: 'pending',
    decidedBy: null,
    createdAt: at(43, sequence * 5),
    deadlineAt: at(47, sequence * 5),
    decidedAt: null,
    desktopOnly: false,
    answerable: true,
    ...overrides
  }
}

export function overviewPrompts(): WorkbenchPermissionDecisionView[] {
  return [
    prompt(1, {}),
    prompt(2, {
      toolName: 'Edit',
      summary: 'Edit: .claude/settings.json',
      desktopOnly: true
    }),
    prompt(3, {
      toolName: 'Read',
      summary: 'Read: contracts/receipt.ts',
      agentId: 'fixture-agent-review',
      answerable: false
    }),
    prompt(4, { toolName: 'Grep', summary: 'Grep in src/main' })
  ]
}

/** Answer outcomes the captures click through: decided, already answered by dot, closed, gone. */
export function answerOutcome(
  view: WorkbenchPermissionDecisionView,
  decision: 'allow' | 'deny'
): {
  outcome: 'decided' | 'already_decided' | 'closed' | 'not_found'
  decision: WorkbenchPermissionDecisionView | null
} {
  const settled = (status: 'allowed' | 'denied', decidedBy: 'desktop' | 'dot') => ({
    ...view,
    status,
    decidedBy,
    decidedAt: at(45),
    answerable: false
  })
  switch (view.decisionId) {
    case 'fixture-decision-2':
      return { outcome: 'already_decided', decision: settled('denied', 'dot') }
    case 'fixture-decision-4':
      return { outcome: 'closed', decision: { ...view, answerable: false } }
    case 'fixture-decision-1':
      return {
        outcome: 'decided',
        decision: settled(decision === 'allow' ? 'allowed' : 'denied', 'desktop')
      }
    default:
      return { outcome: 'not_found', decision: null }
  }
}

/** D-019 outcomes keyed on the fixture text, so a capture can show each one. */
export function messageOutcome(text: string): RunMessageSendResult {
  const base = { messageId: 'fixture-message-1', duplicate: false }
  if (/[^ -~\n]/.test(text)) {
    return { ...base, outcome: 'refused', reason: 'not_english', state: 'refused' }
  }
  if (text.includes('busy')) {
    return { ...base, outcome: 'queued', reason: 'agent_busy', state: 'delivered' }
  }
  if (text.includes('dialog')) {
    return { ...base, outcome: 'queued', reason: 'dialog_open', state: 'held' }
  }
  return { ...base, outcome: 'delivered', reason: null, state: 'delivered' }
}
