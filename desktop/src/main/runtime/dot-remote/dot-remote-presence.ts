import { canonicalJson } from '../../../shared/canonical-json'
import {
  DOT_REMOTE_CONTRACT_VERSION,
  DOT_REMOTE_HEARTBEAT_SECONDS
} from '../../../shared/dot-remote/dot-remote-limits'
import { DotRemoteWorkspaceSchema } from '../../../shared/dot-remote/dot-remote-presence'
import { WORKBENCH_LIST_MAX_LIMIT } from '../../../shared/workbench-request'
import type { DotRemoteBinding } from './dot-remote-consumer'
import {
  siteFailureOf,
  type DotRemoteSiteClient,
  type DotRemoteSiteFailure
} from './dot-remote-site-client'

// What NASH says about itself: a heartbeat every 30 s, and the workspaces dot may target as opaque
// dws_ refs with their display names, published again whenever the list changes. Never a path.

export type DotRemoteWorkspaceEntry = { workspaceRef: string; displayName: string }

const APP_VERSION = /^[A-Za-z0-9._+-]{1,32}$/

export function dotRemoteAppVersion(version: string): string {
  return APP_VERSION.test(version) ? version : 'unknown'
}

export function createDotRemotePresence(deps: {
  readonly now: () => number
  readonly appVersion: string
  readonly listWorkspaces: () => readonly DotRemoteWorkspaceEntry[]
}) {
  const appVersion = dotRemoteAppVersion(deps.appVersion)
  let lastBeatAt: number | null = null
  let publishedSignature: string | null = null
  const iso = (): string => new Date(deps.now()).toISOString()

  function workspaces(): DotRemoteWorkspaceEntry[] {
    const valid = deps
      .listWorkspaces()
      .filter((entry) => DotRemoteWorkspaceSchema.safeParse(entry).success)
    return valid
      .filter(
        (entry, index) =>
          valid.findIndex((other) => other.workspaceRef === entry.workspaceRef) === index
      )
      .slice(0, WORKBENCH_LIST_MAX_LIMIT)
      .map(({ workspaceRef, displayName }) => ({ workspaceRef, displayName }))
  }

  async function beat(site: DotRemoteSiteClient, binding: DotRemoteBinding, signal?: AbortSignal) {
    if (lastBeatAt !== null && deps.now() - lastBeatAt < DOT_REMOTE_HEARTBEAT_SECONDS * 1000) {
      return null
    }
    const result = await site.call(
      'heartbeat.post',
      {
        generation: binding.generation,
        appVersion,
        contractVersion: DOT_REMOTE_CONTRACT_VERSION,
        sentAt: iso()
      },
      { credentials: binding.credentials, signal }
    )
    if (!result.ok) {
      return siteFailureOf(result)
    }
    lastBeatAt = deps.now()
    return null
  }

  async function publish(
    site: DotRemoteSiteClient,
    binding: DotRemoteBinding,
    signal?: AbortSignal
  ) {
    const list = workspaces()
    const signature = canonicalJson(list)
    if (signature === publishedSignature) {
      return null
    }
    const result = await site.call(
      'workspaces.put',
      { generation: binding.generation, publishedAt: iso(), workspaces: list },
      { credentials: binding.credentials, signal }
    )
    if (!result.ok) {
      return siteFailureOf(result)
    }
    publishedSignature = signature
    return null
  }

  return {
    /** A heartbeat when due and the workspace list when it changed; the first failure is returned. */
    async sync(
      site: DotRemoteSiteClient,
      binding: DotRemoteBinding,
      signal?: AbortSignal
    ): Promise<DotRemoteSiteFailure | null> {
      return (await beat(site, binding, signal)) ?? (await publish(site, binding, signal))
    },
    /** A new pairing: both are sent on the next sync. */
    reset(): void {
      lastBeatAt = null
      publishedSignature = null
    }
  }
}

export type DotRemotePresence = ReturnType<typeof createDotRemotePresence>
