/** Sealing was required but the OS keyring cannot seal; nothing was written, and the message carries no value. */
export class ApiKeySealingUnavailableError extends Error {}
