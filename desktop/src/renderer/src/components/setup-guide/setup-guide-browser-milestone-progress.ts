import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  FEATURE_WALL_SETUP_STEPS,
  ORCA_LEGACY_SETUP_STEP_IDS,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'

export function useSetupGuideBrowserMilestoneProgress(
  rawProgress: FeatureWallSetupProgress,
  historicalSplitTerminalDone: boolean
): FeatureWallSetupProgress {
  const setupGuideSidebarDismissed = useAppStore((s) => s.setupGuideSidebarDismissed)
  const browserMilestoneMigrated = useAppStore((s) => s.setupGuideBrowserMilestoneMigrated)
  const browserMilestoneLegacyComplete = useAppStore(
    (s) => s.setupGuideBrowserMilestoneLegacyComplete
  )
  const markBrowserMilestoneMigrated = useAppStore((s) => s.markSetupGuideBrowserMilestoneMigrated)
  const pendingLegacyComplete =
    !browserMilestoneMigrated && rawProgress.ready
      ? shouldMarkBrowserMilestoneLegacyComplete({
          stepDone: rawProgress.stepDone,
          historicalSplitTerminalDone,
          setupGuideSidebarDismissed
        })
      : false
  const effectiveLegacyComplete = browserMilestoneLegacyComplete || pendingLegacyComplete

  useEffect(() => {
    if (browserMilestoneMigrated || !rawProgress.ready) {
      return
    }
    markBrowserMilestoneMigrated(pendingLegacyComplete)
  }, [
    browserMilestoneMigrated,
    markBrowserMilestoneMigrated,
    pendingLegacyComplete,
    rawProgress.ready
  ])

  return useMemo(
    () => getSetupGuideBrowserMilestoneAwareProgress(rawProgress, effectiveLegacyComplete),
    [effectiveLegacyComplete, rawProgress]
  )
}

export function shouldMarkBrowserMilestoneLegacyComplete(input: {
  stepDone: Partial<Record<FeatureWallSetupStepId, boolean>>
  historicalSplitTerminalDone: boolean
  setupGuideSidebarDismissed: boolean
}): boolean {
  if (input.setupGuideSidebarDismissed) {
    return true
  }
  // Why: browser migration preserves the old pre-browser checklist, which
  // included the now-removed split-terminal milestone. Only Orca's steps count;
  // the NASH steps (D-038) were never part of that checklist.
  return (
    input.historicalSplitTerminalDone &&
    ORCA_LEGACY_SETUP_STEP_IDS.every((id) => input.stepDone[id])
  )
}

export function getSetupGuideBrowserMilestoneAwareProgress(
  progress: FeatureWallSetupProgress,
  browserMilestoneLegacyComplete: boolean
): FeatureWallSetupProgress {
  if (!browserMilestoneLegacyComplete) {
    return progress
  }
  // Why: profiles that finished or dismissed the pre-browser checklist keep
  // that prior checklist contract after the browser milestone is introduced.
  // The NASH steps (D-038) still complete only from their own signals.
  const legacyStepIds: ReadonlySet<FeatureWallSetupStepId> = new Set(ORCA_LEGACY_SETUP_STEP_IDS)
  const stepDone = { ...progress.stepDone }
  for (const step of FEATURE_WALL_SETUP_STEPS) {
    stepDone[step.id] = legacyStepIds.has(step.id) || progress.stepDone[step.id]
  }
  return {
    ...progress,
    stepDone,
    coreDoneCount: FEATURE_WALL_SETUP_STEPS.filter((step) => stepDone[step.id]).length,
    coreTotal: FEATURE_WALL_SETUP_STEPS.length
  }
}
