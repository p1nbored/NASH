import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_ROUTE_ROWS,
  buildTestRoutingTable,
  buildTestTableWithRoute
} from './routing-table-document-rows.test-fixture'
import {
  CoordinatorSchema,
  RoutingTableSchema,
  ValidationPolicySchema,
  ValidationReviewerSchema
} from './routing-table-schema'

function parses(input: unknown): boolean {
  return RoutingTableSchema.safeParse(input).success
}

describe('RoutingTableSchema: the document table', () => {
  it('accepts the section 5 rows plus the coordinator and the reviewers', () => {
    const parsed = RoutingTableSchema.safeParse(buildTestRoutingTable())
    expect(parsed.success).toBe(true)
    expect(parsed.data?.routes).toHaveLength(DOCUMENT_ROUTE_ROWS.length)
    expect(parsed.data?.coordinator).toEqual({ model: 'claude-opus-5-5', reasoning_level: 'max' })
  })

  it('defaults the reasoning requirement to required and keeps if_supported when given', () => {
    const routes = RoutingTableSchema.parse(buildTestRoutingTable()).routes
    const agy = routes.find((route) => route.task_type === 'fast_writing_or_alternative_draft')
    const codex = routes.find((route) => route.task_type === 'routine_analysis_batch')
    expect(agy?.reasoning_requirement).toBe('if_supported')
    expect(codex?.reasoning_requirement).toBe('required')
  })

  it('treats the benchmark fields and notes as optional, informational text', () => {
    const table = buildTestTableWithRoute('software_engineering', {
      benchmark_sources: [{ name: 'Artificial Analysis', url: 'https://artificialanalysis.ai/' }],
      benchmark_snapshot_date: '2026-10-01',
      notes: 'Engineering and terminal work.'
    })
    expect(parses(table)).toBe(true)
  })
})

describe('RoutingTableSchema: model pins and the Gemini 4 exclusion', () => {
  it.each(['gemini-4', 'Gemini 4 Flash', 'gemini-4-pro-high', 'argon'])(
    'refuses %s on any route, the coordinator and the reviewers',
    (model) => {
      expect(parses(buildTestTableWithRoute('fast_writing_or_alternative_draft', { model }))).toBe(
        false
      )
      expect(
        parses(buildTestRoutingTable({ coordinator: { model, reasoning_level: 'max' } }))
      ).toBe(false)
      expect(
        parses(
          buildTestRoutingTable({
            validation: { reviewers: [{ target: 'codex_cli', model, reasoning_level: 'high' }] }
          })
        )
      ).toBe(false)
    }
  )

  it.each(['opus', 'sonnet', 'haiku', 'fable', 'latest', 'auto', 'flash', 'pro'])(
    'refuses the alias or selector %s as a pinned model',
    (model) => {
      expect(parses(buildTestTableWithRoute('software_engineering', { model }))).toBe(false)
      expect(
        parses(buildTestRoutingTable({ coordinator: { model, reasoning_level: 'max' } }))
      ).toBe(false)
    }
  )

  it('accepts the exact id that agy lists for Gemini 3.8 Flash and refuses the bare id as an alias', () => {
    expect(
      parses(buildTestTableWithRoute('fast_writing_or_alternative_draft', { model: 'flash' }))
    ).toBe(false)
    expect(
      parses(
        buildTestTableWithRoute('fast_writing_or_alternative_draft', {
          model: 'gemini-3.8-flash-high'
        })
      )
    ).toBe(true)
  })
})

