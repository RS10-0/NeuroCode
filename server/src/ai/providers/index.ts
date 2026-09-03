import { registerProvider } from "../ProviderRegistry";
import {
  cloudflareProvider,
  groqProvider,
  mistralProvider,
  openRouterProvider,
} from "./chain";
import { geminiProvider } from "./GeminiProvider";
import { mockProvider } from "./MockProvider";

/*
 * The provider manifest.
 *
 * Imported once, from AiRuntime, so registration happens before
 * anything can resolve a provider. Registration only means
 * "BuildGentic knows how to speak this protocol" — it says nothing
 * about who gets used, or in what order.
 *
 * That decision lives in providerChain.ts, which is the file to
 * edit to change routing. This one changes only when a vendor is
 * added or removed outright.
 */

let registered = false;

export function registerProviders(): void {
  if (registered) {
    return;
  }

  registerProvider(mockProvider);

  /* The cascade, in no particular order — priority is
     providerChain.ts's business, not the registry's. */
  registerProvider(groqProvider);
  registerProvider(cloudflareProvider);
  registerProvider(openRouterProvider);
  registerProvider(mistralProvider);

  /*
   * Embeddings only. Not in PROVIDER_CHAIN, so no completion can
   * route to it — it is registered purely so EmbeddingRuntime
   * can still ask it for the 768-dimension vectors that every
   * indexed chunk and stored memory was built with.
   */
  registerProvider(geminiProvider);

  registered = true;
}
