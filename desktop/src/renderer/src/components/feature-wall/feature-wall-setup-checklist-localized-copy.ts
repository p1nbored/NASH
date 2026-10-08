import type {
  FeatureWallSetupStep,
  FeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

type LocalizedFeatureWallSetupChecklistCopy = Pick<FeatureWallSetupStep, 'name' | 'description'>

const getLocalizedFeatureWallSetupChecklistCopyById = createLocalizedCatalog(
  (): Record<FeatureWallSetupStepId, LocalizedFeatureWallSetupChecklistCopy> => ({
    'claude-code': {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.claudeCodeName',
        'Set up Claude Code'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.claudeCodeDescription',
        'NASH runs every task through a Claude Code session. Install Claude Code and sign in once from a terminal.'
      )
    },
    clef: {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.clefName',
        'Connect Clef'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.clefDescription',
        'Clef sorts each task by kind so NASH can pick its agent and model. Add your Clef details, then verify them.'
      )
    },
    dot: {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.dotName',
        'Connect dot'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.dotDescription',
        'Send tasks to NASH from ChatGPT dot. Turn on the local interface or pair your GPT Site.'
      )
    },
    'workbench-run': {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.workbenchRunName',
        'Start your first run'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.workbenchRunDescription',
        'Ask NASH for something from the Workbench, then follow the run, its tasks and any prompts there.'
      )
    },
    'two-worktrees': {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.workOnTwoTasks',
        'Work on two tasks at once'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.62bac8f43c',
        'Work in 2 different worktrees at once. Each one is isolated (even in the same project). Perfect for working on 2 features at once.'
      )
    },
    notifications: {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.29aa2c2077',
        'Turn on notifications'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.71bd9a8c95',
        'Know the moment an agent finishes, needs attention, or gets blocked.'
      )
    },
    'task-sources': {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.ad342dd4c6',
        'Connect integrations'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.06fe30fdb0',
        'Start an agent from a task in one click and keep PR status in view.'
      )
    },
    'setup-script': {
      name: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.eddc532e58',
        'Automate workspace setup'
      ),
      description: translate(
        'auto.components.feature.wall.feature.wall.setup.checklist.localized.copy.56049b74c2',
        'Run install and setup commands automatically so every new worktree is ready for agents.'
      )
    }
  })
)

export function getLocalizedFeatureWallSetupChecklistCopy(
  step: FeatureWallSetupStep
): LocalizedFeatureWallSetupChecklistCopy {
  return getLocalizedFeatureWallSetupChecklistCopyById()[step.id]
}
