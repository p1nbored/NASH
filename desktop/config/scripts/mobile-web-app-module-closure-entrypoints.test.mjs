import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { mobileWebAppModuleClosure } from './build-mobile-web-app-bundle.mjs'

it('resolves local entry paths against the requested tree and selects browser siblings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-route-entrypoints-'))
  try {
    await mkdir(join(root, 'app'))
    await writeFile(join(root, 'app', 'route.tsx'), "import 'native-only-package'")
    await writeFile(join(root, 'app', 'route.web.tsx'), "import './browser-dependency'")
    await writeFile(join(root, 'app', 'browser-dependency.ts'), 'export const browser = true')
    for (const entry of ['app/route', './app/route.tsx', join(root, 'app', 'route.tsx')]) {
      const { local } = await mobileWebAppModuleClosure([entry], { absWorkingDir: root })
      expect(local).toContain('app/route.web.tsx')
      expect(local).toContain('app/browser-dependency.ts')
      expect(local).not.toContain('app/route.tsx')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
