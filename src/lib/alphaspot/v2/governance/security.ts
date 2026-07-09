// CHAPTER 2.4 §7 — Security Boundaries
//
// The principle of least privilege is mandatory (Chapter 2.4 §7). Every
// subsystem receives only the permissions required for its responsibility.
//
// Sensitive information must NEVER appear in: logs, events, exceptions,
// dashboards (§7). Secrets remain isolated from business logic.
//
// This module provides:
//   • A secret vault (isolated from business logic)
//   • A redaction layer for logs/events/exceptions
//   • A permission registry enforcing least privilege per domain

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('security')

// ─────────────────────────────────────────────────────────────────────────────
// Secret vault  (Chapter 2.4 §7 — secrets isolated from business logic)
// ─────────────────────────────────────────────────────────────────────────────

class SecretVault {
  private secrets = new Map<string, string>()
  private accessors = new Map<string, Set<string>>() // secretKey → allowed domains

  /** Register a secret + which domains may access it (§7 least privilege). */
  register(key: string, value: string, allowedDomains: string[]): void {
    this.secrets.set(key, value)
    this.accessors.set(key, new Set(allowedDomains))
    log.info(`secret registered: ${key} (accessible to: ${allowedDomains.join(', ')})`)
  }

  /** Load a secret from env and register it. */
  registerFromEnv(key: string, envVar: string, allowedDomains: string[]): void {
    const value = process.env[envVar]
    if (!value) {
      log.warn(`secret "${key}" not set (env var ${envVar} missing)`)
      return
    }
    this.register(key, value, allowedDomains)
  }

  /** Access a secret — throws if the calling domain isn't permitted (§7). */
  access(key: string, callingDomain: string): string {
    const allowed = this.accessors.get(key)
    if (!allowed) throw new Error(`[security] secret "${key}" is not registered`)
    if (!allowed.has(callingDomain)) {
      throw new Error(
        `[security] DENIED: domain "${callingDomain}" is not permitted to access secret "${key}" (§7 least privilege). Allowed: ${[...allowed].join(', ')}`,
      )
    }
    return this.secrets.get(key)!
  }

  /** Check if a secret exists (no access — for health checks). */
  has(key: string): boolean {
    return this.secrets.has(key)
  }

  /** List registered secret names (values NEVER exposed — §7). */
  list(): Array<{ key: string; allowedDomains: string[] }> {
    return Array.from(this.accessors.entries()).map(([key, domains]) => ({
      key,
      allowedDomains: [...domains],
    }))
  }
}

export const secretVault = new SecretVault()

// ─────────────────────────────────────────────────────────────────────────────
// Redaction layer  (Chapter 2.4 §7 — sensitive info never in logs/events)
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE_KEY_PATTERNS = [
  /key/i, /secret/i, /password/i, /token/i, /credential/i, /api[_-]?key/i,
  /private/i, /auth/i, /pass/i, /pwd/i,
]

/** Redact sensitive values from an object before logging/emitting (§7). */
export function redactSensitive<T>(obj: T, maxDepth = 5): T {
  if (obj === null || typeof obj !== 'object' || maxDepth <= 0) return obj
  if (Array.isArray(obj)) {
    return obj.map((v) => redactSensitive(v, maxDepth - 1)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((p) => p.test(k))) {
      out[k] = typeof v === 'string' && v.length > 0 ? `${v.slice(0, 2)}***REDACTED***` : '***REDACTED***'
    } else if (v !== null && typeof v === 'object') {
      out[k] = redactSensitive(v, maxDepth - 1)
    } else {
      out[k] = v
    }
  }
  return out as T
}

/** Sanitize a string for safe logging — removes anything that looks like a key/secret. */
export function sanitizeForLog(str: string): string {
  // Mask anything that looks like a Binance API key (64 hex chars) or a JWT
  return str
    .replace(/[a-f0-9]{64}/gi, '***API_KEY***')
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '***JWT***')
    .replace(/(sk-|pk-|pk_live_|pk_test_)[a-zA-Z0-9]+/g, '***SECRET_KEY***')
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission registry  (Chapter 2.4 §7 — least privilege per domain)
// ─────────────────────────────────────────────────────────────────────────────

export type Permission =
  | 'read:market-data'
  | 'write:market-data'
  | 'read:features'
  | 'read:predictions'
  | 'create:candidates'
  | 'validate:risk'
  | 'execute:trades'
  | 'publish:recommendations'
  | 'persist:state'
  | 'access:secrets'
  | 'manage:config'

class PermissionRegistry {
  private grants = new Map<string, Set<Permission>>()

  /** Grant permissions to a domain (§7 — least privilege). */
  grant(domain: string, ...permissions: Permission[]): void {
    if (!this.grants.has(domain)) this.grants.set(domain, new Set())
    for (const p of permissions) this.grants.get(domain)!.add(p)
    log.debug(`granted ${domain}: ${permissions.join(', ')}`)
  }

  /** Assert a domain has a permission (defensive check — §7). */
  assert(domain: string, permission: Permission): void {
    const perms = this.grants.get(domain)
    if (!perms || !perms.has(permission)) {
      throw new Error(
        `[security] DENIED: domain "${domain}" lacks permission "${permission}" (§7 least privilege)`,
      )
    }
  }

  /** Check (non-throwing) if a domain has a permission. */
  has(domain: string, permission: Permission): boolean {
    return this.grants.get(domain)?.has(permission) ?? false
  }

  /** List a domain's permissions (for audit / documentation §14). */
  list(domain: string): Permission[] {
    return [...(this.grants.get(domain) ?? [])]
  }

  /** List all grants (for audit). */
  listAll(): Array<{ domain: string; permissions: Permission[] }> {
    return Array.from(this.grants.entries()).map(([domain, perms]) => ({ domain, permissions: [...perms] }))
  }
}

export const permissions = new PermissionRegistry()

// ─────────────────────────────────────────────────────────────────────────────
// Canonical permission grants  (Chapter 2.4 §7 + Chapter 2.1 domain responsibilities)
// Each domain gets ONLY the permissions it needs for its responsibility.
// ─────────────────────────────────────────────────────────────────────────────

export function grantCanonicalPermissions(): void {
  permissions.grant('market-gateway', 'write:market-data')
  permissions.grant('market-data', 'read:market-data', 'write:market-data', 'persist:state')
  permissions.grant('feature-engineering', 'read:market-data', 'read:features', 'persist:state')
  permissions.grant('market-intelligence', 'read:features', 'persist:state')
  permissions.grant('machine-learning', 'read:features', 'read:predictions', 'persist:state')
  permissions.grant('decision-engine', 'read:predictions', 'create:candidates', 'persist:state')
  permissions.grant('portfolio-intelligence', 'create:candidates', 'persist:state')
  permissions.grant('risk-engine', 'validate:risk', 'persist:state')
  permissions.grant('execution-engine', 'execute:trades', 'persist:state')
  permissions.grant('workflow-orchestrator', 'publish:recommendations', 'persist:state')
  permissions.grant('presentation-layer') // read-only — no business permissions
  permissions.grant('research-platform', 'read:market-data', 'persist:state')
  permissions.grant('core-infrastructure', 'manage:config', 'access:secrets')
  log.info(`canonical permissions granted to ${permissions.listAll().length} domains`)
}
