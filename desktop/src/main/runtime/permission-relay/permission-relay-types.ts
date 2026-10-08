import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import type { OrchestrationDb } from '../orchestration/db'
import type {
  PermissionAnswerResult,
  PermissionDecisionRecord
} from '../orchestration/db/permission-decision-store'
import type { OrchestrationCompatibilityCallerAuthority } from '../runtime-terminal-contracts'
import type { AgentStatusReader } from './permission-terminal-observer'

export type PermissionRelayDeps = {
  getDb(): OrchestrationDb
  verifyCaller(
    evidence: OrchestrationCompatibilityEvidence | undefined
  ): OrchestrationCompatibilityCallerAuthority | null
  readStatus: AgentStatusReader
  now(): number
  isAutoReviewEnabled(): boolean
  controlPlaneCommands: readonly string[]
  appDataDirectories?: readonly string[]
  reportError?(error: unknown): void
  readIncarnation?(handle: string): string | null
  notifyPrimary?(record: PermissionDecisionRecord): void
}

export type PermissionRelayAnswer =
  | PermissionAnswerResult
  | { outcome: 'closed'; record: PermissionDecisionRecord }

export type PermissionAnswerRequest = {
  decisionId: string
  decision: 'allow' | 'deny'
  decidedBy: 'dot' | 'desktop' | 'primary'
}
