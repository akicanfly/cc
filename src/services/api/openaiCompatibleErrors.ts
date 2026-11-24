import { APIError } from '@anthropic-ai/sdk/error'

export type OpenAIErrorPayload = {
  error?: {
    message?: unknown
    type?: unknown
    code?: unknown
    param?: unknown
    upstream?: { message?: unknown }
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
  headers.set('x-ccc-provider-error', 'true')
  const requestId = headers.get('x-request-id')
  if (requestId && !headers.has('request-id')) headers.set('request-id', requestId)

  return APIError.generate(
    response.status,
    {
      error: {
        ...providerError,
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
  return APIError.generate(payloadErrorStatus(payload.error), payload, message, new Headers({ 'x-ccc-provider-error': 'true' }))
}

export function createOpenAICompatiblePayloadError(
  payload: Record<string, unknown>, headers: Headers, operation = 'provider response',
): APIError {
  const base = payload.base_resp as { status_code?: unknown; status_msg?: unknown } | undefined
  const raw = payload.error
  const error = raw && typeof raw === 'object' ? raw as Record<string, unknown>
    : { message: typeof raw === 'string' ? raw : base?.status_msg, code: base?.status_code }
  const status = payloadErrorStatus(error)
  const message = formatMessage(operation, status, undefined, error, stringifyJson(payload))
  const normalizedHeaders = new Headers(headers)
  normalizedHeaders.set('x-ccc-provider-error', 'true')
  if (!normalizedHeaders.has('request-id') && normalizedHeaders.has('x-request-id')) normalizedHeaders.set('request-id', normalizedHeaders.get('x-request-id')!)
  return APIError.generate(status, { error: { ...error, message } }, message, normalizedHeaders)
}

function payloadErrorStatus(error: Record<string, unknown> | undefined): number {
  for (const value of [error?.status, error?.status_code, error?.code]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) return value
  }
  const statuses: Record<string, number> = {
    authentication_error: 401, invalid_api_key: 401, invalid_authentication: 401, unauthenticated: 401,
    permission_error: 403, permission_denied: 403, access_denied: 403,
    not_found_error: 404, model_not_found: 404, not_found: 404,
    rate_limit_error: 429, rate_limit_exceeded: 429, insufficient_quota: 429, resource_exhausted: 429,
    insufficient_balance: 402, insufficient_credits: 402, payment_required: 402,
    invalid_request_error: 400, invalid_argument: 400, context_length_exceeded: 400,
    overloaded_error: 529, server_error: 500, internal_error: 500, internal: 500,
    service_unavailable: 503, unavailable: 503, deadline_exceeded: 408,
  }
  for (const value of [error?.code, error?.type, error?.status]) {
    if (typeof value === 'string' && statuses[value.toLowerCase()] !== undefined) return statuses[value.toLowerCase()]!
  }
  const message = asString(error?.message) ?? ''
  if (/invalid (?:api[ -]?)?key|bad key|authentication failed|unauthorized/i.test(message)) return 401
  if (/rate limit|too many requests|quota exceeded/i.test(message)) return 429
  // An unknown error envelope is not evidence of a transient server failure.
  return 400
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
    if (!parsed || typeof parsed !== 'object') return undefined
    const value = parsed as Record<string, unknown>
    if (typeof value.error === 'string') return { error: { message: value.error } }
    if (isOpenAIErrorPayload(parsed)) return parsed
    if (typeof value.message === 'string') return { error: { message: value.message } }
    return undefined
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
  const hint = errorHint(status, asString(error?.code), providerMessage ?? rawBody)
  const param = asString(error?.param)
  const upstream = upstreamMessage(error?.upstream?.message)
  return `OpenAI-compatible ${operation} failed: ${providerMessage || fallback}${upstream ? ` Upstream: ${upstream}` : ''}${param ? ` Parameter: ${param}.` : ''}${hint ? ` ${hint}` : ''}`
}

function upstreamMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return
  try {
    const nested = JSON.parse(raw) as { error?: { message?: unknown }; message?: unknown }
    return truncate(asString(nested?.error?.message) ?? asString(nested?.message) ?? raw)
  } catch {
    return truncate(raw)
  }
}

function errorHint(status: number | undefined, code: string | undefined, body: string): string {
  if (body.includes('MissingSessionID')) {
    return 'The Zen free tier needs an x-opencode-session header. It is sent automatically; if you set OPENAI_COMPATIBLE_HEADERS manually, include x-opencode-session.'
  }
  if (status === 401 || status === 403) {
    return 'Check the configured API key and provider permissions.'
  }
  if (status === 404) {
    return 'Check the base URL, /chat/completions or /responses path, and selected model.'
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
