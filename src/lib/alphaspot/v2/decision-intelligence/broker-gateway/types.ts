// CHAPTER 5.9 — Broker Gateway Engine Types
//
// The BGE is the exclusive bridge between Smart Order Routing (Ch 5.8) and
// external execution venues. Transforms validated Routing Contracts into
// broker-specific execution requests (§1).
//
// Core principles (§2):
//   • Execution plans remain broker independent.
//   • Broker communication remains infrastructure dependent.
//   • Isolate all broker-specific behavior from institutional investment logic.
//   • Deterministic, reproducible, configurable, version controlled, auditable.
//   • Broker implementation shall never influence investment decisions.
//
// The BGE performs NO: ML, portfolio construction, risk management, strategy
// logic, execution optimization, smart order routing, exchange matching, fill
// reconciliation (§1).
//
// 28 architectural rules enforced (see §18).
// 16-stage pipeline (§5 — no skips).

import type { CanonicalRoutingContract } from '../smart-order-routing/types'

// ─────────────────────────────────────────────────────────────────────────────
// Communication Protocols  (Chapter 5.9 §7)
// ─────────────────────────────────────────────────────────────────────────────

export type CommunicationProtocol =
  | 'FIX_4_2' // §7
  | 'FIX_4_4' // §7
  | 'FIX_5_0' // §7
  | 'REST_API' // §7
  | 'WEBSOCKET_API' // §7
  | 'GRPC' // §7
  | 'PROPRIETARY' // §7

// ─────────────────────────────────────────────────────────────────────────────
// Transmission State  (Chapter 5.9 §4, §10A, Rule 21)
// Transactional Acknowledgment State Machine.
// ─────────────────────────────────────────────────────────────────────────────

export type TransmissionState =
  | 'PENDING_TRANSMISSION' // §10A
  | 'TRANSMITTED' // §10A
  | 'TRANSMITTED_UNACKNOWLEDGED' // §10A
  | 'ACKNOWLEDGED' // §10A
  | 'REJECTED' // §10A
  | 'TIMED_OUT' // §10A
  | 'UNKNOWN_STATE' // §10A, Rule 22 — requires reconciliation
  | 'RECONCILIATION_REQUIRED' // §10A
  | 'COMPLETED' // §10A

// ─────────────────────────────────────────────────────────────────────────────
// Acknowledgment State  (Chapter 5.9 §4, §6)
// ─────────────────────────────────────────────────────────────────────────────

export type AcknowledgmentState =
  | 'PENDING'
  | 'ACKNOWLEDGED'
  | 'REJECTED'
  | 'TIMED_OUT'
  | 'UNKNOWN'

// ─────────────────────────────────────────────────────────────────────────────
// Submission Status  (Chapter 5.9 §4)
// ─────────────────────────────────────────────────────────────────────────────

export type SubmissionStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'FAILED'
  | 'THROTTLED'
  | 'QUARANTINED'

// ─────────────────────────────────────────────────────────────────────────────
// Connection Status  (Chapter 5.9 §4, §10)
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'DEGRADED'
  | 'RECONNECTING'
  | 'SUSPENDED' // Rule 10 — broken sessions suspend new submissions
  | 'FAILED'

// ─────────────────────────────────────────────────────────────────────────────
// Session State  (Chapter 5.9 §8, Rule 9/10)
// ─────────────────────────────────────────────────────────────────────────────

export type SessionState =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'AUTHENTICATING'
  | 'ACTIVE' // Rule 9 — only authenticated sessions transmit
  | 'HEARTBEAT_DEGRADED'
  | 'RECOVERING'
  | 'LOGGED_OUT'
  | 'BROKEN' // Rule 10 — immediately suspends new submissions
  | 'EXPIRED'

// ─────────────────────────────────────────────────────────────────────────────
// Rate Governor Mechanism  (Chapter 5.9 §10C)
// ─────────────────────────────────────────────────────────────────────────────

