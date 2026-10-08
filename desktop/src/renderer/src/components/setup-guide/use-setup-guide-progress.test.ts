import { describe, expect, it } from 'vitest'
import {
  FEATURE_WALL_SETUP_STEPS,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'
import {
  getSetupGuideBrowserMilestoneAwareProgress,
  shouldMarkBrowserMilestoneLegacyComplete
} from './setup-guide-browser-milestone-progress'
import {
  getCurrentSetupScriptProbeState,
  getSetupGuideProgressReady,
  getSetupScriptProbeSignature,
  markSetupScriptProbePending,
  settleSetupScriptProbe
} from './setup-guide-progress-readiness'

function makePreBrowserDoneStepState(): Partial<Record<FeatureWallSetupStepId, boolean>> {
  return Object.fromEntries<boolean>(FEATURE_WALL_SETUP_STEPS.map((step) => [step.id, true]))
}

function makeProgress(overrides: Partial<FeatureWallSetupProgress> = {}): FeatureWallSetupProgress {
  return {
    ready: true,
    stepDone: {
      'claude-code': false,
      clef: false,
      dot: false,
      'task-sources': false,
      notifications: false,
      'setup-script': false,
      'workbench-run': false,
      'two-worktrees': false
    },
    coreDoneCount: 0,
    coreTotal: FEATURE_WALL_SETUP_STEPS.length,
    ...overrides
  }
}

describe('browser milestone legacy setup guide progress', () => {
  it('marks old profiles as legacy-complete when pre-browser steps were already done', () => {
    expect(
      shouldMarkBrowserMilestoneLegacyComplete({
        stepDone: makePreBrowserDoneStepState(),
        historicalSplitTerminalDone: true,
        setupGuideSidebarDismissed: false
      })
    ).toBe(true)
  })

  it('does not waive browser for old profiles missing historical split completion', () => {
    expect(
      shouldMarkBrowserMilestoneLegacyComplete({
        stepDone: makePreBrowserDoneStepState(),
        historicalSplitTerminalDone: false,
        setupGuideSidebarDismissed: false
      })
    ).toBe(false)
  })

  it('marks old profiles as legacy-complete when the sidebar checklist was dismissed', () => {
    expect(
      shouldMarkBrowserMilestoneLegacyComplete({
        stepDone: {},
        historicalSplitTerminalDone: false,
        setupGuideSidebarDismissed: true
      })
    ).toBe(true)
  })

  it('does not mark old active incomplete profiles as legacy-complete', () => {
    expect(
      shouldMarkBrowserMilestoneLegacyComplete({
        stepDone: {
          'two-worktrees': true
        },
        historicalSplitTerminalDone: true,
        setupGuideSidebarDismissed: false
      })
    ).toBe(false)
  })

  it('keeps legacy-complete setup guide progress complete across all surfaces', () => {
    const progress = getSetupGuideBrowserMilestoneAwareProgress(
      makeProgress({
        stepDone: { ...makeProgress().stepDone, ...makePreBrowserDoneStepState() },
        coreDoneCount: FEATURE_WALL_SETUP_STEPS.length - 1
      }),
      true
    )

    expect(progress.coreDoneCount).toBe(FEATURE_WALL_SETUP_STEPS.length)
    expect(Object.values(progress.stepDone).every(Boolean)).toBe(true)
  })

  it('keeps the NASH steps on their own signals for legacy-complete profiles (D-038)', () => {
    const progress = getSetupGuideBrowserMilestoneAwareProgress(makeProgress(), true)

    expect(progress.stepDone).toMatchObject({
      notifications: true,
      'task-sources': true,
      'setup-script': true,
      'two-worktrees': true,
      'claude-code': false,
      clef: false,
      dot: false,
      'workbench-run': false
    })
    expect(progress.coreDoneCount).toBe(4)
  })

  it('decides legacy completion from the Orca steps only', () => {
    expect(
      shouldMarkBrowserMilestoneLegacyComplete({
        stepDone: {
          notifications: true,
          'task-sources': true,
          'setup-script': true,
          'two-worktrees': true
        },
        historicalSplitTerminalDone: true,
        setupGuideSidebarDismissed: false
      })
    ).toBe(true)
  })

  it('leaves fresh setup guide progress unchanged without legacy completion', () => {
    const original = makeProgress({
      stepDone: makePreBrowserDoneStepState() as Record<FeatureWallSetupStepId, boolean>,
      coreDoneCount: FEATURE_WALL_SETUP_STEPS.length - 1
    })

    expect(getSetupGuideBrowserMilestoneAwareProgress(original, false)).toBe(original)
  })
})

describe('getSetupGuideProgressReady', () => {
  const readyInput = {
    refreshEnabled: true,
    settingsLoaded: true,
    preflightStatusChecked: true,
    linearStatusChecked: true,
    jiraStatusChecked: true,
    setupScriptProbeReady: true,
    nashSignalsChecked: true
  }

  it('is ready once every probe has answered', () => {
    expect(getSetupGuideProgressReady(readyInput)).toBe(true)
  })

  it('waits for the NASH signals (Claude Code, Clef, dot, Workbench runs)', () => {
    expect(getSetupGuideProgressReady({ ...readyInput, nashSignalsChecked: false })).toBe(false)
  })

  it('waits for preflight, Linear, and Jira checks', () => {
    expect(getSetupGuideProgressReady({ ...readyInput, preflightStatusChecked: false })).toBe(false)
    expect(getSetupGuideProgressReady({ ...readyInput, linearStatusChecked: false })).toBe(false)
    expect(getSetupGuideProgressReady({ ...readyInput, jiraStatusChecked: false })).toBe(false)
  })
})

describe('setup script probe readiness', () => {
  it('derives the probe signature from runtime and ordered git repo inputs', () => {
    const localSignature = getSetupScriptProbeSignature({ activeRuntimeEnvironmentId: null }, [
      { id: 'repo-a', hookSettings: undefined },
      { id: 'repo-b', hookSettings: undefined }
    ])
    const remoteSignature = getSetupScriptProbeSignature(
      { activeRuntimeEnvironmentId: 'runtime-1' },
      [
        { id: 'repo-a', hookSettings: undefined },
        { id: 'repo-b', hookSettings: undefined }
      ]
    )
    const reorderedSignature = getSetupScriptProbeSignature({ activeRuntimeEnvironmentId: null }, [
      { id: 'repo-b', hookSettings: undefined },
      { id: 'repo-a', hookSettings: undefined }
    ])

    expect(localSignature).not.toBeNull()
    expect(remoteSignature).not.toBe(localSignature)
    expect(reorderedSignature).not.toBe(localSignature)
  })

  it('resets readiness on setup-script generation changes and ignores late older results', () => {
    const firstSignature = 'runtime:local|repo-a'
    const secondSignature = 'runtime:local|repo-b'
    const firstReady = settleSetupScriptProbe(
      markSetupScriptProbePending(
        { signature: null, ready: false, hasSetupScript: false },
        firstSignature
      ),
      firstSignature,
      true
    )

    expect(firstReady).toEqual({
      signature: firstSignature,
      ready: true,
      hasSetupScript: true
    })

    const secondPending = markSetupScriptProbePending(firstReady, secondSignature)
    expect(secondPending).toEqual({
      signature: secondSignature,
      ready: false,
      hasSetupScript: false
    })
    expect(getCurrentSetupScriptProbeState(firstReady, secondSignature)).toEqual(secondPending)
    expect(settleSetupScriptProbe(secondPending, firstSignature, true)).toBe(secondPending)
  })

  it('settles setup-script failures as ready with no setup script', () => {
    const signature = 'runtime:local|repo-a'
    const pending = markSetupScriptProbePending(
      { signature: null, ready: false, hasSetupScript: false },
      signature
    )

    expect(settleSetupScriptProbe(pending, signature, false)).toEqual({
      signature,
      ready: true,
      hasSetupScript: false
    })
  })

  it('allows late positive setup-script results to update after timeout settlement', () => {
    const signature = 'runtime:local|repo-a'
    const timedOut = {
      signature,
      ready: true,
      hasSetupScript: false
    }

    expect(settleSetupScriptProbe(timedOut, signature, true)).toEqual({
      signature,
      ready: true,
      hasSetupScript: true
    })
  })
})
