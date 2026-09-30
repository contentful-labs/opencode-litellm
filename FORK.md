# Contentful fork: differences and migration

## Upstream baseline

Updated from v0.8.0 to upstream **1.4.1**, including subsequent documentation
and CI changes through [`782d349`](https://github.com/yuseferi/opencode-litellm/commit/782d34913a49315303c31ad8f2b307505a1d243a).
The merge preserves upstream history for future updates.

OpenCode 2 uses `Plugin.define`, provider transforms, live registry reloads,
and integration credential-switch events. The 1.4.1 fix reconciles providers
registered after setup and retries failed publication. OpenCode 1.18.29+
continues to use the legacy `server()` / config-hook entrypoint. Upstream
documents OpenCode 2.0.14+ support and tested the late-registration fix on 2.0.19.

## Required migration: configure the gateway

**The hard-coded Contentful gateway has been removed.** Configure the URL
before upgrading. Resolution is explicit provider URL, then `LITELLM_BASE_URL`,
then local port detection (4000, 8000, 8080). V2 plugin options can also supply
a URL; provider settings take precedence.

### Install this fork

The npm name `opencode-plugin-litellm` belongs to upstream. Installing it from
npm does not include our extra pricing or reasoning behavior. Keep your
existing fork installation, or clone this repository, run `npm ci` in it, and
point OpenCode V2 at the package directory, or V1 at `src/index.ts`, as below. Replace the
example path with your checkout. Update the checkout to receive fork updates.

### OpenCode 2

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///absolute/path/to/opencode-litellm"],
  "providers": {
    "litellm": {
      "name": "Contentful AI Gateway",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://ai-gateway.contentful.tools/v1",
        "apiKey": "{env:LITELLM_API_KEY}"
      }
    }
  }
}
```

Supply credentials to the **background service**, not only the launching
terminal. For an environment-driven setup, after installing the fork:

```sh
opencode service set env LITELLM_BASE_URL https://ai-gateway.contentful.tools/v1
opencode service set env LITELLM_API_KEY YOUR_API_KEY
```

Use `opencode2` if that is your V2 executable name. Explicit provider settings
override the environment URL. Integration-managed credentials are resolved
through V2's connection API; the plugin does not read the V1 auth file on V2.

The public `$schema` URL still serves the V1 shape as of this update, so it can
flag valid V2 fields in editors. These examples follow the versioned
[V2 config](https://github.com/anomalyco/opencode/blob/v2.0.19/packages/schema/src/config.ts)
and [provider schema](https://github.com/anomalyco/opencode/blob/v2.0.19/packages/schema/src/config/provider.ts).

### OpenCode 1.18.29+

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-litellm/src/index.ts"],
  "provider": {
    "litellm": {
      "name": "Contentful AI Gateway",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://ai-gateway.contentful.tools/v1",
        "apiKey": "{env:LITELLM_API_KEY}"
      }
    }
  }
}
```

V1 auth precedence is provider option, environment key, then `/connect`'s
stored key. Both discovery and completion options receive the resolved key.

After updating the plugin or configuration, restart OpenCode (including the
V2 service) so the new code and environment are loaded.

## Retained fork patches

