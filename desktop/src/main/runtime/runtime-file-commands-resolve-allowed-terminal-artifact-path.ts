// @ts-nocheck -- mechanically split class members.
import { RuntimeFileCommandsWithResolveTerminalPath } from './runtime-file-commands-resolve-terminal-path'
import {
  assertLocalTerminalArtifactPathStillCanonical,
  resolveAllowedLocalTerminalArtifactPath
} from './runtime-file-commands-terminal-file-paths'
import {
  assertTerminalArtifactNotHardLinked,
  canonicalPathForArtifactComparison,
  isTerminalArtifactHardLinked,
  localTerminalArtifactContentDigest,
  terminalFileStatIdentity
} from './runtime-file-commands-terminal-artifact-access'
import { open } from 'node:fs/promises'
import type {
  RuntimeFileStatLike,
  TerminalFileGrant
} from './runtime-file-commands-mobile-file-list-limit'
import { TERMINAL_FILE_GRANT_TTL_MS } from './runtime-file-commands-mobile-file-list-limit'
import type { RuntimeTerminalPathResolution } from '../../shared/runtime-types'
import { randomUUID } from 'node:crypto'
import {
  runtimeFileSshTargetId,
  type ResolvedRuntimeFileTarget
} from './runtime-file-command-target'
import { requireReachableFilesystemRoute } from '../providers/execution-host-provider-dispatch'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import { getConnectionExecutionHostId } from '../../shared/execution-host'

export class RuntimeFileCommandsWithResolveAllowedTerminalArtifactPath extends RuntimeFileCommandsWithResolveTerminalPath {
  protected async resolveAllowedTerminalArtifactPath(args: {
    absolutePath: string
    connectionId?: string
    worktreePath: string
  }): Promise<string | null> {
    if (args.connectionId) {
      throw new SshHostNotServedError(args.connectionId)
    }
    return resolveAllowedLocalTerminalArtifactPath(args.absolutePath, args.worktreePath)
  }

  protected async resolveNativeChatArtifactPath(
    absolutePath: string,
    connectionId?: string
  ): Promise<string> {
    requireReachableFilesystemRoute(getConnectionExecutionHostId(connectionId))
    return canonicalPathForArtifactComparison(absolutePath)
  }

  protected async resolveAbsoluteFileGrant(args: {
    worktreeId: string
    artifactPath: string
    rejectedAbsolutePath?: string
    clientId?: string
    readOnly?: boolean
    provenance?: TerminalFileGrant['provenance']
  }): Promise<RuntimeTerminalPathResolution> {
    const { stats, contentDigest } = await this.statLocalTerminalArtifact(args.artifactPath)
    const isDirectory = stats.isDirectory()
    if (!isDirectory && isTerminalArtifactHardLinked(stats)) {
      return {
        worktree: args.worktreeId,
        relativePath: null,
        absolutePath: args.rejectedAbsolutePath ?? args.artifactPath,
        exists: false,
        isDirectory: false
      }
    }
    const grant = isDirectory
      ? null
      : this.createTerminalFileGrant({
          worktreeId: args.worktreeId,
          absolutePath: args.artifactPath,
          clientId: args.clientId,
          readOnly: args.readOnly === true,
          provenance: args.provenance ?? 'terminal-output',
          stats,
          contentDigest
        })
    return {
      worktree: args.worktreeId,
      relativePath: null,
      absolutePath: args.artifactPath,
      exists: true,
      isDirectory,
      openTarget: grant
        ? {
            kind: 'absolute-file',
            provider: grant.provider,
            absolutePath: args.artifactPath,
            grantId: grant.id,
            ...(grant.readOnly ? { readOnly: true } : {})
          }
        : undefined
    }
  }

  protected async statLocalTerminalPath(
    absolutePath: string
  ): Promise<RuntimeFileStatLike & { isDirectory: () => boolean }> {
    return (await this.statLocalTerminalArtifact(absolutePath)).stats
  }

  /** Stat and content digest taken from one handle, so nothing can swap the file between them. */
  protected async statLocalTerminalArtifact(absolutePath: string): Promise<{
    stats: RuntimeFileStatLike & { isDirectory: () => boolean }
    contentDigest: string | null
  }> {
    await assertLocalTerminalArtifactPathStillCanonical(absolutePath)
    const handle = await open(absolutePath, 'r')
    try {
      const stats = await handle.stat()
      const contentDigest = stats.isDirectory()
        ? null
        : await localTerminalArtifactContentDigest(handle, stats.size)
      return { stats, contentDigest }
    } finally {
      await handle.close()
    }
  }

  protected createTerminalFileGrant(args: {
    worktreeId: string
    absolutePath: string
    clientId?: string
    readOnly?: boolean
    provenance: TerminalFileGrant['provenance']
    stats: RuntimeFileStatLike
    contentDigest?: string | null
  }): TerminalFileGrant {
    assertTerminalArtifactNotHardLinked(args.stats)
    const grant: TerminalFileGrant = {
      id: randomUUID(),
      worktreeId: args.worktreeId,
      absolutePath: args.absolutePath,
      provider: 'local',
      ...(args.clientId ? { clientId: args.clientId } : {}),
      expiresAt: Date.now() + TERMINAL_FILE_GRANT_TTL_MS,
      statIdentity: terminalFileStatIdentity(args.stats),
      contentDigest: args.contentDigest ?? null,
      readOnly: args.readOnly === true,
      provenance: args.provenance
    }
    this.terminalFileGrants.set(grant.id, grant)
    this.scheduleTerminalFileGrantExpiry(grant)
    return grant
  }

  protected async requireTerminalFileGrant(
    worktreeSelector: string,
    grantId: string,
    absolutePath: string,
    clientId?: string
  ): Promise<{ grant: TerminalFileGrant; target: ResolvedRuntimeFileTarget }> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    this.pruneExpiredTerminalFileGrants()
    const grant = this.terminalFileGrants.get(grantId)
    if (!grant) {
      throw new Error('terminal_file_grant_expired')
    }
    if (grant.expiresAt <= Date.now()) {
      this.releaseTerminalFileGrant(grantId, grant)
      throw new Error('terminal_file_grant_expired')
    }
    if (
      grant.worktreeId !== target.worktree.id ||
      grant.absolutePath !== absolutePath ||
      // Why: grants are only minted for local paths, so an `ssh:` target never matches one.
      runtimeFileSshTargetId(target) !== undefined ||
      grant.clientId !== clientId
    ) {
      throw new Error('terminal_file_grant_mismatch')
    }
    return { grant, target }
  }

  protected refreshTerminalFileGrant(grant: TerminalFileGrant): void {
    grant.expiresAt = Date.now() + TERMINAL_FILE_GRANT_TTL_MS
    this.scheduleTerminalFileGrantExpiry(grant)
  }

  protected pruneExpiredTerminalFileGrants(): void {
    const now = Date.now()
    for (const [id, grant] of this.terminalFileGrants) {
      if (grant.expiresAt <= now) {
        this.releaseTerminalFileGrant(id, grant)
      }
    }
  }
}
