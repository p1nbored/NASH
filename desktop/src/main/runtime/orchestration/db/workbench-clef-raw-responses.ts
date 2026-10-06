import { createHash } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import {
  WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES,
  WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES
} from './workbench-route-schema-definition'
import { ClefRecordIdSchema } from '../../../../shared/clef/clef-route-contract'
import { WorkbenchRequestIdSchema } from '../../../../shared/workbench-request'

const RecordIdSchema = ClefRecordIdSchema

function bytesAtMost(limit: number) {
  return z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= limit, { message: `Body exceeds ${limit} bytes` })
}

export const WorkbenchRawResponseInputSchema = z
  .object({
    rawResponseId: RecordIdSchema,
    requestId: WorkbenchRequestIdSchema.nullable(),
    spendReservationId: RecordIdSchema.nullable(),
    httpStatus: z.number().int().min(100).max(599),
    requestBody: bytesAtMost(WORKBENCH_CLEF_REQUEST_BODY_MAX_BYTES),
    responseBody: bytesAtMost(WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES)
  })
  .strict()
export type WorkbenchRawResponseInput = z.infer<typeof WorkbenchRawResponseInputSchema>
export type WorkbenchRawResponseReceipt = {
  rawResponseId: string
  requestBodySha256: string
  responseBodySha256: string
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Stores exchange bytes before parsing; size limits apply before hashing. Sensitive at rest. */
export function insertWorkbenchClefRawResponse(
  db: Database.Database,
  input: WorkbenchRawResponseInput,
  receivedAt: string
): WorkbenchRawResponseReceipt {
  const raw = WorkbenchRawResponseInputSchema.parse(input)
  const receipt = {
    rawResponseId: raw.rawResponseId,
    requestBodySha256: sha256(raw.requestBody),
    responseBodySha256: sha256(raw.responseBody)
  }
  db.prepare(`INSERT INTO workbench_clef_raw_responses (raw_response_id, request_id, spend_reservation_id,
    http_status, request_body, request_body_sha256, response_body, response_body_sha256, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    raw.rawResponseId,
    raw.requestId,
    raw.spendReservationId,
    raw.httpStatus,
    raw.requestBody,
    receipt.requestBodySha256,
    raw.responseBody,
    receipt.responseBodySha256,
    receivedAt
  )
  return receipt
}
