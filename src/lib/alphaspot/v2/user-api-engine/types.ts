// CHAPTER 5.21 — User API & Access Management Engine Types
//
// The UAAME is the exclusive gateway between external clients and all authorized
// AlphaSpot platform services (§1). Authenticates, authorizes, rate-limits,
// audits every external request.
//
// 21 architectural rules enforced (see §17).
// 14-stage pipeline (§5 — no skips).

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Types  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type AuthMethod =
  | 'USERNAME' | 'EMAIL' | 'OAUTH2' | 'OIDC' | 'JWT' | 'API_KEY'
  | 'SESSION' | 'MFA' | 'PASSKEY' | 'SSO' | 'DEVICE'

export type AuthStatus = 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'EXPIRED' | 'REVOKED' | 'INVALID'

// ─────────────────────────────────────────────────────────────────────────────
// Authorization Types  (§8, Rule 9)
// ─────────────────────────────────────────────────────────────────────────────

export type AuthzStatus = 'AUTHORIZED' | 'DENIED' | 'CONDITIONAL' | 'EMERGENCY_ACCESS'
export type PermissionLevel = 'READ' | 'WRITE' | 'ADMIN' | 'SERVICE_ACCOUNT'

// ─────────────────────────────────────────────────────────────────────────────
// API Types  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type APIProtocol = 'REST' | 'GRPC' | 'WEBSOCKET' | 'STREAMING' | 'WEBHOOK' | 'SSE'

// ─────────────────────────────────────────────────────────────────────────────
// API Key  (§10, Rule 8 — never plaintext)
// ─────────────────────────────────────────────────────────────────────────────

export interface APIKey {
  keyId: string
  /** Rule 8 — Hashed, never plaintext. */
  keyHash: string
  userId: string
  organizationId: string
  scopes: PermissionLevel[]
  /** §10 — Read-only, read/write, webhook, service account. */
  keyType: 'READ_ONLY' | 'READ_WRITE' | 'WEBHOOK' | 'SERVICE_ACCOUNT'
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
  rotatedFrom: string | null
  /** Rule 8 — Never stored/transmitted in plaintext. */
  isPlaintextStored: false
}

// ─────────────────────────────────────────────────────────────────────────────
// User + Organization + Tenant  (§8, Rule 19)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  userId: string
  email: string
  organizationId: string
  tenantId: string // Rule 19 — Multi-tenant isolation
  roles: string[]
  permissions: string[]
  mfaEnabled: boolean
  active: boolean
}

export interface Organization {
  organizationId: string
  name: string
  tenantId: string // Rule 19 — Tenant isolation
  subscriptionTier: string
  subscriptionStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'TRIAL'
  rateLimitPerMinute: number
  rateLimitPerDay: number
  quotaRemaining: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription + Rate Limit  (§8, §5, Rule 11/14)
// ─────────────────────────────────────────────────────────────────────────────

export interface SubscriptionStatus {
  valid: boolean
  tier: string
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'TRIAL'
  quotaRemaining: number
  rateLimitPerMinute: number
  rateLimitPerDay: number
  features: string[]
  expiresAt: number | null
}

export interface RateLimitResult {
  allowed: boolean
  remainingMinute: number
  remainingDay: number
  resetAtMs: number
  /** Rule 14 — Logically independent from authorization. */
  independentFromAuthz: true
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Lineage + Version + Governance  (§6, §11, §12)
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessLineage {
  userId: string
  organizationId: string
  tenantId: string
  apiVersion: string
  authMethod: AuthMethod
  policyVersion: string
  subscriptionVersion: string
  governanceVersion: string
}

export interface AccessVersionBundle {
  apiVersion: string
  authVersion: string
  authzVersion: string
  policyVersion: string
  subscriptionVersion: string
  governanceVersion: string
}

export interface AccessGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<{ action: string; at: number; actor: string; note: string; outcome: string }>
  auditHistory: Array<{ action: string; at: number; actor: string; note: string; before?: unknown; after?: unknown }>
  creationTimestamp: number
  evaluationTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Access Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalAccessContract {
  accessEventId: string // Rule 3
  requestIdentifier: string
  apiVersion: string
  userId: string
  organizationId: string
  apiKeyId: string | null
  accessTimestamp: number

  // §6 — Canonical Access Contract fields
  authStatus: AuthStatus
  authzStatus: AuthzStatus
  authMethod: AuthMethod
  grantedPermissions: string[]
  subscriptionStatus: SubscriptionStatus
  rateLimitResult: RateLimitResult
  apiProtocol: APIProtocol
  endpoint: string
  /** Rule 21 — Outbound payload signed. */
  outboundSignature: string | null
  /** Rule 17 — Whether request was forwarded (auth failures never forwarded). */
  forwarded: boolean

  // Metadata + Governance
  accessMetadata: {
    accessEventId: string
    versions: AccessVersionBundle
    lineage: AccessLineage
    tenantId: string // Rule 19
  }
  governanceMetadata: AccessGovernanceMetadata

  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>
  createdAt: number // Rule 5 — immutable
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface UAAMEConfiguration {
  /** Rule 8 — Never store plaintext keys. */
  storePlaintextKeys: false
  /** Rule 9 — Least privilege enforced. */
  enforceLeastPrivilege: boolean
  /** Rule 14 — Rate limiting independent from authorization. */
  rateLimitIndependent: boolean
  /** Rule 17 — Auth failures never expose services. */
  failClosedOnAuthFailure: boolean
  /** Rule 18 — Transport encryption required. */
  requireTransportEncryption: boolean
  /** Rule 19 — Multi-tenant isolation enforced. */
  enforceTenantIsolation: boolean
  /** Rule 21 — Webhook signing required. */
  requireWebhookSigning: boolean
  /** Default rate limits. */
  defaultRateLimitPerMinute: number
  defaultRateLimitPerDay: number
  versions: AccessVersionBundle
}

export const DEFAULT_UAAME_CONFIG: Omit<UAAMEConfiguration, 'versions'> = {
  storePlaintextKeys: false,
  enforceLeastPrivilege: true,
  rateLimitIndependent: true,
  failClosedOnAuthFailure: true,
  requireTransportEncryption: true,
  enforceTenantIsolation: true,
  requireWebhookSigning: true,
  defaultRateLimitPerMinute: 100,
  defaultRateLimitPerDay: 10000,
}

// Pipeline Stages (§5 — 14 stages)
export const ACCESS_STAGES = [
  'REQUEST_RECEPTION', 'AUTHENTICATION', 'CREDENTIAL_VALIDATION',
  'SUBSCRIPTION_VALIDATION', 'AUTHORIZATION_EVALUATION', 'RATE_LIMIT_EVALUATION',
  'PERMISSION_RESOLUTION', 'API_VERSION_RESOLUTION', 'REQUEST_SIGNING_VALIDATION',
  'ACCESS_DECISION', 'AUDIT_RECORDING', 'OUTBOUND_PAYLOAD_SIGNING',
  'REQUEST_FORWARDING', 'ACCESS_COMPLETION',
] as const

export const UAAME_VERSION = '1.0.0'
export const ACCESS_SCHEMA_VERSION = '1.0.0'
