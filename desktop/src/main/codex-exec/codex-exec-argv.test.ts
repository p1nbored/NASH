import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CodexExecArgvError,
  buildCodexExecArgv,
  isCodexExecEffort,
  isCodexExecModelSlug,
  type CodexExecArgvInput
} from './codex-exec-argv'

let root = ''
let worktree = ''
let lastMessagePath = ''
let schemaPath = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-exec-argv-'))
  worktree = join(root, 'worktree')
  mkdirSync(worktree)
  lastMessagePath = join(root, 'run', 'last-message.txt')
  schemaPath = join(root, 'run', 'result.schema.json')
  writeFileSync(join(root, 'a-file.txt'), 'not a directory')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function input(overrides: Partial<CodexExecArgvInput> = {}): CodexExecArgvInput {
  return {
    model: 'gpt-6-astra',
    effort: 'high',
    sandbox: 'read-only',
    worktreePath: worktree,
    lastMessagePath,
    ...overrides
  }
}

function errorCodeOf(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    return error instanceof CodexExecArgvError ? error.code : `other:${String(error)}`
  }
  return null
}

describe('buildCodexExecArgv', () => {
  it('emits the documented argv, prompt from stdin, in documented order', () => {
    expect(buildCodexExecArgv(input())).toEqual([
      'exec',
      '--json',
      '--model',
      'gpt-6-astra',
      '-c',
      'model_reasoning_effort="high"',
      '--sandbox',
      'read-only',
      '--cd',
      worktree,
      '--ignore-user-config',
      '--ignore-rules',
      '--output-last-message',
      lastMessagePath,
      '-'
    ])
  })

  it('adds the output schema and ephemeral flags before the stdin marker', () => {
    const argv = buildCodexExecArgv(
      input({ sandbox: 'workspace-write', outputSchemaPath: schemaPath, ephemeral: true })
    )
    expect(argv.slice(-4)).toEqual(['--output-schema', schemaPath, '--ephemeral', '-'])
    expect(argv.at(-1)).toBe('-')
    expect(argv).toContain('--ephemeral')
    expect(argv[argv.indexOf('--sandbox') + 1]).toBe('workspace-write')
    expect(argv[argv.indexOf('--output-schema') + 1]).toBe(schemaPath)
  })

  it('omits optional flags when they are not requested', () => {
    const argv = buildCodexExecArgv(input({ ephemeral: false }))
    expect(argv).not.toContain('--ephemeral')
    expect(argv).not.toContain('--output-schema')
    expect(argv).not.toContain('--skip-git-repo-check')
  })

  it('skips the git-repository check only when asked, for a folder workspace (D-027)', () => {
    const argv = buildCodexExecArgv(input({ ephemeral: true, skipGitRepoCheck: true }))
    expect(argv.slice(-3)).toEqual(['--ephemeral', '--skip-git-repo-check', '-'])
    expect(buildCodexExecArgv(input({ skipGitRepoCheck: false }))).not.toContain(
      '--skip-git-repo-check'
    )
  })

  it('omits --sandbox when none is given, so codex exec uses its own default (D-027 restriction 30)', () => {
    const argv = buildCodexExecArgv(input({ sandbox: undefined }))
    expect(argv).not.toContain('--sandbox')
    expect(argv.slice(0, 6)).toEqual([
      'exec',
      '--json',
      '--model',
      'gpt-6-astra',
      '-c',
      'model_reasoning_effort="high"'
    ])
    expect(argv[6]).toBe('--cd')
  })

  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])(
    'accepts effort %s as a TOML string (D-027: the model listing decides)',
    (effort) => {
      const argv = buildCodexExecArgv(input({ effort }))
      expect(argv[argv.indexOf('-c') + 1]).toBe(`model_reasoning_effort="${effort}"`)
    }
  )

  it.each(['extreme', '', 'High', 'MAX', ' high', 'high" -c x="1', 'medium\n'])(
    'rejects effort %j',
    (effort) => {
      expect(errorCodeOf(() => buildCodexExecArgv(input({ effort })))).toBe('invalid_effort')
    }
  )

  it.each(['danger-full-access', 'full-access', 'read_only', 'workspace_write', 'READ-ONLY', ''])(
    'rejects sandbox %j',
    (sandbox) => {
      expect(errorCodeOf(() => buildCodexExecArgv(input({ sandbox })))).toBe('invalid_sandbox')
    }
  )

  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.5', 'gpt-5.2-codex', 'o3'])(
    'accepts model slug %s',
    (model) => {
      expect(isCodexExecModelSlug(model)).toBe(true)
      expect(buildCodexExecArgv(input({ model }))[3]).toBe(model)
    }
  )

  it.each([
    '',
    ' gpt-6',
    'gpt-6 ',
    '-m',
    '--full-auto',
    'GPT-6',
    'gpt 6',
    'gpt-6/../x',
    'gpt--6',
    'gpt-',
    '6-gpt',
    'a'.repeat(65),
    'gpt-6\u0000',
    'gpt-6"'
  ])('rejects model slug %j', (model) => {
    expect(isCodexExecModelSlug(model)).toBe(false)
    expect(errorCodeOf(() => buildCodexExecArgv(input({ model })))).toBe('invalid_model_slug')
  })

  it('requires an absolute, existing worktree directory', () => {
    expect(errorCodeOf(() => buildCodexExecArgv(input({ worktreePath: 'worktree' })))).toBe(
      'invalid_worktree'
    )
    expect(errorCodeOf(() => buildCodexExecArgv(input({ worktreePath: '' })))).toBe(
      'invalid_worktree'
    )
    expect(
      errorCodeOf(() => buildCodexExecArgv(input({ worktreePath: join(root, 'missing') })))
    ).toBe('invalid_worktree')
    expect(
      errorCodeOf(() => buildCodexExecArgv(input({ worktreePath: join(root, 'a-file.txt') })))
    ).toBe('invalid_worktree')
    expect(
      errorCodeOf(() => buildCodexExecArgv(input({ worktreePath: `${worktree}\u0000x` })))
    ).toBe('invalid_worktree')
  })

  it.each(['\\\\server\\share\\wt', '//server/share/wt', '\\\\?\\C:\\wt', '\\\\.\\C:\\wt'])(
    'refuses the UNC or device worktree %s without touching the network',
    (worktreePath) => {
      expect(errorCodeOf(() => buildCodexExecArgv(input({ worktreePath })))).toBe(
        'invalid_worktree'
      )
    }
  )

  it('reports a non-string field as a typed error instead of throwing a TypeError', () => {
    const hostile = (overrides: Record<string, unknown>) => ({ ...input(), ...overrides })
    expect(errorCodeOf(() => buildCodexExecArgv(hostile({ model: 5 })))).toBe('invalid_model_slug')
    expect(errorCodeOf(() => buildCodexExecArgv(hostile({ effort: null })))).toBe('invalid_effort')
    expect(errorCodeOf(() => buildCodexExecArgv(hostile({ sandbox: {} })))).toBe('invalid_sandbox')
    expect(errorCodeOf(() => buildCodexExecArgv(hostile({ worktreePath: 7 })))).toBe(
      'invalid_worktree'
    )
    expect(errorCodeOf(() => buildCodexExecArgv(hostile({ lastMessagePath: [] })))).toBe(
      'invalid_path'
    )
  })

  it('adds --ephemeral only for a real boolean true', () => {
    const hostile = (ephemeral: unknown) => Object.assign(input(), { ephemeral })
    expect(buildCodexExecArgv(hostile(true))).toContain('--ephemeral')
    for (const value of ['false', 'true', 1, {}, null, undefined, false]) {
      expect(buildCodexExecArgv(hostile(value))).not.toContain('--ephemeral')
    }
  })

  it('requires absolute output paths', () => {
    expect(errorCodeOf(() => buildCodexExecArgv(input({ lastMessagePath: 'last.txt' })))).toBe(
      'invalid_path'
    )
    expect(
      errorCodeOf(() => buildCodexExecArgv(input({ outputSchemaPath: 'result.schema.json' })))
    ).toBe('invalid_path')
  })
})

describe('isCodexExecEffort', () => {
  it('narrows only the supported efforts', () => {
    expect(isCodexExecEffort('max')).toBe(true)
    expect(isCodexExecEffort('ultra')).toBe(true)
    expect(isCodexExecEffort('none')).toBe(true)
    expect(isCodexExecEffort('minimal')).toBe(true)
    expect(isCodexExecEffort('extreme')).toBe(false)
  })
})
