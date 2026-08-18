/**
 * Minimal root-only browser slot registry.
 *
 * @module @minimal-web/client-ui-slots
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'

/** Stable non-callable snapshot consumed by React external-store hooks. */
export interface RootSlotSnapshot {
  readonly component?: ComponentType
}

/** Root component registration and observable snapshot. */
export interface SlotRegistry {
  registerRoot(component: ComponentType): () => void
  getRoot(): ComponentType | undefined
  getSnapshot(): RootSlotSnapshot
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Minimal root-only UI slot registry. */
    slots: SlotRegistry
  }
}

/** Cordis service provided as `ctx.slots`. */
export class MinimalSlotRegistry extends Service implements SlotRegistry {
  private readonly listeners = new Set<() => void>()
  private root: ComponentType | undefined
  private snapshot: RootSlotSnapshot = {}
  private rootRegistration: symbol | undefined
  private closing = false

  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  [Service.init](): void {
    this.ctx.effect(() => () => {
      this.closing = true
      this.root = undefined
      this.snapshot = {}
      this.rootRegistration = undefined
      this.listeners.clear()
    }, 'minimalSlots.lifecycle')
  }

  registerRoot(component: ComponentType): () => void {
    this.assertActive()
    if (this.root !== undefined) throw new Error('minimal UI slots: root is already registered')
    const registration = Symbol('root registration')
    this.root = component
    this.snapshot = { component }
    this.rootRegistration = registration
    this.notify()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.rootRegistration !== registration) return
      this.root = undefined
      this.snapshot = {}
      this.rootRegistration = undefined
      this.notify()
    }
  }

  getRoot(): ComponentType | undefined {
    return this.root
  }

  getSnapshot(): RootSlotSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.assertActive()
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private assertActive(): void {
    if (this.closing) throw new Error('minimal UI slots are closing')
  }
}

export default MinimalSlotRegistry
