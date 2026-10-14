import { describe, expect, it } from 'vitest'
import { WorktreeCreate } from '../../../../shared/rpc-contract/worktree-create-params'
import { buildManagedWorktreeCreateArgs } from './worktree-create-args'

describe('worktree setup choice', () => {
  it.each([false, true])('preserves the submitted choice across RPC (%s)', (setupOnly) => {
    const params = WorktreeCreate.parse({ repo: 'repo-1', name: 'choice', setupOnly })
    expect(buildManagedWorktreeCreateArgs(params, {})).toMatchObject({ setupOnly })
  })
})
