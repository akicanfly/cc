import { initializeErrorLogSink } from './errorLogSink.js'

/**
 * STRIPPED: analytics sink init removed in this build. Only the local
 * on-disk error log sink is attached (writes to ~/.claude errors JSONL,
 * never leaves the machine).
 */
export function initSinks(): void {
  initializeErrorLogSink()
}
