/** Minimal React and Cordis browser shell. */

import { Context } from '@deepseek-ai/cordis'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useCallback, useSyncExternalStore } from 'react'
import type { SlotRegistry } from '@minimal-web/client-ui-slots'
import MinimalSlots from '@minimal-web/client-ui-slots'
import { loadClientPlugins, readBootManifest } from '@minimal-web/client-modules/client'
import type {} from '@minimal-web/client-runtime'

/** Root Slot bridge kept independent from the concrete chat component. */
export function RootOutlet({ slots }: { readonly slots: SlotRegistry }): React.JSX.Element {
  const subscribe = useCallback((listener: () => void) => slots.subscribe(listener), [slots])
  const getSnapshot = useCallback(() => slots.getSnapshot(), [slots])
  const { component: Component } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return Component === undefined ? <div>没有注册 Root UI</div> : <Component />
}

/** Handles returned to tests or a future embedding shell. */
export interface MinimalWebHandle {
  readonly ctx: Context
  readonly root: Root
  dispose(): Promise<void>
}

/** Boot the fixed browser plugin chain into one DOM element. */
export async function bootMinimalWeb(element: HTMLElement): Promise<MinimalWebHandle> {
  const root = createRoot(element)
  const ctx = new Context()
  root.render(<div>正在加载…</div>)
  try {
    await ctx.plugin(MinimalSlots)
    const manifest = readBootManifest()
    await loadClientPlugins(ctx, manifest)
    root.render(<RootOutlet slots={ctx.slots} />)
    await ctx.sessions.start(manifest.cwd).catch(() => undefined)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    root.render(<pre role="alert">{message}</pre>)
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    root,
    async dispose() {
      root.unmount()
      await ctx.fiber.dispose()
    },
  }
}
