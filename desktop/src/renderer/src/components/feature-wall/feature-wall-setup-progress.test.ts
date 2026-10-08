import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FeatureWallSetupProgressInput } from './feature-wall-setup-progress'
import { getFeatureWallSetupProgress } from './feature-wall-setup-progress'
import {
  getFeatureWallSetupSteps,
  getFeatureWallSetupStepsForSection,
  getFirstIncompleteFeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { Worktree } from '../../../../shared/worktree/types'

function makeInput(
  overrides: Partial<FeatureWallSetupProgressInput> = {}
): FeatureWallSetupProgressInput {
  return {
    settings: null,
    hasConnectedTaskSource: false,
    worktreesByRepo: {},
    hasSetupScript: false,
    claudeCodeDetected: false,
    clefConnected: false,
    dotConnected: false,
    hasWorkbenchRun: false,
    ...overrides
  }
}

function makeWorktree(
  id: string,
  options: { createdAt?: number; isMainWorktree?: boolean; path?: string | null } = {}
): Worktree {
  return {
    id,
    path: options.path === null ? undefined : (options.path ?? `/repo/${id}`),
    createdAt: options.createdAt,
    isMainWorktree: options.isMainWorktree ?? false
  } as unknown as Worktree
}

describe('getFeatureWallSetupProgress', () => {
  it('completes each NASH step from its own signal (D-038)', () => {
    expect(getFeatureWallSetupProgress(makeInput()).stepDone).toMatchObject({
      'claude-code': false,
      clef: false,
      dot: false,
      'workbench-run': false
    })

    const progress = getFeatureWallSetupProgress(
      makeInput({
        claudeCodeDetected: true,
        clefConnected: true,
        dotConnected: true,
        hasWorkbenchRun: true
      })
    )

    expect(progress.stepDone).toMatchObject({
      'claude-code': true,
      clef: true,
      dot: true,
      'workbench-run': true
    })
    expect(progress.coreTotal).toBe(8)
  })

  it('drops the Orca steps that do not fit NASH', () => {
    const ids = getFeatureWallSetupSteps().map((step) => step.id)
    for (const retired of ['default-agent', 'agent-capabilities', 'add-two-repos', 'browser']) {
      expect(ids).not.toContain(retired)
    }
  })

  it('preserves the durable setup step definition order', () => {
    expect(getFeatureWallSetupSteps().map((step) => step.id)).toEqual([
      'claude-code',
      'clef',
      'dot',
      'task-sources',
      'notifications',
      'setup-script',
      'workbench-run',
      'two-worktrees'
    ])
  })

  it('groups setup guide steps into Parallel work and Setup sections', () => {
    expect(getFeatureWallSetupStepsForSection('parallel-work').map((step) => step.id)).toEqual([
      'workbench-run',
      'two-worktrees'
    ])
    expect(getFeatureWallSetupStepsForSection('setup').map((step) => step.id)).toEqual([
      'claude-code',
      'clef',
      'dot',
      'task-sources',
      'notifications',
      'setup-script'
    ])
  })

  it('renders Setup before Milestones and numbers Milestones after Setup', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/feature-wall/FeatureWallSetupChecklist.tsx'),
      'utf8'
    )
    const setupSectionIndex = source.indexOf('steps={setupSteps}')
    const milestonesSectionIndex = source.indexOf('steps={parallelWorkSteps}')

    expect(setupSectionIndex).toBeGreaterThanOrEqual(0)
    expect(milestonesSectionIndex).toBeGreaterThan(setupSectionIndex)
    expect(source).toContain('startOrdinal={setupSteps.length + 1}')
  })

  it('auto-selects incomplete parallel work after setup steps are complete', () => {
    const progress = getFeatureWallSetupProgress(
      makeInput({
        settings: {
          notifications: { enabled: true, agentTaskComplete: true }
        } as never,
        hasConnectedTaskSource: true,
        hasSetupScript: true,
        claudeCodeDetected: true,
        clefConnected: true,
        dotConnected: true
      })
    )

    expect(getFirstIncompleteFeatureWallSetupStepId(progress.stepDone)).toBe('workbench-run')
  })

  it('does not include the removed split-terminal step in active progress', () => {
    const progress = getFeatureWallSetupProgress(makeInput())

    expect(Object.hasOwn(progress.stepDone, 'split-terminal')).toBe(false)
    expect(progress.coreTotal).toBe(8)
  })

  it('marks all active steps complete without historical terminal split interaction', () => {
    const progress = getFeatureWallSetupProgress(
      makeInput({
        settings: {
          notifications: { enabled: true, agentTaskComplete: true }
        } as never,
        worktreesByRepo: {
          'repo-1': [makeWorktree('main', { isMainWorktree: true }), makeWorktree('worktree-1')]
        },
        hasConnectedTaskSource: true,
        hasSetupScript: true,
        claudeCodeDetected: true,
        clefConnected: true,
        dotConnected: true,
        hasWorkbenchRun: true
      })
    )

    expect(progress.coreDoneCount).toBe(8)
    expect(Object.values(progress.stepDone).every(Boolean)).toBe(true)
  })

  it('does not mark the step complete from the main checkout alone', () => {
    expect(
      getFeatureWallSetupProgress(
        makeInput({
          worktreesByRepo: { 'repo-1': [makeWorktree('main', { isMainWorktree: true })] }
        })
      ).stepDone['two-worktrees']
    ).toBe(false)
  })

  it('does not pre-complete the step when two repos contribute only main checkouts', () => {
    const progress = getFeatureWallSetupProgress(
      makeInput({
        worktreesByRepo: {
          'repo-1': [makeWorktree('main-1', { isMainWorktree: true })],
          'repo-2': [makeWorktree('main-2', { isMainWorktree: true })]
        }
      })
    )

    expect(progress.stepDone['two-worktrees']).toBe(false)
  })

  it('does not mark the step complete from an unconfirmed non-main worktree placeholder', () => {
    const progress = getFeatureWallSetupProgress(
      makeInput({
        worktreesByRepo: {
          'repo-1': [
            makeWorktree('main', { isMainWorktree: true }),
            makeWorktree('ssh-restored-placeholder', { path: null })
          ]
        }
      })
    )

    expect(progress.stepDone['two-worktrees']).toBe(false)
  })

  it('marks the step complete once a non-main worktree exists beyond the main checkout', () => {
    const progress = getFeatureWallSetupProgress(
      makeInput({
        worktreesByRepo: {
          'repo-1': [makeWorktree('main', { isMainWorktree: true }), makeWorktree('worktree-1')]
        }
      })
    )

    expect(progress.stepDone['two-worktrees']).toBe(true)
  })

  it('marks task sources complete for any supported connected provider', () => {
    const progress = getFeatureWallSetupProgress(makeInput({ hasConnectedTaskSource: true }))

    expect(progress.stepDone['task-sources']).toBe(true)
  })

  it('does not mark task sources complete while provider checks are pending', () => {
    const progress = getFeatureWallSetupProgress(makeInput({ hasConnectedTaskSource: false }))

    expect(progress.stepDone['task-sources']).toBe(false)
  })
})
