export type ClaudifyLine = string | null

declare module 'claude-code' {
  interface PluginState {
    claudify: { line: ClaudifyLine }
  }
}
