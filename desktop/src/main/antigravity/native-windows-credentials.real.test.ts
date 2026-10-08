import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { credential } from './native-account-test-fixtures'
import {
  readAntigravityWindowsCredential,
  writeAntigravityWindowsCredential,
  type WindowsGenericCredentialApi
} from './native-windows-credentials'

const enabled =
  process.platform === 'win32' && process.env.ORCA_REAL_AGY_NATIVE_BACKEND_TEST === '1'

type DisposableCredentialApi = WindowsGenericCredentialApi & {
  deleteTestCredential(target: string): { status: string }
}

describe.skipIf(!enabled)('isolated Windows native credential backend', () => {
  it('writes and reads two complete profiles in a disposable item without changing agy authority', async () => {
    const api: DisposableCredentialApi = createRequire(import.meta.url)('@orca/windows-credentials')
    const target = { target: `nash-test:${randomUUID()}`, userName: 'task-only' }
    expect(target.target).not.toBe('gemini:antigravity')
    const options = { api, target }
    expect(await readAntigravityWindowsCredential(options)).toBeNull()
    try {
      await writeAntigravityWindowsCredential(credential('synthetic-a'), null, options)
      expect((await readAntigravityWindowsCredential(options))?.contents).toBe(
        credential('synthetic-a')
      )
      await writeAntigravityWindowsCredential(
        credential('synthetic-b', 2),
        credential('synthetic-a'),
        options
      )
      expect((await readAntigravityWindowsCredential(options))?.contents).toBe(
        credential('synthetic-b', 2)
      )
      expect(api.readGenericCredential(target.target)).toMatchObject({
        status: 'found',
        userName: 'task-only',
        persist: 2
      })
    } finally {
      expect(api.deleteTestCredential(target.target).status).toBe('ok')
    }
    expect(await readAntigravityWindowsCredential(options)).toBeNull()
  }, 30_000)
})
