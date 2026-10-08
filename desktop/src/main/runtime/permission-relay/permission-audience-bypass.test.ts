import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_METADATA_FILE } from '../../../shared/dot-ingress/dot-ingress-metadata'
import { getRuntimeMetadataPath } from '../../../shared/runtime-bootstrap'
import {
  DESKTOP_ONLY_TOOLS,
  DOT_ANSWERABLE_TOOLS,
  classifyPermissionAudience,
  isDesktopOnlyTool,
  type PermissionAudience,
  type PermissionRelayInput
} from './permission-audience'

// FIXTURE_ONLY: every path below is synthetic; no file is read.
const CONTROL = ['nash']
const USER_DATA = 'C:\\Users\\fixture\\AppData\\Roaming\\nash'

function classify(
  toolName: string,
  toolInput: PermissionRelayInput['toolInput'],
  options: { cwd?: string | null; appData?: readonly string[] } = {}
): PermissionAudience {
  const cwd = options.cwd === undefined ? 'C:\\fixture\\repo' : options.cwd
  return classifyPermissionAudience(
    { toolName, agentId: null, cwd, toolInput },
    CONTROL,
    options.appData ?? []
  )
}

function expectDesktopOnly(toolName: string, key: 'file_path' | 'command', values: string[]) {
  for (const value of values) {
    expect(classify(toolName, { [key]: value }), value).toBe('desktop_only')
  }
}

describe('permission audience: parent segments and the worktrees exemption (M1a)', () => {
  it('resolves .. before matching, so climbing out of .claude/worktrees reaches .claude', () => {
    expectDesktopOnly('Write', 'file_path', [
      'C:\\proj\\.claude\\worktrees\\..\\settings.json',
      '/repo/.claude/worktrees/wt1/../../settings.local.json',
      'C:/proj/.claude/worktrees/./../settings.json'
    ])
  })

  it('keeps the exemption for paths that stay inside a worktree', () => {
    expect(classify('Edit', { file_path: '/repo/.claude/worktrees/./wt1/src/a.ts' })).toBe(
      'dot_and_desktop'
    )
    expect(classify('Edit', { file_path: '/repo/.claude/worktrees/wt1/src/../lib/b.ts' })).toBe(
      'dot_and_desktop'
    )
  })

  it('never relaxes a path that names a protected folder, even when .. leaves it again', () => {
    expect(classify('Edit', { file_path: '/repo/.git/../src/a.ts' })).toBe('desktop_only')
  })

  it('resolves a relative path against the working directory', () => {
    const cwd = '/repo/.claude/worktrees/wt1'
    expect(classify('Write', { file_path: '../../settings.json' }, { cwd })).toBe('desktop_only')
    expect(classify('Write', { file_path: 'src/a.ts' }, { cwd })).toBe('dot_and_desktop')
  })
})

describe('permission audience: Windows path aliases (M1b)', () => {
  it('strips trailing dots and spaces from every segment, as Windows does', () => {
    expectDesktopOnly('Read', 'file_path', [
      'C:\\Users\\fixture\\.ssh.\\known_hosts',
      'C:\\Users\\fixture\\.ssh \\known_hosts',
      'C:\\fixture\\repo\\.env.',
      'C:\\fixture\\repo\\.env . .',
      'C:\\fixture\\repo\\.git.\\config'
    ])
  })

  it('keeps alternate data streams and any colon after the drive on the desktop', () => {
    expectDesktopOnly('Read', 'file_path', [
      'C:\\fixture\\repo\\.env::$DATA',
      'C:\\fixture\\repo\\notes.txt:hidden',
      '/fixture/repo/a:b.txt'
    ])
  })

  it('keeps 8.3 short names, device paths and dots-only segments on the desktop', () => {
    expectDesktopOnly('Read', 'file_path', [
      'C:\\Users\\fixture\\GIT-CR~1',
      'C:\\Users\\fixture\\SSH~1\\known_hosts',
      '\\\\?\\C:\\fixture\\repo\\src\\a.ts',
      '\\\\.\\C:\\fixture\\repo\\src\\a.ts',
      '//?/C:/fixture/repo/src/a.ts',
      'C:\\fixture\\repo\\...\\a.ts'
    ])
  })

  it('still lets dot answer an ordinary drive path', () => {
    expect(classify('Read', { file_path: 'C:\\fixture\\repo\\docs\\plan.md' })).toBe(
      'dot_and_desktop'
    )
    expect(classify('Read', { file_path: 'c:/fixture/repo/docs/plan.v2.md' })).toBe(
      'dot_and_desktop'
    )
  })
})

