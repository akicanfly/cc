export type PermissionMode = 'ask' | 'skip_all_permission_checks' | 'follow_a_plan'
export type Logger = {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}
export type ClaudeForChromeContext = Record<string, unknown>
export const BROWSER_TOOLS: Array<{ name: string }>
export function createClaudeForChromeMcpServer(context?: ClaudeForChromeContext): Record<string, unknown>
