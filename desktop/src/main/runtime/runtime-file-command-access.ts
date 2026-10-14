import { RuntimeFileSearch } from './runtime-file-search'
import { listFilesystemMarkdownDocuments } from '../providers/filesystem-markdown-listing'
import type { MarkdownDocument } from '../../shared/filesystem-entry-types'
import {
  validatePathExistenceBatch,
  type PathExistenceResult
} from '../../shared/path-existence-batch'
import { readRuntimeFilePathExistence } from './runtime-file-path-existence'
import {
  isMobileBinaryPath,
  isMobileMarkdownPath,
  isSafeMobileRelativePath,
  type RuntimeFileCommandHost
} from './runtime-file-command-host'
import type { RuntimeFileOpenResult } from '../../shared/runtime-types'
import type { RuntimeNavigationTarget } from '../../shared/runtime-navigation'
import {
  isMobilePreviewableImagePath,
  type TerminalFileGrant
} from './runtime-file-commands-mobile-file-list-limit'
import { joinWorktreeRelativePath, normalizeRuntimeRelativePath } from './runtime-relative-paths'
import { isENOENT } from '../ipc/filesystem-path-containment'
import {
  requireRuntimeFileProvider,
  type RuntimeFileExplorerPath
} from './runtime-file-command-target'
import { parseExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { FileStat } from '../providers/filesystem-provider-contract'

export class RuntimeFileCommandAccess {
  protected readonly terminalFileGrants = new Map<string, TerminalFileGrant>()
  private readonly search: RuntimeFileSearch

  constructor(protected readonly host: RuntimeFileCommandHost) {
    this.search = new RuntimeFileSearch(host)
  }

  listMobileFiles(...args: Parameters<RuntimeFileSearch['listMobileFiles']>) {
    return this.search.listMobileFiles(...args)
  }

  searchMobileFilePaths(...args: Parameters<RuntimeFileSearch['searchMobileFilePaths']>) {
    return this.search.searchMobileFilePaths(...args)
  }

  searchQuickOpenFilePaths(...args: Parameters<RuntimeFileSearch['searchQuickOpenFilePaths']>) {
    return this.search.searchQuickOpenFilePaths(...args)
  }

  searchRuntimeFiles(...args: Parameters<RuntimeFileSearch['searchRuntimeFiles']>) {
    return this.search.searchRuntimeFiles(...args)
  }

  listRuntimeFiles(...args: Parameters<RuntimeFileSearch['listRuntimeFiles']>) {
    return this.search.listRuntimeFiles(...args)
  }

  async openMobileFile(
    worktreeSelector: string,
    relativePath: string,
    navigation?: RuntimeNavigationTarget
  ): Promise<RuntimeFileOpenResult> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree } = target
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    const kind = isMobilePreviewableImagePath(relativePath)
      ? 'image'
      : isMobileBinaryPath(relativePath)
        ? 'binary'
        : isMobileMarkdownPath(relativePath)
          ? 'markdown'
          : 'text'
    // Why: `kind` only describes the file; the desktop editor opens binaries (e.g. PDFs) like the File Explorer.
    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    // Why: CLI/agents treat opened:true as success; stat first so missing paths and directories fail the RPC instead of opening a ghost tab.
    await this.assertOpenTargetIsFile(filePath, target)
    this.host.openFile(
      worktree.id,
      filePath,
      relativePath,
      runtimeOwnerForTarget(target),
      navigation
    )
    return { worktree: worktree.id, relativePath, kind, opened: true }
  }

  protected async assertOpenTargetIsFile(
    filePath: string,
    target: { executionHostId: ExecutionHostId }
  ): Promise<void> {
    let stats: FileStat
    try {
      stats = await requireRuntimeFileProvider(target, this.host).stat(filePath)
    } catch (error) {
      if (isENOENT(error)) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
      }
      throw error
    }
    if (stats.type === 'directory') {
      throw new Error(`EISDIR: illegal operation on a directory, open '${filePath}'`)
    }
  }

  async openMobileDiff(
    worktreeSelector: string,
    relativePath: string,
    staged: boolean,
    navigation?: RuntimeNavigationTarget
  ): Promise<RuntimeFileOpenResult> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    const { worktree } = target
    if (!isSafeMobileRelativePath(relativePath)) {
      throw new Error('invalid_relative_path')
    }
    const kind = isMobileBinaryPath(relativePath)
      ? 'binary'
      : isMobileMarkdownPath(relativePath)
        ? 'markdown'
        : 'text'
    const filePath = joinWorktreeRelativePath(worktree.path, relativePath)
    this.host.openDiff(
      worktree.id,
      filePath,
      relativePath,
      staged,
      runtimeOwnerForTarget(target),
      navigation
    )
    return { worktree: worktree.id, relativePath, kind, opened: true }
  }

  protected async resolveFileExplorerPath(
    worktreeSelector: string,
    relativePath: string
  ): Promise<RuntimeFileExplorerPath> {
    const [target] = await this.resolveFileExplorerPaths(worktreeSelector, [relativePath])
    return target
  }

  protected async resolveFileExplorerPaths(
    worktreeSelector: string,
    relativePaths: readonly string[]
  ): Promise<RuntimeFileExplorerPath[]> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    return relativePaths.map((relativePath) => ({
      worktree: target.worktree,
      path: joinWorktreeRelativePath(
        target.worktree.path,
        normalizeRuntimeRelativePath(relativePath, target.worktree.path)
      ),
      executionHostId: target.executionHostId
    }))
  }

  async listRuntimeMarkdownDocuments(worktreeSelector: string): Promise<MarkdownDocument[]> {
    const target = await this.host.resolveRuntimeFileTarget(worktreeSelector)
    return listFilesystemMarkdownDocuments(
      requireRuntimeFileProvider(target, this.host),
      target.worktree.path
    )
  }

  async pathsExistRuntimeFiles(
    worktreeSelector: string,
    relativePaths: string[]
  ): Promise<PathExistenceResult[]> {
    validatePathExistenceBatch(relativePaths)
    const targets = await this.resolveFileExplorerPaths(worktreeSelector, relativePaths)
    return readRuntimeFilePathExistence(targets, this.host)
  }

  async statRuntimeFile(
    worktreeSelector: string,
    relativePath: string
  ): Promise<{ size: number; isDirectory: boolean; mtime: number; ctime?: number }> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    const fileStat = await requireRuntimeFileProvider(target, this.host).stat(target.path)
    return {
      size: fileStat.size,
      isDirectory: fileStat.type === 'directory',
      mtime: fileStat.mtime,
      ...(fileStat.ctimeMs === undefined ? {} : { ctime: fileStat.ctimeMs })
    }
  }
}

// Why: name the resolved owner; undefined would let the renderer fall back to the focused server.
function runtimeOwnerForTarget(target: { executionHostId: ExecutionHostId }): string | null {
  const host = parseExecutionHostId(target.executionHostId)
  return host?.kind === 'runtime' ? host.environmentId : null
}
