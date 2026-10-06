// The dot_remote_ family (R1): the remote switch and Site origin, the current pairing, the requests
// NASH reports to the Site with their facet signatures, the event outbox, the inbox item journal and
// the opaque artifact ids. New tables only, no foreign key outside the family, no Orca object touched.
import {
  DOT_REMOTE_EVENT_KINDS,
  DOT_REMOTE_EVENT_RESULT_STATUSES
} from '../../../shared/dot-remote/dot-remote-events'
import { DOT_REMOTE_ITEM_KINDS } from '../../../shared/dot-remote/dot-remote-payload'
import { sqlStringList } from '../orchestration/db/autopilot-run-schema-definition'

export type DotRemoteSchemaDefinition = { readonly name: string; readonly sql: string }

export const DOT_REMOTE_OUTBOX_STATES = ['pending', 'sent', 'rejected', 'fenced'] as const
export type DotRemoteOutboxState = (typeof DOT_REMOTE_OUTBOX_STATES)[number]

const UUID_LENGTH = 36
const SHA256_HEX_LENGTH = 64
const DEVICE_ID_GLOB = `dev_${'[0-9a-f]'.repeat(24)}`
const ARTIFACT_REF_GLOB = `art_${'[0-9a-f]'.repeat(24)}`
/** Bounds what one stored event or ack outcome can hold; the schemas allow far less. */
const EVENT_BODY_MAX_CHARS = 65_536
const OUTCOME_MAX_CHARS = 4_096

/** The event outbox with the event kinds of one schema version; v1 is frozen in dot-remote-schema-v1. */
export function dotRemoteOutboxSql(eventKinds: readonly string[]): string {
  return `CREATE TABLE dot_remote_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL CHECK (length(event_id) = ${UUID_LENGTH}),
      dot_request_id TEXT NOT NULL REFERENCES dot_remote_requests (dot_request_id),
      source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
      kind TEXT NOT NULL CHECK (kind IN (${sqlStringList(eventKinds)})),
      body TEXT NOT NULL CHECK (json_valid(body) AND length(body) <= ${EVENT_BODY_MAX_CHARS}),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      state TEXT NOT NULL CHECK (state IN (${sqlStringList(DOT_REMOTE_OUTBOX_STATES)})),
      attempts INTEGER NOT NULL CHECK (attempts >= 0),
      result TEXT CHECK (result IS NULL OR result IN (${sqlStringList(DOT_REMOTE_EVENT_RESULT_STATUSES)})),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (dot_request_id, source_revision)
    )`
}

/** The inbox item journal with the item kinds of one schema version. */
export function dotRemoteItemsSql(itemKinds: readonly string[]): string {
  return `CREATE TABLE dot_remote_items (
      item_id TEXT PRIMARY KEY NOT NULL CHECK (length(item_id) = ${UUID_LENGTH}),
      kind TEXT NOT NULL CHECK (kind IN (${sqlStringList(itemKinds)})),
      payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = ${SHA256_HEX_LENGTH}),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      outcome TEXT NOT NULL CHECK (json_valid(outcome) AND length(outcome) <= ${OUTCOME_MAX_CHARS}),
      dot_request_id TEXT CHECK (dot_request_id IS NULL OR length(dot_request_id) = ${UUID_LENGTH}),
      acked INTEGER NOT NULL CHECK (acked IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
}

export const DOT_REMOTE_SCHEMA_DEFINITIONS = [
  {
    name: 'dot_remote_schema',
    sql: 'CREATE TABLE dot_remote_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  },
  {
    // Why no column defaults: the default (off) lives in code, so changing it never changes the frozen SQL.
    name: 'dot_remote_settings',
    sql: `CREATE TABLE dot_remote_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      origin TEXT CHECK (origin IS NULL OR (length(origin) BETWEEN 9 AND 2048 AND substr(origin, 1, 8) = 'https://')),
      last_sync_at TEXT,
      updated_at TEXT NOT NULL
    )`
  },
  {
    name: 'dot_remote_pairing',
    sql: `CREATE TABLE dot_remote_pairing (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      origin TEXT NOT NULL CHECK (length(origin) BETWEEN 9 AND 2048 AND substr(origin, 1, 8) = 'https://'),
      device_id TEXT NOT NULL CHECK (length(device_id) = 28 AND device_id GLOB '${DEVICE_ID_GLOB}'),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      paired_at TEXT NOT NULL,
      lifetime_ends_at TEXT CHECK (lifetime_ends_at IS NULL OR length(lifetime_ends_at) BETWEEN 20 AND 35),
      revoked_at TEXT
    )`
  },
  {
    name: 'dot_remote_requests',
    sql: `CREATE TABLE dot_remote_requests (
      dot_request_id TEXT PRIMARY KEY NOT NULL CHECK (length(dot_request_id) = ${UUID_LENGTH}),
      submit_item_id TEXT NOT NULL CHECK (length(submit_item_id) = ${UUID_LENGTH}),
      generation INTEGER NOT NULL CHECK (generation >= 1),
      last_revision INTEGER NOT NULL CHECK (last_revision >= 0),
      open INTEGER NOT NULL CHECK (open IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  },
  {
    name: 'dot_remote_facets',
    sql: `CREATE TABLE dot_remote_facets (
      dot_request_id TEXT NOT NULL REFERENCES dot_remote_requests (dot_request_id),
      facet TEXT NOT NULL CHECK (length(facet) BETWEEN 1 AND 128),
      signature TEXT NOT NULL CHECK (length(signature) = ${SHA256_HEX_LENGTH}),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (dot_request_id, facet)
    )`
  },
  { name: 'dot_remote_outbox', sql: dotRemoteOutboxSql(DOT_REMOTE_EVENT_KINDS) },
  {
    name: 'dot_remote_outbox_state',
    sql: 'CREATE INDEX dot_remote_outbox_state ON dot_remote_outbox (state, sequence)'
  },
  { name: 'dot_remote_items', sql: dotRemoteItemsSql(DOT_REMOTE_ITEM_KINDS) },
  {
    name: 'dot_remote_artifact_refs',
    sql: `CREATE TABLE dot_remote_artifact_refs (
      artifact_ref TEXT PRIMARY KEY NOT NULL CHECK (length(artifact_ref) = 28 AND artifact_ref GLOB '${ARTIFACT_REF_GLOB}'),
      artifact_id TEXT UNIQUE NOT NULL CHECK (length(artifact_id) BETWEEN 1 AND 256),
      created_at TEXT NOT NULL
    )`
  }
] as const satisfies readonly DotRemoteSchemaDefinition[]
