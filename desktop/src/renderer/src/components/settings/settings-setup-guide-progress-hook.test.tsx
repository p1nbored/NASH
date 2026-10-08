import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureWallSetupProgress } from '../feature-wall/feature-wall-setup-progress'
import { useSettingsSetupGuideProgress } from './settings-setup-guide-progress'

const mocks = vi.hoisted(() => ({
  useSetupGuideProgress: vi.fn()
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: mocks.useSetupGuideProgress
}))

function makeProgress(): FeatureWallSetupProgress {
  return {
    ready: true,
    stepDone: {
      'claude-code': true,
      clef: false,
      dot: false,
      'task-sources': true,
      notifications: true,
      'setup-script': false,
      'workbench-run': false,
      'two-worktrees': true
    },
    coreDoneCount: 4,
    coreTotal: 8
  }
}

function SettingsProgressProbe(): React.JSX.Element {
  const progress = useSettingsSetupGuideProgress(true)
  return <span>{`${progress.doneCount}/${progress.total}`}</span>
}

describe('useSettingsSetupGuideProgress', () => {
  beforeEach(() => {
    mocks.useSetupGuideProgress.mockReset()
  })

  it('uses the same setup progress path as the main sidebar', () => {
    mocks.useSetupGuideProgress.mockReturnValue(makeProgress())

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('4/8')
    expect(mocks.useSetupGuideProgress).toHaveBeenCalledWith(true)
  })

  it('uses completion returned by the shared setup progress path', () => {
    mocks.useSetupGuideProgress.mockReturnValue({
      ...makeProgress(),
      stepDone: {
        'claude-code': true,
        clef: true,
        dot: true,
        'task-sources': true,
        notifications: true,
        'setup-script': true,
        'workbench-run': true,
        'two-worktrees': true
      },
      coreDoneCount: 8
    })

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('8/8')
  })

  it('shows Workbench incomplete until a run exists', () => {
    mocks.useSetupGuideProgress.mockReturnValue({
      ...makeProgress(),
      stepDone: {
        'claude-code': true,
        clef: true,
        dot: true,
        'task-sources': true,
        notifications: true,
        'setup-script': true,
        'workbench-run': false,
        'two-worktrees': true
      },
      coreDoneCount: 7
    })

    expect(renderToStaticMarkup(<SettingsProgressProbe />)).toContain('7/8')
  })
})