describe('permission audience: shell quoting, expansion and globs (M1c)', () => {
  it('keeps commands that build a name from quotes, escapes or expansions on the desktop', () => {
    for (const tool of ['Bash', 'PowerShell', 'Monitor']) {
      for (const command of [
        "o''rca terminal send --terminal t1",
        'cl""aude mcp add evil',
        "& ('or'+'ca') terminal send",
        'c\\laude config set x y',
        '{o,}rca terminal send',
        'cmd /c o^rca terminal send',
        'echo $HOME',
        'echo `id`',
        'cat ~/.s*/id_*',
        'cat /home/fixture/.s?h/known_hosts',
        'cat [.]env',
        'tail -f ~/build.log',
        'git log %h'
      ]) {
        expect(classify(tool, { command }), `${tool}: ${command}`).toBe('desktop_only')
      }
    }
  })

  it('normalises path tokens in commands before matching', () => {
    expectDesktopOnly('Bash', 'command', [
      'cat C:/proj/.claude/worktrees/../settings.json',
      'type C:/fixture/repo/.env.',
      'type C:/fixture/repo/.env:stream',
      'cat /c/Users/fixture/AppData/Roaming/nash/orca-runtime.json'
    ])
  })

  it('keeps a command that climbs out of a worktree inside .claude on the desktop', () => {
    const cwd = '/repo/.claude/worktrees/wt1'
    expect(classify('Bash', { command: 'cd ../.. && cat settings.json' }, { cwd })).toBe(
      'desktop_only'
    )
    expect(classify('Bash', { command: 'cd .. && cd .. && cat settings.json' }, { cwd })).toBe(
      'desktop_only'
    )
    expect(classify('Bash', { command: 'npm test' }, { cwd })).toBe('dot_and_desktop')
  })

  it('still lets dot answer plain commands', () => {
    for (const command of [
      'git status',
      'npm test',
      'ls -la src',
      'git diff --stat',
      'tail -f build.log',
      'pnpm run build:mac',
      'git status --short'
    ]) {
      expect(classify('Bash', { command }), command).toBe('dot_and_desktop')
    }
  })
})

describe('permission audience: Grep and Glob (M2)', () => {
  it('keeps Grep on the desktop: its search reaches every file below the path', () => {
    expect(Object.keys(DOT_ANSWERABLE_TOOLS)).not.toContain('Grep')
    expect(DESKTOP_ONLY_TOOLS).toContain('Grep')
    expect(isDesktopOnlyTool('Grep')).toBe(true)
    expect(classify('Grep', { path: '/fixture/repo/src/a.ts', pattern: 'TODO' })).toBe(
      'desktop_only'
    )
  })

  it("checks Glob's pattern as a path", () => {
    for (const toolInput of [
      { pattern: '.ssh/*', path: '/home/fixture' },
      { pattern: '**/.env' },
      { pattern: '/home/fixture/.aws/**' },
      { pattern: '.s*/id_*', path: '/home/fixture' },
      { pattern: '**/.e?v*' },
      { pattern: '../../settings.json', path: '/repo/.claude/worktrees/wt1' }
    ]) {
      expect(classify('Glob', toolInput), JSON.stringify(toolInput)).toBe('desktop_only')
    }
    expect(classify('Glob', { pattern: '**/*.ts', path: '/fixture/repo' })).toBe('dot_and_desktop')
    expect(classify('Glob', { pattern: 'src/**/*.{ts,tsx}' })).toBe('dot_and_desktop')
  })
})

describe("permission audience: NASH's own token files and data folder (M3)", () => {
  it('names the runtime metadata files the app writes', () => {
    for (const name of [
      basename(getRuntimeMetadataPath('C:\\fixture')),
      DOT_INGRESS_METADATA_FILE,
      'clef-api-token.enc',
      'dot-remote-service-token.enc',
      'secrets.json.enc'
    ]) {
      expect(classify('Read', { file_path: `/elsewhere/${name}` }), name).toBe('desktop_only')
    }
    expect(classify('Read', { file_path: '/home/fixture/.nash/agent-hooks/hook.js' })).toBe(
      'desktop_only'
    )
  })

  it('keeps every path under the app data folder on the desktop', () => {
    const appData = [USER_DATA]
    for (const path of [
      `${USER_DATA}\\orchestration.db`,
      'c:/users/FIXTURE/appdata/roaming/NASH/logs/main.log',
      `${USER_DATA}\\Local Storage\\leveldb\\000003.log`,
      '\\\\localhost\\c$\\Users\\fixture\\AppData\\Roaming\\nash\\orchestration.db',
      '/mnt/c/Users/fixture/AppData/Roaming/nash/orchestration.db'
    ]) {
      expect(classify('Read', { file_path: path }, { appData }), path).toBe('desktop_only')
    }
    expect(
      classify(
        'Bash',
        { command: 'cat /c/Users/fixture/AppData/Roaming/nash/settings.json' },
        {
          appData
        }
      )
    ).toBe('desktop_only')
    expect(classify('Bash', { command: 'git status' }, { cwd: USER_DATA, appData })).toBe(
      'desktop_only'
    )
    expect(
      classify(
        'Read',
        { file_path: 'C:\\Users\\fixture\\AppData\\Roaming\\nash-other\\a.txt' },
        {
          appData
        }
      )
    ).toBe('dot_and_desktop')
    expect(classify('Read', { file_path: `${USER_DATA}\\orchestration.db` })).toBe(
      'dot_and_desktop'
    )
  })
})
