// FIXTURE_ONLY: the routes of docs/architecture-direction.md section 5, written out by hand so the
// schema and bundle tests do not depend on the bundled JSON they are checking.
type DocumentRow = {
  readonly task_type: string
  readonly execution_target: string
  readonly model: string
  readonly reasoning_level: string
}

/** Section 5 rows plus coordinator_reasoning (section 4); agy uses the id `agy models` lists. */
export const DOCUMENT_ROUTE_ROWS: readonly DocumentRow[] = [
  {
    task_type: 'coordinator_reasoning',
    execution_target: 'claude_primary',
    model: 'inherit',
    reasoning_level: 'inherit'
  },
  {
    task_type: 'complex_planning_reasoning',
    execution_target: 'claude_subagent',
    model: 'claude-opus-5-5',
    reasoning_level: 'max'
  },
  {
    task_type: 'software_engineering',
    execution_target: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    reasoning_level: 'max'
  },
  {
    task_type: 'scientific_experiment_validation',
    execution_target: 'codex_cli',
    model: 'gpt-6-astra',
    reasoning_level: 'max'
  },
  {
    task_type: 'complex_pdf_evidence_analysis',
    execution_target: 'codex_cli',
    model: 'gpt-6.1-sol',
    reasoning_level: 'max'
  },
  {
    task_type: 'general_research_analysis',
    execution_target: 'codex_cli',
    model: 'gpt-6.1-sol',
    reasoning_level: 'max'
  },
  {
    task_type: 'routine_analysis_batch',
    execution_target: 'codex_cli',
    model: 'gpt-6.1-sol',
    reasoning_level: 'high'
  },
  {
    task_type: 'high_quality_writing',
    execution_target: 'claude_subagent',
    model: 'claude-opus-5-5',
    reasoning_level: 'high'
  },
  {
    task_type: 'fast_writing_or_alternative_draft',
    execution_target: 'agy_cli',
    model: 'gemini-3.8-flash-high',
    reasoning_level: 'high'
  },
  {
    task_type: 'configured_project_workflow',
    execution_target: 'claude_workflow',
    model: 'inherit',
    reasoning_level: 'inherit'
  }
]

export type TestTableInput = Record<string, unknown>

/** A table in the file shape as unknown input; tests build variants, never mutate shared data. */
export function buildTestRoutingTable(overrides: TestTableInput = {}): TestTableInput {
  return {
    schema_version: 1,
    table_version: 1,
    taxonomy_version: 2,
    source: 'bundled',
    based_on: null,
    created_at: '2026-10-04T00:00:00Z',
    coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'max' },
    routes: DOCUMENT_ROUTE_ROWS.map((row) =>
      row.task_type === 'fast_writing_or_alternative_draft'
        ? { ...row, reasoning_requirement: 'if_supported' }
        : { ...row }
    ),
    validation: {
      reviewers: [
        { target: 'codex_cli', model: 'gpt-6.1-sol', reasoning_level: 'high' },
        { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' }
      ]
    },
    ...overrides
  }
}

/** The document table with one route patched; the patch may hold invalid values on purpose. */
export function buildTestTableWithRoute(taskType: string, patch: TestTableInput): TestTableInput {
  return buildTestRoutingTable({
    routes: DOCUMENT_ROUTE_ROWS.map((row) =>
      row.task_type === taskType ? { ...row, ...patch } : { ...row }
    )
  })
}
