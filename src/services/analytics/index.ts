/**
 * Analytics service - public API for event logging
 *
 * STRIPPED: All sink attachment and event queueing are no-ops in this fork.
 * logEvent/logEventAsync drop events immediately and never reach any backend.
 * The public API surface is preserved so ~1,399 call sites across the tree
 * continue to compile unchanged.
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  return metadata
}

type LogEventMetadata = { [key: string]: boolean | number | undefined }

export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

export function attachAnalyticsSink(_newSink: AnalyticsSink): void {
  // no-op: analytics stripped from this build
}

export function logEvent(
  _eventName: string,
  _metadata: LogEventMetadata,
): void {
  // no-op: analytics stripped from this build
}

export async function logEventAsync(
  _eventName: string,
  _metadata: LogEventMetadata,
): Promise<void> {
  // no-op: analytics stripped from this build
}

export function _resetForTesting(): void {
  // no-op: analytics stripped from this build
}
