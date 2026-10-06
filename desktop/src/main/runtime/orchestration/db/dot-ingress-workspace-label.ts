import {
  DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE,
  hasInvisibleLabelCharacter
} from '../../../../shared/dot-ingress/dot-ingress-request'
import { dotInputRefusal } from './dot-ingress-store-input'

/** Refuses a label dot would read but the user cannot see, saying why; the schema refusal names only the field. */
export function refuseInvisibleWorkspaceLabel(label: string): void {
  if (hasInvisibleLabelCharacter(label)) {
    throw dotInputRefusal(
      DOT_WORKSPACE_LABEL_INVISIBLE_MESSAGE,
      ['label'],
      'label_invisible_characters'
    )
  }
}
