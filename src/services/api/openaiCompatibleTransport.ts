import type { ClientOptions } from '@anthropic-ai/sdk'
import { APIConnectionTimeoutError } from '@anthropic-ai/sdk/error'
import { createOpenAICompatibleResponseError } from './openaiCompatibleErrors.js'
import { isOpenRouterBaseURL, zenHeaders } from './openaiCompatibleQuirks.js'
import type { OpenAICompatibleConfig } from 'src/utils/openAICompatibleConfig.js'
import { adaptRejectedSchemas } from './openaiCompatibleSchema.js'

// Retry only explicit request validation failures, before any response is emitted.
// Never drop tools, messages, whole schemas, or output limits to make a request succeed.
export async function postCompatibleRequest({
  config, path, body, signal, fetchOverride, onFallback = message => console.warn(message),
}: {
  config: OpenAICompatibleConfig
  path: string
  body: Record<string, unknown>
  signal: AbortSignal
  fetchOverride?: ClientOptions['fetch']
  onFallback?: (message: string) => void
}): Promise<Response> {
  const headers = compatibleRequestHeaders(config)
  const requestBody = { ...body }
  const attemptedLimits = new Set<string>()
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const response = await (fetchOverride ?? globalThis.fetch)(
      `${config.baseURL.replace(/\/+$/, '')}${path}`,
      { method: 'POST', signal, headers, body: JSON.stringify(requestBody) },
    )
    if (response.ok) return response
    const error = await createOpenAICompatibleResponseError(response, `${path} request`)
    const payload = error.error as { error?: { message?: unknown; param?: unknown; upstream?: { message?: unknown } } } | undefined
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : error.message
    const diagnostic = typeof payload?.error?.upstream?.message === 'string' ? `${message}\n${payload.error.upstream.message}` : message
    if (attempt >= 3 || ![400, 422].includes(response.status)) throw error
    const keywords = new Set<string>()
    let change: string | undefined
    if (config.schemaFallback === true && adaptRejectedSchemas(requestBody, diagnostic, keyword => keywords.add(keyword))) {
      change = `adapted unsupported schema keywords: ${[...keywords].join(', ')}`
    } else if (config.parameterFallback !== false) {
      change = applyParameterFallback(requestBody, message, attemptedLimits, payload?.error?.param)
    }
    if (!change) throw error
    onFallback(`Provider compatibility fallback: ${change}`)
  }
}

export function compatibleRequestHeaders(config: OpenAICompatibleConfig): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...zenHeaders(config.baseURL, config.headers),
    ...(isOpenRouterBaseURL(config.baseURL) ? { 'X-Title': 'ccc' } : {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  })
  for (const [name, value] of Object.entries(config.headers)) headers.set(name, value)
  return headers
}

function applyParameterFallback(
  body: Record<string, unknown>,
  message: string,
  attemptedLimits: Set<string>,
  param: unknown,
): string | undefined {
  // A parameter mentioned in an unrelated validation error is not a reason to remove it.
  if (!/unsupported|not supported|does not support|not allowed|not permitted|unrecognized|unknown (?:parameter|field|argument)|only (?:the )?(?:default|supported)\b/i.test(message)) return undefined
  const mentions = (key: string) => {
    if (typeof param === 'string' && param) return param === key || param.startsWith(key + '.')
    const option = `["']?${key}\\b["']?`
    return new RegExp(`(?:unsupported|unrecognized|unknown)\\s+(?:(?:request )?(?:parameter|field|argument|value)(?: supplied)?\\s*)?[:=]?\\s*${option}|${option}\\s*(?:is |are )?(?:not supported|unsupported|not allowed|not permitted)|does not support\\s+${option}|${option}[^.!?\\n]{0,60}only (?:the )?default`, 'i').test(message)
  }
  for (const key of ['stream_options', 'temperature', 'top_p', 'stop']) {
    if (key in body && mentions(key)) {
      delete body[key]
      return `removed ${key}`
    }
  }
  for (const [from, to] of [
    ['max_tokens', 'max_completion_tokens'],
    ['max_completion_tokens', 'max_tokens'],
  ] as const) {
    if (from in body && mentions(from) && !attemptedLimits.has(to)) {
      attemptedLimits.add(from)
      body[to] = body[from]
      delete body[from]
      return `replaced ${from} with ${to}, preserving the token limit`
    }
  }
  return undefined
}

export function connectionFailureMessage(baseURL: string, error: unknown): string {
  const origin = new URL(baseURL).origin
  const cause = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown } | undefined
  const code = cause?.code ?? cause?.cause?.code
  const detail = typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : ''
  return `Unable to connect to OpenAI-compatible provider at ${origin}${detail}. Check that the server is running and the URL uses the correct http:// or https:// scheme.`
}

export function compatibleTimeoutError(message: string, cause: unknown): APIConnectionTimeoutError {
  const error = new APIConnectionTimeoutError({ message })
  error.cause = cause
  return error
}
