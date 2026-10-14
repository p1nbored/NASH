/**
 * Guards literal-sense mistranslations (Push as 押す, run as 走る, Linear as
 * リニア, ...) so bootstrap re-translation cannot silently regress them.
 */
import { describe, expect, it } from 'vitest'
import ja from './locales/ja.json'

function collectValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) {
      collectValues(value, out)
    }
  }
  return out
}

function findByKey(node: unknown, key: string): string | undefined {
  if (!node || typeof node !== 'object') {
    return undefined
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findByKey(item, key)
      if (found !== undefined) {
        return found
      }
    }
    return undefined
  }
  const record = node as Record<string, unknown>
  if (typeof record[key] === 'string') {
    return record[key] as string
  }
  for (const value of Object.values(record)) {
    const found = findByKey(value, key)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

describe('ja technical literal / sense fixes', () => {
  it('translates the source control Push action as プッシュ, not 押す', () => {
    expect(findByKey(ja, '95550cff15')).toBe('プッシュ')
  })

  it('translates the source control Pull action as プル, not 引く', () => {
    expect(findByKey(ja, 'd64292a938')).toBe('プル')
  })

  it.each([
    ['走る', 'run as running on foot'],
    ['走っている', 'running as running on foot'],
    ['走らないで', "Don't run as don't run on foot"],
    ['逃走', 'missed run as escape'],
    ['労働者', 'worker as a labourer'],
    ['対立', 'merge conflict as a dispute'],
    ['使用法', 'usage as instructions for use'],
    ['リニア', 'the Linear product name as the word linear'],
    ['シャチ', 'the orca-linear skill name as the animal']
  ])('never renders %s (%s)', (literal) => {
    expect(collectValues(ja).filter((value) => value.includes(literal))).toEqual([])
  })
})
