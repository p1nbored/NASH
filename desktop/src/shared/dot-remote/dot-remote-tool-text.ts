// English titles and descriptions of the dot-facing MCP tools. dot reads these to decide which tool
// to call, so each says what the tool does, what it returns and how to retry it safely.

export const DOT_REMOTE_TOOL_NAMES = [
  'nash_status',
  'nash_list_workspaces',
  'nash_submit_task',
  'nash_get_receipt',
  'nash_get_request',
  'nash_list_requests',
  'nash_cancel_request',
  'nash_list_permission_prompts',
  'nash_answer_permission_prompt',
  'nash_send_message_to_run',
  'nash_list_validation_decisions',
  'nash_decide_validation'
] as const
export type DotRemoteToolName = (typeof DOT_REMOTE_TOOL_NAMES)[number]

export const DOT_REMOTE_TOOL_TEXT = {
  nash_status: {
    title: 'NASH status',
    description:
      "Report whether NASH on the user's PC is paired with this Site and online, when it was last seen, and which app and contract version it runs. NASH counts as online while its last heartbeat is less than 90 seconds old. manifestSha256 names the tool manifest this Site serves."
  },
  nash_list_workspaces: {
    title: 'List NASH workspaces',
    description:
      "List the workspaces the user enabled for dot, as opaque workspaceRef values with the user's display names and maxAccess, the most access a task there may ask for (read_only or workspace_write), as the user set it in NASH. Use a workspaceRef from this list in nash_submit_task. The list never contains paths."
  },
  nash_submit_task: {
    title: 'Submit a task to NASH',
    description:
      "Queue a task for NASH on the user's PC and return its receipt at once. Write the objective in English; put names, paths and quotations that must not be translated inside double quotes or backticks. requestedAccess is read_only (the default) or workspace_write. Ask for workspace_write only when the task must change files and nash_list_workspaces shows maxAccess workspace_write for its workspace; NASH refuses a request above the workspace's maxAccess with dot_access_above_maximum. Choose a new idempotencyKey for each task and reuse it to retry: the same key with the same content returns the same receipt, and the same key with other content is refused. Follow the receipt with nash_get_receipt; once accepted it names the dotRequestId."
  },
  nash_get_receipt: {
    title: 'Get a receipt',
    description:
      'Return the current receipt of an item this Site queued for NASH, by its itemId: queued, claimed, accepted with the dotRequestId NASH assigned, refused with a fixed English reason, expired, or canceled_before_claim.'
  },
  nash_get_request: {
    title: 'Get a request',
    description:
      'Return what NASH last reported about one request, by its dotRequestId: the coarse run status, permission prompts, follow-up message outcomes, validation results and the deliverable summary. Artifacts are opaque ids with size and sha256; file paths and contents are never included.'
  },
  nash_list_requests: {
    title: 'List requests',
    description:
      'List the tasks dot submitted through this Site, newest first, each with its submit receipt and the run status NASH last reported. Pass nextCursor back as cursor to read the next page.'
  },
  nash_cancel_request: {
    title: 'Cancel a request',
    description:
      'Cancel a task by the itemId of its submit receipt. A task NASH has not taken yet is canceled here at once and never reaches NASH. A task NASH has taken gets a cancel item that NASH applies once it has accepted the task; follow it with nash_get_receipt. A refused or expired task has nothing to cancel.'
  },
  nash_list_permission_prompts: {
    title: 'List permission prompts',
    description:
      'List the permission prompts NASH reported as open, optionally for one dotRequestId. Each shows the tool name and a short summary with secrets masked, never file contents. dotMayAllow false means dot may only deny that prompt.'
  },
  nash_answer_permission_prompt: {
    title: 'Answer a permission prompt',
    description:
      'Answer an open permission prompt with allow or deny and return the receipt. The first answer wins on NASH. allow is refused when the prompt shows dotMayAllow false; deny is always possible. A prompt not answered before its deadline waits for the user in the app.'
  },
  nash_send_message_to_run: {
    title: 'Send a message to a run',
    description:
      'Send a follow-up message in English to the run of a request dot started, by dotRequestId, and return the receipt. Reuse the messageId to retry. NASH delivers the message when the session can accept input, queues it while the session is busy, or refuses it; the outcome appears in nash_get_request.'
  },
  nash_list_validation_decisions: {
    title: 'List validation decisions',
    description:
      'List the results of tasks dot started that NASH could not validate and that wait for a waive or reject decision, oldest first, optionally for one dotRequestId. Each shows the task title, a fixed reason code and a short summary with secrets, names and paths masked; summaryWithheld true means the summary was not sent. Pass nextCursor back as cursor to read the next page.'
  },
  nash_decide_validation: {
    title: 'Waive or reject a validation',
    description:
      'Waive or reject a waiting validation decision from nash_list_validation_decisions and return the receipt. waive counts the task as completed; reject fails it. Choose a new decisionId for each decision and reuse it to retry. The first decision wins on NASH, whether it came from dot or from the app; the outcome appears in nash_get_request.'
  }
} as const satisfies Record<DotRemoteToolName, { title: string; description: string }>
