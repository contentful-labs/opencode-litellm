import type { LiteLLMModel } from '../types'

type PriceField = 'input_cost_per_token' | 'output_cost_per_token' |
  'cache_read_input_token_cost' | 'cache_creation_input_token_cost'

interface Cost {
  input: number
  output: number
  cache_read?: number
  cache_write?: number
  context_over_200k?: Cost
}

// LiteLLM reports USD/token; both OpenCode APIs use USD/million tokens.
const PER_MILLION = 1_000_000

function pricePerToken(model: LiteLLMModel, field: PriceField): number | undefined {
  if (typeof model[field] === 'number') return model[field]
  // Bedrock Mantle can report only context-tier prices. Use the lowest
  // threshold's price rather than treating the model as free.
  const pattern = new RegExp(`^${field}_above_(\\d+)k_tokens$`)
  return Object.entries(model)
    .flatMap(([key, value]) => {
      const match = key.match(pattern)
      return match && typeof value === 'number'
        ? [{ threshold: Number(match[1]), price: value }]
        : []
    })
    .sort((a, b) => a.threshold - b.threshold)[0]?.price
}

function costs(read: (field: PriceField) => number | undefined): Cost | undefined {
  const input = read('input_cost_per_token')
  const output = read('output_cost_per_token')
  if (input == null && output == null) return undefined
  const cacheRead = read('cache_read_input_token_cost')
  const cacheWrite = read('cache_creation_input_token_cost')
  return {
    input: (input ?? 0) * PER_MILLION,
    output: (output ?? 0) * PER_MILLION,
    ...(cacheRead != null && { cache_read: cacheRead * PER_MILLION }),
    ...(cacheWrite != null && { cache_write: cacheWrite * PER_MILLION }),
  }
}

/** Preserve the fork's V1 cost representation for shared discovery/cache. */
export function modelCost(model: LiteLLMModel): Cost | undefined {
  const base = costs((field) => pricePerToken(model, field))
  if (!base) return undefined
  const tier = costs((field) => model[`${field}_above_200k_tokens`])
  if (tier) base.context_over_200k = tier
  return base
}
