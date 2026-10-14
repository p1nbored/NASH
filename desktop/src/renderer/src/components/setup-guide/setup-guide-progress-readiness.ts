import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'

export type SetupScriptProbeState = {
  signature: string | null
  ready: boolean
  hasSetupScript: boolean
}

export type SetupGuideProgressReadinessInput = {
  refreshEnabled: boolean
  settingsLoaded: boolean
  preflightStatusChecked: boolean
  linearStatusChecked: boolean
  jiraStatusChecked: boolean
  setupScriptProbeReady: boolean
  /** The NASH signals (primary CLI, Clef, dot, Workbench runs) have answered at least once. */
  nashSignalsChecked: boolean
}

export const INITIAL_SETUP_SCRIPT_PROBE_STATE: SetupScriptProbeState = {
  signature: null,
  ready: false,
  hasSetupScript: false
}

export function getSetupScriptProbeSignature(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  orderedGitRepos: readonly Pick<Repo, 'id' | 'hookSettings' | 'connectionId' | 'executionHostId'>[]
): string | null {
  if (!settings) {
    return null
  }
  // Why: each repo's hooks are probed on its own host, so the host is part of the signature.
  return JSON.stringify({
    repos: orderedGitRepos.map((repo) => ({
      id: repo.id,
      host: getRepoExecutionHostId(repo),
      commandSourcePolicy: repo.hookSettings?.commandSourcePolicy ?? null,
      setup: repo.hookSettings?.scripts?.setup ?? null
    }))
  })
}

export function markSetupScriptProbePending(
  current: SetupScriptProbeState,
  signature: string | null
): SetupScriptProbeState {
  if (current.signature === signature) {
    return current
  }
  return { signature, ready: false, hasSetupScript: false }
}

export function settleSetupScriptProbe(
  current: SetupScriptProbeState,
  signature: string,
  hasSetupScript: boolean
): SetupScriptProbeState {
  if (current.signature !== signature) {
    return current
  }
  return { signature, ready: true, hasSetupScript }
}

export function getCurrentSetupScriptProbeState(
  current: SetupScriptProbeState,
  signature: string | null
): SetupScriptProbeState {
  if (current.signature === signature) {
    return current
  }
  return { signature, ready: false, hasSetupScript: false }
}

export function getSetupGuideProgressReady(input: SetupGuideProgressReadinessInput): boolean {
  return (
    input.refreshEnabled &&
    input.settingsLoaded &&
    input.preflightStatusChecked &&
    input.linearStatusChecked &&
    input.jiraStatusChecked &&
    input.setupScriptProbeReady &&
    input.nashSignalsChecked
  )
}
