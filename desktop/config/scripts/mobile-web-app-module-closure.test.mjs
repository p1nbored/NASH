import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { mobileWebAppModuleClosure } from './build-mobile-web-app-bundle.mjs'
import { withScratch } from './mobile-web-app-bundle-test-fixture.mjs'

it.each(['app/_layout', 'app/_layout.tsx'])(
  'resolves %s from the supplied directory without a TypeScript baseUrl',
  async (entry) => {
    await withScratch(async (scratch) => {
      const root = await realpath(scratch)
      await mkdir(join(root, 'app'))
      await writeFile(join(root, 'app/_layout.tsx'), "export default 'native'")
      await writeFile(join(root, 'app/_layout.web.tsx'), "export default 'web'")
      const closure = await mobileWebAppModuleClosure([entry], { absWorkingDir: root })
      expect(closure.modules).toEqual(['app/_layout.web.tsx'])
      expect(closure.local).toEqual(['app/_layout.web.tsx'])
    })
  }
)
