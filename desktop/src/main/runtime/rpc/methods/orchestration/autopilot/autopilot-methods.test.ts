import { describe, expect, it } from 'vitest'
import {
  AUTOPILOT_TASK_API_ERROR_CODES,
  ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES,
  ORCHESTRATION_AUTOPILOT_TASK_METHODS
} from './autopilot-methods'

describe('orchestration autopilot task methods', () => {
  it('declares the five task methods in command order', () => {
    expect(ORCHESTRATION_AUTOPILOT_TASK_METHODS.map((method) => method.name)).toEqual([
      'orchestration.taskPropose',
      'orchestration.taskStart',
      'orchestration.taskShow',
      'orchestration.taskReport',
      'orchestration.runComplete'
    ])
  })

  it('names every method but the read as a mutation', () => {
    expect([...ORCHESTRATION_AUTOPILOT_MUTATION_METHOD_NAMES]).toEqual([
      'orchestration.taskPropose',
      'orchestration.taskStart',
      'orchestration.taskReport',
      'orchestration.runComplete'
    ])
  })

  it('refuses unknown params on every method', () => {
    for (const method of ORCHESTRATION_AUTOPILOT_TASK_METHODS) {
      expect(method.params.safeParse({ model: 'claude-opus-5-5' }).success).toBe(false)
    }
  })

  it('uses autopilot_ codes, which the RPC error passthrough can name by prefix', () => {
    for (const code of Object.values(AUTOPILOT_TASK_API_ERROR_CODES)) {
      expect(code).toMatch(/^autopilot_[a-z_]+$/)
    }
  })
})
