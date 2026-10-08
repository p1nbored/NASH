import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOT_SETTINGS_ANCHOR_PREFIX,
  TASK_ROUTING_SETTINGS_ANCHOR_IDS,
  normalizeSettingsNavigationTarget
} from './settings-navigation-target-normalization'

function readSettingsSource(fileName: string): string {
  return readFileSync(join(process.cwd(), 'src/renderer/src/components/settings', fileName), 'utf8')
}

describe('normalizeSettingsNavigationTarget', () => {
  it('moves dot deep links from Integrations to the Dot category (D-038)', () => {
    for (const sectionId of [
      'integrations-dot',
      'integrations-dot-remote',
      'integrations-dot-interface',
      'integrations-dot-workspaces',
      'integrations-dot-limits'
    ]) {
      expect(
        normalizeSettingsNavigationTarget({ pane: 'integrations', repoId: null, sectionId })
      ).toEqual({ pane: 'dot', repoId: null, sectionId })
    }
  })

  it('moves Routing Table and Clef deep links to the Task routing category', () => {
    for (const sectionId of ['integrations-routing-table', 'integrations-clef-routing']) {
      expect(
        normalizeSettingsNavigationTarget({ pane: 'integrations', repoId: null, sectionId })
      ).toEqual({ pane: 'task-routing', repoId: null, sectionId })
    }
  })

  it('keeps the remaining Integrations deep links in Integrations', () => {
    const linear = { pane: 'integrations', repoId: null, sectionId: 'integrations-linear' } as const
    expect(normalizeSettingsNavigationTarget(linear)).toBe(linear)
    const pane = { pane: 'integrations', repoId: null } as const
    expect(normalizeSettingsNavigationTarget(pane)).toBe(pane)
  })

  it('drops links to the hidden Orca account and Mobile panes', () => {
    expect(normalizeSettingsNavigationTarget({ pane: 'orca-account', repoId: null })).toBeNull()
    expect(normalizeSettingsNavigationTarget({ pane: 'mobile', repoId: null })).toBeNull()
  })

  it('leaves other panes untouched', () => {
    const target = { pane: 'servers', repoId: null } as const
    expect(normalizeSettingsNavigationTarget(target)).toBe(target)
  })

  it('matches the anchors the dot and task routing cards render', () => {
    const anchors = [
      'dot-ingress-section.tsx',
      'dot-remote-access-card.tsx',
      'dot-ingress-interface-card.tsx',
      'dot-ingress-workspaces-card.tsx',
      'dot-ingress-limits-card.tsx'
    ].map((fileName) => /SECTION_ID = '([^']+)'/.exec(readSettingsSource(fileName))?.[1])
    for (const anchor of anchors) {
      expect(anchor?.startsWith(DOT_SETTINGS_ANCHOR_PREFIX)).toBe(true)
    }
    const routingAnchors = ['routing-table-card.tsx', 'clef-routing-card.tsx'].map(
      (fileName) => /SECTION_ID = '([^']+)'/.exec(readSettingsSource(fileName))?.[1]
    )
    expect([...TASK_ROUTING_SETTINGS_ANCHOR_IDS].sort()).toEqual([...routingAnchors].sort())
  })
})
