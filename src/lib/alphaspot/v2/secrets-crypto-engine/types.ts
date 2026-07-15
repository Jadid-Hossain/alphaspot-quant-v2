// CHAPTER 5.24 — Secrets & Cryptographic Key Management Engine Types
//
// The SCKME is the exclusive trust authority for managing every cryptographic
// key, secret, credential, certificate, token, and sensitive security artifact
// throughout the AlphaSpot ecosystem (§1).
//
// 20 architectural rules enforced (see §17).
// Dual pipeline: Secret Lifecycle (12 stages) + Cryptographic Signing (8 stages).

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Types  (§5)
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineType = 'SECRET_LIFECYCLE' | 'CRYPTOGRAPHIC_SIGNING'

// ─────────────────────────────────────────────────────────────────────────────
// Secret Categories  (§7)
// ─────────────────────────────────────────────────────────────────────────────

export type SecretCategory =
  | 'EXCHANGE_API_SECRET' | 'BROKER_CREDENTIAL' | 'DATABASE_CREDENTIAL'
  | 'CLOUD_CREDENTIAL' | 'REDIS_CREDENTIAL' | 'KAFKA_CREDENTIAL'
  | 'OBJECT_STORAGE_CREDENTIAL' | 'WEBHOOK_SECRET' | 'OAUTH_CLIENT_SECRET'
  | 'JWT_SIGNING_SECRET' | 'SERVICE_ACCOUNT_CREDENTIAL' | 'INTERNAL_SERVICE_CREDENTIAL'
  | 'ENCRYPTION_KEY' | 'APPLICATION_SECRET' | 'ENVIRONMENT_SECRET'

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic Key Types  (§8)
// ─────────────────────────────────────────────────────────────────────────────

export type KeyAlgorithm =
  | 'RSA' | 'ECC' | 'ED25519' | 'AES' | 'HMAC' | 'RSA_PSS' | 'ECDSA'
  | 'KYBER' | 'DILITHIUM' // Post-Quantum Cryptography (§8)
  | 'HYBRID_CLASSICAL_PQ'

export type KeyRole = 'KEK' | 'DEK' | 'ROOT_KEY' | 'MASTER_KEY' | 'SIGNING_KEY' | 'ENCRYPTION_KEY'

export type KeyVersionStatus = 'ACTIVE' | 'ROTATED' | 'REVOKED' | 'EXPIRED' | 'COMPROMISED' | 'ARCHIVED'

// ─────────────────────────────────────────────────────────────────────────────
// Certificate Types  (§9)
// ─────────────────────────────────────────────────────────────────────────────

export type CertificateType = 'TLS' | 'MTLS' | 'INTERNAL_PKI' | 'CA' | 'INTERMEDIATE_CA'

// ─────────────────────────────────────────────────────────────────────────────
// Statuses  (§4, §6, Rule 5/12/19)
// ─────────────────────────────────────────────────────────────────────────────

export type RotationStatus = 'NOT_REQUIRED' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
export type RevocationStatus = 'NOT_REVOKED' | 'REVOKED' | 'SUSPENDED'
export type IntegrityStatus = 'PENDING' | 'VERIFIED' | 'FAILED'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL' | 'SUPERSEDED'
export type ValidationStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
export type PublicationStatus = 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'QUARANTINED' | 'RECALLED'

// ─────────────────────────────────────────────────────────────────────────────
// Environment + External Provider Pluggability  (Rule 17)
// ─────────────────────────────────────────────────────────────────────────────

export type EnvironmentType = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'SANDBOX' | 'DISASTER_RECOVERY'

export type ExternalProviderType = 'HSM' | 'KMS' | 'VAULT' | 'INTERNAL'

