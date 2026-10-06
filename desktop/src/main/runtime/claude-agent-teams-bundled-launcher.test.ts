import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveClaudeAgentTeamsShimBin } from './claude-agent-teams-shim-env'

const roots: string[] = []
const originalResourcesPath = process.resourcesPath

afterEach(async () => {
  Object.defineProperty(process, 'resourcesPath', {
    value: originalResourcesPath,
    configurable: true,
    writable: true
  })
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})

describe('claude agent teams shim bundled launcher', () => {
  it.skipIf(!['darwin', 'win32'].includes(process.platform))(
    'resolves the packaged NASH launcher, not an orca-named one, for the tmux callback binary',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'nash-agent-teams-cli-'))
      roots.push(root)
      await mkdir(join(root, 'bin'), { recursive: true })
      const launcher = join(root, 'bin', process.platform === 'win32' ? 'nash.exe' : 'nash')
      await writeFile(launcher, '#!/usr/bin/env sh\n', 'utf8')
      if (process.platform !== 'win32') {
        await chmod(launcher, 0o755)
      }
      Object.defineProperty(process, 'resourcesPath', {
        value: root,
        configurable: true,
        writable: true
      })

      expect(resolveClaudeAgentTeamsShimBin({ PATH: '' })).toBe(launcher)
    }
  )

  it.skipIf(!['darwin', 'win32'].includes(process.platform))(
    'ignores a leftover orca-named launcher in the packaged bin directory',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'nash-agent-teams-cli-'))
      roots.push(root)
      await mkdir(join(root, 'bin'), { recursive: true })
      const orcaLauncher = join(root, 'bin', process.platform === 'win32' ? 'orca.exe' : 'orca')
      await writeFile(orcaLauncher, '#!/usr/bin/env sh\n', 'utf8')
      if (process.platform !== 'win32') {
        await chmod(orcaLauncher, 0o755)
      }
      Object.defineProperty(process, 'resourcesPath', {
        value: root,
        configurable: true,
        writable: true
      })

      expect(resolveClaudeAgentTeamsShimBin({ PATH: '' })).toBeNull()
    }
  )
})
