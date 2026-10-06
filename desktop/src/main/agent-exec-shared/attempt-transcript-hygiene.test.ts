// FIXTURE_ONLY: a static scan of the dot sources; nothing is executed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// RG6: an attempt transcript stays on this machine, so no dot code may import its writer or open the file.
const SRC = join(__dirname, '..', '..')
const DOT_FOLDERS = [
  'main/runtime/dot-remote',
  'main/runtime/dot-ingress',
  'main/dot-remote',
  'shared/dot-remote',
  'shared/dot-ingress',
  'cli/dot-ingress'
]
const DOT_FILE_PREFIXES: readonly (readonly [string, readonly string[]])[] = [
  ['main/runtime/orchestration/db', ['dot-ingress-']],
  ['main/runtime/rpc/methods', ['dot-ingress', 'workbench-dot-ingress', 'workbench-dot-remote']],
  ['shared/rpc-contract', ['workbench-dot-']]
]
const SOURCE_FILE = /\.(?:ts|mts|mjs|js|json)$/
const FORBIDDEN_IMPORT =
  /from\s+['"][^'"]*(?:attempt-transcript|codex-transcript-records)[^'"]*['"]/
const FORBIDDEN_TEXT =
  /transcript\.jsonl|ATTEMPT_TRANSCRIPT_FILE|attemptTranscriptPath|openAttemptTranscript/

function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) {
      return filesUnder(path)
    }
    return SOURCE_FILE.test(name) ? [path] : []
  })
}

function dotSources(): string[] {
  const inFolders = DOT_FOLDERS.map((folder) => join(SRC, folder))
    .filter((folder) => existsSync(folder))
    .flatMap(filesUnder)
  const byPrefix = DOT_FILE_PREFIXES.flatMap(([folder, prefixes]) =>
    readdirSync(join(SRC, folder))
      .filter(
        (name) => SOURCE_FILE.test(name) && prefixes.some((prefix) => name.startsWith(prefix))
      )
      .map((name) => join(SRC, folder, name))
  )
  return [...inFolders, ...byPrefix]
}

const SOURCES = dotSources().map((path) => ({
  name: relative(SRC, path),
  text: readFileSync(path, 'utf8')
}))

describe('attempt transcript stays out of dot', () => {
  it('finds the dot sources it polices', () => {
    expect(SOURCES.length).toBeGreaterThan(50)
    for (const folder of [
      'main/runtime/dot-remote',
      'shared/dot-remote',
      'main/runtime/dot-ingress'
    ]) {
      expect(SOURCES.some((source) => source.name.startsWith(join(folder)))).toBe(true)
    }
  })

  it('recognizes an import of the writer and a read of the file', () => {
    expect("import { x } from '../../agent-exec-shared/attempt-transcript'").toMatch(
      FORBIDDEN_IMPORT
    )
    expect("import type { y } from '../codex-exec/codex-transcript-records'").toMatch(
      FORBIDDEN_IMPORT
    )
    expect("readFile(join(runDir, 'transcript.jsonl'))").toMatch(FORBIDDEN_TEXT)
  })

  it.each(SOURCES)('$name neither imports the transcript writer nor names the file', ({ text }) => {
    expect(text).not.toMatch(FORBIDDEN_IMPORT)
    expect(text).not.toMatch(FORBIDDEN_TEXT)
  })
})
