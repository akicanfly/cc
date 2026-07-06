export type OpenAIErrorPayload = {
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
    param?: unknown;
  };
};

type ParsedOpenAIError = {
  message: string;
  rawBody: string;
  type?: string;
  code?: string;
  param?: string;
};

type OpenAICompatibleErrorOptions = {
  operation: string;
  status?: number;
  statusText?: string;
  requestId?: string | null;
  parsedError: ParsedOpenAIError;
};

export class OpenAICompatibleError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly requestId?: string | null;
  readonly providerType?: string;
  readonly providerCode?: string;
  readonly providerParam?: string;
  readonly rawBody: string;
  readonly retryable: boolean;

  constructor(options: OpenAICompatibleErrorOptions) {
    super(formatOpenAICompatibleError(options));
    this.name = "OpenAICompatibleError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.requestId = options.requestId;
    this.providerType = options.parsedError.type;
    this.providerCode = options.parsedError.code;
    this.providerParam = options.parsedError.param;
    this.rawBody = options.parsedError.rawBody;
    this.retryable = isRetryableOpenAICompatibleError(
      options.status,
      options.parsedError.code,
    );
  }
}

export async function createOpenAICompatibleResponseError(
  response: Response,
  operation: string,
): Promise<OpenAICompatibleError> {
  const rawBody = await response.text().catch(() => response.statusText);
  return new OpenAICompatibleError({
    operation,
    status: response.status,
    statusText: response.statusText,
    requestId: response.headers.get("x-request-id"),
    parsedError: parseOpenAIErrorBody(rawBody || response.statusText),
  });
}

export function createOpenAICompatibleStreamError(
  payload: OpenAIErrorPayload,
): OpenAICompatibleError {
  return new OpenAICompatibleError({
    operation: "streaming chat completion",
    parsedError: parseOpenAIErrorBody(stringifyJson(payload), payload),
  });
}

export function isOpenAIErrorPayload(
  value: unknown,
): value is OpenAIErrorPayload {
  return (
    !!value &&
    typeof value === "object" &&
    "error" in value &&
    !!(value as OpenAIErrorPayload).error
  );
}

function parseOpenAIErrorBody(
  rawBody: string,
  parsedPayload?: OpenAIErrorPayload,
): ParsedOpenAIError {
  const sanitized = truncateErrorBody(rawBody.trim());
  const payload = parsedPayload ?? parseOpenAIErrorPayload(rawBody);
  const error = payload?.error;
  const message =
    (asNonEmptyString(error?.message) ?? sanitized) || "Unknown provider error";

  return {
    message,
    rawBody: sanitized,
    type: asNonEmptyString(error?.type),
    code: asNonEmptyString(error?.code),
    param: asNonEmptyString(error?.param),
  };
}

function parseOpenAIErrorPayload(
  rawBody: string,
): OpenAIErrorPayload | undefined {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isOpenAIErrorPayload(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function formatOpenAICompatibleError(
  options: OpenAICompatibleErrorOptions,
): string {
  const details: string[] = [];
  if (options.status !== undefined)
    details.push(
      `status ${options.status}${options.statusText ? ` ${options.statusText}` : ""}`,
    );
  if (options.parsedError.type)
    details.push(`type ${options.parsedError.type}`);
  if (options.parsedError.code)
    details.push(`code ${options.parsedError.code}`);
  if (options.parsedError.param)
    details.push(`param ${options.parsedError.param}`);
  if (options.requestId) details.push(`request ${options.requestId}`);

  const hint = openAICompatibleErrorHint(
    options.status,
    options.parsedError.code,
  );
  const suffix = details.length ? ` (${details.join(", ")})` : "";
  return `OpenAI-compatible ${options.operation} failed${suffix}: ${options.parsedError.message}${hint ? ` ${hint}` : ""}`;
}

function openAICompatibleErrorHint(
  status: number | undefined,
  code: string | undefined,
): string {
  if (status === 401 || status === 403)
    return "Check the configured API key and provider permissions.";
  if (status === 404)
    return "Check OPENAI_COMPATIBLE_BASE_URL, the /chat/completions path, and the selected model name.";
  if (status === 429)
    return "The provider reported a rate limit or quota issue; retry later or lower request concurrency.";
  if (status === 408 || status === 502 || status === 503 || status === 504)
    return "This is usually transient; retrying may succeed.";
  if (status !== undefined && status >= 500)
    return "The provider returned a server error; retrying may succeed.";
  if (code === "rate_limit_exceeded" || code === "insufficient_quota")
    return "The provider reported a rate limit or quota issue.";
  return "";
}

function isRetryableOpenAICompatibleError(
  status: number | undefined,
  code: string | undefined,
): boolean {
  if (status === 408 || status === 409 || status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return code === "rate_limit_exceeded";
}

function truncateErrorBody(text: string): string {
  return text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
