export type PingRequest = {
  id: string
  type: 'ping'
}

export type SystemResolverHealthRequest = {
  id: string
  type: 'systemResolverHealth'
}

export type PtySpawnHealthRequest = {
  id: string
  type: 'ptySpawnHealth'
}

export type FullDiskAccessStatusRequest = {
  id: string
  type: 'fullDiskAccessStatus'
}
