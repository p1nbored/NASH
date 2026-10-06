import { describe, expect, it } from 'vitest'
import { describeRuntimeCompatBlock, type RuntimeCompatVerdict } from './protocol-compat'
import {
  AUTOMATION_LIST_HOST_SCOPE_UPDATE_REQUIRED_MESSAGE,
  AUTOMATION_OWNER_FENCING_UPDATE_REQUIRED_MESSAGE,
  FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE,
  GITHUB_MARK_PR_READY_UPDATE_REQUIRED_MESSAGE,
  GITLAB_READY_FOR_REVIEW_UPDATE_REQUIRED_MESSAGE,
  JIRA_USER_FIELDS_UPDATE_REQUIRED_MESSAGE
} from './protocol-version'

// Why: these tell the user which app to update, so they name the app the user runs (D-017).
describe('update-required copy names NASH', () => {
  it('says which NASH install is too old for a blocked runtime pairing', () => {
    const clientTooOld: RuntimeCompatVerdict = {
      kind: 'blocked',
      reason: 'client-too-old',
      clientProtocolVersion: 1,
      serverProtocolVersion: 2,
      requiredClientProtocolVersion: 2
    }
    const serverTooOld: RuntimeCompatVerdict = {
      kind: 'blocked',
      reason: 'server-too-old',
      clientProtocolVersion: 2,
      serverProtocolVersion: 1,
      requiredServerProtocolVersion: 2
    }

    expect(describeRuntimeCompatBlock(clientTooOld)).toContain(
      'This NASH client is too old for the selected server. Update NASH on this machine.'
    )
    expect(describeRuntimeCompatBlock(serverTooOld)).toContain(
      'The selected NASH server is too old for this client. Update NASH on the server.'
    )
  })

  it.each([
    JIRA_USER_FIELDS_UPDATE_REQUIRED_MESSAGE,
    FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE,
    GITHUB_MARK_PR_READY_UPDATE_REQUIRED_MESSAGE,
    GITLAB_READY_FOR_REVIEW_UPDATE_REQUIRED_MESSAGE,
    AUTOMATION_LIST_HOST_SCOPE_UPDATE_REQUIRED_MESSAGE,
    AUTOMATION_OWNER_FENCING_UPDATE_REQUIRED_MESSAGE
  ])('asks for a newer NASH server: %s', (message) => {
    expect(message).toMatch(/requires? a newer NASH server/)
    expect(message).not.toMatch(/\bOrca\b/)
  })
})
