import {
  FEATURE_WALL_SETUP_STEPS,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Worktree } from '../../../../shared/worktree/types'

export type FeatureWallSetupProgressInput = {
  ready?: boolean
  settings: GlobalSettings | null
  hasConnectedTaskSource: boolean
  worktreesByRepo: Record<string, Worktree[]>
  hasSetupScript: boolean
  /** Claude Code is on this computer's PATH (agent detection). */
  claudeCodeDetected: boolean
  /** Clef credentials are stored and its profile verified (routing status). */
  clefConnected: boolean
  /** The local dot interface is on, or a GPT Site is paired. */
  dotConnected: boolean
  /** At least one Workbench run exists. */
  hasWorkbenchRun: boolean
}

export type FeatureWallSetupProgress = {
  ready: boolean
  stepDone: Record<FeatureWallSetupStepId, boolean>
  coreDoneCount: number
  coreTotal: number
}

function countAvailableNonMainWorktrees(worktreesByRepo: Record<string, Worktree[]>): number {
  // Why: imported git worktrees count as real parallel-work capacity, but
  // partially hydrated placeholders can appear before a worktree path is known.
  return Object.values(worktreesByRepo).reduce(
    (sum, worktrees) =>
      sum +
      worktrees.filter(
        (worktree) => !worktree.isMainWorktree && typeof worktree.path === 'string' && worktree.path
      ).length,
    0
  )
}

// Why kept: the agent capability setup card still reads it, though the checklist no longer has the step (D-038).
export type AgentCapabilitiesState = {
  browserUseSkillInstalled: boolean
  computerUseSkillInstalled: boolean
  computerUseReady: boolean
  computerUseUnavailable: boolean
  orchestrationSkillInstalled: boolean
}

export function isAgentCapabilitiesDone(state: AgentCapabilitiesState): boolean {
  return (
    state.browserUseSkillInstalled &&
    state.computerUseSkillInstalled &&
    (state.computerUseReady || state.computerUseUnavailable) &&
    state.orchestrationSkillInstalled
  )
}

export function getFeatureWallSetupProgress(
  input: FeatureWallSetupProgressInput
): FeatureWallSetupProgress {
  const stepDone: Record<FeatureWallSetupStepId, boolean> = {
    'claude-code': input.claudeCodeDetected,
    clef: input.clefConnected,
    dot: input.dotConnected,
    'workbench-run': input.hasWorkbenchRun,
    notifications:
      input.settings?.notifications.enabled === true &&
      input.settings.notifications.agentTaskComplete === true,
    'two-worktrees': countAvailableNonMainWorktrees(input.worktreesByRepo) >= 1,
    'task-sources': input.hasConnectedTaskSource,
    'setup-script': input.hasSetupScript
  }
  return {
    ready: input.ready ?? true,
    stepDone,
    coreDoneCount: FEATURE_WALL_SETUP_STEPS.filter((step) => stepDone[step.id]).length,
    coreTotal: FEATURE_WALL_SETUP_STEPS.length
  }
}
