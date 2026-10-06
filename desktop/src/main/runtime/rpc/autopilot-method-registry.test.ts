import { describe, expect, it } from 'vitest'
import { isOrchestrationMutation } from '../../../shared/orchestration-rpc-contract'
import { MOBILE_RPC_METHOD_ALLOWLIST } from '../runtime-rpc/runtime-rpc-mobile-method-allowlist'
import { ALL_RPC_METHODS } from './methods'
import { DOT_INGRESS_RPC_METHODS } from './methods/dot-ingress'
import {
  ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES,
  ORCHESTRATION_AUTOPILOT_TASK_METHODS
} from './methods/orchestration/autopilot/autopilot-methods'
import { ORCHESTRATION_PERMISSION_METHODS } from './methods/orchestration/autopilot/permission-methods'
import { WORKBENCH_DOT_INGRESS_METHODS } from './methods/workbench-dot-ingress'
import { WORKBENCH_DOT_REMOTE_METHODS } from './methods/workbench-dot-remote'
import { WORKBENCH_PERMISSION_METHODS } from './methods/workbench-permission'
import { WORKBENCH_ROUTING_TABLE_METHODS } from './methods/workbench-routing-table'
import { WORKBENCH_RUN_METHODS } from './methods/workbench-run'
import { ORCHESTRATION_CALLER_PARAM } from './orchestration-session-caller'

// E1 registers the D-016 method groups in the one shared registry. These checks keep each group
// registered once, keep the dot ingress surface out of it, and keep every new name off the paths
// that would widen who may call it (mobile, caller param, mutation receipts for one-shot hooks).

const REGISTERED = ALL_RPC_METHODS.map((method) => method.name)
const names = (methods: readonly { name: string }[]): string[] =>
  methods.map((method) => method.name)

const NEW_GROUPS = {
  task: names(ORCHESTRATION_AUTOPILOT_TASK_METHODS),
  permission: names(ORCHESTRATION_PERMISSION_METHODS),
  workbenchPermission: names(WORKBENCH_PERMISSION_METHODS),
  workbenchRun: names(WORKBENCH_RUN_METHODS),
  workbenchRoutingTable: names(WORKBENCH_ROUTING_TABLE_METHODS),
  workbenchDotIngress: names(WORKBENCH_DOT_INGRESS_METHODS),
  workbenchDotRemote: names(WORKBENCH_DOT_REMOTE_METHODS)
} as const
const NEW_NAMES = Object.values(NEW_GROUPS).flat()

describe('the D-016 method groups in the shared registry', () => {
  it.each(Object.entries(NEW_GROUPS))('registers every %s method exactly once', (_group, group) => {
    expect(group.length).toBeGreaterThan(0)
    for (const name of group) {
      expect(REGISTERED.filter((registered) => registered === name)).toEqual([name])
    }
  })

  it('registers the exact method objects, so the params catalog binds their schemas', () => {
    const groups = [
      ...ORCHESTRATION_AUTOPILOT_TASK_METHODS,
      ...ORCHESTRATION_PERMISSION_METHODS,
      ...WORKBENCH_PERMISSION_METHODS,
      ...WORKBENCH_RUN_METHODS,
      ...WORKBENCH_ROUTING_TABLE_METHODS,
      ...WORKBENCH_DOT_INGRESS_METHODS,
      ...WORKBENCH_DOT_REMOTE_METHODS
    ]
    for (const method of groups) {
      expect(ALL_RPC_METHODS).toContain(method)
    }
  })

  it('keeps every dotIngress method out of the shared registry', () => {
    expect(REGISTERED.some((name) => name.startsWith('dotIngress.'))).toBe(false)
    for (const name of names(DOT_INGRESS_RPC_METHODS)) {
      expect(REGISTERED).not.toContain(name)
    }
  })

  it('puts no new name on the mobile allowlist', () => {
    for (const name of [...NEW_NAMES, ...names(DOT_INGRESS_RPC_METHODS)]) {
      expect(MOBILE_RPC_METHOD_ALLOWLIST.has(name), name).toBe(false)
    }
  })

  it('gives no new orchestration method a caller param, since the caller is attested, not named', () => {
    for (const name of [...NEW_GROUPS.task, ...NEW_GROUPS.permission]) {
      expect(ORCHESTRATION_CALLER_PARAM[name], name).toBeUndefined()
    }
  })
})

describe('durable mutation receipts for the task API', () => {
  it('treats the four state-changing task commands as mutations', () => {
    expect([...ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES].sort()).toEqual([
      'orchestration.runComplete',
      'orchestration.taskPropose',
      'orchestration.taskReport',
      'orchestration.taskStart'
    ])
    for (const name of ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES) {
      expect(isOrchestrationMutation(name, {}), name).toBe(true)
    }
  })

  it('keeps task-show a read', () => {
    expect(isOrchestrationMutation('orchestration.taskShow', { taskId: 'task_1' })).toBe(false)
  })

  it('gives the one-shot permission hook no receipt, replay or contract preflight', () => {
    for (const name of NEW_GROUPS.permission) {
      expect(isOrchestrationMutation(name, {}), name).toBe(false)
    }
  })

  it('leaves the desktop workbench methods outside the orchestration receipts', () => {
    const workbench = NEW_NAMES.filter((name) => name.startsWith('workbench.'))
    expect(workbench.length).toBeGreaterThan(0)
    for (const name of workbench) {
      expect(isOrchestrationMutation(name, {}), name).toBe(false)
    }
  })
})