describe('RoutingTableSchema: inheritance', () => {
  it.each(['claude_subagent', 'codex_cli', 'agy_cli'])(
    'refuses inherit on %s, which has no coordinator configuration to inherit',
    (execution_target) => {
      expect(
        parses(
          buildTestTableWithRoute('software_engineering', {
            execution_target,
            model: 'inherit',
            reasoning_level: 'max'
          })
        )
      ).toBe(false)
      expect(
        parses(
          buildTestTableWithRoute('software_engineering', {
            execution_target,
            model: 'claude-sonnet-5-5',
            reasoning_level: 'inherit'
          })
        )
      ).toBe(false)
    }
  )

  it('lets claude_workflow inherit and also pin its own configuration', () => {
    expect(
      parses(
        buildTestTableWithRoute('configured_project_workflow', {
          model: 'claude-sonnet-5-5',
          reasoning_level: 'high'
        })
      )
    ).toBe(true)
    expect(parses(buildTestRoutingTable())).toBe(true)
  })

  it('requires claude_primary to inherit both the model and the level', () => {
    const primary = { execution_target: 'claude_primary' }
    expect(
      parses(
        buildTestTableWithRoute('complex_planning_reasoning', {
          ...primary,
          model: 'claude-opus-5-5',
          reasoning_level: 'max'
        })
      )
    ).toBe(false)
    expect(
      parses(
        buildTestTableWithRoute('complex_planning_reasoning', {
          ...primary,
          model: 'inherit',
          reasoning_level: 'inherit'
        })
      )
    ).toBe(true)
  })

  it('keeps coordinator_reasoning in the primary session', () => {
    expect(
      parses(
        buildTestTableWithRoute('coordinator_reasoning', {
          execution_target: 'claude_subagent',
          model: 'claude-opus-5-5',
          reasoning_level: 'max'
        })
      )
    ).toBe(false)
  })

  it('refuses if_supported without a concrete level', () => {
    expect(
      parses(
        buildTestTableWithRoute('configured_project_workflow', {
          reasoning_level: 'inherit',
          reasoning_requirement: 'if_supported'
        })
      )
    ).toBe(false)
  })
})

describe('RoutingTableSchema: levels, shape and totality', () => {
  it.each(['MAX', '', 'extreme'])('refuses the level %j', (reasoning_level) => {
    expect(parses(buildTestTableWithRoute('software_engineering', { reasoning_level }))).toBe(false)
  })

  it.each(['ultra', 'none', 'minimal'])('allows the level %s (D-027)', (reasoning_level) => {
    expect(parses(buildTestTableWithRoute('software_engineering', { reasoning_level }))).toBe(true)
  })

  it('allows xhigh even though no default uses it', () => {
    expect(
      parses(buildTestTableWithRoute('software_engineering', { reasoning_level: 'xhigh' }))
    ).toBe(true)
  })

  it('requires exactly one route per task type in taxonomy order', () => {
    const routes = DOCUMENT_ROUTE_ROWS.map((row) => ({ ...row }))
    expect(parses(buildTestRoutingTable({ routes: routes.slice(1) }))).toBe(false)
    expect(parses(buildTestRoutingTable({ routes: [...routes, routes[1]] }))).toBe(false)
    expect(parses(buildTestRoutingTable({ routes: routes.toReversed() }))).toBe(false)
    const duplicated = routes.map((route, index) => (index === 9 ? { ...routes[8] } : route))
    expect(parses(buildTestRoutingTable({ routes: duplicated }))).toBe(false)
    expect(parses(buildTestRoutingTable({ routes: [] }))).toBe(false)
  })

  it('refuses a task type outside the taxonomy, including the classifier escape', () => {
    const routes = DOCUMENT_ROUTE_ROWS.map((row, index) =>
      index === 9 ? { ...row, task_type: 'needs_clarification' } : { ...row }
    )
    expect(parses(buildTestRoutingTable({ routes }))).toBe(false)
  })

  it('refuses unknown keys at every level', () => {
    expect(parses(buildTestRoutingTable({ extra: true }))).toBe(false)
    expect(parses(buildTestTableWithRoute('software_engineering', { score: 0.93 }))).toBe(false)
    expect(
      parses(
        buildTestRoutingTable({
          coordinator: { model: 'claude-opus-5-5', reasoning_level: 'max', effort: 'max' }
        })
      )
    ).toBe(false)
    expect(parses(buildTestRoutingTable({ validation: { reviewers: [], threshold: 1 } }))).toBe(
      false
    )
  })

  it('refuses a wrong schema version, a non-positive table version and a bad timestamp', () => {
    expect(parses(buildTestRoutingTable({ schema_version: 2 }))).toBe(false)
    expect(parses(buildTestRoutingTable({ table_version: 0 }))).toBe(false)
    expect(parses(buildTestRoutingTable({ table_version: 1.5 }))).toBe(false)
    expect(parses(buildTestRoutingTable({ created_at: 'yesterday' }))).toBe(false)
    expect(parses(buildTestRoutingTable({ source: 'agent' }))).toBe(false)
  })

  it('refuses a non-object input without throwing', () => {
    for (const input of [null, undefined, 'table', 7, []]) {
      expect(parses(input)).toBe(false)
    }
  })
})

