import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import { RpcDispatcher } from './rpc/dispatcher'
import { AGENT_SESSION_METHODS } from './rpc/methods/agent-session'
import { _resetWslCachesForTests, _setWslCachesForTests } from '../wsl'
import { PROJECT_RUNTIME_REPAIR_REQUIRED_CODE } from '../../shared/project-runtime-repair-message'

vi.mock('../opencode/opencode-launch-capabilities', () => ({
  probeOpenCodeLaunchCapabilities: async () => ({
    version: '1.18.30',
    pluginApi: 'v1',
    promptMode: 'submit'
  })
}))
vi.mock('../opencode/opencode-model-availability', () => ({
  probeOpenCodeModelAvailability: async () => true,
  resolveOpenCodeDirectModelExecutable: async () => 'opencode'
}))

const repo = { id: 'r', path: 'C:\\repo', kind: 'git', projectGroupId: 'g' }
const share = { id: 's', path: '\\\\wsl$\\Ubuntu\\s', kind: 'git', projectGroupId: 'g' }
const folder = { id: 'f', projectGroupId: 'g', folderPath: 'C:\\work' }
const wsl = { kind: 'wsl', distro: 'Ubuntu' }
const store = {
  // A WSL Terminal shell must not move the model check into WSL, as it did once.
  getSettings: () => ({
    disabledTuiAgents: [],
    terminalWindowsShell: 'wsl.exe',
    terminalWindowsWslDistro: 'Ubuntu'
  }),
  getProjects: () => [
    { id: 'p', sourceRepoIds: ['r'], localWindowsRuntimePreference: wsl },
    { id: 'q', sourceRepoIds: ['s'], localWindowsRuntimePreference: { kind: 'windows-host' } }
  ],
  getRepo: (id: string) => [repo, share].find((entry) => entry.id === id),
  getRepos: () => [repo],
  getFolderWorkspaces: () => [folder],
  getProjectGroups: () => [{ id: 'g' }]
}
const scope = { id: 'f', path: 'C:\\work', connectionId: null, repo: null, folderWorkspace: folder }
const clientOperationId = `${Date.now()}-0123456789abcdef0123456789abcdef`
let runtime: OrcaRuntimeService
let spawned: () => (string | undefined)[]
const original = process.platform
const setPlatform = (value: string) =>
  Object.defineProperty(process, 'platform', { configurable: true, value })
beforeEach(() => {
  setPlatform('win32')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these paths read only the members above.
  runtime = new OrcaRuntimeService(store as never)
  Object.assign(runtime, {
    resolveTerminalWorkspaceLaunchScope: async () => scope,
    executionOwnerSupportsAgentSessionOperation: async () => true
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers read only the handle.
  const create = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({ handle: 't' } as never)
  spawned = () => create.mock.calls.map(([, opts]) => opts?.launchRuntime?.platform)
})
afterEach(() => {
  setPlatform(original)
  _resetWslCachesForTests()
})

// TEMPORARY until STA-10251: in a folder whose repo runs in WSL, OpenCode keeps main's Windows
// runtime at every entry point (create, resume, the worker's model check), so they agree.
it('starts, resumes and checks models for OpenCode in a WSL folder on Windows', async () => {
  await runtime.createAgentSession({ clientOperationId, worktree: 'id:f', agent: 'opencode' })
  const providerSession = { key: 'session_id', id: 'ses_1' } as const
  const resume = { kind: 'explicit', worktree: 'id:f', agent: 'opencode', providerSession } as const
  await runtime.ensureAgentSession(resume)
  expect(spawned()).toEqual(['win32', 'win32'])
  const target = { worktree: 'id:f', model: 'm' }
  expect(await runtime.probeOrchestrationOpenCodeModelLaunchSupport(target)).toBe(true)
})

// W5d: a folder whose repo's distro is gone is refused before any spawn, in the settings' words.
it('refuses an agent whose WSL distro is gone, under its own code', async () => {
  _setWslCachesForTests({ available: true, distros: ['Debian'] })
  const params = { clientOperationId, worktree: 'id:f', agent: 'codex' }
  const call = { id: '1', authToken: 't', method: 'terminal.createAgentSession', params }
  const response = await new RpcDispatcher({ runtime, methods: AGENT_SESSION_METHODS }).dispatch(
    call
  )
  const message =
    'No agent was started. Ubuntu is not installed in WSL. Choose an installed distro or switch this project to Windows.'
  expect(response).toMatchObject({ error: { code: PROJECT_RUNTIME_REPAIR_REQUIRED_CODE, message } })
})

// TEMPORARY parity: in a `\\wsl$` repo set to Windows host, OpenCode's model is checked on Windows,
// as on main; its command is still written for Linux, where it runs.
it('checks an OpenCode model on Windows in a WSL-share repo set to Windows host', async () => {
  const shareScope = { ...scope, id: 's', path: share.path, repo: share, folderWorkspace: null }
  Object.assign(runtime, { resolveTerminalWorkspaceLaunchScope: async () => shareScope })
  const request = { clientOperationId, worktree: 'id:s', agent: 'opencode' } as const
  await runtime.createAgentSession({ ...request, launchPreferences: { model: 'm' } })
  expect(spawned()).toEqual(['linux'])
})
