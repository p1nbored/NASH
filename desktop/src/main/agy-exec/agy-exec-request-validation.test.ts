import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateAgyExecRequest } from './agy-exec-request-validation'

let root = ''
let worktree = ''
let runsRoot = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agy-exec-request-'))
  worktree = join(root, 'worktree')
  runsRoot = join(root, 'runs')
  mkdirSync(worktree)
  mkdirSync(runsRoot)
  writeFileSync(join(root, 'a-file.txt'), 'not a directory')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: 'Draft a short changelog entry.',
    model: 'gemini-3.8-flash-high',
    worktreePath: worktree,
    runsRoot,
    runId: 'run-0001',
    sandbox: true,
    ...overrides
  }
}

function detailOf(value: unknown): string {
  const result = validateAgyExecRequest(value, process.platform)
  if (result.ok) {
    throw new Error('expected a refusal')
  }
  expect(result.failure.kind).toBe('invalid_request')
  return result.failure.detail
}

describe('validateAgyExecRequest', () => {
  it('accepts a complete request and derives the argv, the applied record and the run locations', () => {
    const result = validateAgyExecRequest(request({ effort: 'medium' }), process.platform)
    if (!result.ok) {
      throw new Error(result.failure.detail)
    }
    expect(result.value.argv).toEqual([
      '--print=Draft a short changelog entry.',
      '--sandbox',
      '--model',
      'gemini-3.8-flash-high',
      '--effort',
      'medium'
    ])
    expect(result.value.applied).toEqual({ model: 'gemini-3.8-flash-high', effort: 'medium' })
    expect(result.value.location.runDir).toBe(join(runsRoot, 'run-0001'))
    expect(result.value.location.outputPath).toBe(join(runsRoot, 'run-0001', 'output.txt'))
    expect(result.value.location.tempDir).toBe(join(runsRoot, 'run-0001', 'tmp'))
  })

  it('builds the argv without --sandbox when the request asks for none (D-025)', () => {
    const result = validateAgyExecRequest(request({ sandbox: false }), process.platform)
    if (!result.ok) {
      throw new Error(result.failure.detail)
    }
    expect(result.value.argv).toEqual([
      '--print=Draft a short changelog entry.',
      '--model',
      'gemini-3.8-flash-high'
    ])
  })

  it.each([undefined, 'danger-full-access', 'read-only', 1])(
    'refuses a sandbox that is not a boolean (%j)',
    (sandbox) => {
      expect(detailOf(request({ sandbox }))).toContain('sandbox')
    }
  )

  it('records no effort when none was requested (a variant id carries its own)', () => {
    const result = validateAgyExecRequest(request(), process.platform)
    expect(result.ok && result.value.applied).toEqual({
      model: 'gemini-3.8-flash-high',
      effort: null
    })
  })

  it('does not touch the disk: a missing runs root is judged only by its shape', () => {
    const result = validateAgyExecRequest(
      request({ runsRoot: join(root, 'not-created-yet') }),
      process.platform
    )
    expect(result.ok).toBe(true)
  })

  it.each([null, undefined, 5, 'text', [], true])('refuses a request that is %j', (value) => {
    expect(detailOf(value)).toMatch(/object/)
  })

  it.each([
    ['mode', 'accept-edits'],
    ['continue', true],
    ['conversation', 'abc'],
    ['dangerouslySkipPermissions', true],
    ['extraArgs', ['--continue']],
    ['yolo', true]
  ])('refuses the unknown field %s instead of ignoring it', (key, value) => {
    expect(detailOf(request({ [key]: value }))).toContain(key)
  })

  it('bounds the name of an unknown field it echoes, since a request key is untrusted text', () => {
    expect(detailOf(request({ ['x'.repeat(5000)]: 1 })).length).toBeLessThan(200)
  })

  it.each(['prompt', 'model', 'worktreePath', 'runsRoot', 'runId'])(
    'refuses a request with no %s',
    (key) => {
      const { [key]: _removed, ...rest } = request()
      expect(detailOf(rest).length).toBeGreaterThan(0)
    }
  )

  it.each([
    ['model', 7],
    ['model', null],
    ['effort', 9],
    ['modelLabel', {}],
    ['worktreePath', 3],
    ['runsRoot', null],
    ['runId', 12]
  ])('refuses a non-string %s', (key, value) => {
    expect(detailOf(request({ [key]: value })).length).toBeGreaterThan(0)
  })

  it('refuses Gemini 4 by id and by label with the pin policy code', () => {
    expect(detailOf(request({ model: 'gemini-4-flash' }))).toContain('model_excluded')
    expect(detailOf(request({ modelLabel: 'Gemini 4 Pro' }))).toContain('model_excluded')
  })

  it('refuses the default sentinel, an alias and an unlisted effort', () => {
    expect(detailOf(request({ model: 'default' }))).toContain('invalid_model')
    expect(detailOf(request({ model: 'flash' }))).toContain('invalid_model')
    expect(detailOf(request({ effort: 'ultra' }))).toContain('invalid_effort')
  })

  it('refuses a prompt that is empty or has a NUL, and takes a long one (D-027)', () => {
    expect(detailOf(request({ prompt: '  ' }))).toContain('invalid_prompt')
    expect(detailOf(request({ prompt: 'a\u0000b' }))).toContain('invalid_prompt')
    expect(
      validateAgyExecRequest(request({ prompt: 'a'.repeat(20_000) }), process.platform).ok
    ).toBe(true)
  })

  it.each([
    ['a relative worktree', 'relative/dir'],
    ['a worktree starting with a dash', '-rf'],
    ['a file instead of a directory', 'FILE'],
    ['a missing directory', 'MISSING'],
    ['a UNC path', '\\\\server\\share\\wt'],
    ['a NUL path', 'C:\\bad\u0000path']
  ])('refuses %s as the worktree', (_label, value) => {
    const worktreePath =
      value === 'FILE' ? join(root, 'a-file.txt') : value === 'MISSING' ? join(root, 'nope') : value
    expect(detailOf(request({ worktreePath })).length).toBeGreaterThan(0)
  })

  it.each(['', '../x', 'a/b', 'a\\b', '-lead', 'x'.repeat(65), 'CON', 'nul', 'with space'])(
    'refuses the run id %j',
    (runId) => {
      expect(detailOf(request({ runId })).length).toBeGreaterThan(0)
    }
  )

  it('refuses a relative or UNC runs root', () => {
    expect(detailOf(request({ runsRoot: 'runs' }))).toMatch(/runs root/)
    expect(detailOf(request({ runsRoot: '\\\\server\\runs' }))).toMatch(/runs root/)
  })
})
