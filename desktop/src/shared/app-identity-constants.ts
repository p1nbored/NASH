// Single source of the NASH application identity (decision D-017): a name, data folders, lock,
// daemon host and global CLI command that can never collide with a real Orca install.
// Why a JSON twin: electron-builder and the dev scripts are plain Node (CJS/ESM) and cannot import
// this module, so they read app-identity-constants.json; a test keeps the two equal.
export const APP_IDENTITY = {
  // Reverse-DNS app id: Windows AUMID, macOS bundle id, electron-builder appId. A default the user can change here.
  appId: 'com.pinbored.nash',
  productName: 'NASH',
  devProductName: 'NASH Dev',
  // Why a fixed folder name instead of Electron's name derivation: the CLI resolves the same folder to find the runtime metadata.
  userDataDirName: 'nash',
  devUserDataDirName: 'nash-dev',
  windowsExecutableBaseName: 'NASH',
  // Folder under %LOCALAPPDATA% that holds the relocated terminal daemon host; the NSIS uninstall macro removes it.
  localAppDataRootName: 'NASH',
  cliCommandName: 'nash',
  devCliCommandName: 'nash-dev',
  documentProgIdPrefix: 'NASH',
  // Deep-link scheme the OS routes to this app; the builder registers it and the app answers only it.
  urlScheme: 'nash',
  // null = updates disabled: nothing checks, downloads or publishes until NASH has its own release repository.
  // To enable, set { owner, repo, whatsNew } (see AppUpdateFeed in app-update-feed.ts) here and in the JSON twin.
  updateFeed: null
} as const
