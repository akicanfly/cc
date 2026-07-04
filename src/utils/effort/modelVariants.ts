import { getAPIProvider, type APIProvider } from '../model/providers.js'
import type { VariantBlob, VariantID, VariantTable } from './variantTypes.js'

const OPENAI_REASONING_VARIANTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly VariantID[]

const LEGACY_CLAUDE_HIGH_BUDGET = 16_000
const LEGACY_CLAUDE_MAX_BUDGET = 31_999

function normalizeModel(model: string): string {
  return model.toLowerCase()
}

function openAICompatibleVariants(): VariantTable {
  return Object.fromEntries(
    OPENAI_REASONING_VARIANTS.map(variant => [
      variant,
      {
        reasoningEffort: variant,
      } satisfies VariantBlob,
    ]),
  ) as VariantTable
}

function legacyClaudeBudgetVariants(): VariantTable {
  return {
    high: {
      thinking: { type: 'enabled', budgetTokens: LEGACY_CLAUDE_HIGH_BUDGET },
    },
    max: {
      thinking: { type: 'enabled', budgetTokens: LEGACY_CLAUDE_MAX_BUDGET },
    },
  }
}

function opus45Variants(): VariantTable {
  return {
    low: { effort: 'low' },
    medium: { effort: 'medium' },
    high: { effort: 'high' },
    max: { effort: 'max' },
  }
}

function adaptiveClaudeVariants(model: string): VariantTable {
  const variants: VariantID[] = normalizeModel(model).includes('opus-4-7')
    ? ['low', 'medium', 'high', 'xhigh', 'max']
    : ['low', 'medium', 'high', 'max']

  return Object.fromEntries(
    variants.map(variant => [
      variant,
      {
        thinking: { type: 'adaptive' },
        effort: variant,
      } satisfies VariantBlob,
    ]),
  ) as VariantTable
}

export function getModelVariants(
  model: string,
  provider: APIProvider = getAPIProvider(),
): VariantTable {
  // Claude Code's OpenAI-compatible adapter routes arbitrary model IDs through
  // Chat Completions, whose native reasoning knob is `reasoning_effort`.
  if (process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL) {
    return openAICompatibleVariants()
  }

  const normalized = normalizeModel(model)

  // 3P Claude providers still use Anthropic-shaped request bodies in this codebase.
  if (provider !== 'firstParty' && provider !== 'bedrock' && provider !== 'vertex' && provider !== 'foundry') {
    return {}
  }

  if (normalized.includes('claude-3-') && !normalized.includes('claude-3-7')) {
    return {}
  }

  if (normalized.includes('opus-4-6') || normalized.includes('sonnet-4-6')) {
    return adaptiveClaudeVariants(model)
  }

  if (normalized.includes('opus-4-5')) {
    return opus45Variants()
  }

  if (
    normalized.includes('claude-sonnet-4') ||
    normalized.includes('claude-opus-4') ||
    normalized.includes('claude-3-7-sonnet')
  ) {
    return legacyClaudeBudgetVariants()
  }

  return {}
}

export function getVariantBlob(
  model: string,
  variant: VariantID | undefined,
  provider: APIProvider = getAPIProvider(),
): VariantBlob | undefined {
  if (variant === undefined) return undefined
  return getModelVariants(model, provider)[variant]
}
