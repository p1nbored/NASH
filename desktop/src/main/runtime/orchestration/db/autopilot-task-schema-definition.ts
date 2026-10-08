// Task-side tables of the autopilot_runtime_schema family. The B3, C2, C4 and C5 stores write them;
// they are defined here so the whole family is created and exact-SQL verified as one unit.
import {
  AUTOPILOT_EFFORT_LEVELS,
  WORKFLOW_RUN_ACCESS_LEVELS,
  sqlStringList,
  type AutopilotSchemaDefinition
} from './autopilot-run-schema-definition'

export const TASK_ISOLATION_NEEDS = ['none', 'worktree'] as const
/** D-027: a model review runs only when the TaskSpec asks for one; NULL means no request. */
export const TASK_SPEC_REVIEW_REQUESTS = ['model'] as const
/** The only class a TaskSpec may carry; it extends D-012 and is never lowered. */
export const TASK_SPEC_DATA_CLASS = 'agent_task_spec'

export const TASK_CLASSIFICATION_OUTCOMES = [
  'classified',
  'blocked',
  'invalid_output',
  'discarded_after_cancel'
] as const

export const TASK_ROUTE_TARGETS = [
  'claude_primary',
  'claude_subagent',
  'claude_workflow',
  'codex_cli',
  'agy_cli'
] as const
export const TASK_ROUTE_POLICY_LEVELS = [...AUTOPILOT_EFFORT_LEVELS, 'inherit'] as const
export const TASK_ROUTE_STATUSES = [
  'available',
  'unavailable',
  'unverified',
  'not_delegated'
] as const

export const ARTIFACT_ROOTS = ['worktree'] as const

export const TASK_VALIDATION_POLICIES = ['machine_checks', 'model_review'] as const
export const TASK_VALIDATION_VERDICTS = ['pending', 'pass', 'fail', 'inconclusive'] as const
export const TASK_VALIDATION_WAIVERS = ['desktop_user', 'dot'] as const

/** A path under a known root: never absolute, drive-qualified, backslashed or climbing out. */
function relativePathCheck(column: string): string {
  return [
    `length(${column}) BETWEEN 1 AND 1024`,
    `substr(${column}, 1, 1) <> '/'`,
    `instr(${column}, char(92)) = 0`,
    `instr(${column}, ':') = 0`,
    `${column} <> '..'`,
    `${column} NOT LIKE '../%'`,
    `${column} NOT LIKE '%/../%'`,
    `${column} NOT LIKE '%/..'`
  ].join(' AND ')
}

const JSON_ARRAY = (column: string): string =>
  `json_valid(${column}) AND json_type(${column}) = 'array'`

