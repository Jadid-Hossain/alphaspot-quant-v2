// CHAPTER 2.4 §6 — Configuration Management
//
// Configuration must be externalized (Chapter 2.4 §6). No hardcoded:
//   • API keys    • thresholds     • credentials
//   • exchange URLs • model paths  • risk parameters
//
// Configurations must support: validation, versioning, environment isolation (§6).
//
// This module provides a typed, validated, versioned config registry. Domains
// register their config schemas; values are loaded from env + defaults; the
// registry validates and freezes them.

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('config-management')

// ─────────────────────────────────────────────────────────────────────────────
// Config schema definition  (Chapter 2.4 §6 — validation, versioning)
// ─────────────────────────────────────────────────────────────────────────────

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'string[]'

export interface ConfigFieldSchema {
  key: string
  type: ConfigFieldType
  description: string
  default: unknown
  envVar?: string
  required?: boolean
  min?: number
  max?: number
  options?: string[] // enum-like
  sensitive?: boolean // §7 — never log/emit in plaintext
}

export interface ConfigSchema {
  name: string
  version: string
  fields: ConfigFieldSchema[]
}

export type ConfigValue = string | number | boolean | string[]

export interface ResolvedConfig {
  name: string
  version: string
  values: Record<string, ConfigValue>
  resolvedAt: number
  environment: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation result  (Chapter 2.4 §6 — validation)
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: Array<{ field: string; message: string }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration registry  (Chapter 2.4 §6)
// ─────────────────────────────────────────────────────────────────────────────

class ConfigurationManager {
  private schemas = new Map<string, ConfigSchema>()
  private resolved = new Map<string, ResolvedConfig>()
  private subscribers = new Set<(name: string, config: ResolvedConfig) => void>()

  /** Register a config schema (§6 — versioned, documented). */
  registerSchema(schema: ConfigSchema): void {
    if (this.schemas.has(schema.name)) {
      const existing = this.schemas.get(schema.name)!
      if (existing.version !== schema.version) {
        log.info(`config schema "${schema.name}" upgraded v${existing.version} → v${schema.version}`)
      }
    }
    this.schemas.set(schema.name, schema)
    log.info(`config schema registered: ${schema.name} v${schema.version} (${schema.fields.length} fields)`)
  }

  /** Resolve a config: load from env → default, validate, freeze (§6). */
  resolve(name: string, envOverride?: Record<string, string>): ResolvedConfig {
    const schema = this.schemas.get(name)
    if (!schema) throw new Error(`[config] no schema registered for "${name}"`)

    const values: Record<string, ConfigValue> = {}
    for (const field of schema.fields) {
      const env = envOverride ?? process.env
      const raw = field.envVar ? env[field.envVar] : undefined
      let value: ConfigValue

      if (raw === undefined || raw === '') {
        if (field.required) {
          throw new ConfigurationError(name, `required config "${field.key}" (env ${field.envVar}) is not set`)
        }
        value = field.default as ConfigValue
      } else {
        value = this.coerce(raw, field)
      }

      // Range validation (§6)
      if (field.type === 'number' && typeof value === 'number') {
        if (field.min !== undefined && value < field.min) {
          throw new ConfigurationError(name, `config "${field.key}" = ${value} is below min ${field.min}`)
        }
        if (field.max !== undefined && value > field.max) {
          throw new ConfigurationError(name, `config "${field.key}" = ${value} exceeds max ${field.max}`)
        }
      }
      // Enum validation (§6)
      if (field.options && !field.options.includes(String(value))) {
        throw new ConfigurationError(name, `config "${field.key}" = "${value}" not in allowed options: ${field.options.join(', ')}`)
      }

      values[field.key] = value
    }

    const resolved: ResolvedConfig = {
      name,
      version: schema.version,
      values: Object.freeze(values) as Record<string, ConfigValue>,
      resolvedAt: Date.now(),
      environment: process.env.NODE_ENV ?? 'development',
    }
    this.resolved.set(name, resolved)
    log.info(`config "${name}" resolved (${schema.fields.length} fields, env ${resolved.environment})`)
    for (const sub of this.subscribers) sub(name, resolved)
    return resolved
  }

  /** Get a resolved config. */
  get(name: string): ResolvedConfig {
    const cfg = this.resolved.get(name)
    if (!cfg) throw new Error(`[config] "${name}" not resolved — call resolve() first`)
    return cfg
  }

  /** Get a single config value (typed accessor). */
  getValue<T extends ConfigValue>(name: string, key: string): T {
    return this.get(name).values[key] as T
  }

  /** Validate a config without resolving (§6 — pre-flight check). */
  validate(name: string, envOverride?: Record<string, string>): ValidationResult {
    const schema = this.schemas.get(name)
    if (!schema) return { valid: false, errors: [{ field: '_schema', message: `no schema for "${name}"` }] }
    const errors: Array<{ field: string; message: string }> = []
    const env = envOverride ?? process.env
    for (const field of schema.fields) {
      const raw = field.envVar ? env[field.envVar] : undefined
      if ((raw === undefined || raw === '') && field.required) {
        errors.push({ field: field.key, message: `required env var ${field.envVar} is not set` })
      }
    }
    return { valid: errors.length === 0, errors }
  }

  /** List all registered schemas (for documentation §14). */
  listSchemas(): ConfigSchema[] {
    return Array.from(this.schemas.values())
  }

  /** Subscribe to config resolutions (§13 observability). */
  subscribe(handler: (name: string, config: ResolvedConfig) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }

  private coerce(raw: string, field: ConfigFieldSchema): ConfigValue {
    switch (field.type) {
      case 'number': {
        const n = Number(raw)
        if (Number.isNaN(n)) throw new ConfigurationError(field.key, `cannot parse "${raw}" as number`)
        return n
      }
      case 'boolean':
        return raw === 'true' || raw === '1' || raw === 'yes'
      case 'string[]':
        return raw.split(',').map((s) => s.trim()).filter(Boolean)
      case 'string':
      default:
        return raw
    }
  }
}

export const configManager = new ConfigurationManager()

// Import the error class here to avoid a circular dep at module-top
import { ConfigurationError } from './error-handling'
