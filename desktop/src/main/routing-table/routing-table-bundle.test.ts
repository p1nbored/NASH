import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_ROUTE_ROWS,
  buildTestRoutingTable
} from '../../shared/routing-table/routing-table-document-rows.test-fixture'
import { ROUTING_TAXONOMY_VERSION } from '../../shared/routing-table/routing-table-taxonomy'
import {
  ROUTING_TABLE_MAX_FILE_BYTES,
  getBundledRoutingTable,
  parseRoutingTableText,
  routingTableContentSha256,
  routingTableFileText,
  routingTableSha256
} from './routing-table-bundle'

const GEMINI_4_FAMILY = /gemini[\s._-]*4(?![0-9])|argon/i
const DEFAULT_FILE = join(import.meta.dirname, 'default-routing-table.json')

function bundledRoute(taskType: string) {
  const route = getBundledRoutingTable().routes.find(
    (candidate) => candidate.task_type === taskType
  )
  if (!route) {
    throw new Error(`no bundled route for ${taskType}`)
  }
  return route
}

describe('the bundled default table (D-016, D-017)', () => {
  it('equals the architecture document rows plus coordinator_reasoning, in taxonomy order', () => {
    const table = getBundledRoutingTable()
    expect(
      table.routes.map(({ task_type, execution_target, model, reasoning_level }) => ({
        task_type,
        execution_target,
        model,
        reasoning_level
      }))
    ).toEqual(DOCUMENT_ROUTE_ROWS)
  })

  it('starts at version 1 for taxonomy 2 as a bundled table with no base', () => {
    const table = getBundledRoutingTable()
    expect(table.table_version).toBe(1)
    expect(table.taxonomy_version).toBe(ROUTING_TAXONOMY_VERSION)
    expect(table.source).toBe('bundled')
    expect(table.based_on).toBeNull()
  })

  it('holds the coordinator row of claude-opus-5-5 at max', () => {
    expect(getBundledRoutingTable().coordinator).toEqual({
      model: 'claude-opus-5-5',
      reasoning_level: 'max'
    })
  })

  it('keeps the Claude levels as the user wrote them and passes Codex effort explicitly', () => {
    expect(bundledRoute('software_engineering')).toMatchObject({
      execution_target: 'claude_subagent',
      reasoning_level: 'max'
    })
    expect(bundledRoute('high_quality_writing')).toMatchObject({ reasoning_level: 'high' })
    for (const type of ['scientific_experiment_validation', 'routine_analysis_batch']) {
      expect(bundledRoute(type).execution_target).toBe('codex_cli')
      expect(['high', 'max']).toContain(bundledRoute(type).reasoning_level)
    }
  })

  it('routes the agy row to the id that agy models lists, with the policy level recorded', () => {
    const agy = bundledRoute('fast_writing_or_alternative_draft')
    expect(agy.execution_target).toBe('agy_cli')
    expect(agy.model).toBe('gemini-3.8-flash-high')
    expect(agy.reasoning_level).toBe('high')
    expect(agy.reasoning_requirement).toBe('if_supported')
    expect(agy.notes).toMatch(/high thinking when supported/i)
    expect(agy.notes).toMatch(/no effort flag/i)
  })

  it('lists the default validation reviewers in order and marks them as awaiting confirmation', () => {
    const { validation } = getBundledRoutingTable()
    expect(validation.reviewers).toEqual([
      { target: 'codex_cli', model: 'gpt-6.1-sol', reasoning_level: 'high' },
      { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' }
    ])
    expect(validation.notes).toMatch(/awaiting user confirmation/i)
  })

  it('contains no Gemini 4 id anywhere in the file, notes included', () => {
    expect(GEMINI_4_FAMILY.test(readFileSync(DEFAULT_FILE, 'utf8'))).toBe(false)
  })

  it('keeps benchmark scores out of the file: the only numbers are version numbers', () => {
    const numbers: string[] = []
    const walk = (value: unknown, key: string): void => {
      if (typeof value === 'number') {
        numbers.push(key)
      } else if (Array.isArray(value)) {
        value.forEach((item) => walk(item, key))
      } else if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([entryKey, entry]) => walk(entry, entryKey))
      }
    }
    walk(JSON.parse(readFileSync(DEFAULT_FILE, 'utf8')), 'root')
    expect(numbers.sort()).toEqual(['schema_version', 'table_version', 'taxonomy_version'])
  })

  it('carries no benchmark snapshot date until the user supplies one', () => {
    for (const route of getBundledRoutingTable().routes) {
      expect(route.benchmark_snapshot_date).toBeUndefined()
    }
  })

  it('names benchmark sources only as informational text, never with a link it cannot stand behind', () => {
    for (const route of getBundledRoutingTable().routes) {
      for (const source of route.benchmark_sources ?? []) {
        expect(['Artificial Analysis', 'Arena', 'Vals']).toContain(source.name)
        expect(source.url).toBeUndefined()
      }
    }
  })
})

