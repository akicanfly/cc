import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import envPaths from 'env-paths'
import { join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import { lazySchema } from '../lazySchema.js'
import { isEssentialTrafficOnly } from '../privacyLevel.js'
import { jsonStringify } from '../slowOperations.js'

// Cache lives in the OS user cache dir for the claude-cli app, not the
// per-project cache dir used for logs. The catalog is global metadata
// (one entry per model across all providers), so a per-project key would
// fragment the cache without buying anything.
const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_FILENAME = 'models-dev-catalog.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const REFRESH_TIMEOUT_MS = 10_000

// Hard cap on the substring scan so a long cache file can't make lookups
// block. In practice the longest hit is found in the first ~5% of the
// index; the cap is a safety belt, not a hot path.
const MAX_SUBSTRING_SCAN = 5_000

// Zod schema for a single provider entry from models.dev/api.json.
// We accept-and-strip unknown fields to stay forward-compatible — models.dev
// adds new fields regularly and we don't want to break the cache load when
// they do. We only consume the fields below.
const ReasoningOptionSchema = lazySchema(() =>
  z
    .object({
      type: z.string().optional(),
      values: z.array(z.string()).optional(),
    })
    .strip(),
)

const ProviderModelSchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
      attachment: z.boolean().optional(),
      reasoning: z.boolean().optional(),
      reasoning_options: z.array(ReasoningOptionSchema()).optional(),
      tool_call: z.boolean().optional(),
      modalities: z
        .object({
          input: z.array(z.string()).optional(),
          output: z.array(z.string()).optional(),
        })
        .optional(),
      limit: z
        .object({
          context: z.number().optional(),
          output: z.number().optional(),
        })
        .optional(),
    })
    .strip(),
)

const ProviderEntrySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      name: z.string().optional(),
      models: z.record(z.string(), ProviderModelSchema()).optional(),
    })
    .strip(),
)

const CatalogFileSchema = lazySchema(() =>
  z.object({
    entries: z.array(
      z.object({
        id: z.string(),
        providerId: z.string(),
        normalized: z.string(),
        name: z.string().nullable(),
        contextWindow: z.number().nullable(),
        maxOutput: z.number().nullable(),
        supportsImage: z.boolean().nullable(),
        supportsToolCall: z.boolean().nullable(),
        isReasoning: z.boolean().nullable(),
        reasoningOptions: z.array(z.string()),
      }),
    ),
    timestamp: z.number(),
  }),
)

export type ModelDevEntry = {
  id: string
  providerId: string
  normalized: string
  name: string | null
  contextWindow: number | null
  maxOutput: number | null
  supportsImage: boolean | null
  supportsToolCall: boolean | null
  isReasoning: boolean | null
  reasoningOptions: string[]
}

let refreshPromise: Promise<void> | undefined

function getCacheDir(): string {
  // envPaths('claude-cli') honours XDG_CACHE_HOME on Linux, ~/Library/Caches
  // on macOS, %LOCALAPPDATA% on Windows. The project-local cachePaths.ts uses
  // the same helper but appends a per-cwd hash; we deliberately don't.
  return join(envPaths('claude-cli').cache, getClaudeConfigHomeDir())
}

function getCachePath(): string {
  return join(getCacheDir(), CACHE_FILENAME)
}

// Strip the bracketed suffix used by aggregators (e.g. "-[Openrouter]",
// "-free"), drop a trailing ":variant" (OpenRouter style), and lowercase.
// Result is the key we store/lookup against. Original id is kept alongside
// for debugging and provider attribution.
function normalizeModelId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:[a-z0-9_-]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function toEntry(
  providerId: string,
  model: z.infer<ReturnType<typeof ProviderModelSchema>>,
): ModelDevEntry {
  // Tri-state vision signal:
  //   true  -> attachment === true OR modalities.input includes 'image'
  //   false -> attachment === false AND modalities does not include 'image'
  //   null  -> no signal either way; leave to server
  const inputModalities = model.modalities?.input ?? []
  const attachmentSupportsImages = model.attachment === true
  const modalitiesSupportsImages =
    inputModalities.length > 0 && inputModalities.includes('image')
  const attachmentDeniesImages = model.attachment === false
  let supportsImage: boolean | null
  if (attachmentSupportsImages || modalitiesSupportsImages) supportsImage = true
  else if (attachmentDeniesImages || inputModalities.length > 0) supportsImage = false
  else supportsImage = null

  // reasoning_options is shaped like [{type, values: string[]}, ...] in
  // models.dev. Flatten to a single string[] so consumers don't have to
  // know the wrapper shape. We only keep string values; non-string
  // entries (rare) are dropped.
  const reasoningOptions: string[] = []
  for (const opt of model.reasoning_options ?? []) {
    if (Array.isArray(opt.values)) {
      for (const v of opt.values) {
        if (typeof v === 'string') reasoningOptions.push(v)
      }
    }
  }

  return {
    id: model.id,
    providerId,
    normalized: normalizeModelId(model.id),
    name: model.name ?? null,
    contextWindow: model.limit?.context ?? null,
    maxOutput: model.limit?.output ?? null,
    supportsImage,
    supportsToolCall: model.tool_call ?? null,
    isReasoning: model.reasoning ?? null,
    reasoningOptions,
  }
}

