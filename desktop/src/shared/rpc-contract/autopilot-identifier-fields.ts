import { z } from 'zod'

// The id and tool name rules of the autopilot store and of every wire contract that carries them,
// defined once so the two cannot drift apart.

/** Ids from Orca, the app or the CLI: opaque, bounded, and never holding spaces or path characters. */
export const AutopilotIdSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
export const AutopilotToolNameSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/)
