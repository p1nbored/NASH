import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'

import type { ExecutionHostId } from '../../../src/shared/execution-host'
import { reachableServerClients } from '../transport/execution-host-scoped-rpc-client'
import { useRelayHosts } from '../worktree/relay-hosts-feed'
import { withServerHosts } from '../worktree/server-workspaces'
import { NewWorktreeModal } from './NewWorktreeModal'
import type { NewWorktreeModalProps } from './new-worktree-modal-types'

export type NewWorktreeModalControllerHandle = {
  open: () => void
}

type Props = Omit<
  NewWorktreeModalProps,
  'visible' | 'onClose' | 'serverClients' | 'hostLabelById'
> & {
  /** The desktop's capabilities, which say whether its servers are reachable through it. */
  hostCapabilities: readonly string[]
  /** The desktop's own host names; the sheet adds its servers' from the feed. */
  hostLabelById: ReadonlyMap<ExecutionHostId, string>
  routeVisible: boolean
  onVisibleChange?: (visible: boolean) => void
  onRouteVisibleChange: (visible: boolean) => void
}

export const NewWorktreeModalController = forwardRef<NewWorktreeModalControllerHandle, Props>(
  function NewWorktreeModalController(
    {
      routeVisible,
      client,
      hostCapabilities,
      hostId,
      hostLabelById,
      existingWorktreePaths,
      existingWorktrees,
      openExternalUrl,
      onVisibleChange,
      onRouteVisibleChange,
      onCreated
    },
    ref
  ) {
    const [manualVisible, setManualVisible] = useState(false)
    const visible = routeVisible || manualVisible
    // Why the feed, not the list's server rows: the list stops refreshing behind the sheet.
    const servers = useRelayHosts(visible ? client : null)
    const serverClients = useMemo(
      () => reachableServerClients(client, hostCapabilities, servers ?? []),
      [client, hostCapabilities, servers]
    )
    const serverLabelById = useMemo(
      () => withServerHosts(hostLabelById, servers ?? [], (host) => host.label),
      [hostLabelById, servers]
    )

    useImperativeHandle(
      ref,
      () => ({
        open: () => setManualVisible(true)
      }),
      []
    )

    const close = useCallback(() => {
      setManualVisible(false)
      if (routeVisible) {
        onRouteVisibleChange(false)
      }
    }, [onRouteVisibleChange, routeVisible])

    useEffect(() => {
      onVisibleChange?.(visible)
    }, [onVisibleChange, visible])

    return (
      <NewWorktreeModal
        visible={visible}
        client={client}
        serverClients={serverClients}
        hostId={hostId}
        hostLabelById={serverLabelById}
        existingWorktreePaths={existingWorktreePaths}
        existingWorktrees={existingWorktrees}
        openExternalUrl={openExternalUrl}
        onCreated={onCreated}
        onClose={close}
      />
    )
  }
)
