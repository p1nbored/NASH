import { describe, expect, it } from 'vitest'
import { isLocalAbsolutePath, isPathInside, isUncOrDevicePath } from './path-containment'

describe('isPathInside', () => {
  it('treats the root itself and anything beneath it as inside', () => {
    expect(isPathInside('/srv/wt', '/srv/wt', 'linux')).toBe(true)
    expect(isPathInside('/srv/wt/a/b', '/srv/wt', 'linux')).toBe(true)
    expect(isPathInside('/srv/wt/a/../b', '/srv/wt', 'linux')).toBe(true)
  })

  it('does not treat a sibling that shares a name prefix as inside', () => {
    expect(isPathInside('/srv/wt-tools', '/srv/wt', 'linux')).toBe(false)
    expect(isPathInside('/srv/other', '/srv/wt', 'linux')).toBe(false)
  })

  it('does not let dot segments escape the root', () => {
    expect(isPathInside('/srv/wt/../other', '/srv/wt', 'linux')).toBe(false)
  })

  it('folds case on win32 only', () => {
    expect(isPathInside('C:\\Work\\WT\\x', 'c:\\work\\wt', 'win32')).toBe(true)
    expect(isPathInside('/SRV/wt', '/srv/wt', 'linux')).toBe(false)
  })

  it('accepts a root that already ends with a separator, including a drive root', () => {
    expect(isPathInside('C:\\a', 'C:\\', 'win32')).toBe(true)
    expect(isPathInside('/a', '/', 'linux')).toBe(true)
  })
})

describe('isUncOrDevicePath and isLocalAbsolutePath', () => {
  it.each(['\\\\server\\share', '\\\\?\\C:\\x', '//server/share', '\\\\.\\pipe\\x'])(
    'flags %s',
    (path) => {
      expect(isUncOrDevicePath(path)).toBe(true)
      expect(isLocalAbsolutePath(path, 'win32')).toBe(false)
    }
  )

  it('accepts only absolute local paths without NUL', () => {
    expect(isLocalAbsolutePath('C:\\work', 'win32')).toBe(true)
    expect(isLocalAbsolutePath('/work', 'linux')).toBe(true)
    expect(isLocalAbsolutePath('work', 'linux')).toBe(false)
    expect(isLocalAbsolutePath('/work\u0000x', 'linux')).toBe(false)
    expect(isLocalAbsolutePath('', 'linux')).toBe(false)
    expect(isLocalAbsolutePath(5, 'linux')).toBe(false)
  })
})
