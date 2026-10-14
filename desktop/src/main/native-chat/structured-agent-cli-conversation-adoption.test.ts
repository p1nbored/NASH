import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLI_CONVERSATION_ADOPTING_AGENTS } from '../../shared/structured-agent-cli-conversation-adoption'
import {
  clearGrokSessionPathLookupCacheForTests,
  findGrokChatHistoryBySessionId,
  grokEncodedCwdDirName,
  GROK_SESSION_GROUP_SCAN_MAX_ENTRIES,
  setGrokSessionDirectoryOpenerForTests
} from '../../shared/grok-session-paths'
import {
  STRUCTURED_AGENT_RUNTIME_REGISTRATIONS,
  structuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import { resolveStructuredAgentSessionAdoptionForCreate } from '../runtime/structured-agent-session-create-adoption'
import { prepareLegacyTranscriptImport } from './agent-session-journal/journal-legacy-import'

const SESSION_ID = '0198c2a4-7d1e-7c3a-9a4b-1f2e3d4c5b6a'
let root: string | null = null

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  clearGrokSessionPathLookupCacheForTests()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
  root = null
})

/** Each agent's CLI conversation as its own CLI lays it out under an account home. */
const RECORDED: Record<'grok' | 'omp', (home: string, text: string) => Promise<string>> = {
  grok: async (home, text) => {
    const dir = join(home, 'sessions', encodeURIComponent('/repo/orca'), SESSION_ID)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'chat_history.jsonl')
    await writeFile(
      file,
      `${JSON.stringify({ type: 'user', content: [{ type: 'text', text }], timestamp: '2026-10-12T00:00:00.000Z' })}\n`
    )
    return file
  },
  omp: async (home, text) => {
    const dir = join(home, 'sessions', '--repo-orca--')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `2026-10-12T00-00-00-000Z_${SESSION_ID}.jsonl`)
    await writeFile(
      file,
      [
        {
          type: 'session',
          id: SESSION_ID,
          cwd: '/repo/orca',
          timestamp: '2026-10-12T00:00:00.000Z'
        },
        {
          type: 'message',
          id: 'rec-1',
          parentId: null,
          timestamp: '2026-10-12T00:00:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text }] }
        }
      ]
        .map((record) => JSON.stringify(record))
        .join('\n')
    )
    return file
  }
}

function adopt(
  agent: 'grok' | 'omp',
  selectedAccountHomePath: string,
  launchEnv: NodeJS.ProcessEnv = process.env,
  workspaceCwd = '/repo/orca'
) {
  // Grok also looks where Session History lists it from; keep that off the real home.
  vi.stubEnv('GROK_HOME', selectedAccountHomePath)
  const transcriptImport = structuredAgentRuntimeRegistration(agent)?.transcriptImport
  if (!transcriptImport) {
    throw new Error(`${agent} registers no transcript import`)
  }
  return resolveStructuredAgentSessionAdoptionForCreate({
    host: null,
    settings: {},
    agent,
    transcriptImport,
    providerSessionId: SESSION_ID,
    selfSessionId: 'chat-1',
    selectedAccountHomePath,
    launchEnv,
    workspaceCwd
  })
}

describe('which chats can take over a CLI conversation', () => {
  it('lists exactly the agents the host registers a transcript import for', () => {
    expect(
      STRUCTURED_AGENT_RUNTIME_REGISTRATIONS.filter((registration) => registration.transcriptImport)
        .map((registration) => registration.definition.agent)
        .toSorted()
    ).toEqual([...CLI_CONVERSATION_ADOPTING_AGENTS].toSorted())
  })
})

it.each([false, true])(
  'finds a Grok cwd beyond the generic cap (long path: %s)',
  async (longPath) => {
    root = await mkdtemp(join(tmpdir(), 'orca-grok-adopt-cwd-'))
    const workspaceCwd = join(root, longPath ? '中'.repeat(80) : 'workspace')
    const recorded = await RECORDED.grok(root, 'CURRENT-WORKSPACE')
    const group = grokEncodedCwdDirName(workspaceCwd)
    if (!group) {
      throw new Error('Expected a CLI cwd group')
    }
    const cwdRecorded = join(root, 'sessions', group, SESSION_ID)
    await mkdir(cwdRecorded, { recursive: true })
    const currentFile = join(cwdRecorded, 'chat_history.jsonl')
    await writeFile(currentFile, await readFile(recorded))
    setGrokSessionDirectoryOpenerForTests(async () => ({
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index <= GROK_SESSION_GROUP_SCAN_MAX_ENTRIES; index += 1) {
          yield {
            name: `earlier-${index}`,
            isDirectory: () => true,
            isSymbolicLink: () => false
          }
        }
      },
      close: async () => {}
    }))

    expect(await findGrokChatHistoryBySessionId(join(root, 'sessions'), SESSION_ID)).toBeNull()
    expect((await adopt('grok', root, process.env, workspaceCwd)).transcriptPath).toBe(currentFile)
  }
)

