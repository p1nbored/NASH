import { pathApiFor } from '../agent-exec-shared/path-containment'
import {
  createRunDirectory,
  locateRunDirectory,
  type RunDirectoryInput,
  type RunDirectoryLocation
} from '../agent-exec-shared/run-directory'

// The shared module builds the exclusive, private run directory; this adds the one file an agy run keeps in it.

export const AGY_OUTPUT_FILE = 'output.txt'

export type AgyRunLocation = RunDirectoryLocation & { readonly outputPath: string }

export type AgyRunLocationResult =
  | { readonly ok: true; readonly value: AgyRunLocation }
  | { readonly ok: false; readonly detail: string }

export type AgyRunDirectoryResult =
  | { readonly ok: true; readonly value: AgyRunLocation }
  | {
      readonly ok: false
      readonly kind: 'invalid_request' | 'run_dir_unusable'
      readonly detail: string
    }

function withOutputPath(location: RunDirectoryLocation, platform: NodeJS.Platform): AgyRunLocation {
  return { ...location, outputPath: pathApiFor(platform).join(location.runDir, AGY_OUTPUT_FILE) }
}

/** Pure checks on the runs root and run id, and the paths they imply; nothing touches the disk. */
export function locateAgyRunDirectory(
  value: { readonly runsRoot: unknown; readonly runId: unknown },
  platform: NodeJS.Platform
): AgyRunLocationResult {
  const located = locateRunDirectory(value, platform)
  return located.ok ? { ok: true, value: withOutputPath(located.value, platform) } : located
}

export async function createAgyRunDirectory(
  input: RunDirectoryInput
): Promise<AgyRunDirectoryResult> {
  const created = await createRunDirectory(input)
  return created.ok ? { ok: true, value: withOutputPath(created.value, input.platform) } : created
}