| Patch | Files | Why it remains / removal path |
|---|---|---|
| Tiered pricing | `src/plugin/pricing.ts`, shared enrichment/types, `src/plugin/v2.ts` | Bedrock Mantle can expose prices only in `*_above_Nk_tokens`. Use the lowest threshold when base pricing is absent; preserve input/output/cache prices and the >200k tier. V2 maps it to `cost[].tier = { type: "context", size: 200000 }`. Upstream currently copies only base pricing. Upstreaming this would remove the main functional divergence. |
| Reasoning fallback | `src/plugin/index.ts` | When no effort levels are reported, reasoning-capable models get minimal/low/medium/high/xhigh/max. Explicit proxy levels win. Could be removed after the gateway consistently publishes supported levels or engineers curate model variants. |
| Quiet console | `src/plugin/index.ts`, `src/plugin/v2.ts` | V1 may log through the OpenCode API. V2 does not print successful-operation messages; failures remain warnings. Remove once equivalent host logging behavior is confirmed. |
| Local V2 package entrypoint | `server.ts`, `package.json` | OpenCode 2.0.19 resolves local directories through a root `server`/`index` entry, not `package.json.main`. Provide `server.ts` and the `./server` export so the fork checkout loads. Suitable for upstreaming. |
| Refresh existing model metadata | `src/plugin/v2.ts` | Upstream retained old entries when a discovered ID remained present. Replace plugin-owned entries during reload so prices, limits, variants and capabilities refresh; curated IDs remain untouched. Suitable for upstreaming. |
| Cache migration | `src/utils/model-cache.ts` | Version 4 rejects upstream v1/v2 and prior fork v3 entries that lack the combined metadata. Both API paths share the config-level cache representation. |
| Organization maintenance | `renovate.json`, `package-lock.json` | Keep `local>contentful/renovate-config` and the fork's js-yaml 4.3.1 lockfile fix. |

### Already upstream; no separate patch needed

Our SWR cache work landed in upstream PR #19: atomic writes, seven-day expiry,
five-minute refresh throttle, timeout timer cleanup, and tracking only injected
IDs with key-presence checks. Upstream additionally scopes the cache to provider,
URL, filters, capability overrides and naming configuration.

### Pricing limitations retained from the fork

V1 represents only the >200k tier, so discovery preserves that tier rather than
arbitrary thresholds. A threshold-only price used as the base is an estimate;
LiteLLM's actual billing remains authoritative. Missing input/output sides of a
reported tier remain zero, as before. Unknown prices are omitted; explicit zero
prices remain zero. V2 now carries the same values instead of dropping the tier.

## Other breaking or visible changes

- V2 uses `plugins/providers/package/settings` rather than V1's
  `plugin/provider/npm/options`. V2 variants are arrays with `id` and `settings`;
  pricing uses cost entries with nested cache prices and optional context tiers.
- V2 local plugin references must point at the package directory, not a source
  file. V1's `src/index.ts` reference cannot be copied unchanged into V2.
- Upgrade older V1 clients to at least 1.18.29 before using the new entrypoint.
- Upstream 1.0 removed the exported `Transport`, `TransportPolicy`,
  `LiteLLMOptions`, and `ModelType` types and the unused transport builder files.
  Consumers importing these need to migrate. Named plugin exports remain.
- Our unused `DEFAULT_BASE_URL` utility constant was removed with the gateway
  default. Configure a URL rather than importing a company-specific constant.
- No capability metadata now means text-only. Set per-model
  `modelCapabilities.supports_vision` when a route actually accepts images.
- The first launch after this update performs cold discovery because cache keys
  and version changed. The proxy must be reachable to populate discovered models.
- V2 refreshes models in-process on new sessions (five-minute throttle); V1 sees
  refreshed cache entries on its next launch.
- Previous fork README claims about automatic `litellm-responses` routing were
  stale. That path was already inactive. This update does not newly remove it;
  discovery uses the single chat-completions provider. Configure gateway routing
  if a backend needs the Responses API.

## Verification

Run `npm run typecheck`, `npm test`, and `git diff --check`.
`test/fork-discovery.test.ts` exercises both plugin entrypoints against a real
loopback HTTP proxy, including tier-only/base/cache prices, reasoning fallback,
reported efforts, auth, URL environment resolution, and curated model preservation.
The upstream lifecycle tests cover late providers, reload retries, credential
switches, model removal and refresh. Fork coverage also checks metadata refresh
for a retained ID and invalidation of cache versions 1, 2 and 3.

Manual isolated CLI smoke checks for this update: OpenCode 1.18.33 discovered
the mock model with base pricing and all fallback variants; OpenCode 2.0.19
loaded the local package and completed a streaming chat request against the
mock proxy. It reported $0.000056 for 10 input tokens at $4/million plus two
output tokens at $8/million. These checks use synthetic data, not the company gateway.
