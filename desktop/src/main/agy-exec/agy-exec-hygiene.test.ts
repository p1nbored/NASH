import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The runners must load in a plain Node host and start children only through the shared pipeline.
const FOLDERS = [__dirname, join(__dirname, '..', 'agent-exec-shared')]

function sourceFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter(
      (name) =>
        name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.test-fixture.ts')
    )
    .map((name) => join(folder, name))
}

describe('agent runner source hygiene', () => {
  it('has source files to scan in both folders', () => {
    for (const folder of FOLDERS) {
      expect(sourceFiles(folder).length).toBeGreaterThan(0)
    }
  })

  it.each(FOLDERS.map((folder) => [folder]))(
    'imports neither electron nor child_process in %s',
    (folder) => {
      for (const file of sourceFiles(folder)) {
        const text = readFileSync(file, 'utf8')
        expect(text, file).not.toMatch(/from\s+['"]electron['"]/)
        expect(text, file).not.toMatch(/from\s+['"](?:node:)?child_process['"]/)
      }
    }
  )

  it('keeps the shared folder independent of both runners', () => {
    for (const file of sourceFiles(join(__dirname, '..', 'agent-exec-shared'))) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/from\s+['"]\.\.\/(?:codex-exec|agy-exec)\//)
    }
  })

  it('keeps the agy runner independent of the codex runner', () => {
    for (const file of sourceFiles(__dirname)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from\s+['"]\.\.\/codex-exec\//)
    }
  })

  it('has no agy source that reads a credential file or the network', () => {
    for (const file of sourceFiles(__dirname)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\.gemini|antigravity-cli|auth\.json|settings\.json/)
      expect(text, file).not.toMatch(
        /from\s+['"](?:node:)?(?:http|https|net|dns|tls)['"]|\bfetch\(/
      )
    }
  })
})
