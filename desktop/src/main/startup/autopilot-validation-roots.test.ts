import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { createValidationRoots } from './autopilot-validation-roots'

const USER_DATA = join('C:', 'fixture', 'userData')

function roots(requireWorkspace = vi.fn(() => ({ path: join('C:', 'fixture', 'workspace') }))) {
  return {
    requireWorkspace,
    port: createValidationRoots({ requireWorkspace, userDataPath: USER_DATA })
  }
}

describe('createValidationRoots', () => {
  it('resolves a local folder workspace as a folder and a worktree as git', async () => {
    const { port } = roots()
    expect(await port.resolveWorkspace('folder:fixture')).toEqual({
      path: join('C:', 'fixture', 'workspace'),
      kind: 'folder'
    })
    expect((await port.resolveWorkspace('repo-fixture::C:/fixture/workspace'))?.kind).toBe('git')
  })

  it('resolves a workspace the catalog refuses to null', async () => {
    const { port } = roots(
      vi.fn(() => {
        throw new OrchestrationError('workbench_workspace_unavailable', 'Fixture: gone.')
      })
    )
    expect(await port.resolveWorkspace('folder:gone')).toBeNull()
  })

  it('resolves the floating terminal workspace to null without asking the catalog', async () => {
    const { port, requireWorkspace } = roots()
    expect(await port.resolveWorkspace(FLOATING_TERMINAL_WORKTREE_ID)).toBeNull()
    expect(requireWorkspace).not.toHaveBeenCalled()
  })

  it('resolves only attempt folders strictly under the app runs folder', () => {
    const { port } = roots()
    expect(port.resolveRunDirectory('autopilot-runs/run_1/ctx_1')).toBe(
      join(USER_DATA, 'autopilot-runs', 'run_1', 'ctx_1')
    )
    expect(port.resolveRunDirectory('autopilot-runs')).toBeNull()
    expect(port.resolveRunDirectory('autopilot-runs/../settings')).toBeNull()
    expect(port.resolveRunDirectory('../outside/autopilot-runs/run_1')).toBeNull()
    expect(port.resolveRunDirectory('autopilot-reviews/run_1')).toBeNull()
  })
})
