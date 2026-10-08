import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { hasEffectiveSetupCommand } from '@/lib/setup-script-status'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  getFeatureWallSetupProgress,
  type FeatureWallSetupProgress
} from '../feature-wall/feature-wall-setup-progress'
import { deriveIntegrationConnectionStatus } from '../feature-wall/use-integration-connection-status'
import {
  getCurrentSetupScriptProbeState,
  getSetupGuideProgressReady,
  getSetupScriptProbeSignature
} from './setup-guide-progress-readiness'
import { useNashSetupSignals } from './use-nash-setup-signals'
import {
  readSetupScriptProbeCache,
  setSetupScriptProbeCache,
  subscribeSetupScriptProbeCache
} from './setup-script-probe-cache'

const SETUP_SCRIPT_PROBE_SETTLE_TIMEOUT_MS = 15_000

export function useSetupGuideProgress(shouldRefreshCoreState: boolean): FeatureWallSetupProgress {
  const settings = useAppStore((s) => s.settings)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const preflightStatus = useAppStore((s) => s.preflightStatus)
  const preflightStatusChecked = useAppStore((s) => s.preflightStatusChecked)
  const preflightStatusContextKey = useAppStore((s) => s.preflightStatusContextKey)
  const preflightStatusError = useAppStore((s) => s.preflightStatusError)
  const preflightStatusLoading = useAppStore((s) => s.preflightStatusLoading)
  const refreshPreflightStatus = useAppStore((s) => s.refreshPreflightStatus)
  const linearStatus = useAppStore((s) => s.linearStatus)
  const linearStatusChecked = useAppStore((s) => s.linearStatusChecked)
  const linearStatusContextKey = useAppStore((s) => s.linearStatusContextKey)
  const checkLinearConnection = useAppStore((s) => s.checkLinearConnection)
  const jiraStatus = useAppStore((s) => s.jiraStatus)
  const jiraStatusChecked = useAppStore((s) => s.jiraStatusChecked)
  const jiraStatusContextKey = useAppStore((s) => s.jiraStatusContextKey)
  const checkJiraConnection = useAppStore((s) => s.checkJiraConnection)
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const expectedPreflightContextKey = useAppStore((s) =>
    localPreflightContextKey(getLocalPreflightContext(s))
  )
  const setupScriptProbe = useSyncExternalStore(
    subscribeSetupScriptProbeCache,
    readSetupScriptProbeCache,
    readSetupScriptProbeCache
  )
  const nashSignals = useNashSetupSignals(shouldRefreshCoreState)
  const providerRuntimeContextKey = getProviderRuntimeContextKey(settings)
  const linearStatusCurrent = linearStatusContextKey === providerRuntimeContextKey
  const jiraStatusCurrent = jiraStatusContextKey === providerRuntimeContextKey
  const preflightStatusCurrent = preflightStatusContextKey === expectedPreflightContextKey

  useEffect(() => {
    if (!shouldRefreshCoreState) {
      return
    }
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
    if (!linearStatusCurrent || !linearStatusChecked) {
      void checkLinearConnection()
    }
    if (!jiraStatusCurrent || !jiraStatusChecked) {
      void checkJiraConnection()
    }
  }, [
    checkJiraConnection,
    checkLinearConnection,
    jiraStatusCurrent,
    jiraStatusChecked,
    jiraStatusContextKey,
    linearStatusCurrent,
    linearStatusChecked,
    linearStatusContextKey,
    expectedPreflightContextKey,
    preflightStatusContextKey,
    preflightStatusCurrent,
    preflightStatusChecked,
    providerRuntimeContextKey,
    refreshPreflightStatus,
    shouldRefreshCoreState
  ])

  const orderedGitRepos = useMemo(() => {
    const gitRepos = repos.filter(isGitRepoKind)
    const activeRepo = activeRepoId
      ? (gitRepos.find((repo) => repo.id === activeRepoId) ?? null)
      : null
    return activeRepo
      ? [activeRepo, ...gitRepos.filter((repo) => repo.id !== activeRepo.id)]
      : gitRepos
  }, [activeRepoId, repos])

  const setupScriptProbeSignature = useMemo(
    () => getSetupScriptProbeSignature(settings, orderedGitRepos),
    [orderedGitRepos, settings]
  )
  const activeSetupScriptProbeSignatureRef = useRef<string | null>(setupScriptProbeSignature)
  activeSetupScriptProbeSignatureRef.current = setupScriptProbeSignature

  useEffect(() => {
    if (!shouldRefreshCoreState || !settings || setupScriptProbeSignature === null) {
      return
    }
    const signature = setupScriptProbeSignature
    let stale = false
    // Why: setup-script checks can cross SSH/runtime streams. Bound sidebar
    // visibility readiness so a wedged read cannot hide the checklist forever.
    const timeoutId = window.setTimeout(() => {
      if (activeSetupScriptProbeSignatureRef.current === signature) {
        setSetupScriptProbeCache({ signature, ready: true, hasSetupScript: false })
      }
    }, SETUP_SCRIPT_PROBE_SETTLE_TIMEOUT_MS)

    const settle = (hasSetupScript: boolean): void => {
      window.clearTimeout(timeoutId)
      if (activeSetupScriptProbeSignatureRef.current === signature) {
        setSetupScriptProbeCache({ signature, ready: true, hasSetupScript })
      }
    }

    async function refreshSetupScriptState(): Promise<void> {
      for (const repo of orderedGitRepos) {
        const hooksResult = await checkRuntimeHooks(settings, repo.id).catch(() => null)
        if (stale) {
          return
        }
        if (hooksResult && hasEffectiveSetupCommand(repo, hooksResult)) {
          settle(true)
          return
        }
      }
      settle(false)
    }

    void refreshSetupScriptState()
    return () => {
      stale = true
      window.clearTimeout(timeoutId)
    }
  }, [orderedGitRepos, settings, setupScriptProbeSignature, shouldRefreshCoreState])

  const taskSourceStatus = deriveIntegrationConnectionStatus({
    preflightStatus,
    preflightStatusChecked,
    preflightStatusContextKey,
    preflightStatusError,
    preflightStatusLoading,
    expectedPreflightContextKey,
    linearStatus,
    linearStatusChecked,
    linearStatusContextKey,
    jiraStatus,
    jiraStatusChecked,
    jiraStatusContextKey,
    providerRuntimeContextKey
  })
  const hasConnectedTaskSource = taskSourceStatus.trackerConnected
  const currentSetupScriptProbe = getCurrentSetupScriptProbeState(
    setupScriptProbe,
    setupScriptProbeSignature
  )
  const ready = getSetupGuideProgressReady({
    refreshEnabled: shouldRefreshCoreState,
    settingsLoaded: settings !== null,
    // Why: task-source readiness is a capability group. Once any provider is
    // usable, unrelated stale provider checks should not hide setup progress.
    preflightStatusChecked: !taskSourceStatus.checking,
    linearStatusChecked: true,
    jiraStatusChecked: true,
    setupScriptProbeReady: currentSetupScriptProbe.ready,
    nashSignalsChecked: nashSignals.checked
  })

  return useMemo(
    () =>
      getFeatureWallSetupProgress({
        ready,
        settings,
        hasConnectedTaskSource,
        worktreesByRepo,
        hasSetupScript: currentSetupScriptProbe.hasSetupScript,
        primaryCliDetected: nashSignals.primaryCliDetected,
        clefConnected: nashSignals.clefConnected,
        dotConnected: nashSignals.dotConnected,
        hasWorkbenchRun: nashSignals.hasWorkbenchRun
      }),
    [
      ready,
      hasConnectedTaskSource,
      currentSetupScriptProbe.hasSetupScript,
      nashSignals,
      settings,
      worktreesByRepo
    ]
  )
}