it('looks up OMP history under the configured launch XDG and profile root', async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-omp-adopt-env-'))
  const ambientData = join(root, 'ambient-data')
  const launchData = join(root, 'launch-data')
  const profile = 'work'
  const ambientSessions = join(ambientData, 'omp', 'profiles', profile, 'sessions')
  const launchSessions = join(launchData, 'omp', 'profiles', profile, 'sessions')
  await mkdir(join(ambientData, 'omp', 'profiles', profile), { recursive: true })
  await mkdir(join(launchData, 'omp', 'profiles', profile), { recursive: true })
  const ambientFile = await RECORDED.omp(join(ambientData, 'omp', 'profiles', profile), 'AMBIENT')
  const launchFile = await RECORDED.omp(join(launchData, 'omp', 'profiles', profile), 'LAUNCH')
  vi.stubEnv('XDG_DATA_HOME', ambientData)
  vi.stubEnv('OMP_PROFILE', profile)
  const launchEnv = {
    ...process.env,
    HOME: root,
    XDG_DATA_HOME: launchData,
    OMP_PROFILE: profile,
    OMP_CODING_AGENT_DIR: ''
  }
  const accountHome = join(root, '.omp', 'agent')

  expect(ambientFile.startsWith(ambientSessions)).toBe(true)
  expect(launchFile.startsWith(launchSessions)).toBe(true)
  expect((await adopt('omp', accountHome, launchEnv)).transcriptPath).toBe(launchFile)
})

it('uses the configured OMP profile when the ambient profile names another session', async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-omp-adopt-profile-'))
  const xdgData = join(root, 'data')
  const ambientProfile = 'ambient'
  const launchProfile = 'configured'
  const ambientHome = join(xdgData, 'omp', 'profiles', ambientProfile)
  const launchHome = join(xdgData, 'omp', 'profiles', launchProfile)
  await mkdir(ambientHome, { recursive: true })
  await mkdir(launchHome, { recursive: true })
  await RECORDED.omp(ambientHome, 'AMBIENT-PROFILE')
  const launchFile = await RECORDED.omp(launchHome, 'LAUNCH-PROFILE')
  vi.stubEnv('XDG_DATA_HOME', xdgData)
  vi.stubEnv('OMP_PROFILE', ambientProfile)

  const accountHome = join(root, '.omp', 'agent')
  const launchEnv = {
    ...process.env,
    HOME: root,
    OMP_PROFILE: launchProfile,
    OMP_CODING_AGENT_DIR: ''
  }
  expect((await adopt('omp', accountHome, launchEnv)).transcriptPath).toBe(launchFile)
})

it.each(['win32', 'linux', 'darwin'] as const)(
  'follows the child home precedence for a named OMP profile on %s',
  async (platform) => {
    root = await mkdtemp(join(tmpdir(), 'orca-omp-adopt-home-'))
    const home = join(root, 'home')
    const userProfile = join(root, 'user-profile')
    const profile = 'work'
    const homeFile = await RECORDED.omp(join(home, '.omp', 'profiles', profile, 'agent'), 'HOME')
    const userProfileFile = await RECORDED.omp(
      join(userProfile, '.omp', 'profiles', profile, 'agent'),
      'USERPROFILE'
    )
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)

    const adoption = await adopt('omp', join(root, 'account'), {
      HOME: home,
      USERPROFILE: userProfile,
      OMP_PROFILE: profile
    })

    expect(adoption.transcriptPath).toBe(platform === 'win32' ? userProfileFile : homeFile)
  }
)

it('refuses OMP history from another workspace without creating a blank chat', async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-omp-adopt-other-cwd-'))
  await RECORDED.omp(root, 'OTHER-WORKSPACE')
  await expect(adopt('omp', root, process.env, '/another/workspace')).rejects.toMatchObject({
    refusal: { code: 'agent_session_identity_required' }
  })
})

describe.each(['grok', 'omp'] as const)('adopting a %s CLI conversation', (agent) => {
  it('finds the conversation under the chat account and imports its history', async () => {
    root = await mkdtemp(join(tmpdir(), `orca-${agent}-adopt-`))
    const recorded = await RECORDED[agent](root, `ORCA-${agent}-ADOPT`)

    const adoption = await adopt(agent, root)

    expect(adoption).toEqual({ accountHomePath: root, transcriptPath: recorded })
    const imported = await prepareLegacyTranscriptImport({
      agent,
      sessionId: SESSION_ID,
      options: { filePath: adoption.transcriptPath }
    })
    expect(imported.ok && JSON.stringify(imported.items)).toContain(`ORCA-${agent}-ADOPT`)
  })

  it('refuses a conversation the account does not hold, rather than opening a blank chat', async () => {
    root = await mkdtemp(join(tmpdir(), `orca-${agent}-adopt-missing-`))
    await expect(adopt(agent, root)).rejects.toMatchObject({
      refusal: { code: 'agent_session_identity_required' }
    })
  })
})
