import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SQLInputValue } from 'node:sqlite'
import { OrchestrationDb } from './orchestration-db'
import { ensureWorkbenchRequestSchema } from './workbench-request-schema'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import {
  FIXTURE_HASH_A,
  fixtureTime,
  insertRawRun,
  insertRawSpendReservation,
  insertRawTaskSpec
} from './autopilot-runtime.test-fixture'

let uniqueCounter = 0
const unique = (): number => ++uniqueCounter

// The task-side tables are created here and written by the B3 stores; these tests pin their invariants.
describe('autopilot task-side tables', () => {
  let owner: OrchestrationDb
  const run = (sql: string, ...values: SQLInputValue[]) => owner.db.prepare(sql).run(...values)

  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ensureWorkbenchRequestSchema(owner.db)
    ensureAutopilotRuntimeSchema(owner.db)
    insertRawRun(owner.db, 'run_fixture01', 'request_fixture01')
    insertRawTaskSpec(owner.db, 'task_fixture01', 'run_fixture01')
  })
  afterEach(() => owner.close())

  describe('rows stay inside their own run', () => {
    beforeEach(() => {
      insertRawRun(owner.db, 'run_fixture02', 'request_fixture02')
      insertRawSpendReservation(owner.db, 'reservation_fixture01')
    })

    it('refuses a spend link whose run is not the run of its task', () => {
      const link = (runId: string) => () =>
        run(
          'INSERT INTO clef_classification_spend (reservation_id, run_id, task_id, attempt) VALUES (?, ?, ?, 1)',
          'reservation_fixture01',
          runId,
          'task_fixture01'
        )
      expect(link('run_fixture02')).toThrow(/constraint/i)
      expect(link('run_fixture01')).not.toThrow()
    })
  })

  describe('task_specs', () => {
    const insertSpec = (overrides: { dataClass?: string; checks?: string; taskId?: string }) =>
      run(
        `INSERT INTO task_specs (task_id, run_id, spec_sha256, expected_outputs, acceptance_criteria,
          machine_checks, task_constraints, access_need, isolation_need, workflow_name, data_class, created_at)
          VALUES (?, 'run_fixture01', ?, '[]', '[]', ?, '[]', 'read_only', 'none', NULL, ?, ?)`,
        overrides.taskId ?? 'task_other',
        FIXTURE_HASH_A,
        overrides.checks ?? '[]',
        overrides.dataClass ?? 'agent_task_spec',
        fixtureTime()
      )

    it('allows a TaskSpec with no machine checks', () => {
      expect(() => insertSpec({ checks: '[]' })).not.toThrow()
    })

    it('takes no review request or a model review request, nothing else (D-027)', () => {
      const setReview = (review: string | null) =>
        run(`UPDATE task_specs SET review = ? WHERE task_id = 'task_other'`, review)
      insertSpec({})
      expect(() => setReview('model')).not.toThrow()
      expect(() => setReview(null)).not.toThrow()
      expect(() => setReview('machine')).toThrow(/constraint/i)
    })

    it('refuses any data class except agent_task_spec', () => {
      expect(() => insertSpec({ dataClass: 'user_task_summary' })).toThrow(/constraint/i)
      expect(() => insertSpec({ dataClass: 'file_contents' })).toThrow(/constraint/i)
    })

    it('refuses list fields that are not JSON arrays', () => {
      expect(() => insertSpec({ checks: '{"kind":"artifact_exists"}' })).toThrow()
      expect(() => insertSpec({ checks: 'not json' })).toThrow()
    })

    it('refuses a TaskSpec whose run does not exist', () => {
      expect(() =>
        run(
          `INSERT INTO task_specs (task_id, run_id, spec_sha256, expected_outputs, acceptance_criteria,
            machine_checks, task_constraints, access_need, isolation_need, data_class, created_at)
            VALUES ('task_orphan', 'run_missing', ?, '[]', '[]', '[]', '[]', 'read_only', 'none', 'agent_task_spec', ?)`,
          FIXTURE_HASH_A,
          fixtureTime()
        )
      ).toThrow(/constraint/i)
    })
  })

  describe('task_classifications and task_routes', () => {
    const classify = (outcome: string, detail: string | null, typed: boolean) =>
      run(
        `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, detail,
          needs_delegation, task_type, created_at) VALUES (?, 'task_fixture01', ?, ?, ?, ?, ?, ?)`,
        `classification_${outcome}_${String(detail)}`,
        unique(),
        outcome,
        detail,
        typed ? 1 : null,
        typed ? 'software_engineering' : null,
        fixtureTime()
      )

    it('requires needs_delegation and task_type for a classified outcome only', () => {
      expect(() => classify('classified', null, true)).not.toThrow()
      expect(() => classify('classified', null, false)).toThrow(/constraint/i)
      expect(() => classify('blocked', 'ambiguous/low_margin', false)).not.toThrow()
      expect(() => classify('blocked', null, false)).toThrow(/constraint/i)
      expect(() => classify('guessed', 'x', false)).toThrow(/constraint/i)
    })

    it('allows one classification per task attempt', () => {
      run(
        `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, detail, created_at)
          VALUES ('classification_a', 'task_fixture01', 1, 'blocked', 'invalid_output', ?)`,
        fixtureTime()
      )
      expect(() =>
        run(
          `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, detail, created_at)
            VALUES ('classification_b', 'task_fixture01', 1, 'blocked', 'invalid_output', ?)`,
          fixtureTime()
        )
      ).toThrow(/constraint/i)
    })

    const insertRoute = (status: string, target: string | null) =>
      run(
        `INSERT INTO task_routes (route_id, classification_id, routing_table_version, routing_table_sha256,
          target, model, policy_level, status, reasons, created_at)
          VALUES (?, 'classification_a', 1, ?, ?, ?, ?, ?, '[]', ?)`,
        `route_${unique()}`,
        FIXTURE_HASH_A,
        target,
        target === null ? null : 'gpt-6.1-sol',
        target === null ? null : 'max',
        status,
        fixtureTime()
      )

    it('gives a route a target exactly when the task is delegated', () => {
      run(
        `INSERT INTO task_classifications (classification_id, task_id, attempt, outcome, needs_delegation, task_type, created_at)
          VALUES ('classification_a', 'task_fixture01', 1, 'classified', 1, 'general_research_analysis', ?)`,
        fixtureTime()
      )
      expect(() => insertRoute('available', 'codex_cli')).not.toThrow()
      expect(() => insertRoute('unavailable', 'agy_cli')).not.toThrow()
      expect(() => insertRoute('not_delegated', null)).not.toThrow()
      expect(() => insertRoute('available', null)).toThrow(/constraint/i)
      expect(() => insertRoute('not_delegated', 'codex_cli')).toThrow(/constraint/i)
      expect(() => insertRoute('substituted', 'codex_cli')).toThrow(/constraint/i)
      expect(() => insertRoute('available', 'gemini_cli')).toThrow(/constraint/i)
    })
  })

  describe('attempt_artifacts', () => {
    it('records artifacts only by a relative path that stays inside its root', () => {
      const artifact = (root: string, path: string) =>
        run(
          `INSERT INTO attempt_artifacts (artifact_id, dispatch_id, kind, root, relative_path, sha256, size_bytes, created_at)
            VALUES (?, 'dispatch_a', 'output_file', ?, ?, ?, 10, ?)`,
          `artifact_${unique()}`,
          root,
          path,
          FIXTURE_HASH_A,
          fixtureTime()
        )
      expect(() => artifact('worktree', 'docs/report.md')).not.toThrow()
      expect(() => artifact('run_directory', 'last-message.txt')).toThrow(/constraint/i)
      for (const escaping of [
        '../secret.txt',
        'a/../../b',
        'a/..',
        '..',
        '/etc/passwd',
        '\\\\server\\share\\x',
        'C:\\Windows\\x',
        'C:/Windows/x',
        'a\\b',
        ''
      ]) {
        expect(() => artifact('worktree', escaping), escaping).toThrow(/constraint/i)
      }
      expect(() => artifact('home', 'a.txt')).toThrow(/constraint/i)
    })
  })

  describe('task_validations', () => {
    const validation = (fields: {
      policy: string
      verdict: string
      waiver?: string | null
      waivedAt?: string | null
      worker?: string | null
      reviewer?: string | null
      dispatch?: string
    }) =>
      run(
        `INSERT INTO task_validations (validation_id, task_id, dispatch_id, policy, criteria_sha256, verdict,
          checks, validator_id, worker_model, reviewer_model, evidence_refs, waiver, waived_at, created_at, updated_at)
          VALUES (?, 'task_fixture01', ?, ?, ?, ?, '[]', 'validator_fixture', ?, ?, '[]', ?, ?, ?, ?)`,
        `validation_${unique()}`,
        fields.dispatch ?? `dispatch_${unique()}`,
        fields.policy,
        FIXTURE_HASH_A,
        fields.verdict,
        fields.worker ?? null,
        fields.reviewer ?? null,
        fields.waiver ?? null,
        fields.waivedAt ?? null,
        fixtureTime(),
        fixtureTime()
      )

    it('accepts the four verdicts and refuses any other', () => {
      for (const verdict of ['pending', 'pass', 'fail', 'inconclusive']) {
        expect(() => validation({ policy: 'machine_checks', verdict })).not.toThrow()
      }
      expect(() => validation({ policy: 'machine_checks', verdict: 'waived' })).toThrow(
        /constraint/i
      )
      expect(() => validation({ policy: 'executor_said_done', verdict: 'pass' })).toThrow(
        /constraint/i
      )
    })

    it('lets only desktop_user or dot waive, and only an inconclusive result', () => {
      expect(() =>
        validation({
          policy: 'machine_checks',
          verdict: 'inconclusive',
          waiver: 'desktop_user',
          waivedAt: fixtureTime()
        })
      ).not.toThrow()
      expect(() =>
        validation({
          policy: 'machine_checks',
          verdict: 'inconclusive',
          waiver: 'dot',
          waivedAt: fixtureTime()
        })
      ).not.toThrow()
      expect(() =>
        validation({
          policy: 'machine_checks',
          verdict: 'fail',
          waiver: 'dot',
          waivedAt: fixtureTime()
        })
      ).toThrow(/constraint/i)
      expect(() =>
        validation({
          policy: 'machine_checks',
          verdict: 'inconclusive',
          waiver: 'primary_session',
          waivedAt: fixtureTime()
        })
      ).toThrow(/constraint/i)
      expect(() =>
        validation({
          policy: 'machine_checks',
          verdict: 'inconclusive',
          waiver: 'dot',
          waivedAt: null
        })
      ).toThrow(/constraint/i)
    })

    it('requires a model review to use a different model than the one that did the work', () => {
      expect(() =>
        validation({
          policy: 'model_review',
          verdict: 'pending',
          worker: 'claude-sonnet-5-5',
          reviewer: 'gpt-6.1-sol'
        })
      ).not.toThrow()
      expect(() =>
        validation({
          policy: 'model_review',
          verdict: 'pending',
          worker: 'claude-sonnet-5-5',
          reviewer: 'Claude-Sonnet-5-5'
        })
      ).toThrow(/constraint/i)
      expect(() =>
        validation({
          policy: 'model_review',
          verdict: 'pending',
          worker: null,
          reviewer: 'gpt-6.1-sol'
        })
      ).toThrow(/constraint/i)
    })

    it('allows one validation per attempt and policy', () => {
      validation({ policy: 'machine_checks', verdict: 'pending', dispatch: 'dispatch_same' })
      expect(() =>
        validation({ policy: 'machine_checks', verdict: 'pass', dispatch: 'dispatch_same' })
      ).toThrow(/constraint/i)
      expect(() =>
        validation({
          policy: 'model_review',
          verdict: 'pending',
          dispatch: 'dispatch_same',
          worker: 'claude-sonnet-5-5',
          reviewer: 'gpt-6.1-sol'
        })
      ).not.toThrow()
    })
  })
})
