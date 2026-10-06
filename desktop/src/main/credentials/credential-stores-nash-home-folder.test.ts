import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type * as OsModule from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixtureHome = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  homedir: () => fixtureHome.path
}))

import { saveBitbucketCredential } from '../bitbucket/credential-store'
import { saveToken as saveJiraToken } from '../jira/site-credential-store'
import {
  ensureWorkspaceTokenDir,
  getLegacyViewerPath,
  getWorkspaceFilePath
} from '../linear/linear-credential-paths'
import { saveMiniMaxSessionCookie } from '../minimax/minimax-cookie-store'
import { saveOpenAiSpeechApiKey } from '../speech/openai-api-key-store'
import { saveZcodePlanApiKey } from '../zcode/zcode-plan-api-key-store'
import { createEncryptedApiKeyFileStore } from './encrypted-api-key-file-store'

// FIXTURE_ONLY: an obviously fake key; never a real secret.
const FIXTURE_ONLY_KEY = 'FAKE_API_KEY_FIXTURE_ONLY_0000000000'

// D-017: a credential NASH writes must land in its own home folder, never in a real Orca's `~/.orca`.
describe('credential stores use the NASH home folder', () => {
  beforeEach(() => {
    fixtureHome.path = mkdtempSync(join(tmpdir(), 'nash-credential-home-'))
  })

  afterEach(() => {
    rmSync(fixtureHome.path, { recursive: true, force: true })
  })

  it('writes every credential under ~/.nash and creates no ~/.orca', () => {
    saveBitbucketCredential({
      authMode: 'token',
      email: null,
      baseUrl: null,
      account: null,
      accessToken: FIXTURE_ONLY_KEY,
      apiToken: null
    })
    saveJiraToken('fixture-site', FIXTURE_ONLY_KEY)
    ensureWorkspaceTokenDir()
    saveMiniMaxSessionCookie(FIXTURE_ONLY_KEY)
    saveOpenAiSpeechApiKey(FIXTURE_ONLY_KEY)
    saveZcodePlanApiKey(FIXTURE_ONLY_KEY)
    createEncryptedApiKeyFileStore({
      fileName: 'fixture-api-key.enc',
      envelopePrefix: 'fixture-api-key:v1:',
      providerLabel: 'Fixture',
      logScope: 'fixture'
    }).save(FIXTURE_ONLY_KEY)

    expect(readdirSync(fixtureHome.path)).toEqual(['.nash'])
    const stored = readdirSync(join(fixtureHome.path, '.nash'))
    expect(stored).toEqual(
      expect.arrayContaining([
        'bitbucket-credential.enc',
        'fixture-api-key.enc',
        'jira-tokens',
        'linear-tokens'
      ])
    )
  })

  it('places the Linear credential files under ~/.nash', () => {
    mkdirSync(fixtureHome.path, { recursive: true })

    expect(getWorkspaceFilePath()).toBe(join(fixtureHome.path, '.nash', 'linear-workspaces.json'))
    expect(getLegacyViewerPath()).toBe(join(fixtureHome.path, '.nash', 'linear-viewer.json'))
  })
})
