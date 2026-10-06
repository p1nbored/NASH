import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MAIN = join(process.cwd(), 'src/main')
const IMPORT_SPECIFIER = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm

function read(relativePath: string): string {
  return readFileSync(join(MAIN, relativePath), 'utf8')
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1])
}

function body(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`)
  expect(start, functionName).toBeGreaterThanOrEqual(0)
  return source.slice(start)
}

describe('clef startup ordering', () => {
  // Why: ES modules evaluate in import order, so only the first import runs before every other
  // module can read process.env or launch a child that inherits it.
  it('evaluates the environment scrub before any other main-process module', () => {
    expect(importSpecifiers(read('index.ts'))[0]).toBe('./startup/clef-environment-scrub-at-load')
  })

  // Why: orcad and the terminal daemon start without Electron, so index.ts never runs for them and
  // they would otherwise inherit user-scoped Clef variables from the launching shell into every PTY.
  it.each(['orcad/orcad-entry.ts', 'daemon/daemon-entry.ts'])(
    'evaluates the environment scrub before any other module of %s',
    (entry) => {
      expect(importSpecifiers(read(entry))[0]).toBe('../startup/clef-environment-scrub-at-load')
    }
  )

  it('reaches the scrub first from the orcad executable, whose only earlier import is a built-in', () => {
    const firstProjectImport = importSpecifiers(read('orcad/main.ts')).find(
      (specifier) => !specifier.startsWith('node:')
    )
    expect(firstProjectImport).toBe('./orcad-entry')
  })

  it('keeps the scrub module free of imports that could evaluate earlier', () => {
    expect(importSpecifiers(read('startup/clef-environment-scrub-at-load.ts'))).toEqual([
      '../clef/clef-env-scrub'
    ])
    expect(importSpecifiers(read('clef/clef-env-scrub.ts'))).toEqual([])
  })

  it('installs the sealed store in account services, before the runtime is created', () => {
    const accountServices = body(
      read('startup/main-process-account-services.ts'),
      'initializeMainProcessAccountServices'
    )
    expect(accountServices).toContain('installClefCredentialStore()')

    const readyRuntime = body(
      read('startup/main-process-ready-runtime.ts'),
      'initializeReadyRuntimeServices'
    )
    const install = readyRuntime.indexOf('initializeMainProcessAccountServices()')
    const runtime = readyRuntime.indexOf('initializeMainProcessRuntime()')
    expect(install).toBeGreaterThanOrEqual(0)
    expect(runtime).toBeGreaterThan(install)
  })

  it('installs the autopilot runtime once the runtime and account services exist, before any window launches', () => {
    const readyRuntime = body(
      read('startup/main-process-ready-runtime.ts'),
      'initializeReadyRuntimeServices'
    )
    const configure = readyRuntime.indexOf('configureRuntimeServices(runtime)')
    const autopilot = readyRuntime.indexOf('await initializeMainProcessAutopilotRuntime(runtime,')
    expect(configure).toBeGreaterThanOrEqual(0)
    expect(autopilot).toBeGreaterThan(configure)
    expect(readyRuntime).not.toContain('initializeMainProcessWorkbenchRouting')

    const ready = read('startup/main-process-ready.ts')
    const services = ready.indexOf('await initializeReadyRuntimeServices()')
    const launch = ready.indexOf('initializeMainProcessRuntimeLaunch(options)')
    expect(services).toBeGreaterThanOrEqual(0)
    expect(launch).toBeGreaterThan(services)
  })

  it('recovers interrupted routing before it installs the runtime, and aborts the verification call at quit', () => {
    const install = read('startup/workbench-routing-clef-administration.ts')
    const recover = install.indexOf('recoverInterruptedRouting()')
    const installRuntime = install.indexOf('setWorkbenchRoutingRuntime(runtime)')
    expect(recover).toBeGreaterThanOrEqual(0)
    expect(installRuntime).toBeGreaterThan(recover)
    expect(install).toContain('runtime.abortAllRouting()')
    expect(read('startup/autopilot-runtime-shutdown.ts')).toContain(
      'parts.clef?.runtime.abortAllRouting()'
    )
  })

  it('joins the autopilot shutdown to the will-quit barrier, so runs settle before the app exits', () => {
    const source = read('startup/main-process-quit.ts')
    const willQuit = source.slice(source.indexOf("app.on('will-quit'"))
    const begin = willQuit.indexOf(
      'const autopilotRuntimeShutdown = beginAutopilotRuntimeShutdown()'
    )
    const barrier = willQuit.indexOf('settleTeardownWithinDeadline([')
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(barrier).toBeGreaterThan(begin)
    expect(willQuit.slice(barrier)).toContain(
      "{ name: 'autopilot-runtime', promise: autopilotRuntimeShutdown }"
    )
  })

  it('keeps electron out of every autopilot and routing install module', () => {
    const modules = readdirSync(join(MAIN, 'startup'))
      .filter((name) => /^(?:autopilot-|workbench-routing-|main-process-autopilot-)/.test(name))
      .filter((name) => name.endsWith('.ts') && !/\.test(?:-fixture)?\.ts$/.test(name))
    expect(modules).toContain('autopilot-runtime-install.ts')
    expect(modules).toContain('workbench-routing-clef-administration.ts')
    const offenders = modules.filter((name) =>
      importSpecifiers(read(`startup/${name}`)).some(
        (specifier) => specifier === 'electron' || specifier.startsWith('electron/')
      )
    )
    expect(offenders).toEqual([])
  })

  it('registers the credential IPC inside the run-once guard of the core handlers', () => {
    const core = body(
      read('ipc/register-core-handlers/register-core-handlers.ts'),
      'registerCoreHandlers'
    )
    const guard = core.indexOf('registered = true')
    const clef = core.indexOf('registerClefCredentialsHandlers(installClefCredentialStore()')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(clef).toBeGreaterThan(guard)
  })
})
