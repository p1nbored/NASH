import { openCodeHookServiceModuleMock } from '../ipc/pty-ipc-mock-registry'
import { describe, expect, it, vi } from 'vitest'
import { setPtyHostBindings } from '../ipc/pty-host-bindings'

const { handleMock, onMock, removeHandlerMock, removeAllListenersMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  removeAllListenersMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn().mockReturnValue('/tmp/orca-test-userdata')
  },
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeHandler: removeHandlerMock,
    removeAllListeners: removeAllListenersMock
  },
  powerMonitor: {
    on: vi.fn()
  }
}))

vi.mock('fs', () => ({
  existsSync: () => true,
  statSync: () => ({ isDirectory: () => true, mode: 0o755 }),
  accessSync: () => undefined,
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  constants: { X_OK: 1 }
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn().mockReturnValue({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    process: 'zsh',
    pid: 12345
  })
}))

vi.mock('../opencode/hook-service', () => openCodeHookServiceModuleMock())

vi.mock('../pi/titlebar-extension-service', () => ({
  piTitlebarExtensionService: { buildPtyEnv: () => ({}), clearPty: vi.fn() }
}))

import { registerPtyHandlers } from '../ipc/pty/register-handlers'

describe('PTY provider dispatch', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { on: vi.fn(), send: vi.fn(), removeListener: vi.fn() }
  }

  function setup(): void {
    handlers.clear()
    handleMock.mockReset()
    onMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
    onMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
    // Why: pty.ts registers against an injected surface now, so the mocked ipcMain must
    // be installed for this suite's own `handlers` map to capture registrations.
    setPtyHostBindings({
      ipc: {
        handle: handleMock,
        on: onMock,
        removeHandler: removeHandlerMock,
        removeAllListeners: removeAllListenersMock
      }
    })
    registerPtyHandlers(mainWindow as never)
  }

  it('routes to local provider when connectionId is null', async () => {
    setup()
    const result = (await handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24,
      connectionId: null
    })) as { id: string }
    expect(result.id).toBeTruthy()
  })

  it('routes to local provider when connectionId is undefined', async () => {
    setup()
    const result = (await handlers.get('pty:spawn')!(null, {
      cols: 80,
      rows: 24
    })) as { id: string }
    expect(result.id).toBeTruthy()
  })

  it('throws for unknown connectionId', async () => {
    setup()
    await expect(
      handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        connectionId: 'unknown-conn'
      })
    ).rejects.toThrow(/^No PTY provider for connection "unknown-conn"/)
  })
})