describe('RoutingTableSchema: informational fields', () => {
  it('requires English notes (D-013)', () => {
    expect(parses(buildTestTableWithRoute('software_engineering', { notes: '工程任务' }))).toBe(
      false
    )
    expect(parses(buildTestRoutingTable({ notes: 'Привет' }))).toBe(false)
    expect(parses(buildTestRoutingTable({ notes: 'Initial default.' }))).toBe(true)
  })

  it('bounds the notes and refuses an empty note', () => {
    expect(
      parses(buildTestTableWithRoute('software_engineering', { notes: 'x'.repeat(501) }))
    ).toBe(false)
    expect(parses(buildTestTableWithRoute('software_engineering', { notes: '' }))).toBe(false)
  })

  it.each([
    [{ name: 'Arena', url: 'http://arena.ai/' }],
    [{ name: 'Arena', url: 'javascript:alert(1)' }],
    [{ name: 'Arena', url: 'not a url' }],
    [{ name: '', url: 'https://arena.ai/' }],
    [{ name: 'Arena', score: 1500 }]
  ])('refuses the benchmark source %j', (source) => {
    expect(
      parses(buildTestTableWithRoute('high_quality_writing', { benchmark_sources: [source] }))
    ).toBe(false)
  })

  it('refuses a snapshot date that is not an ISO date', () => {
    expect(
      parses(buildTestTableWithRoute('high_quality_writing', { benchmark_snapshot_date: 'Oct 1' }))
    ).toBe(false)
  })
})

describe('validation reviewers (D-017)', () => {
  it('keeps the reviewers in the order they were written', () => {
    const policy = ValidationPolicySchema.parse({
      reviewers: [
        { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' },
        { target: 'codex_cli', model: 'gpt-6.1-sol', reasoning_level: 'max' }
      ]
    })
    expect(policy.reviewers.map((reviewer) => reviewer.target)).toEqual([
      'claude_headless',
      'codex_cli'
    ])
  })

  it('allows an empty list, which leaves validation inconclusive without automatic checks', () => {
    expect(ValidationPolicySchema.safeParse({ reviewers: [] }).success).toBe(true)
  })

  it('accepts only codex_cli and claude_headless as review targets', () => {
    for (const target of ['agy_cli', 'claude_subagent', 'claude_primary', 'codex', '']) {
      expect(
        ValidationReviewerSchema.safeParse({
          target,
          model: 'gpt-6.1-sol',
          reasoning_level: 'high'
        }).success
      ).toBe(false)
    }
  })

  it.each(['inherit', 'latest', 'opus', 'gemini-4', 'gpt-6-sol'])(
    'applies the model pin policy to the reviewer model %s',
    (model) => {
      expect(
        ValidationReviewerSchema.safeParse({ target: 'codex_cli', model, reasoning_level: 'high' })
          .success
      ).toBe(false)
    }
  )

  it.each(['ultra', 'none'])('allows the reviewer level %s (D-027)', (reasoning_level) => {
    expect(
      ValidationReviewerSchema.safeParse({
        target: 'codex_cli',
        model: 'gpt-6.1-sol',
        reasoning_level
      }).success
    ).toBe(true)
  })

  it.each(['inherit', 'MAX'])('refuses the reviewer level %s', (reasoning_level) => {
    expect(
      ValidationReviewerSchema.safeParse({
        target: 'codex_cli',
        model: 'gpt-6.1-sol',
        reasoning_level
      }).success
    ).toBe(false)
  })

  it('bounds the list and requires English notes', () => {
    const reviewer = { target: 'codex_cli', model: 'gpt-6.1-sol', reasoning_level: 'high' }
    expect(
      ValidationPolicySchema.safeParse({ reviewers: Array.from({ length: 9 }, () => reviewer) })
        .success
    ).toBe(false)
    expect(ValidationPolicySchema.safeParse({ reviewers: [], notes: '待确认' }).success).toBe(false)
  })

  it('requires the validation block on every table', () => {
    const { validation: _validation, ...withoutValidation } = buildTestRoutingTable()
    expect(parses(withoutValidation)).toBe(false)
  })
})

describe('CoordinatorSchema', () => {
  it('needs a pinned model and a concrete level', () => {
    expect(
      CoordinatorSchema.safeParse({ model: 'claude-opus-5-5', reasoning_level: 'max' }).success
    ).toBe(true)
    expect(CoordinatorSchema.safeParse({ model: 'inherit', reasoning_level: 'max' }).success).toBe(
      false
    )
    expect(
      CoordinatorSchema.safeParse({ model: 'claude-opus-5-5', reasoning_level: 'inherit' }).success
    ).toBe(false)
  })
})
