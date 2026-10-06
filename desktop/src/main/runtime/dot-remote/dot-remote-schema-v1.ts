import {
  DOT_REMOTE_SCHEMA_DEFINITIONS,
  dotRemoteItemsSql,
  dotRemoteOutboxSql,
  type DotRemoteSchemaDefinition
} from './dot-remote-schema-definition'

// The frozen v1 layout (before G7) that ensureDotRemoteSchema migrates from. Never edit it: the
// schema test pins its hash. Only the outbox and item journal differ from v2, by their kind lists.

const V1_EVENT_KINDS = [
  'request_status',
  'permission_prompt_opened',
  'permission_prompt_closed',
  'message_outcome',
  'validation_result',
  'deliverable_summary'
] as const

const V1_ITEM_KINDS = ['submit', 'cancel', 'permission_answer', 'message'] as const

/** The v1 objects in creation order; every one but the two rebuilt tables is the same in v2. */
export const DOT_REMOTE_SCHEMA_V1_DEFINITIONS: readonly DotRemoteSchemaDefinition[] =
  DOT_REMOTE_SCHEMA_DEFINITIONS.map((definition) => {
    if (definition.name === 'dot_remote_outbox') {
      return { name: definition.name, sql: dotRemoteOutboxSql(V1_EVENT_KINDS) }
    }
    if (definition.name === 'dot_remote_items') {
      return { name: definition.name, sql: dotRemoteItemsSql(V1_ITEM_KINDS) }
    }
    return definition
  })
