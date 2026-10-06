import {
  createRunDirectory as createSharedRunDirectory,
  defaultTempRoots,
  locateRunDirectory as locateSharedRunDirectory,
  RUN_TEMP_DIRECTORY,
  type RunDirectoryInput,
  type RunDirectoryLocation
} from '../agent-exec-shared/run-directory'
import { pathApiFor } from '../agent-exec-shared/path-containment'

// The shared module builds the exclusive, private run directory; this adds the files a codex run keeps in it.

export { defaultTempRoots, RUN_TEMP_DIRECTORY }
export type { RunDirectoryInput }

export const LAST_MESSAGE_FILE = 'last-message.txt'
export const OUTPUT_SCHEMA_FILE = 'result.schema.json'

export type RunLocation = RunDirectoryLocation & {
  readonly lastMessagePath: string
  readonly schemaPath: string
}

export type RunLocationResult =
  | { readonly ok: true; readonly value: RunLocation }
  | { readonly ok: false; readonly detail: string }

export type RunDirectoryResult =
  | { readonly ok: true; readonly value: RunLocation }
  | {
      readonly ok: false
      readonly kind: 'invalid_request' | 'run_dir_unusable'
      readonly detail: string
    }

function withCodexFiles(location: RunDirectoryLocation, platform: NodeJS.Platform): RunLocation {
  const api = pathApiFor(platform)
  return {
    ...location,
    lastMessagePath: api.join(location.runDir, LAST_MESSAGE_FILE),
    schemaPath: api.join(location.runDir, OUTPUT_SCHEMA_FILE)
  }
}

/** Pure checks on the runs root and run id, and the paths they imply; nothing touches the disk. */
export function locateRunDirectory(
  value: { readonly runsRoot: unknown; readonly runId: unknown },
  platform: NodeJS.Platform
): RunLocationResult {
  const located = locateSharedRunDirectory(value, platform)
  return located.ok ? { ok: true, value: withCodexFiles(located.value, platform) } : located
}

export async function createRunDirectory(input: RunDirectoryInput): Promise<RunDirectoryResult> {
  const created = await createSharedRunDirectory(input)
  return created.ok ? { ok: true, value: withCodexFiles(created.value, input.platform) } : created
}
