import { APIError } from '@anthropic-ai/sdk/error'

export type OpenAIErrorPayload = {
  error?: {
    message?: unknown
    type?: unknown
    code?: unknown
    param?: unknown
  }
}

export async function createOpenAICompatibleResponseError(
  response: Response,
  operation: string,
): Promise<APIError> {
  const rawBody = await response.text().catch(() => response.statusText)
  const payload = parseOpenAIErrorPayload(rawBody)
  const providerError = payload?.error
  const message = formatMessage(
    operation,
    response.status,
    response.statusText,
    providerError,
    rawBody,
  )
  const headers = new Headers(response.headers)
  const requestId = headers.get('x-request-id')
  if (requestId && !headers.has('request-id')) headers.set('request-id', requestId)

  return APIError.generate(
    response.status,
    {
      error: {
        message,
        type: asString(providerError?.type),
        code: asString(providerError?.code),
        param: asString(providerError?.param),
      },
    },
    message,
    headers,
  )
}

export function createOpenAICompatibleStreamError(
  payload: OpenAIErrorPayload,
): APIError {
  const message = formatMessage(
    'streaming chat completion',
    undefined,
    undefined,
    payload.error,
    stringifyJson(payload),
  )
  return APIError.generate(undefined, payload, message, undefined)
}

export function isOpenAIErrorPayload(
  value: unknown,
): value is OpenAIErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    'error' in value &&
    !!(value as OpenAIErrorPayload).error
  )
}

function parseOpenAIErrorPayload(rawBody: string): OpenAIErrorPayload | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown
    return isOpenAIErrorPayload(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function formatMessage(
  operation: string,
  status: number | undefined,
  statusText: string | undefined,
  error: OpenAIErrorPayload['error'],
  rawBody: string,
): string {
  const providerMessage = asString(error?.message)
  const fallback = truncate(rawBody.trim()) || statusText || 'Unknown provider error'
  const hint = errorHint(status, asString(error?.code))
  return `OpenAI-compatible ${operation} failed: ${providerMessage || fallback}${hint ? ` ${hint}` : ''}`
}

function errorHint(status: number | undefined, code: string | undefined): string {
  if (status === 401 || status === 403) {
    return 'Check the configured API key and provider permissions.'
  }
  if (status === 404) {
    return 'Check the base URL, /chat/completions path, and selected model.'
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return 'The provider reported a rate limit; retry later or lower concurrency.'
  }
  if (status === 408 || status === 409 || (status !== undefined && status >= 500)) {
    return 'This is usually transient; retrying may succeed.'
  }
  return ''
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function truncate(text: string): string {
  return text.length > 1_000 ? `${text.slice(0, 1_000)}...` : text
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
