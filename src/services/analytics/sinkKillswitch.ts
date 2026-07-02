/**
 * STRIPPED: All analytics sinks are killed in this build.
 */

export type SinkName = 'datadog' | 'firstParty'

export function isSinkKilled(_sink: SinkName): boolean {
  return true
}
