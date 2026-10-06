import { createHash } from 'node:crypto'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectArtifactFile } from './artifact-file-inspection'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

function tryLink(target: string, path: string, type: 'file' | 'junction'): boolean {
  try {
    symlinkSync(target, path, type)
    return true
  } catch {
    return false
  }
}

describe('artifact file inspection', () => {
  let base: string
  let root: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'c5-artifact-'))
    root = join(base, 'worktree')
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'report.md'), 'Report body.')
    mkdirSync(join(base, 'outside'))
    writeFileSync(join(base, 'outside', 'secret.txt'), 'outside the root')
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('hashes a regular file under the root and reports its size', async () => {
    expect(await inspectArtifactFile(root, 'out/report.md')).toEqual({
      status: 'ok',
      sha256: sha('Report body.'),
      sizeBytes: 12,
      text: null
    })
  })

  it('returns the text only when asked and only within the text bound', async () => {
    expect(await inspectArtifactFile(root, 'out/report.md', { textMaxBytes: 64 })).toMatchObject({
      status: 'ok',
      text: 'Report body.'
    })
    expect(await inspectArtifactFile(root, 'out/report.md', { textMaxBytes: 4 })).toMatchObject({
      status: 'ok',
      text: null
    })
  })

  it('refuses a path that is absolute, climbs out, or uses another separator', async () => {
    for (const path of [
      '../outside/secret.txt',
      'out/../../x',
      '/etc/passwd',
      'out\\report.md',
      'C:x',
      ''
    ]) {
      expect(await inspectArtifactFile(root, path)).toEqual({ status: 'path_refused' })
    }
  })

  it('reports a missing file, a directory, and a path through a file', async () => {
    expect(await inspectArtifactFile(root, 'out/missing.md')).toEqual({ status: 'missing' })
    expect(await inspectArtifactFile(root, 'out')).toEqual({ status: 'not_a_file' })
    expect(await inspectArtifactFile(root, 'out/report.md/inner')).toEqual({ status: 'missing' })
  })

  it('refuses a junction or directory link on the path, even when the target exists', async (context) => {
    if (!tryLink(join(base, 'outside'), join(root, 'linked'), 'junction')) {
      context.skip('This host cannot create a junction or directory link.')
    }
    expect(await inspectArtifactFile(root, 'linked/secret.txt')).toEqual({ status: 'symlink' })
  })

  it('refuses a file symlink where links can be made', async (context) => {
    if (!tryLink(join(base, 'outside', 'secret.txt'), join(root, 'out', 'link.txt'), 'file')) {
      context.skip('This host cannot create a file symlink.')
    }
    expect(await inspectArtifactFile(root, 'out/link.txt')).toEqual({ status: 'symlink' })
  })

  it('refuses a file with another hard link, which may name a file outside the root', async () => {
    linkSync(join(base, 'outside', 'secret.txt'), join(root, 'out', 'hard.txt'))
    expect(await inspectArtifactFile(root, 'out/hard.txt')).toEqual({ status: 'hard_linked' })
  })

  it('refuses a file whose real path lands outside the root', async () => {
    const realPath = async (path: string): Promise<string> =>
      path.endsWith('report.md') ? join(base, 'outside', 'secret.txt') : path
    expect(await inspectArtifactFile(root, 'out/report.md', { deps: { realPath } })).toEqual({
      status: 'escape'
    })
  })

  it('does not hash a file over the bound', async () => {
    expect(await inspectArtifactFile(root, 'out/report.md', { maxHashBytes: 4 })).toEqual({
      status: 'too_large',
      sizeBytes: 12
    })
  })

  it('refuses a root that is not an absolute local path', async () => {
    expect(await inspectArtifactFile('relative/root', 'out/report.md')).toEqual({
      status: 'unreadable',
      code: 'ROOT_NOT_ABSOLUTE'
    })
  })
})
