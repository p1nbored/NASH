import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// D-017: NASH must never read or write a folder a real Orca install owns, nor dial Orca's release
// feed. The renderer is excluded (a separate UI package owns it). Each rule scans production source.
const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCANNED_DIRS = ['main', 'shared', 'cli', 'relay', 'preload']
const NON_PRODUCTION_FILE =
  /\.(?:test|spec)\.tsx?$|\.test-fixture\.ts$|\.fixture\.ts$|-harness\.ts$|-test-support\.ts$|test-harness|test-mocks|test-fixtures|[\\/]orca-runtime-tests[\\/]/

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : listSourceFiles(path)
    }
    return /\.tsx?$/.test(entry.name) && !NON_PRODUCTION_FILE.test(path) ? [path] : []
  })
}

type Offence = { file: string; line: number; text: string }

function isCommentLine(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

function findOffences(pattern: RegExp, allowedFiles: readonly string[] = []): Offence[] {
  const allowed = new Set(allowedFiles)
  return SCANNED_DIRS.flatMap((dir) => listSourceFiles(join(SRC_ROOT, dir))).flatMap((path) => {
    const file = relative(SRC_ROOT, path).split(sep).join('/')
    if (allowed.has(file)) {
      return []
    }
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .flatMap((text, index) =>
        pattern.test(text) && !isCommentLine(text)
          ? [{ file, line: index + 1, text: text.trim().slice(0, 140) }]
          : []
      )
  })
}

// Per-repository folders live inside the user's project, not in a per-user folder shared across apps.
const PER_REPOSITORY_ORCA_FOLDER_FILES = [
  'main/issue-command-file.ts',
  'main/ipc/hooks/register-worktree-hook-file-handlers.ts',
  'main/runtime/runtime-repository-issue-command.ts',
  'main/ipc/filesystem-mutations.ts',
  'main/ipc/filesystem-import-ssh.ts',
  'main/runtime/browser-client-download-transfers.ts'
]
// Why allowed: bundled skill-guide prose (the UI and docs package rewrites it), not a path the app opens.
const GENERATED_GUIDE_TEXT = ['cli/bundled-skill-guides.ts']

describe('NASH never reaches an Orca release feed', () => {
  it('has no Orca release, atom, changelog or nudge address in production source', () => {
    const pattern =
      /releases\.atom|releases\/(?:latest\/)?download|github\.com\/stablyai\/orca\/releases|onorca\.dev\/(?:whats-new|changelog)|(?:MAIN|HOURLY|DAILY|ADHOC)_RELEASE_REPO/
    // Why allowed: these build their address from the configured feed, never from a literal.
    const derivedFromFeed = [
      'main/updater-release-repo-urls.ts',
      'main/updater-prerelease-feed.ts',
      'main/updater-release-builds.ts',
      'main/updater/updater-release-feed.ts',
      'main/updater/updater-setup.ts',
      'main/runtime/agent-state-rules/agent-state-rules-live-update.ts',
      'shared/release-channel.ts'
    ]
    // Why allowed: the third-party scrcpy server download, not an Orca host.
    const allowed = [...derivedFromFeed, 'main/emulator/android/scrcpy-server-download.ts']

    expect(findOffences(pattern, allowed)).toEqual([])
    const literalOrcaHosts = findOffences(/stablyai|onorca\.dev/).filter((offence) =>
      derivedFromFeed.includes(offence.file)
    )
    expect(literalOrcaHosts).toEqual([])
  })
})

describe('NASH never names an Orca macOS bundle id', () => {
  it('has no com.stablyai bundle id in production source', () => {
    expect(findOffences(/com\.stablyai/)).toEqual([])
  })
})

describe('NASH never answers the Orca URL scheme', () => {
  it('has no orca:// link or orca: protocol check in production source', () => {
    const pattern = /orca:\/\/|['"`]orca:['"`]/
    // Why allowed: a shared fixture the separate mobile app's own tests import; it is not app code.
    expect(findOffences(pattern, ['shared/mobile-relay-pairing-fixtures.ts'])).toEqual([])
  })
})

describe('NASH never uses an Orca per-user folder', () => {
  it('has no ~/.orca home folder', () => {
    const pattern = /['"`]\.orca['"`]|\.orca[/\\]|~\/\.orca/
    const allowed = [...PER_REPOSITORY_ORCA_FOLDER_FILES, ...GENERATED_GUIDE_TEXT]

    expect(findOffences(pattern, allowed)).toEqual([])
  })

  it('has no .orca-relay, .orca-remote or .orca-wsl folder', () => {
    // Why allowed: it only recognises a history path a real Orca relay minted, so the value is dropped.
    const allowed = ['main/worktree-history-file-path.ts']

    expect(findOffences(/\.orca-(?:relay|remote|wsl)\b/, allowed)).toEqual([])
  })

  it('has no ~/.local/share/orca data folder', () => {
    const pattern = /\.local[/\\'",\s]+share[/\\'",\s]+orca\b|\.local\/share\}?\/orca\b/

    expect(findOffences(pattern)).toEqual([])
  })

  it('has no ~/orca/projects or ~/orca/workspaces folder', () => {
    const pattern =
      /['"`]orca['"`],\s*['"`](?:projects|workspaces)['"`]|~\/orca\/|\/orca\/(?:projects|workspaces)/

    expect(findOffences(pattern, GENERATED_GUIDE_TEXT)).toEqual([])
  })

  it('has no Orca profile folder under the OS application-data root', () => {
    const pattern =
      /Application Support\/orca|%APPDATA%\\+orca|\/orca(?:-dev)?\/agent-hooks|\.config\}?\/orca\b|(?:APPDATA|XDG_CONFIG_HOME|Roaming|'\.config'|'AppData').*['"`]orca(?:-dev)?['"`]\)/

    expect(findOffences(pattern, GENERATED_GUIDE_TEXT)).toEqual([])
  })

  it('has no ~/.cache/orca folder or Orca AppImage cache', () => {
    const pattern =
      /\.cache\/orca\b|\.cache['"],\s*['"]orca['"]|['"`]orca['"`],\s*['"`]appimage['"`]/

    expect(findOffences(pattern)).toEqual([])
  })
})

describe('NASH never launches a real Orca install', () => {
  it('names no Orca app bundle, install folder or executable', () => {
    const pattern =
      /Applications\/Orca\b|['"`]Orca\.(?:app|exe)['"`]|['"`]Programs['"`],\s*['"`]Orca['"`]/

    expect(findOffences(pattern)).toEqual([])
  })
})
