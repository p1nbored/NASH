import type { ComponentType } from 'react'
import { FolderOpen, Globe, Monitor, Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export type AddRepoLocalStartActionHandlers = {
  onBrowse: () => void
  onOpenCloneStep: () => void
  onOpenRemoteStep: () => void
  onOpenCreateStep: () => void
  browseHostKind?: 'local' | 'runtime'
  /** A paired server's own SSH hosts; `unsupported` when it predates managing them. */
  serverSshProjects?: 'supported' | 'unsupported' | 'unknown'
}

export type AddRepoLocalStartAction = {
  kind: 'browse' | 'clone' | 'remote' | 'create'
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  disabled?: boolean
  onClick: () => void
}

export function getAddRepoLocalStartActions({
  onBrowse,
  onOpenCloneStep,
  onOpenRemoteStep,
  onOpenCreateStep,
  browseHostKind = 'local',
  serverSshProjects
}: AddRepoLocalStartActionHandlers): {
  primaryAction: AddRepoLocalStartAction
  secondaryActions: AddRepoLocalStartAction[]
} {
  const primaryAction = {
    kind: 'browse' as const,
    icon: FolderOpen,
    title: translate(
      'auto.components.sidebar.add.repo.local.start.actions.2281fdc8c7',
      'Browse folder'
    ),
    description:
      browseHostKind === 'runtime'
        ? translate(
            'auto.components.sidebar.add.repo.local.start.actions.runtimeBrowseDescription',
            'Existing Git repository or folder on this host'
          )
        : translate(
            'auto.components.sidebar.add.repo.local.start.actions.fb4fc5380e',
            'Local project, Git repo, or folder with many repos'
          ),
    onClick: onBrowse
  }

  const remote = serverSshProjects
    ? {
        kind: 'remote' as const,
        icon: Monitor,
        title: translate(
          'auto.components.sidebar.add.repo.local.start.actions.serverSshTitle',
          "Project on this server's SSH host"
        ),
        description:
          serverSshProjects === 'unsupported'
            ? translate(
                'auto.components.sidebar.add.repo.local.start.actions.serverSshUpdate',
                'Update this server to add projects on its SSH hosts'
              )
            : translate(
                'auto.components.sidebar.add.repo.local.start.actions.serverSshDescription',
                'Open a project folder from an SSH host this server connects to'
              ),
        // Why: an old server has no way to do this, and this client must not do it locally.
        disabled: serverSshProjects !== 'supported',
        onClick: onOpenRemoteStep
      }
    : null
  const clone = {
    kind: 'clone' as const,
    icon: Globe,
    title: translate(
      'auto.components.sidebar.add.repo.local.start.actions.7edb8ebe24',
      'Clone from URL'
    ),
    description: translate(
      'auto.components.sidebar.add.repo.local.start.actions.5f9ffac036',
      'Clone a remote Git repository'
    ),
    onClick: onOpenCloneStep
  }
  const create = {
    kind: 'create' as const,
    icon: Plus,
    title: translate(
      'auto.components.sidebar.add.repo.local.start.actions.c709860596',
      'Create new project'
    ),
    description: translate(
      'auto.components.sidebar.add.repo.local.start.actions.d72789705e',
      'Start from an empty folder'
    ),
    onClick: onOpenCreateStep
  }

  const secondaryActions = remote ? [clone, remote, create] : [clone, create]

  return { primaryAction, secondaryActions }
}
