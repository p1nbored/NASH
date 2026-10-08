import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Availability only observes: it spawns nothing, opens no network, never names a flag the runners
// forbid, and reuses Orca's own readings and the one model policy instead of copying them.
const TABLE_DIR = join(import.meta.dirname, '..')
const TEST_PATH = /(?:\.test\.ts$|\.test-fixture\.ts$)/
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /(^|\s)\/\/[^\n]*/g

function productionFiles(): string[] {
  const availability = readdirSync(import.meta.dirname).map((name) => `availability/${name}`)
  return [...availability, 'route-resolver.ts', 'routing-table-runtime.ts'].filter(
    (path) => path.endsWith('.ts') && !TEST_PATH.test(path)
  )
}

function codeOf(path: string): string {
  return readFileSync(join(TABLE_DIR, path), 'utf8')
    .replace(BLOCK_COMMENT, '')
    .replace(LINE_COMMENT, '$1')
}

describe('route availability source hygiene', () => {
  const files = productionFiles()

  it('scans the modules this package owns', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'availability/route-availability-evaluator.ts',
        'availability/claude-route-checks.ts',
        'availability/codex-route-checks.ts',
        'availability/agy-route-checks.ts',
        'availability/route-effort-mapping.ts',
        'availability/route-availability-store.ts',
        'route-resolver.ts',
        'routing-table-runtime.ts'
      ])
    )
  })

  it('does not import Electron, spawn a process or open the network', () => {
    const offenders = files.filter((path) =>
      /from\s+['"](?:electron|node:child_process|node:http|node:https|node:net|child_process)['"]|\bfetch\s*\(|\bapp\.getPath\b|(?<![.\w])(?:spawn|exec|execFile|execSync|execFileSync)\s*\(/.test(
        codeOf(path)
      )
    )
    expect(offenders).toEqual([])
  })

  it('never spells a runner flag: the runners own their argv', () => {
    const offenders = files.filter((path) => /skip-git-repo-check|--dangerously/.test(codeOf(path)))
    expect(offenders).toEqual([])
  })

  it('does not hardcode provider families in availability checks', () => {
    const copies = files.filter((path) => /gemini|argon/i.test(codeOf(path)))
    expect(copies).toEqual([])
  })

  it('defines the headroom and the bounded refresh once, in their own availability modules', () => {
    const definers = (definition: RegExp) => files.filter((path) => definition.test(codeOf(path)))
    expect(definers(/function\s+providerHeadroomFrom\b/)).toEqual([
      'availability/route-provider-headroom.ts'
    ])
    expect(definers(/function\s+createBoundedRateLimitRead\b/)).toEqual([
      'availability/route-rate-limit-refresh.ts'
    ])
    const code = files.map((path) => codeOf(path)).join('\n')
    expect(code).toMatch(/from '\.\/route-provider-headroom'/)
    expect(code).toMatch(/from '\.\/route-rate-limit-refresh'/)
    expect(code).not.toMatch(/runtime\/workbench-routing\/route-/)
    // Why: Orca's rate-limit service owns the staleness rule; headroom imports it, never copies it.
    expect(code).not.toMatch(/const\s+STALE_THRESHOLD_MS\b/)
  })

  it('never reads benchmark evidence or notes', () => {
    const readers = files.filter((path) =>
      /benchmark_(?:sources|snapshot_date)|\.notes\b/.test(codeOf(path))
    )
    expect(readers).toEqual([])
  })
})
