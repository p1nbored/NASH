'use strict'

// Why lazy: non-Windows installs never build the addon, so requiring it at module load would
// break any import of this package on macOS/Linux — including test collection.
let addon = null
function getAddon() {
  if (!addon) {
    addon = require('./build/Release/orca_windows_credentials.node')
  }
  return addon
}

/** CRED_PERSIST_* values accepted by writeGenericCredential. */
const CRED_PERSIST = Object.freeze({ SESSION: 1, LOCAL_MACHINE: 2, ENTERPRISE: 3 })

function readGenericCredential(target) {
  return getAddon().readGenericCredential(target)
}

function writeGenericCredential(target, userName, blob, persist) {
  return getAddon().writeGenericCredential(target, userName, blob, persist)
}

// Why it exists: the real-store test must remove its disposable item without cmdkey or PowerShell.
// The addon refuses every target outside `nash-test:`.
function deleteTestCredential(target) {
  return getAddon().deleteTestCredential(target)
}

module.exports = {
  CRED_PERSIST,
  deleteTestCredential,
  readGenericCredential,
  writeGenericCredential
}
