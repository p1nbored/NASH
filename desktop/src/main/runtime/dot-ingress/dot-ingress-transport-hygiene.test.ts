import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static guards for the ingress transport: it stays electron-free, cannot reach the paid Clef path, and only the
// admission step can issue a dot caller.
const MAIN_ROOT = join(import.meta.dirname, '..', '..')
const INGRESS_DIR = join(MAIN_ROOT, 'runtime', 'dot-ingress')
const METHODS_FILE = join(MAIN_ROOT, 'runtime', 'rpc', 'methods', 'dot-ingress.ts')
const ISSUER_FILES = ['dot-ingress-admission.ts', 'dot-ingress-caller.ts']

const FORBIDDEN_IMPORTS = [
  /^electron$/,
  /clef-transport/,
  /clef-sealed-credential-store/,
  /clef-spend/,
  /clef-call-/,
  /clef-verifier/,
  /network\/http-client/,
  /workbench-route-store/,
  /workbench-request-router/,
  /workbench-routing\//,
  // The ingress stays on the local pipe or socket: no WebSocket, relay, pairing or mobile services.
  /ws-transport/,
  /(^|\/)relay\//,
  /pairing/,
  /mobile-/,
  /device-registry/,
  /e2ee/,
  // The full method registry (rpc/methods/index): the ingress must never see it.
  /(^|\/)methods(\/index)?$/
]

const isTestFile = (name: string) => /\.(test|spec)\.ts$|\.test-fixture\.ts$/.test(name)

function transportFiles(): string[] {
  const inFolder = readdirSync(INGRESS_DIR)
    .filter((name) => name.endsWith('.ts') && !isTestFile(name))
    .map((name) => join(INGRESS_DIR, name))
  return [...inFolder, METHODS_FILE]
}

function importSpecifiers(source: string): string[] {
  const found = source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)
  return [...found].map((match) => match[1] ?? '')
}

describe('dot ingress transport hygiene', () => {
  it('has the transport files this package owns', () => {
    const names = transportFiles().map((file) => relative(MAIN_ROOT, file).replaceAll('\\', '/'))

    expect(names).toEqual(
      expect.arrayContaining([
        'runtime/dot-ingress/dot-ingress-caller.ts',
        'runtime/dot-ingress/dot-ingress-admission.ts',
        'runtime/dot-ingress/dot-ingress-listener.ts',
        'runtime/dot-ingress/dot-ingress-metadata-file.ts',
        'runtime/dot-ingress/dot-ingress-control.ts',
        'runtime/rpc/methods/dot-ingress.ts'
      ])
    )
  })

  it.each(transportFiles().map((file) => [relative(MAIN_ROOT, file), file]))(
    '%s imports no electron and no paid Clef, HTTP or routing module',
    (_name, file) => {
      const offending = importSpecifiers(readFileSync(file, 'utf8')).filter((specifier) =>
        FORBIDDEN_IMPORTS.some((pattern) => pattern.test(specifier))
      )

      expect(offending).toEqual([])
    }
  )

  it('takes the endpoint name from the runtime naming code instead of spelling a prefix out', () => {
    for (const file of transportFiles()) {
      // A spelled-out pipe path, socket file name or name template would be a second copy of the naming.
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/pipe\\|\.sock\b|\bo-\$\{|orca-\$\{/)
    }
  })

  it('never refers to the desktop caller issuer', () => {
    for (const file of transportFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('issueWorkbenchDesktopCaller')
    }
  })

  it('lets only the caller module and the admission step issue a dot caller', () => {
    const issuers: string[] = []
    for (const entry of readdirSync(MAIN_ROOT, { recursive: true, encoding: 'utf8' })) {
      if (!entry.endsWith('.ts') || isTestFile(entry)) {
        continue
      }
      if (readFileSync(join(MAIN_ROOT, entry), 'utf8').includes('issueDotIngressCaller')) {
        issuers.push(entry.replaceAll('\\', '/').split('/').pop() ?? entry)
      }
    }

    expect(issuers.sort()).toEqual(ISSUER_FILES)
  })
})
