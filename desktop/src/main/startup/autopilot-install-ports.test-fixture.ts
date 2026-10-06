// FIXTURE_ONLY: the install ports of a fake autopilot runtime. Every credential member refuses, so a
// test fails the moment the install reads the Clef or the remote access credentials.
import { vi, type Mock } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import type { AutopilotRuntimeLog } from './autopilot-runtime-events'
import type { FakeAutopilot } from './autopilot-runtime.test-fixture'

type Refusing = Mock<() => never>

export type FakeInstallPorts = {
  readonly runtime: OrcaRuntimeService
  readonly owner: OrchestrationDb
  readonly userDataPath: string
  readonly cliCommand: string
  readonly credentials: { status: Refusing; read: Refusing; generation: Refusing }
  readonly dotRemote: {
    credentials: {
      status: Refusing
      read: Refusing
      save: Refusing
      clear: Refusing
      readDevice: Refusing
      saveDevice: Refusing
      clearDevice: Refusing
    }
    appVersion: string
  }
  readonly now: () => number
  readonly log: Mock<AutopilotRuntimeLog>
  readonly stepTimeoutMs: number
  readonly quitWaitMs: number
}

function refusing(what: string): Refusing {
  return vi.fn((): never => {
    throw new Error(`Fixture: the install must not read the ${what}.`)
  })
}

/** The install ports a fixture runtime needs; neither the Clef nor the remote credentials are read. */
export function fakeInstallPorts(fake: FakeAutopilot): FakeInstallPorts {
  return {
    runtime: fake.runtime,
    owner: fake.owner,
    userDataPath: 'C:/fixture/userData',
    cliCommand: 'orca',
    credentials: {
      status: refusing('credential status'),
      read: refusing('credential'),
      generation: refusing('credential generation')
    },
    dotRemote: {
      credentials: {
        status: refusing('remote token status'),
        read: refusing('remote token'),
        save: refusing('remote token save'),
        clear: refusing('remote token clear'),
        readDevice: refusing('remote device credential'),
        saveDevice: refusing('remote device credential save'),
        clearDevice: refusing('remote device credential clear')
      },
      appVersion: '1.4.0'
    },
    now: () => Date.parse('2026-10-05T00:00:00.000Z'),
    log: vi.fn<AutopilotRuntimeLog>(),
    stepTimeoutMs: 1_000,
    quitWaitMs: 1_000
  }
}
