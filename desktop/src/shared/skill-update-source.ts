import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { renameFileWithWindowsRetry } from './windows-retry-file-operations'

const lockSchema = z
  .object({ version: z.literal(3), skills: z.record(z.string(), z.unknown()) })
  .passthrough()
const entrySchema = z
  .object({
    source: z.literal('stablyai/orca'),
    sourceType: z.literal('github'),
    sourceUrl: z.string(),
    skillPath: z.string(),
    skillFolderHash: z.string().min(1),
    ref: z.string().optional()
  })
  .passthrough()

// The upstream lock can be current while NASH's bundled skill is newer.
export function migrateGlobalSkillUpdateSources(
  names: readonly string[],
  options: { homeDir?: string; stateHome?: string | null } = {}
): void {
  const stateHome = options.stateHome === undefined ? process.env.XDG_STATE_HOME : options.stateHome
  const path = stateHome
    ? join(stateHome, 'skills', '.skill-lock.json')
    : join(options.homeDir ?? homedir(), '.agents', '.skill-lock.json')
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
  const lock = lockSchema.safeParse(JSON.parse(contents))
  if (!lock.success) {
    return
  }
  let changed = false
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      continue
    }
    const entry = entrySchema.safeParse(lock.data.skills[name])
    if (
      !entry.success ||
      entry.data.ref !== undefined ||
      entry.data.skillPath !== `skills/${name}/SKILL.md`
    ) {
      continue
    }
    if (!/^https:\/\/github\.com\/stablyai\/orca(?:\.git)?\/?$/.test(entry.data.sourceUrl)) {
      continue
    }
    lock.data.skills[name] = {
      ...entry.data,
      source: 'p1nbored/NASH',
      sourceUrl: 'https://github.com/p1nbored/NASH.git',
      skillPath: `desktop/skills/${name}/SKILL.md`
    }
    changed = true
  }
  if (!changed) {
    return
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(lock.data, null, 2)}\n`, {
      flag: 'wx',
      mode: statSync(path).mode
    })
    if (readFileSync(path, 'utf8') !== contents) {
      throw new Error('Skill registration changed; retry the update.')
    }
    renameFileWithWindowsRetry(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}
