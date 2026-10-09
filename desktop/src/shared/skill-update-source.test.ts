import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateGlobalSkillUpdateSources } from './skill-update-source'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture(stateHome = false) {
  const homeDir = mkdtempSync(join(tmpdir(), 'nash-skill-source-'))
  roots.push(homeDir)
  const directory = join(homeDir, stateHome ? 'skills' : '.agents')
  mkdirSync(directory)
  const path = join(directory, '.skill-lock.json')
  const entry = {
    source: 'stablyai/orca',
    sourceType: 'github',
    sourceUrl: 'https://github.com/stablyai/orca.git',
    skillPath: 'skills/orchestration/SKILL.md',
    skillFolderHash: 'b0cd1d58b0c317cf7c3726fef7e6b1197c405246',
    installedAt: '2026-10-09T05:30:00.068Z'
  }
  const lock = {
    version: 3,
    skills: { orchestration: entry, untouched: entry },
    dismissed: { findSkillsPrompt: true }
  }
  writeFileSync(path, JSON.stringify(lock))
  return { path, lock, options: { homeDir, stateHome: stateHome ? homeDir : null } }
}

describe('NASH skill update source migration', () => {
  it('moves only the requested upstream registration and preserves its installed revision', () => {
    const { path, lock, options } = fixture()
    migrateGlobalSkillUpdateSources(['orchestration'], options)
    const result = JSON.parse(readFileSync(path, 'utf8'))
    expect(result.skills.orchestration).toEqual({
      ...lock.skills.orchestration,
      source: 'p1nbored/NASH',
      sourceUrl: 'https://github.com/p1nbored/NASH.git',
      skillPath: 'desktop/skills/orchestration/SKILL.md'
    })
    expect(result.skills.untouched).toEqual(lock.skills.untouched)
    expect(result.dismissed).toEqual(lock.dismissed)
    const migrated = readFileSync(path, 'utf8')
    migrateGlobalSkillUpdateSources(['orchestration'], options)
    expect(readFileSync(path, 'utf8')).toBe(migrated)
  })

  it('uses XDG state storage when configured', () => {
    const { path, options } = fixture(true)
    migrateGlobalSkillUpdateSources(['orchestration'], options)
    expect(JSON.parse(readFileSync(path, 'utf8')).skills.orchestration.source).toBe('p1nbored/NASH')
  })

  it.each([
    { ref: 'custom-branch' },
    { source: 'someone/custom' },
    { skillPath: 'custom/orchestration/SKILL.md' },
    { sourceType: 'local' }
  ])('preserves user-selected sources: %j', (override) => {
    const { path, lock, options } = fixture()
    Object.assign(lock.skills.orchestration, override)
    const original = JSON.stringify(lock)
    writeFileSync(path, original)
    migrateGlobalSkillUpdateSources(['orchestration'], options)
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('does not create a missing lock or overwrite an unsupported schema', () => {
    const { path, options } = fixture()
    writeFileSync(path, '{"version":2,"skills":{}}')
    migrateGlobalSkillUpdateSources(['orchestration'], options)
    expect(readFileSync(path, 'utf8')).toBe('{"version":2,"skills":{}}')
    rmSync(path)
    expect(() => migrateGlobalSkillUpdateSources(['orchestration'], options)).not.toThrow()
  })
})
