import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { mobileWebAppModuleClosure } from './build-mobile-web-app-bundle.mjs'

it.each(['extensionless', 'explicit', 'absolute'])(
  'resolves %s census entries against their source tree and prefers web siblings',
  async (form) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'orca-mobile-entry-'))
    const modules = ['app/_layout', 'app/h/_layout', 'app/h/[hostId]/index']
    const webModules = ['app/_layout.web.tsx', 'app/h/_layout.tsx', 'app/h/[hostId]/index.web.tsx']
    try {
      for (const file of [...webModules, 'app/_layout.tsx', 'app/h/[hostId]/index.tsx']) {
        const target = path.join(directory, file)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, 'export const entry = 1')
      }
      const entries = modules.map((entry) => {
        if (form === 'explicit') {
          return `${entry}.tsx`
        }
        if (form === 'absolute') {
          return path.join(directory, `${entry}.tsx`)
        }
        return entry
      })
      const { local } = await mobileWebAppModuleClosure(entries, { absWorkingDir: directory })
      expect(local.map((file) => file.replaceAll('\\', '/')).sort()).toEqual(webModules.sort())
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
