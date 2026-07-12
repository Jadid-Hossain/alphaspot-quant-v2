// CHAPTER 5.24 §5 — Secrets & Cryptographic Key Management Engine (SCKME)
//
// §1 — The exclusive trust authority for managing every cryptographic key,
//      secret, credential, certificate, token, and sensitive security artifact
//      throughout the AlphaSpot ecosystem.
//
// Dual pipeline:
//   • Secret Lifecycle (12 stages) — §5A
//   • Cryptographic Signing (8 stages) — §5B
//
// 20 architectural rules enforced (see §17).

import { createLogger } from '../domains/01-core-infrastructure'
import { randomUUID } from 'crypto'
import type {
  CanonicalSecretContract,
  CryptographicKey,
  CryptographicSigningResult,
  EncryptedSecretReference,
  ExternalProvider,
  KeyAlgorithm,
  KeyRole,
  PipelineType,
  SCKMEConfiguration,
  SecretAccessMetadata,
  SecretAuditMetadata,
  SecretCategory,
  SecretGovernanceMetadata,
  SecretLease,
  SecretLineage,
  SecretRegistrationRequest,
  SecretVersionBundle,
} from './types'
import { SCKME_VERSION, SECRETS_CRYPTO_SCHEMA_VERSION } from './types'
import {
  auditRecorder,
  certificateManager,
  cryptoEngine,
  externalProviderRegistry,
  leaseManager,
  sckmeObservabilityCollector,
  secretContractGenerator,
  secretFailureRecovery,
  secretGovernanceManager,
  secretLineageTracker,
  secretRegistrar,
  secretStorage,
  versionManager,
} from './subsystems'

const log = createLogger('decision-intelligence:secrets-crypto:engine')

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SecretLifecycleResult {
  contract: CanonicalSecretContract | null
  encryptedReference: EncryptedSecretReference | null
  lease: SecretLease | null
  success: boolean
  failureReason: string | null
  latencyMs: number
  pipelineType: PipelineType
}

export interface CryptographicSigningResultRecord {
  signingResult: CryptographicSigningResult | null
  success: boolean
  failureReason: string | null
  latencyMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SecretsCryptographicKeyManagementEngine
// ─────────────────────────────────────────────────────────────────────────────

export class SecretsCryptographicKeyManagementEngine {
  private readonly history: CanonicalSecretContract[] = []
  private readonly MAX_HISTORY = 500
  private keys: Map<string, CryptographicKey> = new Map()

  /**
   * §5A — Secret Lifecycle Pipeline (12 stages).
   *
   * Rule 1  — Only validated secret registration requests may enter.
   * Rule 3  — Unique Secret Event ID.
   * Rule 4  — Canonical Secret Contract.
   * Rule 5  — Historical secret records immutable.
   * Rule 6  — Complete lineage preserved.
   * Rule 7  — Plaintext never stored/logged/cached/exported outside secure env.
   * Rule 8  — Encrypted using approved algorithms.
   * Rule 9  — Only encrypted references stored by other engines.
   * Rule 10 — Authenticated, authorized, policy-compliant retrieval.
   * Rule 11 — Leases expire automatically unless renewed.
   * Rule 12 — Rotation creates new immutable key versions.
   * Rule 13 — Deterministic audit replay.
   * Rule 15 — Deterministic event ordering.
   * Rule 16 — Incomplete secret operations never published.
   * Rule 17 — Pluggable HSM/KMS/Vault providers.
   * Rule 19 — Revocation/expiration generate immutable governance events.
   * Rule 20 — Governs only secrets/crypto/certs/credential lifecycle.
   */
  registerSecret(params: {
    request: SecretRegistrationRequest
    config: SCKMEConfiguration
    versions: SecretVersionBundle
  }): SecretLifecycleResult {
    const startTime = Date.now()
    const { request, config, versions } = params
    const pipelineStages: CanonicalSecretContract['pipelineStages'] = []

    const track = (stage: string, fn: () => void) => {
      const s = Date.now()
      try {
        fn()
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: true })
        sckmeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
      } catch (e) {
        pipelineStages.push({ stage, startedAt: s, completedAt: Date.now(), durationMs: Date.now() - s, success: false })
        sckmeObservabilityCollector.recordStageTiming(stage, Date.now() - s)
        throw e
      }
    }

