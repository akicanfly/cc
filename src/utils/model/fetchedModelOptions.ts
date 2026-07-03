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
        description: '',
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
