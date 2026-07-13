import { OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getAnthropicClient } from '../../services/api/client.js'
import {
  isOpenAICompatibleEnabled,
  listOpenAICompatibleModels,
} from '../../services/api/openaiCompatible.js'
import { isClaudeAISubscriber } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { isModelAllowed } from './modelAllowlist.js'
import type { ModelOption } from './modelOptions.js'
import { getModelDevEntry, refreshModelsDevCatalog } from './modelsDevCatalog.js'

let fetchedModelOptionsPromise: Promise<ModelOption[]> | undefined

async function listAnthropicModels(): Promise<string[]> {
  const anthropic = await getAnthropicClient({ maxRetries: 1 })
  const betas = isClaudeAISubscriber() ? [OAUTH_BETA_HEADER] : undefined
  const ids: string[] = []
  for await (const model of anthropic.models.list({ betas })) {
    if (model.id) ids.push(model.id)
  }
  return ids
}

export function getFetchedModelOptions(): Promise<ModelOption[]> {
  fetchedModelOptionsPromise ??= fetchModelOptions()
  return fetchedModelOptionsPromise
}

async function fetchModelOptions(): Promise<ModelOption[]> {
  try {
    // Fire-and-forget: warm the models.dev catalog in the background so the
    // first /models request can already use enrichment. Not awaited so the
    // model picker is not blocked on a network round-trip. Failures are
    // swallowed inside refreshModelsDevCatalog; on a cold cache with no
    // network, the picker just shows id-only options.
    if (isOpenAICompatibleEnabled()) {
      void refreshModelsDevCatalog()
    }

    const ids = isOpenAICompatibleEnabled()
      ? await listOpenAICompatibleModels()
      : await listAnthropicModels()

    const seen = new Set<string>()
    const options: ModelOption[] = []
    for (const id of ids) {
      if (seen.has(id) || !isModelAllowed(id)) continue
      seen.add(id)
      options.push({
        value: id,
        label: id,
        description: describeWithCatalog(id),
      })
    }

    return options.sort((a, b) =>
      String(a.value).localeCompare(String(b.value)),
    )
  } catch (error) {
    logForDebugging(
      `[modelOptions] fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
    return []
  }
}

function describeWithCatalog(modelId: string): string {
  const dev = getModelDevEntry(modelId)
  if (!dev) return ''
  const parts: string[] = []
  if (dev.name && dev.name !== modelId) parts.push(dev.name)
  if (dev.contextWindow) {
    const ctx =
      dev.contextWindow >= 1_000_000
        ? `${(dev.contextWindow / 1_000_000).toFixed(dev.contextWindow % 1_000_000 === 0 ? 0 : 1)}M`
        : `${Math.round(dev.contextWindow / 1000)}k`
    parts.push(`${ctx} context`)
  }
  const caps: string[] = []
  if (dev.supportsImage === true) caps.push('vision')
  if (dev.isReasoning === true) caps.push('reasoning')
  if (dev.supportsToolCall === false) caps.push('no tools')
  if (caps.length) parts.push(caps.join(', '))
  return parts.join(' · ')
}
