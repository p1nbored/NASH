// @ts-nocheck -- mechanically split class members.
import { RuntimeFileCommandsWithRevokeTerminalFileGrantsForClient } from './runtime-file-commands-revoke-terminal-file-grants-for-client'
import { MOBILE_FILE_READ_MAX_BYTES } from './runtime-file-commands-mobile-file-list-limit'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import { isMobileBinaryPath } from './runtime-file-command-host'
import {
  assertTerminalArtifactContentUnchanged,
  assertTerminalFileGrantFresh,
  readFileHandleBufferBounded,
  terminalFileStatIdentity
} from './runtime-file-commands-terminal-artifact-access'
import { openLocalTerminalArtifactGrant } from './runtime-file-commands-terminal-file-paths'
import { chmod, constants, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export class RuntimeFileCommandsWithWriteTerminalArtifactFile extends RuntimeFileCommandsWithRevokeTerminalFileGrantsForClient {
  async writeTerminalArtifactFile(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    content: string,
    clientId?: string
  ): Promise<{ ok: true }> {
    if (Buffer.byteLength(content, 'utf8') > MOBILE_FILE_READ_MAX_BYTES) {
      throw new Error('file_too_large')
    }
    const { grant } = await this.requireTerminalFileGrant(
      worktreeSelector,
      grantId,
      absolutePath,
      clientId
    )
    if (grant.readOnly) {
      throw new Error('terminal_file_grant_read_only')
    }
    if (isMobileBinaryPath(grant.absolutePath)) {
      throw new Error('binary_file')
    }
    let originalMode: number | null = null
    const handle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
    try {
      const fileStats = await handle.stat()
      originalMode = fileStats.mode
      if (fileStats.isDirectory()) {
        throw new Error('Cannot write to a directory')
      }
      if (fileStats.size > MOBILE_FILE_READ_MAX_BYTES) {
        throw new Error('file_too_large')
      }
      assertTerminalFileGrantFresh(grant, fileStats)
      const buffer = await readFileHandleBufferBounded(handle, MOBILE_FILE_READ_MAX_BYTES + 1)
      assertTerminalArtifactContentUnchanged(grant, buffer)
      if (isBinaryBuffer(buffer)) {
        throw new Error('binary_file')
      }
    } finally {
      await handle.close()
    }
    const tempPath = join(
      dirname(grant.absolutePath),
      `.${basename(grant.absolutePath)}.${randomUUID()}.tmp`
    )
    try {
      await writeFile(tempPath, content, { encoding: 'utf-8', flag: 'wx' })
      if (typeof originalMode === 'number') {
        await chmod(tempPath, originalMode & 0o7777)
      }
      const freshHandle = await openLocalTerminalArtifactGrant(grant, constants.O_RDONLY)
      try {
        assertTerminalFileGrantFresh(grant, await freshHandle.stat())
        assertTerminalArtifactContentUnchanged(
          grant,
          await readFileHandleBufferBounded(freshHandle, MOBILE_FILE_READ_MAX_BYTES + 1)
        )
      } finally {
        await freshHandle.close()
      }
      await rename(tempPath, grant.absolutePath)
      const committed = await this.statLocalTerminalArtifact(grant.absolutePath)
      grant.statIdentity = terminalFileStatIdentity(committed.stats)
      grant.contentDigest = committed.contentDigest
      this.refreshTerminalFileGrant(grant)
      return { ok: true }
    } finally {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}
