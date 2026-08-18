/** One browser plugin loaded by the minimal shell. */
export interface BootEntry {
  readonly id: string
  readonly url: string
}

/** Fixed browser boot data emitted by the Host. */
export interface BootManifest {
  readonly cwd: string
  readonly entries: readonly BootEntry[]
}

/** Browser plugins in dependency order; Slots is built into the shell. */
export const CLIENT_ENTRIES: readonly BootEntry[] = [
  { id: '@minimal-web/client-connection', url: '/plugins/connection.js' },
  { id: '@minimal-web/client-runtime', url: '/plugins/runtime.js' },
  { id: '@minimal-web/client-ui-minimal-chat', url: '/plugins/chat.js' },
]
