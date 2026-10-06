import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from './app-identity-constants'
import {
  APP_AGENT_HOOKS_HOME_PATH,
  APP_AGENT_HOOKS_HOME_PATH_WINDOWS,
  APP_DEFAULT_PROJECTS_DIR_SEGMENTS,
  APP_DEFAULT_WORKSPACES_DIR_SEGMENTS,
  APP_HOME_DIR_NAME,
  APP_RELAY_HOME_DIR_NAME,
  APP_REMOTE_DIR_NAME,
  APP_WSL_DIR_NAME,
  APP_XDG_DATA_DIR_NAME,
  APP_XDG_DATA_HOME_PATH
} from './app-identity-paths'

// FIXTURE_ONLY: every per-user folder name a real Orca install owns (decision D-017).
const ORCA_PER_USER_NAMES = [
  '.orca',
  '.orca-relay',
  '.orca-remote',
  '.orca-wsl',
  'orca',
  '.orca/agent-hooks',
  '.orca\\agent-hooks',
  '.local/share/orca',
  'orca/projects',
  'orca/workspaces'
]

describe('NASH per-user folder names', () => {
  it('derives every folder from the identity data folder name', () => {
    const name = APP_IDENTITY.userDataDirName

    expect(APP_HOME_DIR_NAME).toBe(`.${name}`)
    expect(APP_RELAY_HOME_DIR_NAME).toBe(`.${name}-relay`)
    expect(APP_REMOTE_DIR_NAME).toBe(`.${name}-remote`)
    expect(APP_WSL_DIR_NAME).toBe(`.${name}-wsl`)
    expect(APP_XDG_DATA_DIR_NAME).toBe(name)
    expect(APP_DEFAULT_PROJECTS_DIR_SEGMENTS).toEqual([name, 'projects'])
    expect(APP_DEFAULT_WORKSPACES_DIR_SEGMENTS).toEqual([name, 'workspaces'])
    expect(APP_AGENT_HOOKS_HOME_PATH).toBe(`.${name}/agent-hooks`)
    expect(APP_AGENT_HOOKS_HOME_PATH_WINDOWS).toBe(`.${name}\\agent-hooks`)
    expect(APP_XDG_DATA_HOME_PATH).toBe(`.local/share/${name}`)
  })

  it('never equals a folder a real Orca install owns, ignoring case', () => {
    const ours = [
      APP_HOME_DIR_NAME,
      APP_RELAY_HOME_DIR_NAME,
      APP_REMOTE_DIR_NAME,
      APP_WSL_DIR_NAME,
      APP_XDG_DATA_DIR_NAME,
      APP_DEFAULT_PROJECTS_DIR_SEGMENTS.join('/'),
      APP_DEFAULT_WORKSPACES_DIR_SEGMENTS.join('/'),
      APP_AGENT_HOOKS_HOME_PATH,
      APP_AGENT_HOOKS_HOME_PATH_WINDOWS,
      APP_XDG_DATA_HOME_PATH
    ].map((value) => value.toLowerCase())

    for (const orcaName of ORCA_PER_USER_NAMES) {
      expect(ours).not.toContain(orcaName)
    }
  })

  it('keeps the home folder, relay folder and remote folder distinct from each other', () => {
    const folders = [
      APP_HOME_DIR_NAME,
      APP_RELAY_HOME_DIR_NAME,
      APP_REMOTE_DIR_NAME,
      APP_WSL_DIR_NAME
    ]

    expect(new Set(folders).size).toBe(folders.length)
  })
})
