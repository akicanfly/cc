import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  EFFORT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
} from 'src/constants/betas.js'
import type { VariantBlob } from 'src/utils/effort/variantTypes.js'

export type ThinkingTarget = 'anthropic_native' | 'openai_compatible'

export type LowerThinkingOptions = {
  model: string
  maxOutputTokens?: number
}

export type LoweredThinking = {
  thinking?: BetaMessageStreamParams['thinking']
  outputConfig?: Record<string, unknown>
  extraBodyParams?: Record<string, unknown>
  betas?: string[]
}

type AnthropicThinkingBlob = {
  type?: unknown
  budgetTokens?: unknown
  budget_tokens?: unknown
  display?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function lowerAnthropicThinking(
  options: LowerThinkingOptions,
  variantBlob: VariantBlob,
): LoweredThinking {
  const outputConfig: Record<string, unknown> = {}
  const betas: string[] = []
  const effort = asString(variantBlob.effort)

  if (effort) {
    outputConfig.effort = effort
    betas.push(EFFORT_BETA_HEADER)
  }

  const thinkingBlob = variantBlob.thinking as AnthropicThinkingBlob | undefined
  if (!thinkingBlob || typeof thinkingBlob !== 'object') {
    return {
      ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
      ...(betas.length ? { betas } : {}),
    }
  }

  const type = asString(thinkingBlob.type)
  if (type === 'adaptive') {
    const thinking: Record<string, unknown> = { type: 'adaptive' }
    const display = asString(thinkingBlob.display)
    if (display) thinking.display = display
    betas.push(INTERLEAVED_THINKING_BETA_HEADER)
    return {
      thinking: thinking as BetaMessageStreamParams['thinking'],
      ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
      betas,
    }
  }

  if (type === 'enabled') {
    const rawBudget = thinkingBlob.budgetTokens ?? thinkingBlob.budget_tokens
    if (typeof rawBudget !== 'number') {
      return {
        ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
        ...(betas.length ? { betas } : {}),
      }
    }
    const budget = options.maxOutputTokens
      ? Math.min(options.maxOutputTokens - 1, rawBudget)
      : rawBudget
    return {
      thinking: {
        type: 'enabled',
        budget_tokens: budget,
      } satisfies BetaMessageStreamParams['thinking'],
      ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
      ...(betas.length ? { betas } : {}),
    }
  }

  return {
    ...(Object.keys(outputConfig).length ? { outputConfig } : {}),
    ...(betas.length ? { betas } : {}),
  }
}

function lowerOpenAIThinking(variantBlob: VariantBlob): LoweredThinking {
  const reasoningEffort = asString(variantBlob.reasoningEffort)
  if (!reasoningEffort) return {}

  return {
    extraBodyParams: {
      reasoning_effort: reasoningEffort,
    },
  }
}

export function lowerThinking(
  options: LowerThinkingOptions,
  target: ThinkingTarget,
  variantBlob: VariantBlob | undefined,
): LoweredThinking {
  if (!variantBlob) return {}

  switch (target) {
    case 'anthropic_native':
      return lowerAnthropicThinking(options, variantBlob)
    case 'openai_compatible':
      return lowerOpenAIThinking(variantBlob)
  }
}
