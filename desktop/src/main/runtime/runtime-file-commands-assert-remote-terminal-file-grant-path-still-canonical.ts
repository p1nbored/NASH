// @ts-nocheck -- mechanically split class members.
import { RuntimeFileCommandsWithWriteTerminalArtifactFile } from './runtime-file-commands-write-terminal-artifact-file'
import {
  runtimeFileWatcherLeasesByOwnerAndRoot,
  runtimeWatcherReleaseKey
} from './runtime-file-commands-mobile-file-list-limit'
import {
  requireLocalRuntimeFileRoute,
  requireRuntimeFileProvider,
  runtimeFileSshTargetId
} from './runtime-file-command-target'
import { stat } from 'node:fs/promises'
import type { DirEntry, FsChangeEvent } from '../../shared/filesystem-entry-types'
import { sortDirEntries } from '../../shared/file-name-sort'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import { watchWindowsRuntimeFileExplorer } from './runtime-file-command-host'
import { beginWatcherInstall } from '../ipc/watcher-removal-gate'
import {
  closeFileExplorerWatcherInWatcherProcess,
  watchFileExplorerInWatcherProcess
} from './file-watcher-host'
import { registerRuntimeFileWatcherRelease } from './runtime-file-watcher-leases'

export class RuntimeFileCommandsWithAssertRemoteTerminalFileGrantPathStillCanonical extends RuntimeFileCommandsWithWriteTerminalArtifactFile {
  async readFileExplorerDir(
    worktreeSelector: string,
    relativePath: string,
    options: { followSymlinks?: boolean } = {}
  ): Promise<DirEntry[]> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    // Why: providers do not promise this order, so sort before returning.
    return sortDirEntries(
      await requireRuntimeFileProvider(target, this.host).readDir(target.path, options)
    )
  }

  async watchFileExplorer(
    worktreeSelector: string,
    callback: (events: FsChangeEvent[]) => void,
    onTerminalError: (error: Error) => void = () => undefined,
    signal?: AbortSignal
  ): Promise<() => Promise<void>> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, '')
    // Why: watcher keys must scope teardown to the owning host; a `runtime:` host throws here
    // rather than registering a lease under this client's namespace.
    const sshTargetId = runtimeFileSshTargetId(target)
    const open = async (): Promise<{
      unsubscribe: () => Promise<void>
      rootPaths: string[]
    }> => {
      const finishInstall = beginWatcherInstall(target.path, sshTargetId)
      try {
        requireLocalRuntimeFileRoute(target)
        const rootPath = await resolveAuthorizedPath(target.path, this.host.requireStore())
        const rootStats = await stat(rootPath)
        if (!rootStats.isDirectory()) {
          throw new Error('not_a_directory')
        }
        if (process.platform === 'win32') {
          const close = watchWindowsRuntimeFileExplorer(rootPath, callback, onTerminalError)
          return { unsubscribe: close, rootPaths: [target.path, rootPath] }
        }
        // Why: the forked watcher keeps the blocking crawl and native faults out of the main/`serve` process (issues #5308, #8212).
        const dispose = await watchFileExplorerInWatcherProcess(
          rootPath,
          callback,
          onTerminalError,
          signal
        )
        return { unsubscribe: dispose, rootPaths: [target.path, rootPath] }
      } finally {
        finishInstall()
      }
    }
    const initial = await open()
    return registerRuntimeFileWatcherRelease(
      this.host.getRuntimeId(),
      sshTargetId,
      initial.rootPaths,
      initial.unsubscribe,
      async () => (await open()).unsubscribe,
      onTerminalError
    )
  }

  async closeFileExplorerWatchersForPath(rootPath: string, connectionId?: string): Promise<void> {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      await Promise.all(Array.from(leases, (lease) => lease.suspend()))
    }
    if (!connectionId) {
      // Why: setup can fail before registerRuntimeFileWatcherRelease publishes its callback while the child owner still lives.
      const resolvedRootPath = await resolveAuthorizedPath(rootPath, this.host.requireStore())
      await closeFileExplorerWatcherInWatcherProcess(resolvedRootPath)
    }
  }

  async restoreFileExplorerWatchersAfterFailedRemoval(
    rootPath: string,
    connectionId?: string
  ): Promise<void> {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      await Promise.all(Array.from(leases, (lease) => lease.resume()))
    }
  }

  forgetFileExplorerWatchersAfterRemoval(rootPath: string, connectionId?: string): void {
    const key = runtimeWatcherReleaseKey(this.host.getRuntimeId(), connectionId, rootPath)
    const leases = runtimeFileWatcherLeasesByOwnerAndRoot.get(key)
    if (leases) {
      for (const lease of Array.from(leases)) {
        lease.forget()
      }
    }
  }
}
