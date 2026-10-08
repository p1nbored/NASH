import { describe, expect, it } from 'vitest'
import {
  FEATURE_WALL_SETUP_STEPS,
  type FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import { getSettingsSetupGuideProgress } from './settings-setup-guide-progress'

describe('settings setup guide progress', () => {
  function makePreBrowserDoneStepState(): Partial<Record<FeatureWallSetupStepId, boolean>> {
    return Object.fromEntries<boolean>(
      FEATURE_WALL_SETUP_STEPS.map((step) => [step.id, step.id !== 'workbench-run'])
    )
  }

  it('tracks the full setup checklist total', () => {
    const progress = getSettingsSetupGuideProgress({
      ready: true,
      stepDone: {}
    })

    expect(progress).toEqual({
      ready: true,
      doneCount: 0,
      total: FEATURE_WALL_SETUP_STEPS.length,
      firstIncompleteStepId: 'claude-code'
    })
  })

  it('does not mark Settings complete when only the old setup subset is done', () => {
    const stepDone = {
      'two-worktrees': true,
      notifications: true,
      'claude-code': true,
      'task-sources': true
    } satisfies Partial<Record<FeatureWallSetupStepId, boolean>>

    expect(getSettingsSetupGuideProgress({ ready: true, stepDone })).toEqual({
      ready: true,
      doneCount: 4,
      total: FEATURE_WALL_SETUP_STEPS.length,
      firstIncompleteStepId: 'clef'
    })
  })

  it('does not mark Settings complete for fresh users when only the first run is incomplete', () => {
    expect(
      getSettingsSetupGuideProgress({
        ready: true,
        stepDone: makePreBrowserDoneStepState()
      })
    ).toEqual({
      ready: true,
      doneCount: FEATURE_WALL_SETUP_STEPS.length - 1,
      total: FEATURE_WALL_SETUP_STEPS.length,
      firstIncompleteStepId: 'workbench-run'
    })
  })

  it('marks Settings complete when every setup guide step is done', () => {
    const stepDone = Object.fromEntries(
      FEATURE_WALL_SETUP_STEPS.map((step) => [step.id, true])
    ) as Record<FeatureWallSetupStepId, boolean>

    expect(getSettingsSetupGuideProgress({ ready: true, stepDone })).toEqual({
      ready: true,
      doneCount: FEATURE_WALL_SETUP_STEPS.length,
      total: FEATURE_WALL_SETUP_STEPS.length,
      firstIncompleteStepId: null
    })
  })

  it('preserves progress readiness for the sidebar row gate', () => {
    const progress = getSettingsSetupGuideProgress({
      ready: false,
      stepDone: {
        'two-worktrees': true
      }
    })

    expect(progress.ready).toBe(false)
    expect(progress.doneCount).toBe(1)
  })
})