function parseCatalog(raw: unknown): ModelDevEntry[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const providers = raw as Record<string, unknown>
  const entries: ModelDevEntry[] = []
  for (const provider of Object.values(providers)) {
    const parsedProvider = ProviderEntrySchema().safeParse(provider)
    if (!parsedProvider.success) continue
    const { id: providerId, models } = parsedProvider.data
    if (!models) continue
    for (const model of Object.values(models)) {
      const parsedModel = ProviderModelSchema().safeParse(model)
      if (!parsedModel.success) continue
      entries.push(toEntry(providerId, parsedModel.data))
    }
  }
  return entries
}

function readCacheSync(path: string): { entries: ModelDevEntry[]; timestamp: number } | null {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- called from sync lookup; same pattern as modelCapabilities
    const raw = readFileSync(path, 'utf-8')
    const parsed = CacheFileSchema().safeParse(safeParseJSON(raw, false))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// In-memory snapshot of the on-disk cache. Refreshed by refreshModelsDevCatalog,
// read by getModelDevEntry. We hold the parsed entries in memory so the
// request path never touches the filesystem. Sorted longest-normalized-first
// so the substring scan exits early on common matches.
let inMemory: { entries: ModelDevEntry[]; byNormalized: Map<string, ModelDevEntry> } | undefined

function rebuildIndex(entries: ModelDevEntry[]): { entries: ModelDevEntry[]; byNormalized: Map<string, ModelDevEntry> } {
  const sorted = [...entries].sort((a, b) => b.normalized.length - a.normalized.length)
  const byNormalized = new Map<string, ModelDevEntry>()
  for (const e of sorted) {
    // If two providers share an id (rare but possible), keep the first seen.
    if (!byNormalized.has(e.normalized)) byNormalized.set(e.normalized, e)
  }
  return { entries: sorted, byNormalized }
}

function loadFromDisk(): { entries: ModelDevEntry[]; timestamp: number } | null {
  return readCacheSync(getCachePath())
}

async function fetchAndCache(): Promise<void> {
  if (isEssentialTrafficOnly()) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
  try {
    const response = await fetch(MODELS_DEV_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'claude-code/modelsdev-catalog',
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      logForDebugging(`[modelsDevCatalog] fetch failed: status ${response.status}`)
      return
    }
    const raw = (await response.json()) as unknown
    const entries = parseCatalog(raw)
    if (entries.length === 0) {
      logForDebugging('[modelsDevCatalog] fetch returned no entries, keeping existing cache')
      return
    }

    const dir = getCacheDir()
    await mkdir(dir, { recursive: true })
    const payload = { entries, timestamp: Date.now() }
    await writeFile(getCachePath(), jsonStringify(payload), {
      encoding: 'utf-8',
      mode: 0o600,
    })
    inMemory = rebuildIndex(entries)
    logForDebugging(`[modelsDevCatalog] cached ${entries.length} models from ${MODELS_DEV_URL}`)
  } catch (error) {
    logForDebugging(
      `[modelsDevCatalog] refresh failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fire-and-forget background refresh. Idempotent: concurrent callers share
 * a single in-flight promise. Callers (e.g. fetchedModelOptions) trigger
 * this on startup; the next /models request will already see an in-memory
 * index if the fetch finished.
 */
export function refreshModelsDevCatalog(): Promise<void> {
  if (isEssentialTrafficOnly()) return Promise.resolve()
  refreshPromise ??= fetchAndCache().finally(() => {
    // Allow a future refresh after a long-lived process (e.g. 24h later).
    // We don't add a timer here — callers can re-invoke after the TTL.
    refreshPromise = undefined
  })
  return refreshPromise
}

/**
 * Synchronous lookup. Returns the catalog entry for a model id, or undefined
 * if not found. Safe to call on every request — reads only the in-memory
 * index, no filesystem I/O.
 *
 * Match order:
 *  1. Exact normalized id.
 *  2. Normalized id with bracketed suffix stripped (e.g. "z-ai/glm-5.2-[Openrouter]"
 *     -> "z-ai/glm-5.2").
 *  3. Longest-suffix containment: the catalog entry whose normalized id is
 *     the longest substring of the query. Capped at MAX_SUBSTRING_SCAN.
 */
export function getModelDevEntry(model: string): ModelDevEntry | undefined {
  if (!inMemory) {
    const fromDisk = loadFromDisk()
    if (fromDisk) inMemory = rebuildIndex(fromDisk.entries)
  }
  if (!inMemory) return undefined

  const normalized = normalizeModelId(model)
  if (!normalized) return undefined

  const exact = inMemory.byNormalized.get(normalized)
  if (exact) return exact

  // Substring fallback. We walk entries sorted longest-normalized-first,
  // bounded by MAX_SUBSTRING_SCAN, and return the first hit. For
  // "z-ai/glm-5.2-[Openrouter]" the catalog id "z-ai/glm-5.2" matches
  // before any shorter entry gets a chance.
  let scanned = 0
  for (const entry of inMemory.entries) {
    if (++scanned > MAX_SUBSTRING_SCAN) break
    if (normalized.includes(entry.normalized)) return entry
  }
  return undefined
}

/**
 * Test/diagnostic helper. Forces a refresh and waits for it. Not used in
 * production paths.
 */
export async function _forceRefreshModelsDevCatalog(): Promise<void> {
  refreshPromise = undefined
  await fetchAndCache()
}

/**
 * Read-only accessor for the in-memory index. Returns an empty array if
 * the cache hasn't been loaded yet. Used by the model picker to enrich
 * labels for the full model list at startup.
 */
export function listAllModelDevEntries(): ModelDevEntry[] {
  if (!inMemory) {
    const fromDisk = loadFromDisk()
    if (fromDisk) inMemory = rebuildIndex(fromDisk.entries)
  }
  return inMemory?.entries ?? []
}
