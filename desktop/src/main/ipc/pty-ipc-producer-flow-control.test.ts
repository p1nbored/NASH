import { describe, expect, it, vi } from 'vitest'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { registerPtyHandlers } from './pty/register-handlers'
import { getPtyRendererDeliveryDebugSnapshot } from './pty/delivery/debug'

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
  const { mainWindow, installObservableDaemonTestProvider, getPtyDataSendCalls } =
    setupPtyIpcSuite()

  it('resumes a paused producer when the PTY exits before draining', async () => {
    vi.useFakeTimers()
    try {
      const provider = installObservableDaemonTestProvider()
      registerPtyHandlers(mainWindow as never)
      mainWindow.webContents.send.mockClear()

      const finalPendingData = 'x'.repeat(320 * 1024)
      provider.emitData('flood-pty', finalPendingData)
      expect(provider.pauseProducer).toHaveBeenCalledTimes(1)

      // Exit while pending is above the low watermark: the exit path must release the pause, not leave a stale mark.
      provider.emitExit('flood-pty', 0)
      expect(provider.resumeProducer).toHaveBeenCalledTimes(1)
      expect(provider.resumeProducer).toHaveBeenCalledWith('flood-pty')
    } finally {
      vi.useRealTimers()
    }
  })
  it('releases a paused producer when handlers re-register for a replacement window', () => {
    vi.useFakeTimers()
    try {
      const provider = installObservableDaemonTestProvider()
      registerPtyHandlers(mainWindow as never)
      mainWindow.webContents.send.mockClear()

      provider.emitData('flood-pty', 'x'.repeat(320 * 1024))
      expect(provider.pauseProducer).toHaveBeenCalledTimes(1)

      // Re-registration hands delivery to a new window; the outgoing session must run its real
      // lifecycle reset before the bridge is neutralized or this shell stays paused forever.
      registerPtyHandlers(mainWindow as never)
      expect(provider.resumeProducer).toHaveBeenCalledWith('flood-pty')
    } finally {
      vi.useRealTimers()
    }
  })
  it('fences synchronous producer data and duplicate exit while releasing an exiting PTY', () => {
    vi.useFakeTimers()
    try {
      const provider = installObservableDaemonTestProvider()
      registerPtyHandlers(mainWindow as never)
      mainWindow.webContents.send.mockClear()

      const finalPendingData = 'x'.repeat(320 * 1024)
      provider.emitData('flood-pty', finalPendingData)
      expect(provider.pauseProducer).toHaveBeenCalledTimes(1)
      provider.resumeProducer.mockImplementation((id: string) => {
        provider.emitData(id, 'must-not-follow-exit')
        provider.emitExit(id, 0)
      })

      provider.emitExit('flood-pty', 0)

      expect(provider.resumeProducer).toHaveBeenCalledTimes(1)
      expect(mainWindow.webContents.send.mock.calls).toEqual([
        ['pty:data', { id: 'flood-pty', data: finalPendingData }],
        ['pty:exit', { id: 'flood-pty', code: 0 }]
      ])
      expect(
        getPtyDataSendCalls().some(
          (call) => (call[1] as { data?: string } | undefined)?.data === 'must-not-follow-exit'
        )
      ).toBe(false)
      expect(
        mainWindow.webContents.send.mock.calls.filter((call) => call[0] === 'pty:exit')
      ).toHaveLength(1)
      expect(getPtyRendererDeliveryDebugSnapshot()).toMatchObject({
        pendingPtyCount: 0,
        rendererInFlightPtyCount: 0,
        rendererInFlightChars: 0,
        flushScheduled: false
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not retry a complete payload after a synchronous renderer send failure', () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const provider = installObservableDaemonTestProvider()
      registerPtyHandlers(mainWindow as never)
      mainWindow.webContents.send.mockClear()
      let failed = false
      let markerFailed = false
      mainWindow.webContents.send.mockImplementation(
        (channel: string, payload: { id?: string }) => {
          if (channel === 'pty:data' && payload.id === 'send-fail-complete' && !failed) {
            failed = true
            throw new Error('synthetic send failure')
          }
          if (channel === 'pty:modelRestoreNeeded' && !markerFailed) {
            markerFailed = true
            throw new Error('synthetic marker failure')
          }
        }
      )

      provider.emitData('send-fail-complete', 'lost-once')
      vi.advanceTimersByTime(2)

      expect(getPtyDataSendCalls()).toEqual([
        ['pty:data', { id: 'send-fail-complete', data: 'lost-once' }]
      ])
      expect(getPtyRendererDeliveryDebugSnapshot()).toMatchObject({
        pendingPtyCount: 0,
        pendingChars: 0,
        rendererInFlightPtyCount: 0,
        rendererInFlightChars: 0,
        flushScheduled: false
      })
      expect(vi.getTimerCount()).toBe(0)

      provider.emitData('send-fail-complete', 'recovery')
      vi.advanceTimersByTime(2)
      expect(getPtyDataSendCalls()).toEqual([
        ['pty:data', { id: 'send-fail-complete', data: 'lost-once' }],
        ['pty:data', { id: 'send-fail-complete', data: 'recovery' }]
      ])
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty:modelRestoreNeeded', {
        id: 'send-fail-complete',
        reason: 'delivery-heal'
      })
      provider.emitData('send-fail-complete', 'after-marker-failure')
      vi.advanceTimersByTime(2)
      expect(
        mainWindow.webContents.send.mock.calls.filter(
          (call) => call[0] === 'pty:modelRestoreNeeded'
        )
      ).toHaveLength(2)
      expect(getPtyDataSendCalls().at(-1)).toEqual([
        'pty:data',
        { id: 'send-fail-complete', data: 'after-marker-failure' }
      ])
    } finally {
      errorSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
