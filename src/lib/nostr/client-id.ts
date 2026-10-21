/**
 * NIP-89 `client` tag value for every event this app publishes.
 *
 * Keep this stable: relays and analytics use it to attribute events to the
 * producing client. Changing it splits history across two identifiers.
 */
export const BNOS_CLIENT_ID = 'bnos';
