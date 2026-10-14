import { describe, expect, it } from 'vitest'
import { assessCompatBoundaryImports } from './check-compat-boundary-imports.mjs'

const folders = [
  { folder: 'src/main/compat', importers: ['src/main/owner.ts'] },
  { folder: 'src/renderer/src/runtime/frozen', importers: [] }
]

function assess(files) {
  return assessCompatBoundaryImports(new Map(Object.entries(files)), folders)
}

describe('compatibility folder import boundary', () => {
  it('lets the named importer use the entry and the folder use itself', () => {
    expect(
      assess({
        'src/main/owner.ts': "import { a } from './compat'\nimport { b } from './compat/index.ts'",
        'src/main/compat/index.ts': "export { a } from './a'",
        'src/main/compat/a.test.ts': "import { a } from './a'"
      })
    ).toEqual([])
  })

  it('rejects other importers and deep imports, including renderer aliases', () => {
    expect(
      assess({
        'src/main/other.ts': "import { a } from './compat'",
        'src/main/owner.ts': "import { a } from './compat/a'",
        'src/renderer/src/store.ts': "import { f } from '@/runtime/frozen'"
      })
    ).toEqual([
      'src/main/other.ts: only src/main/owner.ts may import src/main/compat',
      'src/main/owner.ts: import src/main/compat through its index, not ./compat/a',
      'src/renderer/src/store.ts: only no file may import src/renderer/src/runtime/frozen'
    ])
  })

  it('resolves renderer aliases only in renderer files', () => {
    expect(assess({ 'mobile/src/app.ts': "import { f } from '@/runtime/frozen'" })).toEqual([])
  })

  it('lets tests outside the folder use only the entry', () => {
    expect(
      assess({
        'src/main/owner.test.ts': "import { a } from './compat'",
        'src/main/other.test.ts': "import { a } from './compat/a'"
      })
    ).toEqual(['src/main/other.test.ts: import src/main/compat through its index, not ./compat/a'])
  })

  it.each([
    './co\\u006dpat/a',
    './co\\x6dpat/a',
    './co\\mpat/a',
    './co\\\nmpat/a',
    './co\\u{6d}pat/a'
  ])('rejects deep imports with escaped folder names: %s', (specifier) => {
    expect(assess({ 'src/main/owner.ts': `import { a } from '${specifier}'` })).toEqual([
      'src/main/owner.ts: import src/main/compat through its index, not ./compat/a'
    ])
  })

  it('checks const-bound loaders and dot segments', () => {
    expect(
      assess({
        'src/main/other.ts': "const entry = './compat/nested/../index'; require(entry)",
        'src/renderer/src/store.ts': "export { f } from '@renderer/runtime/frozen/inner/../index'"
      })
    ).toEqual([
      'src/main/other.ts: only src/main/owner.ts may import src/main/compat',
      'src/renderer/src/store.ts: import src/renderer/src/runtime/frozen through its index, not @renderer/runtime/frozen/inner/../index'
    ])
  })

  it('checks imports inherited from a compatibility folder in the file path', () => {
    expect(
      assessCompatBoundaryImports(
        new Map([['src/main/compat.ts/consumer.ts', "import { a } from '.'"]]),
        [{ folder: 'src/main/compat', importers: [] }]
      )
    ).toEqual(['src/main/compat.ts/consumer.ts: only no file may import src/main/compat'])
  })

  it('keeps parse failures fatal for candidate files', () => {
    expect(() => assess({ 'src/main/owner.ts': "import { from './compat'" })).toThrow(
      'Cannot parse'
    )
  })
})
