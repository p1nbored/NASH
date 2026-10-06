import type { WorkbenchSchemaDefinition } from './workbench-request-schema-definition'

export const WORKBENCH_V2_SCHEMA_VERSION = 2

/**
 * The exact pre-D-016 Workbench v2 layout, frozen so a v2 database is exact-SQL verified before it
 * is migrated to v3. Never edit: a v2 database that differs is refused, not migrated.
 */
export const WORKBENCH_V2_SCHEMA_DEFINITIONS: readonly WorkbenchSchemaDefinition[] = [
  {
    name: 'workbench_request_schema',
    sql: `CREATE TABLE workbench_request_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)`
  },
  {
    name: 'workbench_requests',
    sql: `CREATE TABLE workbench_requests (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      workspace_id TEXT NOT NULL,
      workspace_binding TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ROUTING_BLOCKED', 'ROUTING', 'ROUTED', 'CANCELED')),
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      blocker_reason TEXT,
      blocker_detail TEXT,
      model_profile_id TEXT,
      execution_surface TEXT,
      plugin_operation_id TEXT,
      clef_decision_id TEXT REFERENCES workbench_route_decisions(decision_id),
      UNIQUE (principal_id, idempotency_key),
      CHECK ((blocker_reason IS NULL) = (blocker_detail IS NULL)),
      CHECK ((status = 'ROUTING_BLOCKED') = (blocker_reason IS NOT NULL)),
      CHECK ((status = 'ROUTED') = (model_profile_id IS NOT NULL AND execution_surface IS NOT NULL AND clef_decision_id IS NOT NULL)),
      CHECK (status = 'ROUTED' OR (model_profile_id IS NULL AND execution_surface IS NULL AND plugin_operation_id IS NULL AND clef_decision_id IS NULL))
    )`
  },
  {
    name: 'workbench_request_scope',
    sql: `CREATE INDEX workbench_request_scope ON workbench_requests (workspace_id, workspace_binding, principal_id, sequence DESC)`
  },
  {
    name: 'workbench_request_events',
    sql: `CREATE TABLE workbench_request_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      kind TEXT NOT NULL CHECK (kind IN ('accepted', 'routing_started', 'routed', 'routing_blocked', 'route_discarded', 'canceled')),
      revision INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      input_hash TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_request_event_scope',
    sql: `CREATE INDEX workbench_request_event_scope ON workbench_request_events (request_id, sequence)`
  },
  {
    name: 'workbench_request_outbox',
    sql: `CREATE TABLE workbench_request_outbox (
      request_id TEXT PRIMARY KEY REFERENCES workbench_requests(request_id),
      state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'consumed', 'withdrawn')),
      revision INTEGER NOT NULL,
      input_hash TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_clef_spend',
    sql: `CREATE TABLE workbench_clef_spend (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id TEXT UNIQUE NOT NULL,
      request_id TEXT REFERENCES workbench_requests(request_id),
      purpose TEXT NOT NULL CHECK (purpose IN ('production', 'verification', 'test')),
      attempt INTEGER CHECK (attempt IS NULL OR attempt > 0),
      price_basis_version INTEGER NOT NULL CHECK (price_basis_version > 0),
      estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
      reserved_micro_usd INTEGER NOT NULL CHECK (typeof(reserved_micro_usd) = 'integer' AND reserved_micro_usd >= 0),
      reserved_neurons INTEGER NOT NULL CHECK (typeof(reserved_neurons) = 'integer' AND reserved_neurons >= 0),
      state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'kept', 'released')),
      input_tokens INTEGER CHECK (input_tokens >= 0),
      output_tokens INTEGER CHECK (output_tokens >= 0),
      output_cost TEXT CHECK (output_cost = 'cost_unknown'),
      spent_micro_usd INTEGER CHECK (typeof(spent_micro_usd) IN ('integer', 'null') AND spent_micro_usd >= 0),
      spent_neurons INTEGER CHECK (typeof(spent_neurons) IN ('integer', 'null') AND spent_neurons >= 0),
      utc_day TEXT NOT NULL,
      reserved_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE (request_id, attempt),
      CHECK (purpose <> 'production' OR request_id IS NOT NULL),
      CHECK ((request_id IS NULL) = (attempt IS NULL)),
      CHECK ((state = 'reserved') = (spent_micro_usd IS NULL)),
      CHECK ((spent_micro_usd IS NULL) = (spent_neurons IS NULL) AND (spent_micro_usd IS NULL) = (closed_at IS NULL) AND (spent_micro_usd IS NULL) = (output_cost IS NULL)),
      CHECK ((state = 'settled') = (input_tokens IS NOT NULL)),
      CHECK (state = 'settled' OR output_tokens IS NULL),
      CHECK (state NOT IN ('kept', 'released') OR (spent_micro_usd = reserved_micro_usd AND spent_neurons = reserved_neurons))
    )`
  },
  {
    name: 'workbench_clef_spend_day',
    sql: `CREATE INDEX workbench_clef_spend_day ON workbench_clef_spend (utc_day, purpose)`
  },
  {
    name: 'workbench_clef_raw_responses',
    sql: `CREATE TABLE workbench_clef_raw_responses (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_response_id TEXT UNIQUE NOT NULL,
      request_id TEXT REFERENCES workbench_requests(request_id),
      spend_reservation_id TEXT REFERENCES workbench_clef_spend(reservation_id),
      http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
      request_body BLOB NOT NULL CHECK (typeof(request_body) = 'blob' AND length(request_body) <= 65536),
      request_body_sha256 TEXT NOT NULL CHECK (length(request_body_sha256) = 64),
      response_body BLOB NOT NULL CHECK (typeof(response_body) = 'blob' AND length(response_body) <= 1048576),
      response_body_sha256 TEXT NOT NULL CHECK (length(response_body_sha256) = 64),
      received_at TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_clef_raw_response_scope',
    sql: `CREATE INDEX workbench_clef_raw_response_scope ON workbench_clef_raw_responses (request_id, sequence)`
  },
  {
    name: 'workbench_route_decisions',
    sql: `CREATE TABLE workbench_route_decisions (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id TEXT UNIQUE NOT NULL,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      request_revision INTEGER NOT NULL CHECK (request_revision > 0),
      decision_source TEXT NOT NULL CHECK (decision_source IN ('clef', 'local_gate')),
      outcome TEXT NOT NULL CHECK (outcome IN ('routed', 'blocked', 'invalid_output', 'discarded_after_cancel')),
      selected_tuple_id TEXT,
      raw_response_id TEXT REFERENCES workbench_clef_raw_responses(raw_response_id),
      spend_reservation_id TEXT REFERENCES workbench_clef_spend(reservation_id),
      record TEXT NOT NULL CHECK (json_valid(record)),
      created_at TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_route_decision_scope',
    sql: `CREATE INDEX workbench_route_decision_scope ON workbench_route_decisions (request_id, sequence)`
  },
  {
    name: 'workbench_dispatch_intents',
    sql: `CREATE TABLE workbench_dispatch_intents (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      intent_id TEXT UNIQUE NOT NULL,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      decision_id TEXT NOT NULL REFERENCES workbench_route_decisions(decision_id),
      generation INTEGER NOT NULL CHECK (generation > 0),
      input_hash TEXT NOT NULL,
      scope_hash TEXT NOT NULL,
      plugin_operation_id TEXT,
      provider_reservation_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('issued', 'consumed', 'withdrawn')),
      created_at TEXT NOT NULL,
      closed_at TEXT,
      UNIQUE (request_id, generation),
      CHECK ((state = 'issued') = (closed_at IS NULL))
    )`
  },
  {
    name: 'workbench_route_overrides',
    sql: `CREATE TABLE workbench_route_overrides (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      override_id TEXT UNIQUE NOT NULL,
      request_id TEXT NOT NULL REFERENCES workbench_requests(request_id),
      tuple_id TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      attestation TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_route_override_scope',
    sql: `CREATE INDEX workbench_route_override_scope ON workbench_route_overrides (request_id, sequence)`
  }
]
