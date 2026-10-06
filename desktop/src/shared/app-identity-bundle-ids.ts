import { APP_IDENTITY } from './app-identity-constants'

// macOS bundle ids derived from the app id (decision D-017), so TCC rows, preferences domains and
// notification settings that NASH touches are never a real Orca install's.

/** The computer-use helper app's bundle id; build-computer-macos.mjs stamps the same value into its Info.plist. */
export const APP_COMPUTER_USE_BUNDLE_ID = `${APP_IDENTITY.appId}.computer-use`

// Why the helper and the dev and local channels too: terminals run from the detached helper, which
// TCC can hold responsible independently, and dev and local builds carry their own bundle ids.
const TCC_RESPONSIBLE_BUNDLE_ID_SUFFIXES = ['', '.helper', '.dev', '.dev.helper', '.local', '.local.helper']

/** Bundle ids macOS may name as responsible for a TCC dialog raised on this app's behalf. */
export const APP_TCC_RESPONSIBLE_BUNDLE_IDS: readonly string[] =
  TCC_RESPONSIBLE_BUNDLE_ID_SUFFIXES.map((suffix) => `${APP_IDENTITY.appId}${suffix}`)
