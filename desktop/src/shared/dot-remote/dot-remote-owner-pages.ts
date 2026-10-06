// Kept free of imports so the renderer can read it without the contract's node:crypto modules.

/** Site pages the signed-in owner opens in a browser; NASH only shows their address. */
export const DOT_REMOTE_OWNER_PAGES = { pairingApproval: '/pairing' } as const
