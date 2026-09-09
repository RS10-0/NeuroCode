import { searchChainIds, searchProviderId } from "../ai/config";
import { AiRuntimeError } from "../ai/errors";
import type { SearchProvider, SearchProviderId } from "./types";

/*
 * The seam that keeps search vendors out of the rest of the app.
 *
 * Deliberately the same shape as ai/ProviderRegistry.ts. Adding
 * a search provider is: write the adapter, call `register()` in
 * providers/index.ts, name it in an environment variable. No
 * route, no runtime change, no React component.
 */

const registry = new Map<SearchProviderId, SearchProvider>();

export function registerSearchProvider(provider: SearchProvider): void {
  registry.set(provider.id, provider);
}

export function getSearchProvider(id: SearchProviderId): SearchProvider {
  const provider = registry.get(id);

  if (!provider) {
    /*
     * Only reachable by naming a provider that was never
     * registered, which is a wiring mistake rather than
     * anything a learner did.
     */
    throw new AiRuntimeError(
      "provider_not_configured",
      "Web search is unavailable. Please try again shortly.",
      { internalDetail: `Search provider "${id}" is not registered.` }
    );
  }

  return provider;
}

/*
 * The provider that actually answers, after configuration has
 * been reconciled with reality.
 *
 * A configured provider whose key is missing falls back to the
 * mock rather than failing, which is the same decision
 * PowerSourceResolver makes about the platform model provider
 * and it is made for the same reason: a capability that a
 * learner has switched on should degrade to something honest
 * and offline, not to a red box they cannot act on. The startup
 * diagnostic says loudly which of the two is happening.
 */
export function activeSearchProvider(): SearchProvider {
  const configured = getSearchProvider(searchProviderId);

  return configured.isConfigured() ? configured : getSearchProvider("mock");
}

/*
 * Every provider that may be asked, in the order to ask them.
 *
 * The chain exists because a free search tier is an allowance,
 * and an allowance runs out. When Tavily's month is spent it
 * answers 429 — and a search that fails does not fail the run:
 * the agent answers from training data instead, fluently and
 * with no idea it is doing so. Falling through to DuckDuckGo
 * gives a worse answer than Tavily and a far better one than
 * an invented one.
 *
 * Only entries that can actually answer are returned, so the
 * caller's loop never has to ask "is this one real". An entry
 * whose key is missing is dropped here rather than attempted
 * and failed, which is what keeps a missing key costing zero
 * round trips — the same promise `isConfigured` makes in the
 * single-provider path.
 *
 * An empty result falls back to the mock for the reason
 * `activeSearchProvider` does: a learner who switched this
 * capability on should get something honest and offline rather
 * than an error they cannot act on.
 */
export function searchChain(): SearchProvider[] {
  const chain: SearchProvider[] = [];

  for (const id of searchChainIds) {
    const provider = getSearchProvider(id);

    if (provider.isConfigured()) {
      chain.push(provider);
    }
  }

  return chain.length > 0 ? chain : [getSearchProvider("mock")];
}
