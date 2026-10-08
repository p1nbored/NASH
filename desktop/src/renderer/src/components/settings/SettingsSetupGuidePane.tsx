import { useEffect, useMemo, useState } from 'react'
import {
  getFeatureWallSetupSteps,
  getFirstIncompleteFeatureWallSetupStepId
} from '../../../../shared/feature-wall-setup-steps'
import type { FeatureWallSetupStepId } from '../../../../shared/feature-wall-setup-steps'
import { FeatureWallSetupChecklist } from '../feature-wall/FeatureWallSetupChecklist'
import { useSettingsSetupGuideFullProgress } from './settings-setup-guide-progress'

export function SettingsSetupGuidePane(): React.JSX.Element {
  const setupSteps = useMemo(() => getFeatureWallSetupSteps(), [])
  const [userSelectedStep, setUserSelectedStep] = useState(false)
  // Why false, false: the checklist no longer has an agent skills step (D-038).
  const progress = useSettingsSetupGuideFullProgress(true, false, false)
  const [activeStepId, setActiveStepId] = useState<FeatureWallSetupStepId>(() =>
    getFirstIncompleteFeatureWallSetupStepId(progress.stepDone)
  )
  const activeStep = setupSteps.find((step) => step.id === activeStepId) ?? setupSteps[0] ?? null

  useEffect(() => {
    if (userSelectedStep) {
      return
    }
    setActiveStepId(getFirstIncompleteFeatureWallSetupStepId(progress.stepDone))
  }, [progress.stepDone, userSelectedStep])

  useEffect(() => {
    if (!activeStep || userSelectedStep || !progress.stepDone[activeStep.id]) {
      return
    }
    const nextUnfinishedStepId = getFirstIncompleteFeatureWallSetupStepId(progress.stepDone)
    if (nextUnfinishedStepId !== activeStep.id) {
      setActiveStepId(nextUnfinishedStepId)
    }
  }, [activeStep, progress.stepDone, userSelectedStep])

  const handleSelectStep = (id: FeatureWallSetupStepId): void => {
    setUserSelectedStep(true)
    setActiveStepId(id)
  }

  return (
    <div className="h-[min(740px,calc(100vh-14rem))] min-h-[540px] px-7 py-6">
      <FeatureWallSetupChecklist
        layout="embedded"
        activeStep={activeStep}
        progress={progress}
        onSelectStep={handleSelectStep}
      />
    </div>
  )
}
