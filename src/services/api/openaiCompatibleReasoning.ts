// Preserve OpenRouter's opaque reasoning details in Anthropic-shaped history.
// These are replay metadata, never request-level reasoning-effort settings.
const SIGNATURE_PREFIX = 'ccc-openrouter:'
const DELTA_FIELDS = new Set(['text', 'summary', 'data', 'signature'])
export type ReasoningDetail = Record<string, unknown>

export function reasoningSignature(details: ReasoningDetail[]): string {
  return SIGNATURE_PREFIX + JSON.stringify(details)
}

export function reasoningDetails(signature: unknown): ReasoningDetail[] | undefined {
  if (typeof signature !== 'string' || !signature.startsWith(SIGNATURE_PREFIX)) return
  let parsed: unknown
  try {
    parsed = JSON.parse(signature.slice(SIGNATURE_PREFIX.length))
  } catch {
    throw new Error('Saved OpenRouter reasoning metadata contains invalid JSON')
  }
  if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Saved OpenRouter reasoning metadata must be an array of objects')
  }
  return parsed
}

export function appendReasoningDetails(
  details: Map<number, ReasoningDetail>, incoming: ReasoningDetail[],
): void {
  incoming.forEach((part, fallbackIndex) => {
    const index = typeof part.index === 'number' ? part.index : fallbackIndex
    const previous = details.get(index)
    const next = { ...previous, ...part }
    for (const key of DELTA_FIELDS) {
      if (typeof previous?.[key] === 'string' && typeof part[key] === 'string') {
        next[key] = previous[key] + part[key]
      }
    }
    details.set(index, next)
  })
}
