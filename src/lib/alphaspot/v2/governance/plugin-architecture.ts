// CHAPTER 2.4 §15, §16 — Extension Policy & Plugin Architecture
//
// Future capabilities must be added through EXTENSION, never through
// modification of stable core components (Chapter 2.4 §15).
//
// The platform supports replaceable plugins (§16):
//   • Exchange Connectors     • ML Models
//   • Feature Generators      • Risk Models
//   • Market Intelligence     • Portfolio Models
// Plugins communicate ONLY through public contracts (§16).

import { createLogger } from '../domains/01-core-infrastructure'

const log = createLogger('plugin-architecture')

// ─────────────────────────────────────────────────────────────────────────────
// Plugin types  (Chapter 2.4 §16)
// ─────────────────────────────────────────────────────────────────────────────

export type PluginType =
  | 'exchange-connector'
  | 'feature-generator'
  | 'market-intelligence-module'
  | 'ml-model'
  | 'risk-model'
  | 'portfolio-model'
  | 'storage-backend'
  | 'event-transport'
  | (string & {})

export interface PluginManifest {
  pluginId: string
  name: string
  version: string
  type: PluginType
  description: string
  author: string
  /** The public contract this plugin implements (§5, §16). */
  contractToken: string
  /** Other plugins this depends on (explicit — §4). */
  dependencies?: string[]
  createdAt: number
}

export interface PluginInstance {
  manifest: PluginManifest
  /** The factory that creates the plugin's implementation. */
  factory: () => unknown
  /** Whether this plugin is currently active. */
  active: boolean
  /** The resolved instance (lazy). */
  instance?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin registry  (Chapter 2.4 §15, §16)
// ─────────────────────────────────────────────────────────────────────────────

class PluginRegistry {
  private plugins = new Map<string, PluginInstance>()
  private activeByType = new Map<PluginType, string>() // type → pluginId
  private subscribers = new Set<(manifest: PluginManifest) => void>()

  /** Register a plugin (§15 — extend, don't modify core). */
  register(manifest: PluginManifest, factory: () => unknown): void {
    if (this.plugins.has(manifest.pluginId)) {
      throw new Error(`[plugins] plugin "${manifest.pluginId}" already registered`)
    }
    const instance: PluginInstance = { manifest, factory, active: false }
    this.plugins.set(manifest.pluginId, instance)
    log.info(`plugin registered: ${manifest.name} v${manifest.version} (type: ${manifest.type}, contract: ${manifest.contractToken})`)

    // Auto-activate if no other plugin of this type is active
    if (!this.activeByType.has(manifest.type)) {
      this.activate(manifest.pluginId)
    }
    for (const sub of this.subscribers) sub(manifest)
  }

  /** Activate a plugin (deactivates any other plugin of the same type — §16 replaceable). */
  activate(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) throw new Error(`[plugins] cannot activate — "${pluginId}" not registered`)

    // Deactivate the current active plugin of this type
    const currentActive = this.activeByType.get(plugin.manifest.type)
    if (currentActive && currentActive !== pluginId) {
      const current = this.plugins.get(currentActive)!
      current.active = false
      current.instance = undefined
      log.info(`plugin deactivated: ${current.manifest.name} (replaced by ${plugin.manifest.name})`)
    }

    plugin.active = true
    plugin.instance = plugin.factory()
    this.activeByType.set(plugin.manifest.type, pluginId)
    log.info(`plugin activated: ${plugin.manifest.name}`)
  }

  /** Deactivate a plugin. */
  deactivate(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return
    plugin.active = false
    plugin.instance = undefined
    if (this.activeByType.get(plugin.manifest.type) === pluginId) {
      this.activeByType.delete(plugin.manifest.type)
    }
    log.info(`plugin deactivated: ${plugin.manifest.name}`)
  }

  /** Get the active plugin of a given type (§16 — plugins communicate through contracts). */
  getActive<T = unknown>(type: PluginType): T | undefined {
    const pluginId = this.activeByType.get(type)
    if (!pluginId) return undefined
    return this.plugins.get(pluginId)?.instance as T | undefined
  }

  /** Get a plugin manifest by id. */
  getManifest(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId)?.manifest
  }

  /** List all registered plugins (for documentation §14). */
  list(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest)
  }

  /** List plugins by type. */
  listByType(type: PluginType): PluginManifest[] {
    return this.list().filter((m) => m.type === type)
  }

  subscribe(handler: (manifest: PluginManifest) => void): () => void {
    this.subscribers.add(handler)
    return () => this.subscribers.delete(handler)
  }
}

export const pluginRegistry = new PluginRegistry()
