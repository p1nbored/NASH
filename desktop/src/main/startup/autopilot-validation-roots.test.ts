import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { createValidationRoots } from './autopilot-validation-roots'

function roots(requireWorkspace = vi.fn(() => ({ path: join('C:', 'fixture', 'workspace') }))) {
  return {
    requireWorkspace,
    port: createValidationRoots({ requireWorkspace })
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
})
