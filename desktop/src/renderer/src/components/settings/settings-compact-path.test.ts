import { describe, expect, it } from 'vitest'
import { compactPath } from './settings-compact-path'

describe('compactPath', () => {
  it('keeps the last two folders of a long path behind an ellipsis', () => {
    expect(compactPath('C:\\Users\\fixture\\Programs\\NASH\\desktop')).toBe('…\\NASH\\desktop')
    expect(compactPath('/home/fixture/src/nash/desktop')).toBe('…/nash/desktop')
  })

  it('returns short paths unchanged', () => {
    expect(compactPath('C:\\NASH\\desktop')).toBe('C:\\NASH\\desktop')
    expect(compactPath('/srv/app')).toBe('/srv/app')
  })

  it('ignores trailing and repeated separators', () => {
    expect(compactPath('/home//fixture/src/nash/')).toBe('…/src/nash')
  })
})
