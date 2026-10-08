// Each current setup step completes from a signal NASH already has.
export type FeatureWallSetupStepId =
  | 'claude-code'
  | 'clef'
  | 'dot'
  | 'task-sources'
  | 'notifications'
  | 'setup-script'
  | 'workbench-run'
  | 'two-worktrees'

export type FeatureWallSetupStep = {
  readonly id: FeatureWallSetupStepId
  readonly name: string
  readonly subtitle: string
  readonly description: string
}

export const FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS = [
  'workbench-run',
  'two-worktrees'
] as const satisfies readonly FeatureWallSetupStepId[]

export type FeatureWallSetupSectionId = 'parallel-work' | 'setup'

export const FEATURE_WALL_SETUP_STEPS: readonly FeatureWallSetupStep[] = [
  {
    id: 'claude-code',
    name: 'Set up a primary agent',
    subtitle: 'Set up a primary agent',
    description:
      'Install Claude Code or Codex for the primary session, then sign in from a terminal.'
  },
  {
    id: 'clef',
    name: 'Connect Clef',
    subtitle: 'Connect Clef',
    description:
      'Clef sorts each task by kind so NASH can pick its agent and model. Add your Clef details, then verify them.'
  },
  {
    id: 'dot',
    name: 'Connect dot',
    subtitle: 'Connect dot',
    description:
      'Send tasks to NASH from ChatGPT dot. Turn on the local interface or pair your GPT Site.'
  },
  {
    id: 'task-sources',
    name: 'Connect integrations',
    subtitle: 'Connect integrations',
    description: 'Start an agent from a task in one click and keep PR status in view.'
  },
  {
    id: 'notifications',
    name: 'Turn on notifications',
    subtitle: 'Turn on notifications',
    description: 'Know the moment an agent finishes, needs attention, or gets blocked.'
  },
  {
    id: 'setup-script',
    name: 'Automate workspace setup',
    subtitle: 'Automate workspace setup',
    description:
      'Run install and setup commands automatically so every new worktree is ready for agents.'
  },
  {
    id: 'workbench-run',
    name: 'Start your first run',
    subtitle: 'Start your first run',
    description:
      'Ask NASH for something from the Workbench, then follow the run, its tasks and any prompts there.'
  },
  {
    id: 'two-worktrees',
    name: 'Work on two tasks at once',
    subtitle: 'Work on two tasks at once',
    description:
      'Work in 2 different worktrees at once. Each one is isolated (even in the same project). Perfect for working on 2 features at once.'
  }
] as const

export const FEATURE_WALL_SETUP_STEP_IDS = FEATURE_WALL_SETUP_STEPS.map((step) => step.id)

export function getFeatureWallSetupSteps(): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS
}

export function getFeatureWallSetupSectionId(
  stepId: FeatureWallSetupStepId
): FeatureWallSetupSectionId {
  return FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS.includes(
    stepId as (typeof FEATURE_WALL_SETUP_PARALLEL_WORK_STEP_IDS)[number]
  )
    ? 'parallel-work'
    : 'setup'
}

export function getFeatureWallSetupStepsForSection(
  sectionId: FeatureWallSetupSectionId
): readonly FeatureWallSetupStep[] {
  return FEATURE_WALL_SETUP_STEPS.filter(
    (step) => getFeatureWallSetupSectionId(step.id) === sectionId
  )
}

export function getFirstIncompleteFeatureWallSetupStepId(
  stepDone: Partial<Record<FeatureWallSetupStepId, boolean>>
): FeatureWallSetupStepId {
  // Why: onboarding should prioritize Setup, while durable definitions retain the original order.
  const setupStep = getFeatureWallSetupStepsForSection('setup').find((step) => !stepDone[step.id])
  if (setupStep) {
    return setupStep.id
  }
  const parallelStep = getFeatureWallSetupStepsForSection('parallel-work').find(
    (step) => !stepDone[step.id]
  )
  return parallelStep?.id ?? FEATURE_WALL_SETUP_STEPS[0].id
}

export function isFeatureWallSetupStepId(value: unknown): value is FeatureWallSetupStepId {
  return (
    typeof value === 'string' &&
    FEATURE_WALL_SETUP_STEP_IDS.includes(value as FeatureWallSetupStepId)
  )
}
