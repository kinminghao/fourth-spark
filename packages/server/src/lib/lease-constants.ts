// Cloud worker constants — values MUST match claude-accounts-pool/src/constants.ts
// exactly so both processes agree on timing, sentinel values, and lock behaviour.
// Changing any value here without updating the upstream breaks the wire contract.

/** Worker auth.json refresh slot filler. A worker never holds a real refresh token;
 *  this sentinel occupies the slot so opencode recognises the entry as a credential.
 *  Checked by VALUE, never by mode — local mode never produces it. */
export const SENTINEL_REFRESH = "claude-accounts-pool/cloud-lease/not-a-refresh-token"

/** How often a worker inspects its own lease (no network unless renewal is due). */
export const LEASE_CHECK_INTERVAL_MS = 30_000

/** Renew a lease this long BEFORE its access token expires.
 *  Must always exceed LEASE_CHECK_INTERVAL_MS. */
export const LEASE_RENEW_BUFFER_MS = 5 * 60_000

/** Lease request retry: exponential backoff starting here. */
export const LEASE_BACKOFF_BASE_MS = 5_000

/** Backoff ceiling — stops doubling at 5 minutes. */
export const LEASE_BACKOFF_CAP_MS = 300_000

/** Hard ceiling on any network call to the master. */
export const NETWORK_TIMEOUT_MS = 15_000

/** Cloud protocol routes — frozen so the two sides stay in sync. */
export const CLOUD_ROUTES = Object.freeze({
  lease: "/v1/lease",
  ratelimit: "/v1/ratelimit",
  health: "/v1/health",
  usage: "/v1/usage",
  usageRefresh: "/v1/usage/refresh",
} as const)
