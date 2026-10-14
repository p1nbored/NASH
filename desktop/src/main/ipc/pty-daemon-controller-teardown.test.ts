import { describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { registerPtyHandlers } from './pty/register-handlers'
import { setPtyOwnership } from './pty/provider/ownership-state'
import { setLocalPtyProvider } from './pty/provider/registry'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('registerPtyHandlers', () => {
  const { handlers, mainWindow } = setupPtyIpcSuite()

  describe('spawn environment', () => {
    describe('daemon-active provider (parity with LocalPtyProvider)', () => {
      // Why: under the daemon, LocalPtyProvider.buildSpawnEnv never runs, so host-local env injection must happen in the pty:spawn handler instead.
      it('runtime controller stopAndWait fails when keepHistory allows the PTY to revive', async () => {
        vi.useFakeTimers()
        const shutdown = vi.fn(async () => undefined)
        const listProcesses = vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'local-pty', cwd: '/tmp/demo', title: 'shell' }])
        setLocalPtyProvider({
          spawn: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          shutdown,
          sendSignal: vi.fn(),
          getCwd: vi.fn(),
          getInitialCwd: vi.fn(),
          clearBuffer: vi.fn(),
          acknowledgeDataEvent: vi.fn(),
          hasChildProcesses: vi.fn(),
          getForegroundProcess: vi.fn(),
          serialize: vi.fn(),
          revive: vi.fn(),
          onData: vi.fn(() => () => {}),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {}),
          listProcesses,
          attach: vi.fn(),
          getDefaultShell: vi.fn(),
          getProfiles: vi.fn()
        } as never)
        const runtime = {
          setPtyController: vi.fn(),
          onPtyExit: vi.fn()
        }
        handlers.clear()
        registerPtyHandlers(mainWindow as never, runtime as never)
        const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
          stopAndWait: (ptyId: string, opts?: { keepHistory?: boolean }) => Promise<boolean>
        }

        const stopPromise = controller.stopAndWait('local-pty', { keepHistory: true })
        await vi.advanceTimersByTimeAsync(200)

        await expect(stopPromise).resolves.toBe(false)
        expect(shutdown).toHaveBeenCalledWith('local-pty', {
          immediate: true,
          keepHistory: true
        })
        expect(runtime.onPtyExit).not.toHaveBeenCalled()
      })
      it('runtime controller stopAndWait preserves ownership when proof fails after shutdown', async () => {
        const shutdown = vi.fn(async () => undefined)
        const listProcesses = vi.fn().mockRejectedValue(new Error('legacy unavailable'))
        setLocalPtyProvider({
          spawn: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          shutdown,
          sendSignal: vi.fn(),
          getCwd: vi.fn(),
          getInitialCwd: vi.fn(),
          clearBuffer: vi.fn(),
          acknowledgeDataEvent: vi.fn(),
          hasChildProcesses: vi.fn(),
          getForegroundProcess: vi.fn(),
          serialize: vi.fn(),
          revive: vi.fn(),
          onData: vi.fn(() => () => {}),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {}),
          listProcesses,
          attach: vi.fn(),
          getDefaultShell: vi.fn(),
          getProfiles: vi.fn()
        } as never)
        const runtime = {
          setPtyController: vi.fn(),
          onPtyExit: vi.fn()
        }
        handlers.clear()
        registerPtyHandlers(mainWindow as never, runtime as never)
        const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
          stopAndWait: (ptyId: string, opts?: { keepHistory?: boolean }) => Promise<boolean>
        }

        await expect(controller.stopAndWait('local-pty', { keepHistory: true })).resolves.toBe(
          false
        )

        expect(shutdown).toHaveBeenCalledWith('local-pty', {
          immediate: true,
          keepHistory: true
        })
        expect(runtime.onPtyExit).not.toHaveBeenCalled()
      })
      it('bounds keep-history inventory polls by the settlement deadline', async () => {
        vi.useFakeTimers()
        try {
          const listProcesses = vi.fn(async (_opts?: { deadlineMs?: number }) => [])
          setLocalPtyProvider({
            spawn: vi.fn(),
            write: vi.fn(),
            resize: vi.fn(),
            shutdown: vi.fn(async () => undefined),
            sendSignal: vi.fn(),
            getCwd: vi.fn(),
            getInitialCwd: vi.fn(),
            clearBuffer: vi.fn(),
            acknowledgeDataEvent: vi.fn(),
            hasChildProcesses: vi.fn(),
            getForegroundProcess: vi.fn(),
            serialize: vi.fn(),
            revive: vi.fn(),
            onData: vi.fn(() => () => {}),
            onReplay: vi.fn(() => () => {}),
            onExit: vi.fn(() => () => {}),
            listProcesses,
            getDefaultShell: vi.fn(),
            getProfiles: vi.fn()
          } as never)
          const runtime = {
            setPtyController: vi.fn(),
            onPtyExit: vi.fn()
          }
          handlers.clear()
          registerPtyHandlers(mainWindow as never, runtime as never)
          const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
            stopAndWait: (
              ptyId: string,
              opts?: { keepHistory?: boolean; deadlineMs?: number }
            ) => Promise<boolean>
          }
          const callerDeadlineMs = Date.now() + 5_000
          const stopPromise = controller.stopAndWait('local-pty', {
            keepHistory: true,
            deadlineMs: callerDeadlineMs
          })

          await vi.advanceTimersByTimeAsync(1_000)
          await expect(stopPromise).resolves.toBe(true)

          expect(listProcesses.mock.calls[0]?.[0]).toEqual({ deadlineMs: callerDeadlineMs })
          const settlementDeadlines = listProcesses.mock.calls
            .slice(1)
            .map(([opts]) => opts?.deadlineMs)
          expect(settlementDeadlines.length).toBeGreaterThan(0)
          expect(new Set(settlementDeadlines)).toEqual(new Set([callerDeadlineMs - 4_000]))
        } finally {
          vi.useRealTimers()
        }
      })
      it('uses inventory, not an incarnation-less exit, to confirm the current PTY stopped', async () => {
        const exitListeners = new Set<
          (payload: { id: string; code: number; incarnationId?: string }) => void
        >()
        const provider = {
          spawn: vi.fn(async () => ({ id: 'local-incarnated', incarnationId: 'incarnation-live' })),
          write: vi.fn(),
          resize: vi.fn(),
          shutdown: vi.fn(async () => {
            for (const listener of exitListeners) {
              listener({ id: 'local-incarnated', code: 0 })
            }
          }),
          sendSignal: vi.fn(),
          getCwd: vi.fn(),
          getInitialCwd: vi.fn(),
          clearBuffer: vi.fn(),
          acknowledgeDataEvent: vi.fn(),
          hasChildProcesses: vi.fn(),
          getForegroundProcess: vi.fn(),
          serialize: vi.fn(),
          revive: vi.fn(),
          onData: vi.fn(() => () => {}),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn((listener) => {
            exitListeners.add(listener)
            return () => exitListeners.delete(listener)
          }),
          listProcesses: vi.fn(async () => []),
          attach: vi.fn(),
          getDefaultShell: vi.fn(),
          getProfiles: vi.fn()
        }
        setLocalPtyProvider(provider as never)
        const runtime = {
          setPtyController: vi.fn(),
          onPtyExit: vi.fn(),
          registerPty: vi.fn(),
          onPtySpawned: vi.fn()
        }
        handlers.clear()
        registerPtyHandlers(mainWindow as never, runtime as never)
        const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
          spawn: (args: { cols: number; rows: number }) => Promise<{ id: string }>
          stopAndWait: (ptyId: string) => Promise<boolean>
        }

        await controller.spawn({ cols: 80, rows: 24 })
        await expect(controller.stopAndWait('local-incarnated')).resolves.toBe(true)

        expect(runtime.onPtyExit).toHaveBeenCalledWith('local-incarnated', 0, 'incarnation-live')
      })
      it('runtime controller kill tombstones app-scoped SSH ids when ownership and provider are absent', async () => {
        const localShutdown = vi.fn()
        setLocalPtyProvider({
          spawn: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          shutdown: localShutdown,
          sendSignal: vi.fn(),
          getCwd: vi.fn(),
          getInitialCwd: vi.fn(),
          clearBuffer: vi.fn(),
          acknowledgeDataEvent: vi.fn(),
          hasChildProcesses: vi.fn(),
          getForegroundProcess: vi.fn(),
          serialize: vi.fn(),
          revive: vi.fn(),
          onData: vi.fn(() => () => {}),
          onReplay: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {}),
          listProcesses: vi.fn(async () => []),
          attach: vi.fn(),
          getDefaultShell: vi.fn(),
          getProfiles: vi.fn()
        } as never)
        const store = { markSshRemotePtyLease: vi.fn() }
        const runtime = {
          setPtyController: vi.fn(),
          onPtyExit: vi.fn()
        }
        handlers.clear()
        registerPtyHandlers(
          mainWindow as never,
          runtime as never,
          undefined,
          undefined,
          undefined,
          store as never
        )
        const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
          kill: (ptyId: string) => boolean
        }

        // The lease is tombstoned, but nothing observed the detached relay PTY
        // stop, so the stop itself is reported as unconfirmed.
        expect(controller.kill('ssh:ssh-1@@relay-pty')).toBe(false)

        expect(localShutdown).not.toHaveBeenCalled()
        expect(store.markSshRemotePtyLease).toHaveBeenCalledWith('ssh-1', 'relay-pty', 'terminated')
        expect(runtime.onPtyExit).toHaveBeenCalledWith('ssh:ssh-1@@relay-pty', -1, undefined)
      })
      it('marks a detached SSH lease terminated when runtime controller kill has no provider', async () => {
        const store = { markSshRemotePtyLease: vi.fn() }
        const runtime = {
          setPtyController: vi.fn(),
          onPtyExit: vi.fn()
        }
        setPtyOwnership('remote-pty', 'ssh:ssh-1')
        handlers.clear()
        registerPtyHandlers(
          mainWindow as never,
          runtime as never,
          undefined,
          undefined,
          undefined,
          store as never
        )
        const controller = runtime.setPtyController.mock.calls[0]?.[0] as {
          kill: (ptyId: string) => boolean
        }

        expect(controller.kill('remote-pty')).toBe(false)

        expect(store.markSshRemotePtyLease).toHaveBeenCalledWith(
          'ssh-1',
          'remote-pty',
          'terminated'
        )
        expect(runtime.onPtyExit).toHaveBeenCalledWith('remote-pty', -1, undefined)
      })
    })
  })
})
