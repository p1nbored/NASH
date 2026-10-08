import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  DOT_REMOTE_SCHEMA_DEFINITIONS,
  type DotRemoteSchemaDefinition
} from './dot-remote-schema-definition'
import { DOT_REMOTE_SCHEMA_VERSION, ensureDotRemoteSchema } from './dot-remote-schema'

// Pins the exact layouts: changing any definition without a new schema version fails here first.
const SCHEMA_V2_SHA256 = 'b9276875496367705f77f7223249611ee2367b2a45f3dc80c7ed6f74dab7a83f'

function layoutHash(definitions: readonly DotRemoteSchemaDefinition[]): string {
  const text = definitions
    .map((definition) => definition.sql.replace(/\s+/g, ' ').trim())
    .join('\n')
  return createHash('sha256').update(text).digest('hex')
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof OrchestrationError ? error.code : 'not_an_orchestration_error'
  }
}

function familyObjects(owner: OrchestrationDb): string[] {
  return owner.db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'dot_remote_%' ORDER BY name")
    .all()
    .map((row) => String(row.name))
}

describe('dot remote schema family', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  it('creates only new dot_remote_ objects at the current version', () => {
    const before = owner.db
      .prepare("SELECT name, sql FROM sqlite_master WHERE instr(name, 'dot_remote_') = 0")
      .all()
    ensureDotRemoteSchema(owner.db)
    expect(familyObjects(owner)).toEqual(
      DOT_REMOTE_SCHEMA_DEFINITIONS.map((definition) => definition.name).sort()
    )
    expect(
      owner.db
        .prepare("SELECT name, sql FROM sqlite_master WHERE instr(name, 'dot_remote_') = 0")
        .all()
    ).toEqual(before)
    expect(owner.db.prepare('SELECT version FROM dot_remote_schema WHERE id = 1').get()).toEqual({
      version: DOT_REMOTE_SCHEMA_VERSION
    })
  })

  it('verifies an existing family on the next start without changing it', () => {
    ensureDotRemoteSchema(owner.db)
    ensureDotRemoteSchema(owner.db)
    expect(familyObjects(owner)).toHaveLength(DOT_REMOTE_SCHEMA_DEFINITIONS.length)
  })

  it('fails closed on a drifted table and changes nothing', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('DROP TABLE dot_remote_artifact_refs')
    owner.db.exec('CREATE TABLE dot_remote_artifact_refs (artifact_ref TEXT)')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('fails closed on an unknown version', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('UPDATE dot_remote_schema SET version = 99 WHERE id = 1')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('fails closed on a partial family', () => {
    ensureDotRemoteSchema(owner.db)
    owner.db.exec('DROP TABLE dot_remote_artifact_refs')
    expect(codeOf(() => ensureDotRemoteSchema(owner.db))).toBe('dot_remote_recovery_required')
  })

  it('pins the current layout', () => {
    expect(DOT_REMOTE_SCHEMA_VERSION).toBe(2)
    expect(layoutHash(DOT_REMOTE_SCHEMA_DEFINITIONS)).toBe(SCHEMA_V2_SHA256)
  })
})