export const AUTOPILOT_TASK_SCHEMA_DEFINITIONS = [
  {
    name: 'task_specs',
    sql: `CREATE TABLE task_specs (
      task_id TEXT PRIMARY KEY NOT NULL CHECK (length(task_id) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL REFERENCES workflow_runs(run_id),
      spec_sha256 TEXT NOT NULL CHECK (length(spec_sha256) = 64),
      expected_outputs TEXT NOT NULL CHECK (${JSON_ARRAY('expected_outputs')}),
      acceptance_criteria TEXT NOT NULL CHECK (${JSON_ARRAY('acceptance_criteria')}),
      machine_checks TEXT NOT NULL CHECK (${JSON_ARRAY('machine_checks')}),
      task_constraints TEXT NOT NULL CHECK (${JSON_ARRAY('task_constraints')}),
      access_need TEXT NOT NULL CHECK (access_need IN (${sqlStringList(WORKFLOW_RUN_ACCESS_LEVELS)})),
      isolation_need TEXT NOT NULL CHECK (isolation_need IN (${sqlStringList(TASK_ISOLATION_NEEDS)})),
      workflow_name TEXT CHECK (workflow_name IS NULL OR length(workflow_name) BETWEEN 1 AND 128),
      review TEXT CHECK (review IS NULL OR review IN (${sqlStringList(TASK_SPEC_REVIEW_REQUESTS)})),
      data_class TEXT NOT NULL CHECK (data_class = '${TASK_SPEC_DATA_CLASS}'),
      created_at TEXT NOT NULL,
      UNIQUE (task_id, run_id)
    )`
  },
  {
    name: 'autopilot_task_spec_run',
    sql: 'CREATE INDEX autopilot_task_spec_run ON task_specs (run_id)'
  },
  {
    name: 'task_classifications',
    sql: `CREATE TABLE task_classifications (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      classification_id TEXT UNIQUE NOT NULL CHECK (length(classification_id) BETWEEN 1 AND 128),
      task_id TEXT NOT NULL REFERENCES task_specs(task_id),
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      outcome TEXT NOT NULL CHECK (outcome IN (${sqlStringList(TASK_CLASSIFICATION_OUTCOMES)})),
      detail TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 128),
      needs_delegation INTEGER CHECK (needs_delegation IS NULL OR needs_delegation IN (0, 1)),
      task_type TEXT CHECK (task_type IS NULL OR length(task_type) BETWEEN 1 AND 64),
      answers TEXT CHECK (answers IS NULL OR json_valid(answers)),
      bundle_sha256 TEXT CHECK (bundle_sha256 IS NULL OR length(bundle_sha256) = 64),
      taxonomy_version INTEGER CHECK (taxonomy_version IS NULL OR taxonomy_version > 0),
      profile_sha256 TEXT CHECK (profile_sha256 IS NULL OR length(profile_sha256) = 64),
      classifier_model TEXT CHECK (classifier_model IS NULL OR length(classifier_model) BETWEEN 1 AND 128),
      raw_response_id TEXT REFERENCES workbench_clef_raw_responses(raw_response_id),
      spend_reservation_id TEXT REFERENCES workbench_clef_spend(reservation_id),
      created_at TEXT NOT NULL,
      UNIQUE (task_id, attempt),
      CHECK (outcome <> 'classified' OR (needs_delegation IS NOT NULL AND task_type IS NOT NULL)),
      CHECK (outcome = 'classified' OR detail IS NOT NULL)
    )`
  },
  {
    name: 'task_routes',
    sql: `CREATE TABLE task_routes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id TEXT UNIQUE NOT NULL CHECK (length(route_id) BETWEEN 1 AND 128),
      classification_id TEXT NOT NULL REFERENCES task_classifications(classification_id),
      routing_table_version INTEGER NOT NULL CHECK (routing_table_version > 0),
      routing_table_sha256 TEXT NOT NULL CHECK (length(routing_table_sha256) = 64),
      target TEXT CHECK (target IS NULL OR target IN (${sqlStringList(TASK_ROUTE_TARGETS)})),
      model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 128),
      policy_level TEXT CHECK (policy_level IS NULL OR policy_level IN (${sqlStringList(TASK_ROUTE_POLICY_LEVELS)})),
      cli_setting TEXT CHECK (cli_setting IS NULL OR (json_valid(cli_setting) AND length(cli_setting) <= 2048)),
      status TEXT NOT NULL CHECK (status IN (${sqlStringList(TASK_ROUTE_STATUSES)})),
      reasons TEXT NOT NULL CHECK (${JSON_ARRAY('reasons')}),
      availability TEXT CHECK (availability IS NULL OR (json_valid(availability) AND length(availability) <= 8192)),
      created_at TEXT NOT NULL,
      CHECK ((status = 'not_delegated') = (target IS NULL))
    )`
  },
  {
    name: 'autopilot_task_route_classification',
    sql: 'CREATE INDEX autopilot_task_route_classification ON task_routes (classification_id, sequence)'
  },
  {
    name: 'attempt_artifacts',
    sql: `CREATE TABLE attempt_artifacts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      artifact_id TEXT UNIQUE NOT NULL CHECK (length(artifact_id) BETWEEN 1 AND 128),
      dispatch_id TEXT NOT NULL CHECK (length(dispatch_id) BETWEEN 1 AND 128),
      kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
      root TEXT NOT NULL CHECK (root IN (${sqlStringList(ARTIFACT_ROOTS)})),
      relative_path TEXT NOT NULL CHECK (${relativePathCheck('relative_path')}),
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_at TEXT NOT NULL,
      UNIQUE (dispatch_id, root, relative_path)
    )`
  },
  {
    name: 'task_validations',
    sql: `CREATE TABLE task_validations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      validation_id TEXT UNIQUE NOT NULL CHECK (length(validation_id) BETWEEN 1 AND 128),
      task_id TEXT NOT NULL REFERENCES task_specs(task_id),
      dispatch_id TEXT NOT NULL CHECK (length(dispatch_id) BETWEEN 1 AND 128),
      policy TEXT NOT NULL CHECK (policy IN (${sqlStringList(TASK_VALIDATION_POLICIES)})),
      criteria_sha256 TEXT NOT NULL CHECK (length(criteria_sha256) = 64),
      verdict TEXT NOT NULL CHECK (verdict IN (${sqlStringList(TASK_VALIDATION_VERDICTS)})),
      checks TEXT NOT NULL CHECK (${JSON_ARRAY('checks')}),
      validator_id TEXT NOT NULL CHECK (length(validator_id) BETWEEN 1 AND 128),
      worker_model TEXT CHECK (worker_model IS NULL OR length(worker_model) BETWEEN 1 AND 128),
      reviewer_model TEXT CHECK (reviewer_model IS NULL OR length(reviewer_model) BETWEEN 1 AND 128),
      evidence_refs TEXT NOT NULL CHECK (${JSON_ARRAY('evidence_refs')}),
      waiver TEXT CHECK (waiver IS NULL OR waiver IN (${sqlStringList(TASK_VALIDATION_WAIVERS)})),
      waived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (dispatch_id, policy),
      CHECK (waiver IS NULL OR verdict = 'inconclusive'),
      CHECK ((waiver IS NULL) = (waived_at IS NULL)),
      CHECK (policy <> 'model_review' OR (worker_model IS NOT NULL AND reviewer_model IS NOT NULL AND lower(worker_model) <> lower(reviewer_model)))
    )`
  },
  {
    name: 'autopilot_task_validation_task',
    sql: 'CREATE INDEX autopilot_task_validation_task ON task_validations (task_id, sequence)'
  },
  {
    name: 'clef_classification_spend',
    sql: `CREATE TABLE clef_classification_spend (
      reservation_id TEXT PRIMARY KEY NOT NULL REFERENCES workbench_clef_spend(reservation_id),
      run_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      FOREIGN KEY (task_id, run_id) REFERENCES task_specs (task_id, run_id),
      UNIQUE (task_id, attempt)
    )`
  }
] as const satisfies readonly AutopilotSchemaDefinition[]
