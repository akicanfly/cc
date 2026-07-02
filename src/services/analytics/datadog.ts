/**
 * STRIPPED: Datadog egress removed from this build.
 */

export async function initializeDatadog(): Promise<boolean> {
  return false
}

export async function shutdownDatadog(): Promise<void> {
  // no-op
}

export async function trackDatadogEvent(
  _eventName: string,
  _properties: { [key: string]: boolean | number | undefined },
): Promise<void> {
  // no-op
}
