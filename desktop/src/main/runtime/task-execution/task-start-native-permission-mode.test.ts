import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import { getPrimarySessionStore } from '../orchestration/db/primary-session-store'
import type { startLocalWorker } from '../rpc/methods/orchestration/worker/local-worker-start'
import { startRoutedNativeWorker } from './task-start-native'
import {
  AGY_ROUTE,
  CODEX_ROUTE,
  SUBAGENT_ROUTE,
  FIXTURE_NOW_MS,
  availableResult,
  createAppRunHarness,
  seedRoutedAppTask,
  type AppRunHarness
} from './task-execution.test-fixture'

const launch = vi.hoisted(() => vi.fn<typeof startLocalWorker>())
vi.mock('../rpc/methods/orchestration/worker/local-worker-start', () => ({
  startLocalWorker: launch
}))

let harness: AppRunHarness | undefined
afterEach(() => {
  harness?.owner.close()
  harness = undefined
  launch.mockReset()
})

describe('routed worker permission transport', () => {
  it.each([CODEX_ROUTE, SUBAGENT_ROUTE, AGY_ROUTE])(
    'keeps $target on the terminal hook path when the user prefers structured chats',
    async (fixture) => {
      const env = createAppRunHarness()
      harness = env
      const creator = {
        kind: 'terminal' as const,
        handle: 'term_primary',
        paneKey: 'tab_primary:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        processIncarnation: 'process-primary'
      }
      const sessions = getPrimarySessionStore(env.owner)
      const owner = sessions.insertStarting({
        runId: env.runId,
        launchOperationId: 'launch_permission_fixture',
        permissionMode: 'manual',
        requestedModel: 'claude-opus-5-5',
        requestedEffort: 'max',
        timestamp: new Date(FIXTURE_NOW_MS).toISOString()
      })
      sessions.markRunning(owner.ownerId, {
        terminalHandle: creator.handle,
        paneKey: creator.paneKey,
        processIncarnation: creator.processIncarnation,
        launchTokenSha256: null,
        launchLedger: 'orca',
        receipt: {},
        timestamp: new Date(FIXTURE_NOW_MS + 1000).toISOString()
      })
      const settings = Object.freeze({
        experimentalNativeChat: true,
        experimentalStructuredNativeChat: true,
        openAgentTabsInChatByDefault: true
      })
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these are the adapter's runtime reads before the mocked external launch rejects.
      const runtime = {
        getOrchestrationDb: () => env.owner,
        getTerminalProcessIncarnation: () => creator.processIncarnation,
        getClientSettings: () => settings
      } as unknown as OrcaRuntimeService
      const seeded = seedRoutedAppTask(env, fixture)
      const availability = availableResult(fixture)
      if (availability.status !== 'available') {
        throw new Error('fixture unavailable')
      }
      const stoppedAtLaunch = new Error('fixture reached external launch')
      launch.mockRejectedValue(stoppedAtLaunch)

      await expect(
        startRoutedNativeWorker(
          runtime,
          { taskId: seeded.taskId, creator, maxDepth: 4 },
          {
            kind: 'delegated',
            routeId: seeded.routeId,
            target: fixture.target,
            taskType: fixture.taskType,
            subject: fixture.subject,
            availability
          }
        )
      ).rejects.toBe(stoppedAtLaunch)

      expect(launch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          mode: expect.objectContaining({ mode: 'terminal' }),
          taskAccess: 'read_only',
          routeId: seeded.routeId
        })
      )
      expect(settings.experimentalStructuredNativeChat).toBe(true)
    }
  )
})
