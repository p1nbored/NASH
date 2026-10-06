import { randomBytes } from 'node:crypto'
import type Database from '../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { ensureDotRemoteSchema, runDotRemoteWrite } from './dot-remote-schema'

// An artifact leaves the PC only as an opaque art_ id with its size and hash. The mapping to the
// recorded artifact (and through it the path) stays in this table on the PC.

const ARTIFACT_REF_BYTES = 12

const stores = new WeakMap<OrchestrationDb, DotRemoteArtifactRefs>()

export function getDotRemoteArtifactRefs(owner: OrchestrationDb): DotRemoteArtifactRefs {
  let store = stores.get(owner)
  if (!store) {
    store = new DotRemoteArtifactRefs(owner.db)
    stores.set(owner, store)
  }
  return store
}

export class DotRemoteArtifactRefs {
  constructor(
    private readonly db: Database.Database,
    private readonly random: (bytes: number) => Buffer = randomBytes
  ) {
    ensureDotRemoteSchema(db)
  }

  /** The same artifact always maps to the same random id; the id derives from nothing on the PC. */
  refFor(artifactId: string, timestamp: string): string {
    return runDotRemoteWrite(this.db, 'dot_remote_artifact_refs', () => {
      const existing = this.db
        .prepare('SELECT artifact_ref FROM dot_remote_artifact_refs WHERE artifact_id = ?')
        .get(artifactId)
      if (typeof existing?.artifact_ref === 'string') {
        return existing.artifact_ref
      }
      const ref = `art_${this.random(ARTIFACT_REF_BYTES).toString('hex')}`
      this.db
        .prepare(
          'INSERT INTO dot_remote_artifact_refs (artifact_ref, artifact_id, created_at) VALUES (?, ?, ?)'
        )
        .run(ref, artifactId, timestamp)
      return ref
    })
  }
}