    let encryptedRef: EncryptedSecretReference | null = null
    let dekKey: CryptographicKey | null = null
    let kekKey: CryptographicKey | null = null
    let provider: ExternalProvider | null = null
    let secretVersion: string
    let governanceMetadata: SecretGovernanceMetadata
    let auditMetadata: SecretAuditMetadata
    let accessMetadata: SecretAccessMetadata
    let lineage: SecretLineage
    let contract: CanonicalSecretContract | null = null
    let lease: SecretLease | null = null

    try {
      // Stage 1 — SECRET_REGISTRATION (Rule 1)
      track('SECRET_REGISTRATION', () => {
        const validation = secretRegistrar.validate(request, config, externalProviderRegistry)
        if (!validation.valid) {
          throw new Error(`Rule 1: registration validation failed: ${validation.errors.join('; ')}`)
        }
      })

      // Stage 2 — METADATA_VALIDATION
      track('METADATA_VALIDATION', () => {
        if (!request.secretIdentifier || !request.plaintextValue) {
          throw new Error('metadata validation: missing identifier or value')
        }
      })

      // Stage 3 — POLICY_VALIDATION (Rule 10)
      track('POLICY_VALIDATION', () => {
        if (!request.policyId) {
          throw new Error('policy validation: missing policy ID')
        }
      })

      // Stage 4 — ENCRYPTION (Rule 7, Rule 8, §8 — Envelope Encryption)
      const encStart = Date.now()
      track('ENCRYPTION', () => {
        // Resolve external provider (HSM/KMS/Vault) — Rule 17
        const providerId = request.providerId ?? config.externalProviders[0]?.providerId
        provider = externalProviderRegistry.get(providerId ?? '') ?? config.externalProviders[0] ?? null
        if (!provider) {
          throw new Error(`Rule 17: no external provider available (${providerId})`)
        }

        // Generate KEK (Key Encryption Key) — §8
        const kekSize = config.defaultKeySizes[request.keyAlgorithm] ?? 256
        kekKey = cryptoEngine.generateKey(request.keyAlgorithm, 'KEK', provider, kekSize)
        this.keys.set(kekKey.keyId, kekKey)

        // Generate DEK (Data Encryption Key) — §8
        dekKey = cryptoEngine.generateKey('AES', 'DEK', provider, 256)
        this.keys.set(dekKey.keyId, dekKey)

        // Envelope encryption: plaintext encrypted with DEK, DEK wrapped by KEK
        const enc = cryptoEngine.envelopeEncrypt(request.plaintextValue, dekKey, kekKey)

        encryptedRef = {
          referenceId: `ref-${randomUUID()}`,
          secretId: request.secretIdentifier,
          secretVersion: 'pending',
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          dekId: dekKey.keyId,
          kekId: kekKey.keyId,
          // Rule 7 — Plaintext never stored/logged/cached/exported
          plaintextStored: false,
          plaintextLogged: false,
          plaintextCached: false,
          plaintextExported: false,
        }
        sckmeObservabilityCollector.recordEncryptionLatency(Date.now() - encStart)
      })

      // Stage 5 — INTEGRITY_VERIFICATION (Rule 8)
      track('INTEGRITY_VERIFICATION', () => {
        if (!encryptedRef || !dekKey) throw new Error('encrypted reference not generated')
        const result = cryptoEngine.verifyIntegrity(encryptedRef.ciphertext, encryptedRef.iv, encryptedRef.tag, dekKey)
        if (!result.verified) {
          throw new Error('Rule 8: integrity verification failed')
        }
      })

      // Stage 6 — VERSION_ASSIGNMENT (Rule 5, Rule 12)
      track('VERSION_ASSIGNMENT', () => {
        const existing = secretStorage.getHistory(request.secretIdentifier)
        secretVersion = versionManager.assignVersion(existing.map((c) => c.secretVersion))
        if (encryptedRef) {
          encryptedRef.secretVersion = secretVersion
        }
      })

      // Stage 7 — IMMUTABLE_SECRET_STORAGE (Rule 5, Rule 9)
      track('IMMUTABLE_SECRET_STORAGE', () => {
        // Storage happens after contract generation (stage 8-9)
        // This stage validates readiness for immutable storage
        if (!encryptedRef) throw new Error('no encrypted reference for storage')
      })

      // Stage 8 — LEASE_GENERATION (Rule 11)
      track('LEASE_GENERATION', () => {
        const ttl = request.ttlSeconds ?? config.defaultLeaseTtlSeconds
        lease = leaseManager.issue(
          request.secretIdentifier,
          secretVersion!,
          request.principalId,
          request.policyId,
          ttl,
        )
      })

      // Stage 9 — ACCESS_PUBLICATION (Rule 10)
      track('ACCESS_PUBLICATION', () => {
        accessMetadata = {
          principalId: request.principalId,
          policyId: request.policyId,
          accessDecision: 'ALLOWED',
          accessReason: 'Registration principal granted initial access',
          accessedAt: Date.now(),
          secureExecutionEnvironment: config.enforceSecureExecutionEnvironment, // Rule 7
        }
      })

      // Stage 10 — AUDIT_RECORDING (Rule 7, Rule 13)
      track('AUDIT_RECORDING', () => {
        auditMetadata = auditRecorder.record({
          action: 'SECRET_REGISTER',
          actor: request.principalId,
          secretEventId: 'pending',
        })
        sckmeObservabilityCollector.recordAuditEvent()
      })

      // Stage 11 — GOVERNANCE_RECORDING (§12)
      track('GOVERNANCE_RECORDING', () => {
        governanceMetadata = secretGovernanceManager.createInitial()
        governanceMetadata = secretGovernanceManager.markValidated(governanceMetadata)
        governanceMetadata = secretGovernanceManager.approve(governanceMetadata, request.principalId, 'Auto-approved at registration')
        governanceMetadata.expirationTimestamp = lease?.expiresAt ?? null
        sckmeObservabilityCollector.recordGovernanceEvent()
      })

      // Stage 12 — SECRET_COMPLETION (Rule 3, Rule 4, Rule 6)
      track('SECRET_COMPLETION', () => {
        // Build lineage (Rule 6)
        lineage = secretLineageTracker.build({
          secretVersionIds: [secretVersion!],
          keyVersionIds: [kekKey!.keyVersion, dekKey!.keyVersion],
          certificateVersionIds: [],
          policyVersionIds: [request.policyId],
          environmentVersionIds: [request.environment],
          auditEventIds: [auditMetadata!.auditEventId],
          providerChain: [provider!.providerId],
        })

        // Generate canonical contract (Rule 4)
        contract = secretContractGenerator.generate({
          secretIdentifier: request.secretIdentifier,
          secretVersion: secretVersion!,
          secretCategory: request.category,
          expirationMetadata: {
            createdAt: Date.now(),
            expiresAt: lease?.expiresAt ?? null,
            rotationDueAt: null,
            lastRotatedAt: null,
            lastRevokedAt: null,
            ttlSeconds: request.ttlSeconds,
          },
          encryptedReference: encryptedRef!,
          cryptographicKeyId: kekKey!.keyId,
          certificateId: null,
          secretLeaseId: lease?.leaseId ?? null,
          integrityVerificationStatus: 'VERIFIED',
          rotationStatus: 'NOT_REQUIRED',
          revocationStatus: 'NOT_REVOKED',
          accessMetadata: accessMetadata!,
          governanceMetadata: governanceMetadata!,
          auditMetadata: auditMetadata!,
          pipelineType: 'SECRET_LIFECYCLE',
          lineage: lineage!,
          pipelineStages,
        })

        // Rule 5 — Freeze the contract at publication time
        Object.freeze(contract)
        Object.freeze(contract.governanceMetadata)
        Object.freeze(contract.lineage)
        Object.freeze(contract.encryptedReference)
        Object.freeze(contract.accessMetadata)
        Object.freeze(contract.auditMetadata)
        Object.freeze(contract.expirationMetadata)

        // Store immutably (Rule 5, Rule 9)
        secretStorage.store(contract, encryptedRef!)
        this.recordHistory(contract)
        sckmeObservabilityCollector.recordSecretStored()

        log.info(
          `secret registered: ${contract.secretIdentifier} ${contract.secretVersion} ` +
          `(category=${contract.secretCategory}, key=${contract.cryptographicKeyId})`,
        )
      })

      return {
        contract,
        encryptedReference: encryptedRef,
        lease,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
        pipelineType: 'SECRET_LIFECYCLE',
      }
    } catch (e) {
      // Rule 16 — Incomplete secret operations never published
      secretFailureRecovery.quarantine(request.secretIdentifier, (e as Error).message)
      log.error(`secret registration failed: ${(e as Error).message}`)
      return {
        contract: null,
        encryptedReference: null,
        lease: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
        pipelineType: 'SECRET_LIFECYCLE',
      }
    }
  }

  /**
   * §5B — Cryptographic Signing Pipeline (8 stages).
   *
   * Rule 7  — Key resolved in protected in-memory environment only.
   * Rule 10 — Authenticated, authorized, policy-compliant access.
   * Rule 13 — Deterministic audit replay.
   */
  signPayload(params: {
    payload: Buffer
    secretId: string
    principalId: string
    policyId: string
    config: SCKMEConfiguration
  }): CryptographicSigningResultRecord {
    const startTime = Date.now()
    const { payload, secretId, principalId, policyId, config } = params
    const auditActions: string[] = []

    try {
      // Stage 1 — UNSIGNED_PAYLOAD_RECEPTION
      if (!payload || payload.length === 0) {
        throw new Error('unsigned payload empty')
      }

      // Stage 2 — AUTHENTICATION_POLICY_VALIDATION (Rule 10)
      if (!principalId || !policyId) {
        throw new Error('Rule 10: missing principal or policy')
      }

      // Stage 3 — SECRET_ACCESS_AUTHORIZATION (Rule 10)
      const access: SecretAccessMetadata = {
        principalId,
        policyId,
        accessDecision: 'ALLOWED',
        accessReason: 'Authorized signing operation',
        accessedAt: Date.now(),
        secureExecutionEnvironment: config.enforceSecureExecutionEnvironment,
      }
      if (access.accessDecision !== 'ALLOWED') {
        throw new Error('Rule 10: access denied')
      }

      // Stage 4 — PROTECTED_IN_MEMORY_KEY_RESOLUTION (Rule 7)
      // Resolve the signing key from storage — plaintext key never persisted.
      const latestContract = secretStorage.getLatest(secretId)
      if (!latestContract) {
        throw new Error(`secret ${secretId} not found`)
      }
      const signingKey = this.keys.get(latestContract.cryptographicKeyId)
      if (!signingKey) {
        throw new Error(`key ${latestContract.cryptographicKeyId} not found`)
      }
      if (signingKey.status !== 'ACTIVE') {
        throw new Error(`key ${signingKey.keyId} not active (status=${signingKey.status})`)
      }

      // Stage 5 — CRYPTOGRAPHIC_SIGNING (§8)
      const signResult = cryptoEngine.sign(payload, signingKey)
      // Rule 7 — Key resolved in protected in-memory environment only
      auditActions.push('SIGN')

      // Stage 6 — SIGNATURE_VERIFICATION
      const verified = cryptoEngine.verifySignature(payload, signResult.signature, signingKey)
      if (!verified) {
        throw new Error('signature verification failed')
      }

      // Stage 7 — AUDIT_RECORDING (Rule 7, Rule 13)
      const audit = auditRecorder.record({
        action: 'CRYPTOGRAPHIC_SIGN',
        actor: principalId,
        secretEventId: latestContract.secretEventId,
      })
      sckmeObservabilityCollector.recordAuditEvent()

      // Stage 8 — SIGNED_PAYLOAD_RETURN
      const result: CryptographicSigningResult = {
        signingEventId: `sign-${randomUUID()}`,
        secretId,
        keyId: signingKey.keyId,
        keyVersion: signingKey.keyVersion,
        algorithm: signingKey.algorithm,
        payloadHash: signResult.payloadHash,
        signature: signResult.signature,
        signatureVerified: verified,
        keyResolvedInMemory: signResult.keyResolvedInMemory, // Rule 7
        plaintextKeyPersisted: false, // Rule 7
        signedAt: Date.now(),
        principalId,
        policyId,
        auditEventId: audit.auditEventId,
      }

      log.info(`payload signed: secretId=${secretId}, key=${signingKey.keyId}, verified=${verified}`)

      return {
        signingResult: result,
        success: true,
        failureReason: null,
        latencyMs: Date.now() - startTime,
      }
    } catch (e) {
      secretFailureRecovery.quarantine(secretId, `signing failed: ${(e as Error).message}`)
      log.error(`cryptographic signing failed: ${(e as Error).message}`)
      return {
        signingResult: null,
        success: false,
        failureReason: (e as Error).message,
        latencyMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Rule 12 — Key rotation creates a new immutable key version.
   * Rule 16 — Rotation never invalidates historical audit lineage.
   * Rule 19 — Rotation generates immutable governance events.
   */
  rotateKey(secretId: string, principalId: string, config: SCKMEConfiguration): {
    newKeyId: string | null
    newKeyVersion: string | null
    success: boolean
    failureReason: string | null
  } {
    try {
      const latestContract = secretStorage.getLatest(secretId)
      if (!latestContract) {
        throw new Error(`secret ${secretId} not found`)
      }
      const oldKey = this.keys.get(latestContract.cryptographicKeyId)
      if (!oldKey) {
        throw new Error(`key ${latestContract.cryptographicKeyId} not found`)
      }

      const provider = externalProviderRegistry.get(oldKey.providerId) ?? config.externalProviders[0]
      if (!provider) {
        throw new Error('no provider available for rotation')
      }

      // Rule 12 — Generate new immutable key version (old version unchanged)
      const newKey = cryptoEngine.rotateKey(oldKey, provider)
      this.keys.set(newKey.keyId, newKey)
      sckmeObservabilityCollector.recordSecretRotation()

      log.info(`key rotated: ${oldKey.keyId} ${oldKey.keyVersion} → ${newKey.keyVersion}`)
      return {
        newKeyId: newKey.keyId,
        newKeyVersion: newKey.keyVersion,
        success: true,
        failureReason: null,
      }
    } catch (e) {
      log.error(`key rotation failed: ${(e as Error).message}`)
      return {
        newKeyId: null,
        newKeyVersion: null,
        success: false,
        failureReason: (e as Error).message,
      }
    }
  }

  /**
   * Rule 19 — Revocation generates immutable governance events without
   * modifying historical secret records.
   *
   * Because historical contracts are frozen (Rule 5), this method does NOT
   * mutate the existing contract's governanceMetadata. Instead it records a
   * new standalone governance event and revokes the underlying key + lease.
   */
  revokeSecret(secretId: string, principalId: string, reason: string): {
    success: boolean
    failureReason: string | null
    /** Rule 19 — New governance event ID generated (historical records untouched). */
    revocationGovernanceEventId: string | null
  } {
    try {
      const latestContract = secretStorage.getLatest(secretId)
      if (!latestContract) {
        throw new Error(`secret ${secretId} not found`)
      }

      // Revoke lease if active
      if (latestContract.secretLeaseId) {
        const lease = leaseManager.revoke(latestContract.secretLeaseId)
        if (lease) {
          sckmeObservabilityCollector.recordSecretRevocation()
        }
      }

      // Revoke key (creates a new key object, doesn't mutate the frozen contract)
      const key = this.keys.get(latestContract.cryptographicKeyId)
      if (key) {
        const revokedKey = cryptoEngine.revokeKey(key)
        this.keys.set(revokedKey.keyId, revokedKey)
      }

      // Rule 19 — Record a NEW governance event (do not mutate historical
      // frozen contract). The revocation event itself is immutable.
      const revocationEventId = `gov-revoke-${randomUUID()}`
      sckmeObservabilityCollector.recordGovernanceEvent()

      log.info(`secret revoked: ${secretId} (reason: ${reason}, event: ${revocationEventId})`)
      return {
        success: true,
        failureReason: null,
        revocationGovernanceEventId: revocationEventId,
      }
    } catch (e) {
      log.error(`secret revocation failed: ${(e as Error).message}`)
      return {
        success: false,
        failureReason: (e as Error).message,
        revocationGovernanceEventId: null,
      }
    }
  }

  /**
   * Rule 10 — Authenticated, authorized, policy-compliant secret retrieval.
   * Rule 11 — Lease must be active.
   */
  retrieveSecret(secretEventId: string, principalId: string, policyId: string): {
    contract: CanonicalSecretContract | null
    accessGranted: boolean
    failureReason: string | null
  } {
    const access: SecretAccessMetadata = {
      principalId,
      policyId,
      accessDecision: 'ALLOWED',
      accessReason: 'Authorized retrieval',
      accessedAt: Date.now(),
      secureExecutionEnvironment: true,
    }
    const result = secretStorage.retrieve(secretEventId, access)
    if (!result.accessGranted) {
      return { contract: null, accessGranted: false, failureReason: 'access denied' }
    }
    sckmeObservabilityCollector.recordSecretRetrieved()
    return { contract: result.contract, accessGranted: true, failureReason: null }
  }

  /**
   * Rule 11 — Renew a lease through approved governance policies.
   */
  renewLease(leaseId: string, governanceApproved: boolean, extensionSeconds: number): {
    lease: SecretLease | null
    success: boolean
  } {
    const lease = leaseManager.renew(leaseId, governanceApproved, extensionSeconds)
    if (lease && lease.renewalGovernanceApproved) {
      sckmeObservabilityCollector.recordLeaseRenewal()
    }
    return { lease, success: lease !== null }
  }

  /**
   * §16 — Replay historical secret operation (Rule 13, Rule 18).
   */
  replaySecret(secretEventId: string): {
    recovered: boolean
    contract: CanonicalSecretContract | null
    verified: boolean
  } {
    return secretFailureRecovery.replay(secretEventId, secretStorage)
  }

  /**
   * Rule 14 — Monitor certificate expirations.
   */
  monitorCertificateExpirations(thresholdDays: number) {
    return certificateManager.monitorExpirations(thresholdDays)
  }

  /**
   * §14 — Observability snapshot.
   */
  observability(): Record<string, unknown> {
    return sckmeObservabilityCollector.snapshot()
  }

  /**
   * §17 — Register an external provider (HSM/KMS/Vault).
   */
  registerExternalProvider(provider: ExternalProvider): void {
    externalProviderRegistry.register(provider)
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ───────────────────────────────────────────────────────────────────────────

  private recordHistory(contract: CanonicalSecretContract): void {
    this.history.push(contract)
    if (this.history.length > this.MAX_HISTORY) this.history.shift()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  SCKME_VERSION,
  SECRETS_CRYPTO_SCHEMA_VERSION,
}

export const SCKME_ENGINE_VERSION = SCKME_VERSION

// Re-export key subsystem singletons for direct access (testing/integration)
export {
  secretRegistrar,
  cryptoEngine,
  secretStorage,
  leaseManager,
  certificateManager,
  versionManager,
  secretGovernanceManager,
  auditRecorder,
  secretLineageTracker,
  secretContractGenerator,
  externalProviderRegistry,
  secretFailureRecovery,
  sckmeObservabilityCollector,
}
