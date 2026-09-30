import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@opencode/plugin/promise/plugin'
import plugin from '../src'

const ladder = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const metadata = {
  'tier-only': {
    input_cost_per_token_above_128k_tokens: 0.000002,
    input_cost_per_token_above_200k_tokens: 0.000004,
    output_cost_per_token_above_200k_tokens: 0.000008,
    cache_read_input_token_cost_above_200k_tokens: 0.000001,
    cache_creation_input_token_cost_above_200k_tokens: 0.000003,
    supports_reasoning: true,
  },
  'base-and-tier': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_read_input_token_cost: 0.000001,
    cache_creation_input_token_cost: 0.000002,
    input_cost_per_token_above_200k_tokens: 0.000006,
    output_cost_per_token_above_200k_tokens: 0.000030,
    supports_reasoning: true,
    supports_high_reasoning_effort: true,
  },
  'openai/gpt-5.4': {},
  'o3-mini': {},
  'response-alias': { mode: 'responses' },
  'unknown-price': {},
  'free': { input_cost_per_token: 0, output_cost_per_token: 0 },
  'curated': { input_cost_per_token: 0.001 },
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('fork discovery against a real HTTP proxy', () => {
  it.each(['v1', 'v2'])('preserves pricing, variants, auth and curated entries on %s', async (version) => {
    const cache = mkdtempSync(join(tmpdir(), 'litellm-fork-test-'))
    vi.stubEnv('XDG_CACHE_HOME', cache)
    vi.stubEnv('LITELLM_API_KEY', '')
    vi.stubEnv('LITELLM_MASTER_KEY', '')
    const requests: string[] = []
    const consoleLog = vi.spyOn(console, 'log')
    const server = createServer((req, res) => {
      requests.push(req.url ?? '')
      if (req.headers.authorization !== 'Bearer example-fork-key' || req.headers['x-gateway'] !== 'example') {
        res.writeHead(401).end()
        return
      }
      const data = req.url === '/v1/model/info'
        ? Object.entries(metadata).map(([model_name, model_info]) => ({ model_name, model_info }))
        : Object.keys(metadata).map((id) => ({ id, object: 'model' }))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const baseURL = `http://127.0.0.1:${address.port}/v1`
    vi.stubEnv('LITELLM_BASE_URL', baseURL)
    const options = { apiKey: 'example-fork-key', customHeaders: { 'X-Gateway': 'example' } }
    let models: Record<string, any> = { curated: { id: 'curated', name: 'Keep me' } }
    let cleanup: (() => unknown) | void = undefined
    try {
      if (version === 'v1') {
        const hooks = await plugin.server({ client: { app: { log: vi.fn(async () => {}) } } } as never)
        const config = { provider: { litellm: { options: { ...options }, models } } }
        await hooks.config?.(config as never)
        expect(config.provider.litellm.options).toMatchObject({ baseURL })
        const count = requests.length
        await hooks.config?.(config as never)
        expect(requests).toHaveLength(count)
      } else {
        const provider = { id: 'litellm', name: 'Test', settings: options }
        cleanup = await plugin.setup({
          options: {},
          provider: {
            list: async () => ({ data: [provider] }),
            transform: async (transform: (editor: unknown) => void) => {
              transform({
                get: () => ({ provider, models: new Map(Object.entries(models)) }),
                update: (_id: string, update: (value: unknown) => void) => update(provider),
                models: { set: (_id: string, entries: any[]) => {
                  models = Object.fromEntries(entries.map((entry) => [entry.id, entry]))
                } },
              })
              return { dispose: async () => {} }
            },
            reload: async () => {},
          },
          event: { subscribe: () => (async function* () {})() },
        } as unknown as Context)
        expect(provider.settings).toMatchObject({ baseURL, apiKey: options.apiKey })
      }
      expect(requests).toContain('/v1/model/info')
      expect(models.curated.name).toBe('Keep me')
      const efforts = (id: string) => version === 'v1'
        ? Object.keys(models[id].variants ?? {})
        : models[id].variants.map((variant: { id: string }) => variant.id)
      for (const id of ['tier-only', 'openai/gpt-5.4', 'o3-mini', 'response-alias']) {
        expect(efforts(id)).toEqual(ladder)
      }
      expect(efforts('base-and-tier')).toEqual(['high'])
      expect(efforts('unknown-price')).toEqual([])
      if (version === 'v1') {
        expect(models['tier-only'].cost).toEqual({
          input: 2, output: 8, cache_read: 1, cache_write: 3,
          context_over_200k: { input: 4, output: 8, cache_read: 1, cache_write: 3 },
        })
        expect(models['base-and-tier'].cost).toEqual({
          input: 3, output: 15, cache_read: 1, cache_write: 2,
          context_over_200k: { input: 6, output: 30 },
        })
        expect(models['unknown-price'].cost).toBeUndefined()
        expect(models.free.cost).toEqual({ input: 0, output: 0 })
      } else {
        expect(models['tier-only'].cost).toEqual([
          { input: 2, output: 8, cache: { read: 1, write: 3 } },
          { tier: { type: 'context', size: 200000 }, input: 4, output: 8, cache: { read: 1, write: 3 } },
        ])
        expect(models['base-and-tier'].cost).toEqual([
          { input: 3, output: 15, cache: { read: 1, write: 2 } },
          { tier: { type: 'context', size: 200000 }, input: 6, output: 30, cache: { read: 0, write: 0 } },
        ])
        expect(models['unknown-price'].cost).toEqual([])
        expect(models.free.cost).toEqual([{ input: 0, output: 0, cache: { read: 0, write: 0 } }])
      }
      expect(consoleLog).not.toHaveBeenCalled()
    } finally {
      await cleanup?.()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      rmSync(cache, { recursive: true, force: true })
    }
  })
})
