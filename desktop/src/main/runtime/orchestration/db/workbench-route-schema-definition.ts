/** Mirrors the section 5 preflight body cap; frozen here because the v2 layout is exact-SQL checked. */
export const WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES = 65_536
/** Upper bound on a stored Clef response; larger bodies are refused before hashing. */
export const WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES = 1_048_576

/**
 * Clef spend and raw-response tables, added in Workbench v2 (spec section 11) and kept byte-identical
 * in v3 because the autopilot task tables reference them by foreign key.
 * `workbench_clef_spend` keeps integer micro-dollars and whole neurons so cap checks are exact.
 * `workbench_clef_raw_responses` holds request and response bytes: sensitive at rest,
 * excluded from exports and diagnostic bundles.
 */
export const WORKBENCH_ROUTE_SCHEMA_DEFINITIONS = [
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
    sql: 'CREATE INDEX workbench_clef_spend_day ON workbench_clef_spend (utc_day, purpose)'
  },
  {
    name: 'workbench_clef_raw_responses',
    sql: `CREATE TABLE workbench_clef_raw_responses (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_response_id TEXT UNIQUE NOT NULL,
      request_id TEXT REFERENCES workbench_requests(request_id),
      spend_reservation_id TEXT REFERENCES workbench_clef_spend(reservation_id),
      http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
      request_body BLOB NOT NULL CHECK (typeof(request_body) = 'blob' AND length(request_body) <= ${WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES}),
      request_body_sha256 TEXT NOT NULL CHECK (length(request_body_sha256) = 64),
      response_body BLOB NOT NULL CHECK (typeof(response_body) = 'blob' AND length(response_body) <= ${WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES}),
      response_body_sha256 TEXT NOT NULL CHECK (length(response_body_sha256) = 64),
      received_at TEXT NOT NULL
    )`
  },
  {
    name: 'workbench_clef_raw_response_scope',
    sql: 'CREATE INDEX workbench_clef_raw_response_scope ON workbench_clef_raw_responses (request_id, sequence)'
  }
] as const
