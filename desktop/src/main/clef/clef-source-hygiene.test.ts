import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectElectronImporters } from '../../../config/scripts/check-runtime-electron-ratchet.mjs'

// Spec section 15 hygiene: nothing but the transport issues Clef HTTP, no flash variant or other
// model client is reachable, no real-looking account id sits in source, and the runtime stays free
// of Electron. Every check reads the sources themselves, so a new module cannot opt out.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const SRC_ROOT = join(REPO_ROOT, 'src')
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/
// Why: same test-path conventions as the fixture isolation and child-process ratchet tests.
const TEST_PATH =
  /(?:\.(?:test|spec)\.tsx?$|test-harness|test-utils|test-setup|test-fixture|repro|\/__tests__\/|\/__fixtures__\/|\/fixtures\/)/
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g

const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
// Why: the redaction tests probe case-insensitive matching with the documented value reversed.
const FIXTURE_ONLY_VARIANTS = new Set([FIXTURE_ONLY_ACCOUNT_ID, 'fedcba9876543210fedcba9876543210'])
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
// Why the leading whitespace: a URL such as https://host has no space before its slashes.
const LINE_COMMENT = /(^|\s)\/\/[^\n]*/g

const allFiles = readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
  .map((path) => path.split(sep).join('/'))
  .filter((path) => SOURCE_FILE.test(path) && !path.includes('node_modules/'))

const productionFiles = allFiles.filter((path) => !TEST_PATH.test(`/${path}`))

function read(path: string): string {
  return readFileSync(join(SRC_ROOT, path), 'utf8')
}

/** Source without comments, so a doc line that names a symbol is not mistaken for a use of it. */
function codeOf(path: string): string {
  return read(path).replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '$1')
}

function filesContaining(files: readonly string[], pattern: RegExp): string[] {
  return files.filter((path) => pattern.test(codeOf(path))).sort()
}

function specifiersOf(path: string): string[] {
  return [...read(path).matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? '')
}

const SCOPE_PREFIXES = [
  'main/clef/',
  'main/runtime/workbench-routing/',
  'main/runtime/task-classification/',
  'main/startup/workbench-routing-',
  'shared/clef/',
  'shared/routing-table/'
]
const SCOPE_FILES = [
  'main/runtime/workbench-intake-submit.ts',
  'main/runtime/rpc/methods/workbench.ts'
]

/** The modules of the Clef adapter and Workbench routing, which must stay free of other model and HTTP clients. */
const ROUTING_SCOPE = productionFiles.filter(
  (path) => SCOPE_FILES.includes(path) || SCOPE_PREFIXES.some((prefix) => path.startsWith(prefix))
)
const TRANSPORT_FAMILY = /^main\/clef\/clef-transport[a-z-]*\.ts$/

describe('the hygiene scope covers the D-016 modules', () => {
  it('includes the shared Routing Table modules, so they stay free of HTTP clients, secrets and Electron', () => {
    const routingTable = ROUTING_SCOPE.filter((path) => path.startsWith('shared/routing-table/'))
    expect(routingTable).toContain('shared/routing-table/routing-table-schema.ts')
    expect(routingTable).toContain('shared/routing-table/routing-table-taxonomy.ts')
  })

  it('includes the Clef classifier modules and the Workbench routing runtime', () => {
    expect(ROUTING_SCOPE).toContain('main/clef/clef-classification-rules.ts')
    expect(ROUTING_SCOPE).toContain('main/clef/clef-question-set.ts')
    expect(ROUTING_SCOPE).toContain('main/runtime/workbench-routing/clef-verifier.ts')
  })

  // Why: the TaskSpec classifier makes the paid Clef call and reads the Routing Table's resolver.
  it('includes the TaskSpec classification runtime', () => {
    expect(ROUTING_SCOPE).toContain('main/runtime/task-classification/task-classifier.ts')
    expect(ROUTING_SCOPE).toContain('main/runtime/task-classification/classification-exchange.ts')
  })

  it('names only modules that exist, so a deleted path cannot keep a stale exception alive', () => {
    const missingFiles = SCOPE_FILES.filter((path) => !productionFiles.includes(path))
    const emptyPrefixes = SCOPE_PREFIXES.filter(
      (prefix) => !productionFiles.some((path) => path.startsWith(prefix))
    )
    expect([...missingFiles, ...emptyPrefixes]).toEqual([])
  })
})

