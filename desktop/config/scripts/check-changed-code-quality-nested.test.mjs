import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runProcessSync } from '../../src/shared/child-process/run-process'
import { collectAddedLineRanges, collectBaseLineBlocks } from './check-changed-code-quality.mjs'

let root
let desktop
function git(args) {
  const result = runProcessSync({ program: 'git', args, cwd: root })
  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
  return result.stdout.trim()
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'nash-quality-nested-'))
  desktop = path.join(root, 'desktop')
  mkdirSync(path.join(desktop, 'src'), { recursive: true })
  writeFileSync(path.join(desktop, 'src/value.ts'), 'export const value = 1\n')
  git(['init'])
  git(['add', '.'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    '-c',
    `core.hooksPath=${path.join(root, '.git/hooks')}`,
    'commit',
    '-m',
    'baseline'
  ])
  writeFileSync(path.join(desktop, 'src/value.ts'), 'export const value = 2\n')
})
afterEach(() => {
  if (!path.resolve(root).startsWith(path.join(tmpdir(), 'nash-quality-nested-'))) {
    throw new Error('unexpected fixture path')
  }
  rmSync(root, { recursive: true, force: true })
})
it('checks tracked changes relative to a nested package', () => {
  const { rangesByFile } = collectAddedLineRanges(desktop, 'HEAD')
  expect([...rangesByFile.keys()]).toEqual(['src/value.ts'])
  expect(rangesByFile.get('src/value.ts')).toEqual([{ start: 1, end: 1 }])
})
it('reads nested base files so moved legacy lines remain distinguishable from new code', () => {
  expect(collectBaseLineBlocks(desktop, 'HEAD', ['src/value.ts'])).toEqual([
    ['export const value = 1']
  ])
})
