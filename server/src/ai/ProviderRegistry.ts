import { AiRuntimeError } from "./errors";
import type { AiProvider, ProviderId } from "./types";

/*
 * The seam that keeps vendor names out of the rest of the app.
 *
 * Adding a provider is: write the adapter, call `register()` in
 * providers/index.ts, add its models to the catalogue. No route,
 * no React component and no future Agent Builder changes.
 */

const registry = new Map<ProviderId, AiProvider>();

export function registerProvider(provider: AiProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: ProviderId): AiProvider {
  const provider = registry.get(id);

  if (!provider) {
    /*
     * Only reachable by resolving to a provider that was never
     * registered, which is a wiring mistake rather than anything
     * the caller did — so it must not leak as a 400 telling the
     * learner their request was bad.
     */
    throw new AiRuntimeError(
      "provider_not_configured",
      "The AI provider is unavailable. Please try again shortly.",
      { internalDetail: `Provider "${id}" is not registered.` }
    );
  }

  return provider;
}

export function listProviders(): AiProvider[] {
  return [...registry.values()];
}
