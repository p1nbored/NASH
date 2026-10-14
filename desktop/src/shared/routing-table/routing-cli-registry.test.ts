import { describe, expect, it } from 'vitest'
import { CoordinatorSchema, RouteSchema } from './routing-table-schema'

describe('routing CLI choices', () => {
  it.each(['antigravity', 'gemini', 'cursor', 'codebuddy', 'grok', 'muse', 'omp', 'opencode'])(
    'accepts %s as a coordinator with an exact model',
    (agent) => {
      expect(
        CoordinatorSchema.safeParse({ agent, model: 'gemini-4-argon', reasoning_level: 'high' })
          .success
      ).toBe(true)
    }
  )

  it.each([
    'claude_cli',
    'gemini_cli',
    'cursor_cli',
    'codebuddy_cli',
    'grok_cli',
    'muse_cli',
    'omp_cli',
    'opencode_cli'
  ])('accepts a delegated %s route without changing inheritance rules', (execution_target) => {
    const route = {
      task_type: 'general_research_analysis',
      execution_target,
      model: 'gemini-4-argon',
      reasoning_level: 'high'
    }
    expect(RouteSchema.safeParse(route).success).toBe(true)
    expect(RouteSchema.safeParse({ ...route, model: 'inherit' }).success).toBe(false)
  })
})