export type RateGovernorMechanism =
  | 'TOKEN_BUCKET' // §10C
  | 'LEAKY_BUCKET' // §10C
  | 'SLIDING_WINDOW' // §10C
  | 'ADAPTIVE_BURST' // §10C
  | 'PRIORITY_QUEUE' // §10C
  | 'EMERGENCY_SHAPING' // §10C

// ─────────────────────────────────────────────────────────────────────────────
// Rate Governor Action  (Chapter 5.9 §10C)
// ─────────────────────────────────────────────────────────────────────────────

export type RateGovernorAction =
  | 'ALLOW'
  | 'DELAY' // §10C
  | 'BUFFER' // §10C
  | 'REPRIORITIZE' // §10C
  | 'REJECT' // §10C
  | 'REROUTE' // §10C

// ─────────────────────────────────────────────────────────────────────────────
// Clock Synchronization Mechanism  (Chapter 5.9 §10D)
// ─────────────────────────────────────────────────────────────────────────────

export type ClockSyncMechanism =
  | 'PTP' // §10D — Precision Time Protocol
  | 'NTP' // §10D — Network Time Protocol
  | 'HARDWARE_TIMESTAMPING' // §10D
  | 'GPS' // §10D — GPS Time Source
  | 'EXCHANGE_SYNC' // §10D

// ─────────────────────────────────────────────────────────────────────────────
// Clock Synchronization Status  (Chapter 5.9 §4, §10D, Rule 27)
// ─────────────────────────────────────────────────────────────────────────────

export type ClockSyncStatus =
  | 'SYNCHRONIZED'
  | 'DRIFT_WARNING'
  | 'DRIFT_EXCEEDED' // Rule 27 — outbound suspended
  | 'REFERENCE_LOST'
  | 'UNSUPPORTED'

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency Mechanism  (Chapter 5.9 §10B)
// ─────────────────────────────────────────────────────────────────────────────

export type IdempotencyMechanism =
  | 'FIX_CLORDID' // §10B
  | 'FIX_SECONDARY_CLORDID' // §10B
  | 'REST_IDEMPOTENCY_KEY' // §10B
  | 'EXCHANGE_CLIENT_ORDER_ID' // §10B
  | 'PROPRIETARY_BROKER_ID' // §10B

// ─────────────────────────────────────────────────────────────────────────────
// Broker Configuration  (Chapter 5.9 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerConfiguration {
  brokerId: string
  brokerName: string
  exchange: string
  /** §7 — Supported protocols. */
  supportedProtocols: CommunicationProtocol[]
  /** Default protocol. */
  defaultProtocol: CommunicationProtocol
  /** §8 — Session configuration. */
  sessionConfig: SessionConfiguration
  /** §10C — Rate limits. */
  rateLimits: RateLimitConfiguration
  /** §10D — Clock sync configuration. */
  clockSyncConfig: ClockSyncConfiguration
  /** §10B — Idempotency configuration. */
  idempotencyConfig: IdempotencyConfiguration
  /** §11 — Failover configuration. */
  failoverConfig: FailoverConfiguration
  /** §12 — Version info. */
  apiVersion: string
  protocolVersion: string
  configVersion: string
}

export interface SessionConfiguration {
  heartbeatIntervalMs: number
  sessionTimeoutMs: number
  maxRetries: number
  retryDelayMs: number
  sequenceNumberSync: boolean
  autoReconnect: boolean
}

export interface RateLimitConfiguration {
  requestsPerSecond: number
  requestsPerMinute: number
  burstLimit: number
  apiWeightPerMinute: number
  /** §10C — Governor mechanism. */
  mechanism: RateGovernorMechanism
}

export interface ClockSyncConfiguration {
  mechanism: ClockSyncMechanism
  /** Rule 27 — Max drift tolerance (ms). */
  maxDriftMs: number
  /** Sync check interval (ms). */
  syncCheckIntervalMs: number
  referenceClock: string
}

