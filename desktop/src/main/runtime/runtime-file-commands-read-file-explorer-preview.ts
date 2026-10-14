// @ts-nocheck -- mechanically split class members.
import { RuntimeFileCommandsWithAssertRemoteTerminalFileGrantPathStillCanonical } from './runtime-file-commands-assert-remote-terminal-file-grant-path-still-canonical'
import type {
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult
} from '../../shared/runtime-types'
import {
  LOCAL_PREVIEWABLE_BINARY_MAX_BYTES,
  MOBILE_FILE_READ_MAX_BYTES,
  RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES,
  assertPreviewWithinTransportBudget,
  previewableBinaryByteLimit
} from './runtime-file-commands-mobile-file-list-limit'
import {
  requireLocalRuntimeFileRoute,
  requireRuntimeFileProvider
} from './runtime-file-command-target'
import { readLocalFileRange } from '../ipc/filesystem/local-file-range-read'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import { extname } from 'node:path'
import {
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../../shared/node-bounded-file-reader'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import type {
  DocPreviewFileAccessRequest,
  DocPreviewFileAccessResult
} from '../../shared/doc-preview-file-access'

export class RuntimeFileCommandsWithReadFileExplorerPreview extends RuntimeFileCommandsWithAssertRemoteTerminalFileGrantPathStillCanonical {
  async readFileExplorerPreview(
    worktreeSelector: string,
    relativePath: string,
    maxContentBytes?: number
  ): Promise<RuntimeFilePreviewResult> {
    const binaryMaxBytes =
      maxContentBytes === undefined
        ? LOCAL_PREVIEWABLE_BINARY_MAX_BYTES
        : previewableBinaryByteLimit(maxContentBytes)
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    requireLocalRuntimeFileRoute(target)
    // Why: sized by extension instead of a stat round trip.
    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    const mimeType = RUNTIME_PREVIEWABLE_BINARY_MIME_TYPES[extname(filePath).toLowerCase()]
    const maxBytes = mimeType ? binaryMaxBytes : MOBILE_FILE_READ_MAX_BYTES
    let buffer: Buffer
    try {
      buffer = (await readNodeFileWithinLimit(filePath, maxBytes)).buffer
    } catch (error) {
      if (error instanceof NodeFileReadTooLargeError) {
        throw new Error('file_too_large')
      }
      throw error
    }
    if (mimeType) {
      return assertPreviewWithinTransportBudget(
        {
          content: buffer.toString('base64'),
          isBinary: true,
          isImage: true,
          mimeType
        },
        maxContentBytes
      )
    }

    if (isBinaryBuffer(buffer)) {
      return assertPreviewWithinTransportBudget({ content: '', isBinary: true }, maxContentBytes)
    }
    return assertPreviewWithinTransportBudget(
      { content: buffer.toString('utf-8'), isBinary: false },
      maxContentBytes
    )
  }

  async readDocPreviewFile(
    worktreeSelector: string,
    relativePath: string,
    entryRelativePath: string,
    implicitRootRelativePath: string | null,
    authorizedRootRelativePaths: string[],
    maxContentBytes?: number
  ): Promise<DocPreviewFileAccessResult> {
    const relativePaths = [
      '',
      entryRelativePath,
      relativePath,
      ...(implicitRootRelativePath === null ? [] : [implicitRootRelativePath]),
      ...authorizedRootRelativePaths
    ]
    const [boundary, entry, target, ...authorityRoots] = await this.resolveFileExplorerPaths(
      worktreeSelector,
      relativePaths
    )
    const implicitRoot = implicitRootRelativePath === null ? null : authorityRoots[0]
    const authorizedRoots = authorityRoots.slice(implicitRoot === null ? 0 : 1)
    const binaryMaxBytes =
      maxContentBytes === undefined
        ? LOCAL_PREVIEWABLE_BINARY_MAX_BYTES
        : previewableBinaryByteLimit(maxContentBytes)
    const request: DocPreviewFileAccessRequest = {
      boundaryPath: boundary.path,
      entryPath: entry.path,
      implicitRootPath: implicitRoot?.path ?? null,
      authorizedRootPaths: authorizedRoots.map((root) => root.path),
      targetPath: target.path,
      maxTextBytes: MOBILE_FILE_READ_MAX_BYTES,
      maxBinaryBytes: binaryMaxBytes
    }
    const provider = requireRuntimeFileProvider(target, this.host)
    if (!provider.readDocPreviewFile) {
      throw new Error('Secure document previews require a newer SSH relay')
    }
    return assertPreviewWithinTransportBudget(
      await provider.readDocPreviewFile(request),
      maxContentBytes
    )
  }

  async readFileExplorerChunk(
    worktreeSelector: string,
    relativePath: string,
    offset: number,
    length: number
  ): Promise<RuntimeFileReadChunkResult> {
    const target = await this.resolveFileExplorerPath(worktreeSelector, relativePath)
    requireLocalRuntimeFileRoute(target)
    const filePath = await resolveAuthorizedPath(target.path, this.host.requireStore())
    return readLocalFileRange(filePath, offset, length)
  }
}
