import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: NASH (D-017) ships these guides in its own CLI, and its runtime owns runs, tasks and
// attempts with the primary session as the only planner (D-016), so the guides teach the
// `nash` command and no longer describe a coordinator loop.
const projectDir = resolve(import.meta.dirname, '../..')
const SOURCE_ROOTS = ['skill-guides', 'skill-stubs']

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      return markdownFiles(full)
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : []
  })
}

const sources = SOURCE_ROOTS.flatMap((root) => markdownFiles(join(projectDir, root))).map(
  (file) => ({
    file: relative(projectDir, file).split('\\').join('/'),
    text: readFileSync(file, 'utf8')
  })
)

// Kept on purpose: the GNOME Orca screen reader the resolver warns about, the
// `caller.orcaSessionId` concept, Orca's cloud account (onorca.dev) and quotes of Orca's docs.
const KEPT_ORCA_PHRASES = [/GNOME Orca/gu, /Orca session ID/gu, /Orca Cloud/gu, /Orca docs/gu]

function offendingLines(pattern, keptPhrases = []) {
  return sources.flatMap(({ file, text }) =>
    text.split(/\r?\n/u).flatMap((line, index) => {
      const checked = keptPhrases.reduce((current, phrase) => current.replace(phrase, ''), line)
      return pattern.test(checked) ? [`${file}:${index + 1}: ${line.trim()}`] : []
    })
  )
}

describe('bundled skill guides name NASH', () => {
  it('reads a nonempty guide and stub corpus', () => {
    expect(sources.length).toBeGreaterThan(30)
  })

  it('teaches the nash command instead of a literal orca invocation', () => {
    // `orca-ide` stays NASH's Linux command name for now; skill names such as `orca-cli` are ids.
    expect(offendingLines(/(?:^|[\s`("'])orca(?:-dev)?[ \t]+[a-z]/u)).toEqual([])
  })

  it('calls the running app NASH outside the kept Orca phrases', () => {
    expect(offendingLines(/\bOrca\b/u, KEPT_ORCA_PHRASES)).toEqual([])
  })

  it('resolves snapshot cleanup to the NASH user-data folder', () => {
    const guide = readFileSync(
      join(projectDir, 'skill-guides', 'orca-per-workspace-env.md'),
      'utf8'
    )

    expect(guide).toContain(
      'nash_user_data_path="${ORCA_USER_DATA_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/nash}"'
    )
  })
})

describe('bundled skill guides follow the single execution authority', () => {
  it('no longer describes a coordinator loop', () => {
    expect(offendingLines(/coordinator[- ]loops?/iu)).toEqual([])
    const references = join(projectDir, 'skill-guides', 'orchestration', 'references')
    expect(existsSync(join(references, 'coordinator-loop.md'))).toBe(false)
    expect(existsSync(join(references, 'supervised-waves.md'))).toBe(true)
  })
})