describe('parseRoutingTableText', () => {
  it('parses a table written by routingTableFileText back to the same identity', () => {
    const table = getBundledRoutingTable()
    const parsed = parseRoutingTableText(routingTableFileText(table))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && routingTableSha256(parsed.table)).toBe(routingTableSha256(table))
  })

  it('rejects text over the size cap before parsing it', () => {
    const padded = JSON.stringify(
      buildTestRoutingTable({ notes: 'x'.repeat(ROUTING_TABLE_MAX_FILE_BYTES) })
    )
    expect(parseRoutingTableText(padded)).toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects text that is not JSON', () => {
    expect(parseRoutingTableText('{not json')).toEqual({ ok: false, error: 'invalid_json' })
    expect(parseRoutingTableText('')).toEqual({ ok: false, error: 'invalid_json' })
  })

  it('rejects a table that fails the schema, whole, with the first problem named', () => {
    const text = JSON.stringify(buildTestRoutingTable({ routes: [] }))
    const parsed = parseRoutingTableText(text)
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error.startsWith('schema_invalid')).toBe(true)
  })

  it('never reports table content in an error', () => {
    const text = JSON.stringify(
      buildTestRoutingTable({ coordinator: { model: 'gemini-4-secret', reasoning_level: 'max' } })
    )
    const parsed = parseRoutingTableText(text)
    expect(!parsed.ok && parsed.error).not.toContain('gemini-4-secret')
  })
})

describe('table identity', () => {
  it('hashes the canonical content, so key order does not matter', () => {
    const table = getBundledRoutingTable()
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(table).toReversed()),
      null,
      4
    )
    const parsed = parseRoutingTableText(reordered)
    expect(parsed.ok && routingTableSha256(parsed.table)).toBe(routingTableSha256(table))
    expect(routingTableSha256(table)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the hash when any route, the coordinator or a reviewer changes', () => {
    const table = getBundledRoutingTable()
    const base = routingTableSha256(table)
    const variants = [
      {
        ...table,
        routes: table.routes.map((route, index) =>
          index === 3 ? { ...route, reasoning_level: 'high' as const } : route
        )
      },
      { ...table, coordinator: { ...table.coordinator, reasoning_level: 'high' as const } },
      {
        ...table,
        validation: { ...table.validation, reviewers: table.validation.reviewers.toReversed() }
      }
    ]
    for (const variant of variants) {
      expect(routingTableSha256(variant)).not.toBe(base)
    }
  })

  it('content identity ignores the version envelope but not the policy', () => {
    const table = getBundledRoutingTable()
    const relabeled = {
      ...table,
      table_version: 7,
      source: 'user' as const,
      based_on: { table_version: 6, sha256: 'c'.repeat(64) },
      created_at: '2027-01-01T00:00:00Z',
      notes: 'A note about this version.'
    }
    expect(routingTableContentSha256(relabeled)).toBe(routingTableContentSha256(table))
    expect(routingTableSha256(relabeled)).not.toBe(routingTableSha256(table))
    const changed = {
      ...table,
      coordinator: { ...table.coordinator, reasoning_level: 'high' as const }
    }
    expect(routingTableContentSha256(changed)).not.toBe(routingTableContentSha256(table))
  })
})
