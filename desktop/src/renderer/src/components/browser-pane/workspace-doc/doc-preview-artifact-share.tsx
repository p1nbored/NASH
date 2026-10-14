import type { ArtifactWriteRequest } from '../../../../../shared/artifacts'
import {
  getConnectionExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../../shared/execution-host'
import type { DocPreviewGrantOwner } from '../../../../../preload/api/doc-preview-api'
import { ArtifactPublishButton } from '@/components/artifacts/ArtifactPublishButton'
import { ArtifactPublishPreparationError } from '@/components/artifacts/artifact-publish-flow'
import type { BrowserChromeShareControl } from '@/components/browser-pane/assemble-chrome/browser-chrome-toolbar'
import { isShareableHtmlPath } from '@/components/editor/editor-artifact-upload'
import type { DocPreviewGrantLocation } from '@/lib/doc-preview-grants'
import { fileArtifactSourceKey, type FileArtifactOwner } from '@/lib/file-artifact-source-key'
import { basename } from '@/lib/path'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { readRuntimeFilePreview } from '@/runtime/runtime-file-read-client'

/** The host a grant reads from, spelled as the editor's route for that host. */
export function docPreviewGrantFileOwner(owner: DocPreviewGrantOwner): FileArtifactOwner {
  return owner.kind === 'ssh'
    ? {
        executionHostId: getConnectionExecutionHostId(owner.connectionId),
        runtimeEnvironmentId: null
      }
    : {
        executionHostId: toRuntimeExecutionHostId(owner.environmentId),
        runtimeEnvironmentId: owner.environmentId
      }
}

function docPreviewGrantReadContext(owner: DocPreviewGrantOwner): RuntimeFileOperationArgs {
  if (owner.kind === 'ssh') {
    // Why the connection id is kept: dropping it would read this path on this machine.
    return {
      target: { kind: 'local' },
      worktreeId: null,
      worktreePath: null,
      connectionId: owner.connectionId
    }
  }
  return {
    target: { kind: 'environment', environmentId: owner.environmentId },
    // A selector passes through toRuntimeWorktreeSelector unchanged.
    worktreeId: owner.worktreeSelector,
    worktreePath: owner.worktreeRoot
  }
}

/** Reads the document from the host its grant was minted for, never the one selected now. */
export async function readDocPreviewArtifactRequest(
  location: DocPreviewGrantLocation,
  filePath: string,
  sourceKey: string
): Promise<ArtifactWriteRequest> {
  let result: Awaited<ReturnType<typeof readRuntimeFilePreview>>
  try {
    result = await readRuntimeFilePreview(docPreviewGrantReadContext(location.owner), filePath)
  } catch {
    throw new ArtifactPublishPreparationError('unreadable')
  }
  if (result.isBinary) {
    throw new ArtifactPublishPreparationError('binary')
  }
  return {
    sourceKey,
    content: result.content,
    contentType: 'text/html',
    fileName: basename(filePath)
  }
}

/** The toolbar's Share button for an HTML preview with a live grant; undefined for anything else. */
export function buildDocPreviewShareControl(
  filePath: string,
  location: DocPreviewGrantLocation | null
): ((control: BrowserChromeShareControl) => React.ReactNode) | undefined {
  if (!location || !isShareableHtmlPath(filePath)) {
    return undefined
  }
  const sourceKey = fileArtifactSourceKey(docPreviewGrantFileOwner(location.owner), filePath)
  return (control) => (
    <ArtifactPublishButton
      sourceKey={sourceKey}
      className="h-7 w-7"
      createRequest={() => readDocPreviewArtifactRequest(location, filePath, sourceKey)}
      {...control}
    />
  )
}
