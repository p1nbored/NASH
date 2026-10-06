import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type * as OsModule from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureHome = vi.hoisted(() => ({ path: '' }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  homedir: () => fixtureHome.path
}))

import { RelayDispatcher } from './dispatcher'
import { encodeJsonRpcFrame, type JsonRpcRequest } from './protocol'
import { WorkspaceSessionHandler } from './workspace-session-handler'

// D-017: a NASH relay on a host that also runs a real Orca relay must never share its home folder.
describe('relay per-user folders', () => {
  beforeEach(() => {
    fixtureHome.path = mkdtempSync(join(tmpdir(), 'nash-relay-home-'))
  })

  afterEach(() => {
    rmSync(fixtureHome.path, { recursive: true, force: true })
  })

  it('stores workspace sessions under ~/.nash/sessions and creates no ~/.orca', async () => {
    const dispatcher = new RelayDispatcher(() => undefined)
    new WorkspaceSessionHandler(dispatcher)
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'workspace.patch',
      params: {
        namespace: 'fixture-namespace',
        baseRevision: 0,
        clientId: 'client-a',
        patch: {
          kind: 'replace-session',
          session: { activeTabId: 'tab-1', tabsByWorktreePath: {}, terminalLayoutsByTabId: {} }
        }
      }
    }

    dispatcher.feed(encodeJsonRpcFrame(request, 1, 0))
    await vi.waitFor(() => {
      expect(readdirSync(join(fixtureHome.path, '.nash', 'sessions'))).toHaveLength(1)
    })
    dispatcher.dispose()

    expect(readdirSync(fixtureHome.path)).toEqual(['.nash'])
  })
})
