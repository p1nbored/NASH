// FIXTURE_ONLY: a static scan of this folder's own sources; nothing is executed.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCES = readdirSync(__dirname)
  .filter((name) => name.endsWith('.ts') && !name.includes('.test'))
  .map((name) => ({ name, text: readFileSync(join(__dirname, name), 'utf8') }))

describe('task execution hygiene', () => {
  it('has sources to scan', () => {
    expect(SOURCES.length).toBeGreaterThan(5)
  })

  it.each(SOURCES)('$name imports no electron and no child_process', ({ text }) => {
    expect(text).not.toMatch(/from ['"](?:electron|node:child_process|child_process)['"]/)
  })

  // D-025: workspace-write is the write mode a write run maps to; full access and bypasses never are.
  it.each(SOURCES)(
    '$name names no full-access sandbox, no bypass and no git-check override',
    ({ text }) => {
      expect(text).not.toMatch(
        /danger-full-access|skip-git-repo-check|--dangerously|--yolo|accept-edits/
      )
    }
  )

  it('maps only the sandbox policy to workspace-write', () => {
    const writers = SOURCES.filter((source) => source.text.includes('workspace-write'))
    expect(writers.map((source) => source.name)).toEqual(['executor-sandbox-policy.ts'])
  })

  it('never spells an agy effort flag', () => {
    const agy = SOURCES.find((source) => source.name === 'agy-task-executor.ts')
    expect(agy?.text).toBeDefined()
    expect(agy?.text).not.toMatch(/effort\s*:/)
  })
})