export interface ExternalProvider {
  providerId: string
  type: ExternalProviderType
  /** Rule 17 — HSMs, KMS, Vault remain independently pluggable. */
  pluggable: true
  /** Whether this provider supports hardware-backed key attestation. */
  hardwareBackedAttestation: boolean
  /** Whether this provider supports remote attestation. */
  remoteAttestation: boolean
  /** Whether this provider supports post-quantum cryptography. */
  postQuantumSupported: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic Key Material  (Rule 8, Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface CryptographicKey {
  keyId: string
  keyVersion: string
  algorithm: KeyAlgorithm
  role: KeyRole
  /** Rule 8 — Encrypted key material (never plaintext outside secure env). */
  encryptedKeyMaterial: string
  /** Rule 7 — Plaintext never stored, logged, or cached outside secure env. */
  plaintextExposed: false
  /** Rule 12 — Key version status (rotation creates new version, not in-place mutation). */
  status: KeyVersionStatus
  keySizeBits: number
  createdAt: number
  rotatedAt: number | null
  revokedAt: number | null
  expiresAt: number | null
  /** External provider backing this key (HSM/KMS/Vault). */
  providerId: string
  /** Hardware-backed key attestation present. */
  hardwareAttestation: boolean
}

export interface EnvelopeEncryptionRecord {
  /** DEK wrapped by KEK via envelope encryption (§8). */
  dekId: string
  kekId: string
  /** Wrapped (encrypted) DEK. */
  wrappedDek: string
  /** IV/nonce used for DEK wrapping. */
  iv: string
  /** Authenticated encryption tag. */
  tag: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate  (§9, Rule 14)
// ─────────────────────────────────────────────────────────────────────────────

export interface Certificate {
  certificateId: string
  certificateVersion: string
  type: CertificateType
  subject: string
  issuer: string
  serialNumber: string
  /** Encoded certificate (PEM/DER, never includes private key). */
  encodedCertificate: string
  /** Rule 14 — Certificate expiration monitoring. */
  notBefore: number
  notAfter: number
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'RENEWED'
  rotationMonitored: boolean
  chainValidated: boolean
  transparencyLogged: boolean
  keyId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Lease  (§10, Rule 11)
// ─────────────────────────────────────────────────────────────────────────────

export type LeaseStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'RENEWED'

export interface SecretLease {
  leaseId: string
  secretId: string
  secretVersion: string
  /** Authenticated principal that holds this lease. */
  principalId: string
  /** Rule 10 — Authorized, policy-compliant access required. */
  accessPolicyId: string
  issuedAt: number
  /** Rule 11 — Lease expires automatically unless renewed. */
  expiresAt: number
  renewedAt: number | null
  revokedAt: number | null
  status: LeaseStatus
  /** Rule 11 — Lease renewed through approved governance policies. */
  renewalGovernanceApproved: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Encrypted Secret Reference  (Rule 7/8/9)
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptedSecretReference {
  /** Rule 9 — Only encrypted references stored by other engines. */
  referenceId: string
  secretId: string
  secretVersion: string
  /** Rule 8 — Encrypted ciphertext (never plaintext). */
  ciphertext: string
  /** IV/nonce for the encryption. */
  iv: string
  /** Authenticated encryption tag. */
  tag: string
  /** DEK used to encrypt this secret (itself wrapped by KEK via envelope encryption). */
  dekId: string
  kekId: string
  /** Rule 7 — Plaintext never logged/cached/exported outside secure env. */
  plaintextStored: false
  plaintextLogged: false
  plaintextCached: false
  plaintextExported: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Expiration Metadata  (§4)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretExpirationMetadata {
  createdAt: number
  expiresAt: number | null
  rotationDueAt: number | null
  lastRotatedAt: number | null
  lastRevokedAt: number | null
  /** Time-to-live for dynamic secrets (§10). */
  ttlSeconds: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Metadata  (Rule 10)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretAccessMetadata {
  /** Rule 10 — Authenticated principal. */
  principalId: string
  /** Rule 10 — Policy-compliant access. */
  policyId: string
  accessDecision: 'ALLOWED' | 'DENIED'
  accessReason: string
  accessedAt: number
  /** Whether access was within an approved secure execution environment. */
  secureExecutionEnvironment: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Lineage  (Rule 6, Rule 16)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretLineage {
  /** Rule 6 — Complete lineage linking secret versions, cryptographic keys,
   *  certificates, governance policies, environments, and audit metadata. */
  secretVersionIds: string[]
  keyVersionIds: string[]
  certificateVersionIds: string[]
  policyVersionIds: string[]
  environmentVersionIds: string[]
  auditEventIds: string[]
  /** Rule 16 — Rotation never invalidates historical audit lineage. */
  historicalAuditLineageInvalidated: false
  /** Upstream provider chain (HSM/KMS/Vault). */
  providerChain: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Version Bundle  (§11, Rule 5/12/13)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretVersionBundle {
  secretVersion: string
  keyVersion: string
  certificateVersion: string
  policyVersion: string
  environmentVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Governance Metadata  (§12)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretGovernanceMetadata {
  approvalStatus: ApprovalStatus
  validationStatus: ValidationStatus
  reviewHistory: Array<{
    action: string
    at: number
    actor: string
    note: string
    outcome: string
  }>
  auditHistory: Array<{
    action: string
    at: number
    actor: string
    note: string
    before?: unknown
    after?: unknown
  }>
  creationTimestamp: number
  expirationTimestamp: number | null
  rotationTimestamp: number | null
  revocationTimestamp: number | null
  governanceNotes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Metadata  (§4, Rule 13)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretAuditMetadata {
  auditEventId: string
  action: string
  actor: string
  timestamp: number
  /** Rule 13 — Deterministic audit replay supported. */
  replayable: boolean
  /** Integrity hash for audit tamper detection. */
  auditHash: string
  /** Whether plaintext was exposed in the audit record (always false per Rule 7). */
  plaintextInAudit: false
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Secret Contract  (§4, §6, Rule 4)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalSecretContract {
  /** Rule 3 — Unique secret event ID. */
  secretEventId: string
  /** §6 — Secret identifier. */
  secretIdentifier: string
  /** §6 — Secret version. */
  secretVersion: string
  /** §6 — Secret category. */
  secretCategory: SecretCategory
  /** §6 — Secret expiration metadata. */
  expirationMetadata: SecretExpirationMetadata
  /** §6 — Encrypted secret reference. */
  encryptedReference: EncryptedSecretReference
  /** §6 — Cryptographic key identifier. */
  cryptographicKeyId: string
  /** §6 — Certificate identifier. */
  certificateId: string | null
  /** §6 — Secret lease identifier. */
  secretLeaseId: string | null
  /** §6 — Integrity verification status. */
  integrityVerificationStatus: IntegrityStatus
  /** §6 — Rotation status. */
  rotationStatus: RotationStatus
  /** §6 — Revocation status. */
  revocationStatus: RevocationStatus
  /** §6 — Access metadata. */
  accessMetadata: SecretAccessMetadata
  /** §6 — Governance metadata. */
  governanceMetadata: SecretGovernanceMetadata
  /** §6 — Audit metadata. */
  auditMetadata: SecretAuditMetadata
  /** §5 — Pipeline type. */
  pipelineType: PipelineType
  /** §5 — Pipeline stages executed. */
  pipelineStages: Array<{
    stage: string
    startedAt: number
    completedAt: number
    durationMs: number
    success: boolean
  }>
  /** Rule 6 — Complete lineage. */
  lineage: SecretLineage
  /** Rule 5 — Immutable creation timestamp. */
  createdAt: number
  /** Rule 5 — Immutable content hash for replay verification. */
  contentHash: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Cryptographic Signing Contract  (§5B)
// ─────────────────────────────────────────────────────────────────────────────

export interface CryptographicSigningResult {
  signingEventId: string
  secretId: string
  keyId: string
  keyVersion: string
  algorithm: KeyAlgorithm
  /** Unsigned payload hash (for verification). */
  payloadHash: string
  /** Generated cryptographic signature. */
  signature: string
  /** Signature verification result. */
  signatureVerified: boolean
  /** Rule 7 — Key resolved in protected in-memory environment. */
  keyResolvedInMemory: boolean
  /** Rule 7 — Plaintext key never persisted. */
  plaintextKeyPersisted: false
  signedAt: number
  principalId: string
  policyId: string
  auditEventId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret Registration Request  (§3, Rule 1)
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretRegistrationRequest {
  secretIdentifier: string
  category: SecretCategory
  /** Plaintext secret value — encrypted immediately and never persisted/logged. */
  plaintextValue: string
  /** Environment for this secret. */
  environment: EnvironmentType
  /** TTL in seconds (null = no expiry). */
  ttlSeconds: number | null
  /** Required key algorithm for encryption. */
  keyAlgorithm: KeyAlgorithm
  /** Requesting principal. */
  principalId: string
  /** Governance policy ID. */
  policyId: string
  /** External provider ID (HSM/KMS/Vault) — null = internal. */
  providerId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration  (§3)
// ─────────────────────────────────────────────────────────────────────────────

export interface SCKMEConfiguration {
  /** Rule 7 — Never expose plaintext outside secure execution environments. */
  enforceSecureExecutionEnvironment: boolean
  /** Rule 8 — Institutionally approved algorithms only. */
  approvedAlgorithms: KeyAlgorithm[]
  /** Rule 11 — Lease auto-expiry. */
  defaultLeaseTtlSeconds: number
  /** Rule 12 — Rotation creates new immutable versions. */
  enforceImmutableRotation: boolean
  /** Rule 13 — Deterministic audit replay. */
  enableAuditReplay: boolean
  /** Rule 14 — Continuous certificate expiration monitoring. */
  enableCertExpirationMonitoring: boolean
  /** Rule 17 — Pluggable external providers (HSM/KMS/Vault). */
  externalProviders: ExternalProvider[]
  /** Rule 1 — Fail-closed: invalid registration never partially stored. */
  failClosed: boolean
  /** §8 — Default key sizes per algorithm. */
  defaultKeySizes: Partial<Record<KeyAlgorithm, number>>
  /** Versions for default secrets. */
  versions: SecretVersionBundle
}

export const DEFAULT_SCKME_CONFIG: Omit<SCKMEConfiguration, 'versions'> = {
  enforceSecureExecutionEnvironment: true,
  approvedAlgorithms: ['RSA', 'ECC', 'ED25519', 'AES', 'HMAC', 'RSA_PSS', 'ECDSA', 'KYBER', 'DILITHIUM', 'HYBRID_CLASSICAL_PQ'],
  defaultLeaseTtlSeconds: 3600,
  enforceImmutableRotation: true,
  enableAuditReplay: true,
  enableCertExpirationMonitoring: true,
  externalProviders: [
    {
      providerId: 'internal-provider',
      type: 'INTERNAL',
      pluggable: true,
      hardwareBackedAttestation: false,
      remoteAttestation: false,
      postQuantumSupported: false,
    },
  ],
  failClosed: true,
  defaultKeySizes: { RSA: 4096, ECC: 521, ED25519: 256, AES: 256, HMAC: 256 },
}

// Pipeline Stages (§5A, §5B)
export const SECRET_LIFECYCLE_STAGES = [
  'SECRET_REGISTRATION',
  'METADATA_VALIDATION',
  'POLICY_VALIDATION',
  'ENCRYPTION',
  'INTEGRITY_VERIFICATION',
  'VERSION_ASSIGNMENT',
  'IMMUTABLE_SECRET_STORAGE',
  'LEASE_GENERATION',
  'ACCESS_PUBLICATION',
  'AUDIT_RECORDING',
  'GOVERNANCE_RECORDING',
  'SECRET_COMPLETION',
] as const

export const CRYPTOGRAPHIC_SIGNING_STAGES = [
  'UNSIGNED_PAYLOAD_RECEPTION',
  'AUTHENTICATION_POLICY_VALIDATION',
  'SECRET_ACCESS_AUTHORIZATION',
  'PROTECTED_IN_MEMORY_KEY_RESOLUTION',
  'CRYPTOGRAPHIC_SIGNING',
  'SIGNATURE_VERIFICATION',
  'AUDIT_RECORDING',
  'SIGNED_PAYLOAD_RETURN',
] as const

export const SCKME_VERSION = '1.0.0'
export const SECRETS_CRYPTO_SCHEMA_VERSION = '1.0.0'
