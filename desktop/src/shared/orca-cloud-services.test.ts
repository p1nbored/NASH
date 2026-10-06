import { describe, expect, it } from 'vitest'
import { ORCA_CLOUD_SERVICES_ENABLED, ORCA_CLOUD_SERVICES_OFF_CODE } from './orca-cloud-services'

describe('Orca cloud services switch', () => {
  it('keeps every Orca cloud service off in NASH builds', () => {
    expect(ORCA_CLOUD_SERVICES_ENABLED).toBe(false)
  })

  it('names the refusal code a NASH build returns', () => {
    expect(ORCA_CLOUD_SERVICES_OFF_CODE).toBe('orca_cloud_services_off')
  })
})
