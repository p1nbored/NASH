// Sole entry for the remote layout snapshot; enforced by config/scripts/check-compat-boundary-imports.mjs.
export { RemoteLayoutSnapshotPersistence } from './remote-layout-snapshot-persistence'
export {
  forgetRemoteLayoutSnapshot,
  recordRemoteLayoutFrame,
  type RemoteLayoutSnapshotStore
} from './remote-layout-snapshot-recorder'