describe('Clef stays blind to targets, models and efforts', () => {
  // Why: the question bundle hashes only classifier texts, so a table import would let a model name reach Clef.
  it('imports from the Routing Table only its taxonomy', () => {
    const clefModules = productionFiles.filter(
      (path) => path.startsWith('main/clef/') || path.startsWith('shared/clef/')
    )
    const offenders = clefModules.flatMap((path) =>
      specifiersOf(path)
        .filter((specifier) => /routing-table\//.test(specifier))
        .filter((specifier) => !specifier.endsWith('/routing-table-taxonomy'))
        .map((specifier) => `${path}: ${specifier}`)
    )
    expect(offenders).toEqual([])
  })

  it('keeps the retired tuple, profile and route-option modules out of the Clef scope', () => {
    const retired =
      /(?:legal-tuple-catalog|tuple-guards?|route-eligibility|route-decision-policy|route-binding|route-model-pins|route-profile-models|routing-bundle|question-set-route-options)/
    const offenders = ROUTING_SCOPE.filter((path) => retired.test(path))
    expect(offenders).toEqual([])
  })
})

describe('only the transport issues Clef HTTP', () => {
  it('builds the concrete run URL in the transport alone', () => {
    expect(filesContaining(productionFiles, /\bbuildClefRunUrl\b/)).toEqual([
      'main/clef/clef-endpoint.ts',
      'main/clef/clef-transport.ts'
    ])
  })

  it('names the Cloudflare origin in the endpoint module alone', () => {
    expect(filesContaining(productionFiles, /api\.cloudflare\.com/)).toEqual([
      'main/clef/clef-endpoint.ts'
    ])
  })

  it('references the production send function only where it is defined and where startup wires it', () => {
    expect(filesContaining(productionFiles, /\bsendClefRequest\b/)).toEqual([
      'main/clef/clef-transport.ts',
      'main/startup/workbench-routing-clef-administration.ts'
    ])
  })

  it('keeps every HTTP primitive out of the routing scope except the transport family', () => {
    const primitives =
      /\bfetch\s*\(|\bgetMainHttpClient\b|\bXMLHttpRequest\b|\bnet\.(?:request|fetch)\b|\bhttps?\.request\b|\bglobalThis\.fetch\b|from\s+['"](?:undici|axios|got|node-fetch|node:https?|https?)['"]/
    const offenders = filesContaining(
      ROUTING_SCOPE.filter((path) => !TRANSPORT_FAMILY.test(path)),
      primitives
    )
    expect(offenders).toEqual([])
  })
})

describe('the transport reuses Orca response-body helpers', () => {
  // Why: cancelUnreadResponseBody and readFetchResponseBytesWithinLimit already own these paths (D-014).
  it('hand-rolls no response-body cancel in the transport family', () => {
    const handRolledCancel = /\.body\?\.cancel\(|\btarget\?\.cancel\(/
    const family = productionFiles.filter((path) => TRANSPORT_FAMILY.test(path))
    expect(family.length).toBeGreaterThan(0)
    expect(filesContaining(family, handRolledCancel)).toEqual([])
  })
})

describe('no flash variant and no other model client', () => {
  // Why listed: both name the flash variant only in the report's model-name pattern, so a verification
  // that observed it can be shown and then refused (response_model_disallowed); neither sends it.
  it('uses clef-flash in code only to recognize it in a verification report', () => {
    expect(filesContaining(productionFiles, /clef-flash/i)).toEqual([
      'main/clef/clef-verification-report.ts',
      'shared/clef/clef-verification-view.ts'
    ])
  })

  it('never builds a request for any model other than the pinned clef', () => {
    expect(
      filesContaining(productionFiles, /['"`]@cf\/[a-z0-9-]+\/(?!clef['"`])[a-z0-9.-]+/i)
    ).toEqual([])
  })

  it('imports only zod and node built-ins', () => {
    const allowed = new Set(['zod', 'node:crypto', 'node:fs', 'node:path'])
    const offenders = ROUTING_SCOPE.flatMap((path) =>
      specifiersOf(path)
        .filter((specifier) => !specifier.startsWith('.') && !allowed.has(specifier))
        .map((specifier) => `${path}: ${specifier}`)
    )
    expect(offenders).toEqual([])
  })

  it('reaches no other provider client through a relative import', () => {
    const mainAreas = new Set([
      'clef',
      'credentials',
      'network',
      'observability',
      'preflight',
      'runtime',
      'sqlite',
      'startup'
    ])
    // Why exact: these areas also hold unrelated modules (html-to-pdf, provider usage fetchers), so only
    // the import-free helper, Orca's atomic file writer and the Routing Table modules the TaskSpec
    // classifier reads (their own hygiene tests bar HTTP) are admitted.
    const allowedTargets = new Set([
      'main/lib/unread-response-body',
      'main/codex-accounts/fs-utils',
      'main/routing-table/route-resolver',
      'main/routing-table/routing-table-activation',
      'main/routing-table/availability/route-availability-types'
    ])
    const edges = ROUTING_SCOPE.filter((path) => path.startsWith('main/')).flatMap((path) =>
      specifiersOf(path)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => {
          const parts = join(path, '..', specifier).split(sep).join('/').split('/')
          return { path, target: parts.join('/'), area: parts[1] ?? '' }
        })
        .filter((entry) => entry.target.startsWith('main/') && !mainAreas.has(entry.area))
    )
    const offenders = edges
      .filter((entry) => !allowedTargets.has(entry.target))
      .map((entry) => `${entry.path} -> ${entry.target}`)
    expect(offenders).toEqual([])
    // Why: an admission no module still needs would quietly let the next import through.
    const unused = [...allowedTargets].filter(
      (target) => !edges.some((entry) => entry.target === target)
    )
    expect(unused).toEqual([])
  })

  it('loads nothing dynamically in the routing scope', () => {
    expect(filesContaining(ROUTING_SCOPE, /\bimport\s*\(|\brequire\s*\(/)).toEqual([])
  })
})

describe('no real-looking Cloudflare account id in source', () => {
  const HEX_32 = /\b[0-9a-f]{32}\b/gi
  const inScope = allFiles.filter(
    (path) => /clef|workbench/i.test(path) || path.startsWith('main/startup/')
  )

  it('keeps every 32-hex literal out of shipped code', () => {
    const offenders = inScope
      .filter((path) => !TEST_PATH.test(`/${path}`))
      .filter((path) => [...read(path).matchAll(HEX_32)].length > 0)
    expect(offenders).toEqual([])
  })

  it('allows only the documented FIXTURE_ONLY value in test and fixture files', () => {
    const offenders = inScope
      .filter((path) => TEST_PATH.test(`/${path}`))
      .flatMap((path) =>
        [...read(path).matchAll(HEX_32)]
          .map((match) => match[0])
          .filter((value) => !FIXTURE_ONLY_VARIANTS.has(value.toLowerCase()))
          .map((value) => `${path}: ${value}`)
      )
    expect(offenders).toEqual([])
  })
})

describe('the runtime stays free of Electron', () => {
  it('imports electron, even as a type, from none of the routing modules under src/main/runtime', () => {
    const offenders = ROUTING_SCOPE.filter((path) => path.startsWith('main/runtime/')).filter(
      (path) =>
        specifiersOf(path).some(
          (specifier) => specifier === 'electron' || specifier.startsWith('electron/')
        )
    )
    expect(offenders).toEqual([])
  })

  // Why real: the value of this gate is the transitive edges, which a per-file scan cannot see.
  it('reaches electron from none of the routing and Clef modules the runtime uses', async () => {
    const entries = [
      'src/main/runtime/rpc/methods/workbench.ts',
      'src/main/runtime/workbench-routing/workbench-routing-runtime.ts',
      'src/main/runtime/workbench-routing/clef-verifier.ts',
      'src/main/runtime/task-classification/classification-runtime.ts',
      'src/main/clef/clef-transport.ts',
      'src/main/clef/clef-schema-pins.ts',
      'src/main/clef/clef-classification-rules.ts',
      'src/main/clef/clef-classification-fingerprint.ts',
      'src/shared/routing-table/routing-table-schema.ts'
    ].map((entry) => join(REPO_ROOT, entry))
    expect(await collectElectronImporters(entries)).toEqual([])
  }, 60_000)
})
