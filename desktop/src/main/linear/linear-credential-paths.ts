import { existsSync, mkdirSync } from 'node:fs'
import { APP_HOME_DIR_NAME } from '../../shared/app-identity-paths'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LEGACY_WORKSPACE_ID = 'legacy'

function getOrcaDir(): string {
  return join(homedir(), APP_HOME_DIR_NAME)
}

function getLegacyTokenPath(): string {
  return join(getOrcaDir(), 'linear-token.enc')
}

export function getLegacyViewerPath(): string {
  return join(getOrcaDir(), 'linear-viewer.json')
}

export function getWorkspaceFilePath(): string {
  return join(getOrcaDir(), 'linear-workspaces.json')
}

function getWorkspaceTokenDir(): string {
  return join(getOrcaDir(), 'linear-tokens')
}

export function getWorkspaceTokenPath(workspaceId: string): string {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    return getLegacyTokenPath()
  }
  return join(getWorkspaceTokenDir(), `${Buffer.from(workspaceId).toString('base64url')}.enc`)
}

export function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function ensureWorkspaceTokenDir(): void {
  const dir = getWorkspaceTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
