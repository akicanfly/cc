import type Anthropic from '@anthropic-ai/sdk'
import type { ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { logForDebugging } from '../../utils/debug.js'
import { createOpenAICompatibleAnthropicClient } from './openaiCompatible.js'

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

/**
 * Compatibility-named client factory used by the existing agent loop.
 * The runtime is OpenAI-only; the Anthropic type remains an internal adapter
 * boundary until the message/event model is migrated independently.
 */
export async function getAnthropicClient({
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<Anthropic> {
  return createOpenAICompatibleAnthropicClient({
    fetchOverride: buildFetch(fetchOverride, source),
  }) as Anthropic
}

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  const inner = fetchOverride ?? globalThis.fetch
  return (input, init) => {
    const headers = new Headers(init?.headers)
    if (!headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    try {
      const url = input instanceof Request ? input.url : String(input)
      logForDebugging(
        `[OPENAI API REQUEST] ${new URL(url).pathname} ${CLIENT_REQUEST_ID_HEADER}=${headers.get(CLIENT_REQUEST_ID_HEADER)} source=${source ?? 'unknown'}`,
      )
    } catch {
      // Request logging must never interrupt the API call.
    }
    return inner(input, { ...init, headers })
  }
}
