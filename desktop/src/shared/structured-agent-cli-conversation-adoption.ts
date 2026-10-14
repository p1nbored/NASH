/**
 * The agents whose chats can take over a conversation their own CLI recorded: those the host
 * registers a transcript import for, which a registration test keeps equal to this list. Only a
 * conversation recorded on this machine is offered, and this machine's host is this build, so the
 * list cannot disagree with the host that adopts.
 */
export const CLI_CONVERSATION_ADOPTING_AGENTS = ['claude', 'codex', 'grok', 'omp'] as const

export type CliConversationAdoptingAgent = (typeof CLI_CONVERSATION_ADOPTING_AGENTS)[number]

export function adoptsCliConversations(agent: unknown): agent is CliConversationAdoptingAgent {
  return CLI_CONVERSATION_ADOPTING_AGENTS.some((adopting) => adopting === agent)
}
