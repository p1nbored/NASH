import { describe, expect, it } from 'vitest'
import {
  DESKTOP_ONLY_TOOLS,
  DOT_ANSWERABLE_TOOLS,
  TERMINAL_ONLY_TOOLS,
  classifyPermissionAudience,
  type PermissionRelayInput
} from './permission-audience'

const CONTROL = ['nash']

function input(
  toolName: string,
  toolInput: PermissionRelayInput['toolInput'] = {}
): PermissionRelayInput {
  return { toolName, agentId: null, cwd: 'C:\\fixture\\repo', toolInput }
}

describe('permission audience', () => {
  it('keeps question and plan dialogs in the terminal: a yes or no cannot carry their answers', () => {
    expect([...TERMINAL_ONLY_TOOLS].sort()).toEqual(['AskUserQuestion', 'ExitPlanMode'])
    for (const tool of TERMINAL_ONLY_TOOLS) {
      expect(classifyPermissionAudience(input(tool), CONTROL)).toBe('terminal_only')
    }
  })

  it('names exactly the tools dot may answer: those whose summary shows the command or file', () => {
    expect(Object.keys(DOT_ANSWERABLE_TOOLS).sort()).toEqual(
      ['Bash', 'Edit', 'Glob', 'Monitor', 'NotebookEdit', 'PowerShell', 'Read', 'Write'].sort()
    )
  })

  it('lists the desktop-only tools explicitly and never offers them to dot', () => {
    expect([...DESKTOP_ONLY_TOOLS].sort()).toEqual(
      [
        'Agent',
        'Artifact',
        'CronCreate',
        'EnterPlanMode',
        'EnterWorktree',
        'Grep',
        'PushNotification',
        'RemoteTrigger',
        'ScheduleWakeup',
        'SendFeedback',
        'SendMessage',
        'SendUserFile',
        'ShareOnboardingGuide',
        'Skill',
        'WebFetch',
        'WebSearch',
        'Workflow'
      ].sort()
    )
    for (const tool of DESKTOP_ONLY_TOOLS) {
      expect(classifyPermissionAudience(input(tool, { command: 'ls' }), CONTROL), tool).toBe(
        'desktop_only'
      )
    }
  })

  it('keeps MCP tools and any unknown tool on the desktop', () => {
    expect(classifyPermissionAudience(input('mcp__github__create_issue'), CONTROL)).toBe(
      'desktop_only'
    )
    expect(classifyPermissionAudience(input('BrandNewTool', { command: 'ls' }), CONTROL)).toBe(
      'desktop_only'
    )
  })

  it('lets dot answer ordinary commands and workspace files', () => {
    expect(classifyPermissionAudience(input('Bash', { command: 'git status' }), CONTROL)).toBe(
      'dot_and_desktop'
    )
    expect(
      classifyPermissionAudience(
        input('Edit', { file_path: 'C:\\fixture\\repo\\src\\a.ts' }),
        CONTROL
      )
    ).toBe('dot_and_desktop')
    expect(
      classifyPermissionAudience(
        input('Glob', { pattern: '**/*.ts', path: '/fixture/repo' }),
        CONTROL
      )
    ).toBe('dot_and_desktop')
  })

  it('needs the detail the summary would show; without it the prompt stays on the desktop', () => {
    expect(classifyPermissionAudience(input('Bash'), CONTROL)).toBe('desktop_only')
    expect(classifyPermissionAudience(input('Edit', { command: 'x' }), CONTROL)).toBe(
      'desktop_only'
    )
    expect(classifyPermissionAudience(input('Grep', { pattern: 'TODO' }), CONTROL)).toBe(
      'desktop_only'
    )
    expect(classifyPermissionAudience(input('Monitor', {}), CONTROL)).toBe('desktop_only')
  })

  it("keeps Claude Code's protected paths on the desktop, whatever the separator or case", () => {
    const protectedWrites = [
      'C:\\fixture\\repo\\.claude\\settings.json',
      '/home/fixture/.claude/settings.local.json',
      'C:\\fixture\\repo\\.git\\hooks\\pre-commit',
      '/fixture/repo/.mcp.json',
      'C:\\Users\\fixture\\.claude.json',
      '/home/fixture/.bashrc',
      '/fixture/repo/.VSCode/settings.json',
      '/home/fixture/.config/git/config',
      'C:\\Users\\fixture\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1'
    ]
    for (const path of protectedWrites) {
      expect(classifyPermissionAudience(input('Write', { file_path: path }), CONTROL), path).toBe(
        'desktop_only'
      )
    }
    expect(
      classifyPermissionAudience(
        input('Edit', { file_path: '/fixture/repo/.claude/worktrees/wt1/src/a.ts' }),
        CONTROL
      )
    ).toBe('dot_and_desktop')
  })

  it('keeps credential files on the desktop, for reads too', () => {
    const credentialPaths = [
      '/fixture/repo/.env',
      '/fixture/repo/.env.local',
      'C:\\Users\\fixture\\.ssh\\id_ed25519',
      '/home/fixture/.aws/credentials',
      '/fixture/repo/certs/server.pem',
      '/home/fixture/.netrc',
      '/home/fixture/.git-credentials'
    ]
    for (const path of credentialPaths) {
      expect(classifyPermissionAudience(input('Read', { file_path: path }), CONTROL), path).toBe(
        'desktop_only'
      )
    }
    expect(
      classifyPermissionAudience(input('Read', { file_path: '/fixture/repo/.envoy.md' }), CONTROL)
    ).toBe('dot_and_desktop')
  })

  it('keeps commands that touch protected or credential paths on the desktop', () => {
    const commands = [
      'echo x >> ~/.bashrc',
      'cat .env',
      'Get-Content $HOME\\.ssh\\id_rsa',
      'cp settings.json .claude/settings.json',
      'node -e "1" --config=.mcp.json'
    ]
    for (const command of commands) {
      expect(classifyPermissionAudience(input('Bash', { command }), CONTROL), command).toBe(
        'desktop_only'
      )
    }
  })

  it("keeps the app's own CLI and Claude Code itself on the desktop: they steer the control plane", () => {
    const commands = [
      'nash orchestration reset --all',
      'C:\\tools\\NASH.exe terminal send --terminal t1',
      'orca worktree rm --worktree x',
      'npx claude mcp add evil',
      'git status && claude config set x y'
    ]
    for (const command of commands) {
      expect(classifyPermissionAudience(input('PowerShell', { command }), CONTROL), command).toBe(
        'desktop_only'
      )
    }
    expect(
      classifyPermissionAudience(input('Bash', { command: 'grep -r nashville .' }), CONTROL)
    ).toBe('dot_and_desktop')
  })
})
