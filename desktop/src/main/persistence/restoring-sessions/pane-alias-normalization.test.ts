import { describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../shared/stable-pane-id'
import {
  mergeLegacyPaneKeyAliasEntries,
  normalizeClaudeLivePtySessionIds,
  normalizeLegacyPaneKeyAliasEntries
} from './pane-alias-normalization'

const PANE_A = makePaneKey('tab-1', '11111111-1111-4111-8111-111111111111')
const PANE_B = makePaneKey('tab-2', '22222222-2222-4222-8222-222222222222')
const REMINTED = '$$MFRGGZDFMY:L$$'

describe('persisted remint pane-key aliases', () => {
  it('accepts remint and UUID relocation rows and drops hostile unmatched tokens', () => {
    const normalized = normalizeLegacyPaneKeyAliasEntries([
      { ptyId: 'pty-remint', legacyPaneKey: REMINTED, stablePaneKey: PANE_A, updatedAt: 10 },
      {
        ptyId: 'pty-relocated',
        legacyPaneKey: PANE_A,
        stablePaneKey: PANE_B,
        updatedAt: 11
      },
      {
        ptyId: 'pty-hostile',
        legacyPaneKey: '$$not-a-token$$',
        stablePaneKey: PANE_B,
        updatedAt: 12
      },
      {
        ptyId: 'pty-numeric-cross',
        legacyPaneKey: 'tab-other:0',
        stablePaneKey: PANE_A,
        updatedAt: 13
      }
    ])
    expect(normalized).toEqual([
      expect.objectContaining({ legacyPaneKey: REMINTED, stablePaneKey: PANE_A }),
      expect.objectContaining({ legacyPaneKey: PANE_A, stablePaneKey: PANE_B })
    ])
  })

  it('keeps the newest remint row during merge instead of binding two destinations', () => {
    const merged = mergeLegacyPaneKeyAliasEntries([
      { ptyId: 'pty-a', legacyPaneKey: REMINTED, stablePaneKey: PANE_A, updatedAt: 10 },
      { ptyId: 'pty-b', legacyPaneKey: REMINTED, stablePaneKey: PANE_B, updatedAt: 20 }
    ])
    expect(merged).toEqual([
      expect.objectContaining({
        ptyId: 'pty-b',
        legacyPaneKey: REMINTED,
        stablePaneKey: PANE_B,
        updatedAt: 20
      })
    ])
  })
})

// Why still normalized: the retired live-PTY id list stays in the persisted format, read as written.
describe('persisted Claude live-PTY ids', () => {
  it('drops malformed entries on load', () => {
    expect(
      normalizeClaudeLivePtySessionIds(['valid-id', '', 42, null, 'valid-id', 'x'.repeat(513)])
    ).toEqual(['valid-id'])
  })

  it('keeps the newest ids of an oversized list', () => {
    const ids = normalizeClaudeLivePtySessionIds(
      Array.from({ length: 205 }, (_, index) => `claude-${index}`)
    )
    expect(ids).toHaveLength(200)
    expect(ids[0]).toBe('claude-5')
    expect(ids[199]).toBe('claude-204')
  })
})
