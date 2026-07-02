/**
 * STRIPPED: 1P event logging egress removed from this build.
 *
 * IMPORTANT: is1PEventLoggingEnabled() STILL RETURNS the same value as the
 * original (i.e. !isAnalyticsDisabled()) because isGrowthBookEnabled() in
 * growthbook.ts calls this function. If we force-false it here, every
 * getFeatureValue_CACHED_MAY_BE_STALE call short-circuits to defaultValue
 * and skips the disk cache — which would break yolo/auto-mode and any
 * other feature that relies on cached flag values.
 *
 * So we keep the enable predicate intact but no-op every *dispatch* path:
 * initialize1PEventLogging never constructs a LoggerProvider, the module-local
 * `firstPartyEventLogger` stays null, and logEventTo1P / logGrowthBookExperimentTo1P
 * bail on the `!firstPartyEventLogger` guard. Nothing is ever sent to
 * api.anthropic.com/api/event_logging/batch.
 */

import { isAnalyticsDisabled } from './config.js'

export type EventSamplingConfig = {
  [eventName: string]: {
    sample_rate: number
  }
}

export function getEventSamplingConfig(): EventSamplingConfig {
  return {}
}

export function shouldSampleEvent(_eventName: string): number | null {
  return null
}

export async function shutdown1PEventLogging(): Promise<void> {
  // no-op
}

export function is1PEventLoggingEnabled(): boolean {
  // Preserve original semantics — GrowthBook getters gate on this.
  return !isAnalyticsDisabled()
}

export function logEventTo1P(
  _eventName: string,
  _metadata: Record<string, number | boolean | undefined> = {},
): void {
  // no-op
}

export type GrowthBookExperimentData = {
  experimentId: string
  variationId: number
  userAttributes?: import('./growthbook.js').GrowthBookUserAttributes
  experimentMetadata?: Record<string, unknown>
}

export function logGrowthBookExperimentTo1P(_data: GrowthBookExperimentData): void {
  // no-op
}

export function initialize1PEventLogging(): void {
  // no-op
}

export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {
  // no-op
}
