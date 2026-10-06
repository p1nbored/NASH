import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcRenderer: { invoke } }))

import { clefCredentialsApi } from './clef-credentials-bridge'

// FIXTURE_ONLY: fake values shaped like real Clef credentials; never real secrets.
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const ABSENT = { tokenPresent: false, accountPresent: false, protection: 'absent' }

describe('Clef credential bridge', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('exposes only status, save and clear', () => {
    expect(Object.keys(clefCredentialsApi)).toEqual(['status', 'save', 'clear'])
  })

  it('reads presence and protection from the status channel', async () => {
    invoke.mockResolvedValueOnce(ABSENT)
    await expect(clefCredentialsApi.status()).resolves.toEqual(ABSENT)
    expect(invoke).toHaveBeenCalledWith('clef:credentials:status')
  })

  it('sends exactly the token and account id, and nothing else, on save', async () => {
    invoke.mockResolvedValueOnce({ ok: true, status: ABSENT })
    const input = {
      token: FIXTURE_ONLY_TOKEN,
      accountId: FIXTURE_ONLY_ACCOUNT_ID,
      extra: 'FIXTURE_ONLY_EXTRA'
    }

    await clefCredentialsApi.save(input)

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]).toEqual([
      'clef:credentials:save',
      { token: FIXTURE_ONLY_TOKEN, accountId: FIXTURE_ONLY_ACCOUNT_ID }
    ])
  })

  it('clears through the clear channel without arguments', async () => {
    invoke.mockResolvedValueOnce({ ok: true, status: ABSENT })
    await expect(clefCredentialsApi.clear()).resolves.toEqual({ ok: true, status: ABSENT })
    expect(invoke.mock.calls).toEqual([['clef:credentials:clear']])
  })
})