export interface IdempotencyConfiguration {
  mechanism: IdempotencyMechanism
  /** §10B — Gateway cluster epoch (for distributed uniqueness). */
  clusterEpoch: number
  keyGenerationVersion: string
}

export interface FailoverConfiguration {
  primaryBrokerId: string
  secondaryBrokerIds: string[]
  geographicFailover: boolean
  automaticRetry: boolean
  maxRetries: number
  retryDelayMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker Session  (Chapter 5.9 §8)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerSession {
  sessionId: string
  brokerId: string
  state: SessionState
  /** §8 — Sequence number for FIX protocols. */
  sequenceNumber: number
  /** §8 — Last heartbeat timestamp. */
  lastHeartbeat: number
  /** §8 — Authentication token. */
  authToken: string | null
  /** §8 — Auth expiration. */
  authExpiresAt: number | null
  createdAt: number
  /** §10 — Round-trip latency (ms). */
  roundTripLatency: number
  /** §10 — Packet loss rate (0..1). */
  packetLoss: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Governor State  (Chapter 5.9 §10C)
// ─────────────────────────────────────────────────────────────────────────────

export interface RateGovernorState {
  brokerId: string
  /** Current requests per second. */
  currentRps: number
  /** Current requests per minute. */
  currentRpm: number
  /** API weight used this minute. */
  apiWeightUsed: number
  /** Remaining burst capacity. */
  remainingBurst: number
  /** Remaining capacity (0..1). */
  remainingCapacity: number
  /** Last update timestamp. */
  lastUpdate: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Clock Synchronization State  (Chapter 5.9 §10D)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClockSyncState {
  status: ClockSyncStatus
  mechanism: ClockSyncMechanism
  /** Current drift (ms, can be negative). */
  drift: number
  /** Offset from reference (ms). */
  offset: number
  /** Timestamp accuracy (ms). */
  accuracy: number
  /** Reference clock available. */
  referenceAvailable: boolean
  /** Last sync check. */
  lastSyncCheck: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker Communication Lineage  (Chapter 5.9 Rule 12)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerCommunicationLineage {
  routingDecisionId: string
  executionPlanId: string
  orderDecisionId: string
  positionId: string
  riskAssessmentId: string
  portfolioId: string
  strategyDecisionIds: string[]
  brokerApiVersion: string
  protocolVersion: string
  clockSyncVersion: string
  idempotencyVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker Version Bundle  (Chapter 5.9 §12, Rule 5)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerVersionBundle {
  gatewayVersion: string
  brokerApiVersion: string
  protocolVersion: string
  configurationVersion: string
  governanceVersion: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker Governance Metadata  (Chapter 5.9 §13)
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerGovernanceMetadata {
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONDITIONAL'
  validationStatus: 'PENDING' | 'PASSED' | 'FAILED' | 'WARNING'
  reviewHistory: Array<BrokerReviewEvent>
  auditHistory: Array<BrokerAuditEvent>
  creationTimestamp: number
  transmissionTimestamp: number | null
  retirementStatus: 'ACTIVE' | 'PENDING_RETIREMENT' | 'RETIRED'
  governanceNotes: string[]
}

export interface BrokerReviewEvent {
  action: string
  at: number
  actor: string
  note: string
  outcome: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'CONDITIONAL'
}

export interface BrokerAuditEvent {
  action: string
  at: number
  actor: string
  note: string
  before?: unknown
  after?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Metadata  (Chapter 5.9 §4)
// ─────────────────────────────────────────────────────────────────────────────

export interface RequestMetadata {
  brokerRequestId: string
  gatewayVersion: string
  versions: BrokerVersionBundle
  lineage: BrokerCommunicationLineage
  protocol: CommunicationProtocol
  idempotencyKey: string
  idempotencyMechanism: IdempotencyMechanism
  transmissionAttempt: number
  clockSyncStatus: ClockSyncStatus
  clockDrift: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Broker Communication Contract  (Chapter 5.9 §4, §6, Rule 4)
// Every communication conforms to this contract. Alternative formats PROHIBITED.
// Records are immutable (Rule 5). Never modifies Routing Contracts (Rule 14).
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalBrokerCommunicationContract {
  // §4 — Required identifiers
  brokerRequestId: string // Rule 3 — unique
  gatewayVersion: string
  routingDecisionId: string
  brokerId: string
  exchange: string
  requestTimestamp: number

  // §6 — Canonical Broker Communication Contract fields
  protocol: CommunicationProtocol
  brokerOrderId: string | null
  submissionStatus: SubmissionStatus
  transmissionState: TransmissionState
  acknowledgmentState: AcknowledgmentState
  idempotencyKey: string
  transmissionAttempt: number
  clockSyncStatus: ClockSyncStatus
  brokerSessionId: string
  connectionStatus: ConnectionStatus

  // §4 — Request metadata + governance
  requestMetadata: RequestMetadata
  governanceMetadata: BrokerGovernanceMetadata

  // §5 — Pipeline stages
  pipelineStages: Array<{ stage: string; startedAt: number; completedAt: number; durationMs: number; success: boolean }>

  // Rule 5 — Historical immutable
  createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Gateway Configuration  (Chapter 5.9 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface GatewayConfiguration {
  /** Registered brokers. */
  brokers: Map<string, BrokerConfiguration>
  /** Default broker. */
  defaultBrokerId: string
  /** §10D — Clock sync tolerance (ms). */
  clockSyncToleranceMs: number
  /** §10C — Rate governor enabled. */
  rateGovernorEnabled: boolean
  /** §10B — Idempotency enabled. */
  idempotencyEnabled: boolean
  /** §10A — Acknowledgment timeout (ms). */
  acknowledgmentTimeoutMs: number
  /** Rule 17 — Max retries. */
  maxRetries: number
  versions: BrokerVersionBundle
}

export const DEFAULT_GATEWAY_CONFIG: Omit<GatewayConfiguration, 'versions' | 'brokers'> = {
  defaultBrokerId: '',
  clockSyncToleranceMs: 10,
  rateGovernorEnabled: true,
  idempotencyEnabled: true,
  acknowledgmentTimeoutMs: 5000,
  maxRetries: 3,
}

// ─────────────────────────────────────────────────────────────────────────────
// Broker Communication Pipeline Stages  (Chapter 5.9 §5 — 16 stages, no skips)
// ─────────────────────────────────────────────────────────────────────────────

export const BROKER_COMMUNICATION_STAGES = [
  'ROUTING_CONTRACT_RECEPTION',
  'CONTRACT_VALIDATION',
  'BROKER_SELECTION',
  'SESSION_VERIFICATION',
  'AUTHENTICATION_VERIFICATION',
  'CLOCK_SYNCHRONIZATION_VERIFICATION',
  'DISTRIBUTED_IDEMPOTENCY_GENERATION',
  'RATE_GOVERNOR_VERIFICATION',
  'PROTOCOL_TRANSLATION',
  'MESSAGE_VALIDATION',
  'ORDER_SUBMISSION',
  'TRANSACTIONAL_ACKNOWLEDGMENT_MONITORING',
  'SUBMISSION_VERIFICATION',
  'COMMUNICATION_RECORDING',
  'BROKER_RESPONSE_RECORDING',
  'COMMUNICATION_COMPLETION',
] as const

export type BrokerCommunicationStage = (typeof BROKER_COMMUNICATION_STAGES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Engine version
// ─────────────────────────────────────────────────────────────────────────────

export const BGE_VERSION = '1.0.0'
export const BROKER_COMMUNICATION_SCHEMA_VERSION = '1.0.0'

// ─────────────────────────────────────────────────────────────────────────────
// Re-export input contract types
// ─────────────────────────────────────────────────────────────────────────────

export type { CanonicalRoutingContract } from '../smart-order-routing/types'
