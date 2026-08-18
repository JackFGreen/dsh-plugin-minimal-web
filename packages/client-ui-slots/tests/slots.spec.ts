import { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MinimalSlotRegistry from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('MinimalSlotRegistry', () => {
  it('publishes one root registration and its idempotent removal', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(MinimalSlotRegistry)
    const listener = vi.fn()
    ctx.slots.subscribe(listener)
    const Root = (() => null) as ComponentType

    const dispose = ctx.slots.registerRoot(Root)
    expect(ctx.slots.getRoot()).toBeTypeOf('function')
    const snapshot = ctx.slots.getSnapshot()
    expect(snapshot.component).toBeTypeOf('function')
    expect(ctx.slots.getSnapshot()).toBe(snapshot)
    expect(listener).toHaveBeenCalledOnce()
    expect(() => ctx.slots.registerRoot(() => null)).toThrow(/already registered/)

    dispose()
    dispose()
    expect(ctx.slots.getRoot()).toBeUndefined()
    expect(ctx.slots.getSnapshot().component).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('removes a root owned by an unloaded Cordis plugin', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(MinimalSlotRegistry)
    const Root = (() => null) as ComponentType
    const apply = (ownerCtx: Context): void => {
      ownerCtx.effect(() => ownerCtx.slots.registerRoot(Root), 'test.root')
    }
    const owner = ctx.plugin(Object.assign(apply, { inject: ['slots'] }))
    await owner

    expect(ctx.slots.getRoot()).toBeTypeOf('function')
    await owner.dispose()
    expect(ctx.slots.getRoot()).toBeUndefined()
  })
})
