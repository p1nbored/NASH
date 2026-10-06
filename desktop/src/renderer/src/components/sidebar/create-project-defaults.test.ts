import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getDefaultCreateProjectParent,
  joinCreateProjectPath
} from './create-project-defaults'
import { APP_DEFAULT_PROJECTS_DIR_SEGMENTS } from '../../../../shared/app-identity-paths'

const [APP_DIR, PROJECTS_DIR] = APP_DEFAULT_PROJECTS_DIR_SEGMENTS

describe('create project defaults', () => {
  it('uses the NASH projects folder, never the folder of a real Orca install (D-017)', () => {
    expect(APP_DEFAULT_PROJECTS_DIR_SEGMENTS).toEqual(['nash', 'projects'])
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/nash/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/orca/projects',
        defaultParent: '/Users/alice/orca/projects'
      })
    ).toBe('/Users/alice/orca/projects')
  })

  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe(
      `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`
    )
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      `C:\\Users\\alice\\${APP_DIR}\\${PROJECTS_DIR}`
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe(
      `/home/alice/${APP_DIR}/${PROJECTS_DIR}`
    )
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath(`/home/alice/${APP_DIR}/${PROJECTS_DIR}`, 'demo')).toBe(
      `/home/alice/${APP_DIR}/${PROJECTS_DIR}/demo`
    )
    expect(joinCreateProjectPath(`C:\\Users\\alice\\${APP_DIR}\\${PROJECTS_DIR}`, 'demo')).toBe(
      `C:\\Users\\alice\\${APP_DIR}\\${PROJECTS_DIR}\\demo`
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        createStepAutoFilled: false
      })
    ).toEqual({ parent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}` })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`
      })
    ).toBe(`~/${APP_DIR}/${PROJECTS_DIR}`)
    expect(
      formatCreateProjectParentSummary({
        parent: `/home/alice/${APP_DIR}/${PROJECTS_DIR}`,
        defaultParent: `/home/alice/${APP_DIR}/${PROJECTS_DIR}`
      })
    ).toBe(`~/${APP_DIR}/${PROJECTS_DIR}`)
    expect(
      formatCreateProjectParentSummary({
        parent: `C:\\Users\\alice\\${APP_DIR}\\${PROJECTS_DIR}`,
        defaultParent: `C:\\Users\\alice\\${APP_DIR}\\${PROJECTS_DIR}`
      })
    ).toBe(`~/${APP_DIR}/${PROJECTS_DIR}`)
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('host folder not selected')
    expect(
      formatCreateProjectParentSummary({
        parent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        defaultParent: `/Users/alice/${APP_DIR}/${PROJECTS_DIR}`,
        isRemoteHost: true
      })
    ).toBe(`/Users/alice/${APP_DIR}/${PROJECTS_DIR}`)
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        isRemoteHost: true
      })
    ).toBe('host folder not selected')
  })

  it('keeps a configured Workspace Directory verbatim in the summary', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: 'J:\\PROJECTS',
        defaultParent: 'J:\\PROJECTS'
      })
    ).toBe('J:\\PROJECTS')
    expect(
      formatCreateProjectParentSummary({
        parent: '/data/orca/projects',
        defaultParent: '/data/orca/projects'
      })
    ).toBe('/data/orca/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: 'D:\\code\\orca\\projects',
        defaultParent: 'D:\\code\\orca\\projects'
      })
    ).toBe('D:\\code\\orca\\projects')
  })
})
