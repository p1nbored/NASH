// FIXTURE_ONLY: the production builders over a memory database, a temporary data folder and fake
// host ports. Every child-process entry point and fetch is trapped; the install must touch none.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { OrchestrationError } from '../runtime/orchestration/orchestration-error'
import { setTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import { setWorkbenchRoutingRuntime } from '../runtime/workbench-routing/workbench-routing-runtime'
import { setPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import { createProductionAutopilotBuilders } from './autopilot-production-builders'
import type { AutopilotHostPorts } from './autopilot-runtime-builders'
import {
  installAutopilotRuntime,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'

const trapped = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal()
  const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']
  const traps = Object.fromEntries(
    names.map((name) => [
      name,
      () => {
        trapped.calls.push(`child_process.${name}`)
        throw new Error(`FIXTURE_ONLY: ${name} is forbidden while the app starts.`)
      }
    ])
  )
  return { ...actual, ...traps, default: { ...actual, ...traps } }
})

const dirs: string[] = []
const owners: OrchestrationDb[] = []
let installation: AutopilotRuntimeInstallation | null = null

beforeEach(() => {
  trapped.calls.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    trapped.calls.push('fetch')
    return Promise.reject(new Error('FIXTURE_ONLY: no network while the app starts.'))
  })
})

afterEach(async () => {
  await installation?.shutdown()
  installation = null
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
  vi.restoreAllMocks()
  for (const owner of owners.splice(0)) {
    owner.close()
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Every member records its name; none starts anything. */
function recordingHostPorts(touched: string[]): AutopilotHostPorts {
  const refuse = (name: string) => () => {
    touched.push(name)
    throw new Error(`FIXTURE_ONLY: ${name} must not run while the app starts.`)
  }
  return {
    agents: {
      detectInstalled: refuse('agents.detectInstalled'),
      disabled: refuse('agents.disabled')
    },
    models: {
      claude: refuse('models.claude'),
      codex: refuse('models.codex'),
      agy: refuse('models.agy')
    },
    rateLimits: { read: refuse('rateLimits.read'), refresh: refuse('rateLimits.refresh') },
    codex: { resolveExecutable: refuse('codex.resolveExecutable') },
    agy: { resolveExecutable: refuse('agy.resolveExecutable') },
    claude: { resolveExecutable: refuse('claude.resolveExecutable') }
  }
}

/** The runtime surface the install touches; any other member records its name and does nothing. */
function recordingRuntime(owner: OrchestrationDb, touched: string[]): OrcaRuntimeService {
  const known: Record<string, unknown> = {
    getOrchestrationDb: () => owner,
    requireWorkbenchWorkspace: () => {
      throw new OrchestrationError('workbench_workspace_unavailable', 'Fixture: no workspaces.')
    },
    requireDotIngressControl: () => {
      throw new OrchestrationError('workbench_dot_ingress_unavailable', 'Fixture: no server yet.')
    },
    installDotIngressEnabledReader: vi.fn(),
    notifyMessageArrived: vi.fn()
  }
  const proxy = new Proxy(known, {
    get: (target, name) =>
      typeof name === 'string' && !(name in target)
        ? () => {
            touched.push(`runtime.${name}`)
          }
        : Reflect.get(target, name)
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the proxy answers every member; unknown ones record their name.
  return proxy as unknown as OrcaRuntimeService
}

async function installForReal() {
  const owner = new OrchestrationDb(':memory:')
  owners.push(owner)
  const userDataPath = mkdtempSync(join(tmpdir(), 'orca-autopilot-install-'))
  dirs.push(userDataPath)
  const touched: string[] = []
  const credentials = {
    status: vi.fn(() => {
      throw new Error('FIXTURE_ONLY: the install must not read the credential status.')
    }),
    read: vi.fn(() => {
      throw new Error('FIXTURE_ONLY: the install must not read the credential.')
    }),
    generation: vi.fn(() => {
      throw new Error('FIXTURE_ONLY: the install must not read the credential generation.')
    })
  }
  const remoteRead = (what: string) =>
    vi.fn(() => {
      throw new Error(`FIXTURE_ONLY: the install must not touch the remote ${what}.`)
    })
  const remoteCredentials = {
    status: remoteRead('token status'),
    read: remoteRead('token'),
    save: remoteRead('token save'),
    clear: remoteRead('token clear'),
    readDevice: remoteRead('device credential'),
    saveDevice: remoteRead('device credential save'),
    clearDevice: remoteRead('device credential clear')
  }
  const log = vi.fn()
  installation = await installAutopilotRuntime(
    {
      runtime: recordingRuntime(owner, touched),
      owner,
      userDataPath,
      cliCommand: 'orca',
      credentials,
      transport: vi.fn(() => {
        throw new Error('FIXTURE_ONLY: the install must not call Clef.')
      }),
      dotRemote: { credentials: remoteCredentials, appVersion: '1.4.0' },
      log
    },
    createProductionAutopilotBuilders(recordingHostPorts(touched))
  )
  return { installation, touched, credentials, remoteCredentials, log }
}

describe('installAutopilotRuntime with the production builders: nothing live at startup', () => {
  it('installs every step', async () => {
    const { installation: installed, log } = await installForReal()
    expect(log).not.toHaveBeenCalled()
    expect(installed.report.steps.filter((step) => step.status !== 'installed')).toEqual([])
    expect(installed.report.launchesOpen).toBe(true)
  })

  it('spawns no process and makes no network call', async () => {
    await installForReal()
    expect(trapped.calls).toEqual([])
  })

  it('reads no credential, calls no host port and asks the runtime nothing else', async () => {
    const { credentials, touched } = await installForReal()
    expect(credentials.status).not.toHaveBeenCalled()
    expect(credentials.read).not.toHaveBeenCalled()
    expect(credentials.generation).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })

  it('keeps remote access off, with no token read, when its switch was never turned on', async () => {
    const { installation: installed, remoteCredentials } = await installForReal()
    expect(installed.report.steps.find((step) => step.name === 'dotRemote')?.status).toBe(
      'installed'
    )
    for (const member of Object.values(remoteCredentials)) {
      expect(member).not.toHaveBeenCalled()
    }
    expect(trapped.calls).toEqual([])
  })

  it('keeps the dot interface off when its switch was never turned on', async () => {
    const { installation: installed } = await installForReal()
    expect(installed.report.steps.find((step) => step.name === 'dotIngress')?.status).toBe(
      'installed'
    )
  })
})
