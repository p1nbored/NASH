import type {
  ClefCredentialSaveInput,
  ClefCredentialStatus,
  ClefCredentialsMutationResult
} from '../../shared/clef/clef-credential-contract'

export type ClefCredentialsApi = {
  /** Presence and protection only; never values. */
  status: () => Promise<ClefCredentialStatus>
  /** The only call that carries the token, renderer to main; the result never echoes it. */
  save: (input: ClefCredentialSaveInput) => Promise<ClefCredentialsMutationResult>
  clear: () => Promise<ClefCredentialsMutationResult>
}
