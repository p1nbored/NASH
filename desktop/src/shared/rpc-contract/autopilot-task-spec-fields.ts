import { z } from 'zod'

/**
 * The one definition of TaskSpec text and machine-check fields, used by the wire contract and the
 * app's store alike so the two can never accept different TaskSpecs (TypeScript review M6).
 */

/** At most this many fields per machine check, `kind` included. */
export const TASK_SPEC_MACHINE_CHECK_MAX_FIELDS = 7
const MACHINE_CHECK_NAME = /^[a-z][a-z0-9_]{0,63}$/
const CONTROL_CHARACTER = /\p{Cc}/u
const LINE_ENDING = /\r\n?/g
const LINE_BREAK = /[\r\n]/

const TITLE_MESSAGE = 'A TaskSpec title is one line.'
const CHECK_MESSAGE = `A machine check has at most ${TASK_SPEC_MACHINE_CHECK_MAX_FIELDS} fields, kind included, with lower-case names.`

/** CRLF and a lone CR become LF, so a TaskSpec written on Windows is not refused for its line endings. */
export function normalizeTaskSpecLineEndings(text: string): string {
  return text.replace(LINE_ENDING, '\n')
}

/** True for text with no control character except tab and line feed; NASH's own notices use it. */
export function hasNoControlCharacters(text: string): boolean {
  return !CONTROL_CHARACTER.test(text.replaceAll('\n', '').replaceAll('\t', ''))
}

/** Line endings normalized; any other character is kept (D-027 restriction 6). */
export const TaskSpecTextSchema = z.string().overwrite(normalizeTaskSpecLineEndings).min(1)
export const TaskSpecTextListSchema = z.array(TaskSpecTextSchema)

/** A title is a single line; other control characters are kept (D-027 restriction 6). */
export const TaskSpecTitleSchema = z
  .string()
  .min(1)
  .refine((title) => !LINE_BREAK.test(title), { message: TITLE_MESSAGE })

const MachineCheckParameterSchema = z.union([TaskSpecTextSchema, z.number().finite(), z.boolean()])

// Why loose values: the check kinds and their parameters belong to the validators, which refuse
// an unusable check at proposal; this keeps one flat, bounded shape for every kind.
export const TaskSpecMachineCheckSchema = z
  .object({ kind: z.string().regex(MACHINE_CHECK_NAME) })
  .catchall(MachineCheckParameterSchema)
  .refine(
    (check) =>
      Object.keys(check).length <= TASK_SPEC_MACHINE_CHECK_MAX_FIELDS &&
      Object.keys(check).every((name) => MACHINE_CHECK_NAME.test(name)),
    { message: CHECK_MESSAGE }
  )
export type TaskSpecMachineCheck = z.infer<typeof TaskSpecMachineCheckSchema>
export const TaskSpecMachineCheckListSchema = z.array(TaskSpecMachineCheckSchema)
