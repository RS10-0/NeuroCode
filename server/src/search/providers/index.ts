import { registerSearchProvider } from "../SearchRegistry";
import { braveProvider } from "./BraveProvider";
import { duckDuckGoProvider } from "./DuckDuckGoProvider";
import { mockSearchProvider } from "./MockSearchProvider";
import { tavilyProvider } from "./TavilyProvider";

/*
 * Registration, once, at first use.
 *
 * The same shape as ai/providers/index.ts: idempotent, called
 * from the top of every entry point rather than from module
 * load order, so nothing depends on which file imported which
 * first.
 */

let registered = false;

export function registerSearchProviders(): void {
  if (registered) {
    return;
  }

  registerSearchProvider(mockSearchProvider);
  registerSearchProvider(duckDuckGoProvider);
  registerSearchProvider(braveProvider);
  registerSearchProvider(tavilyProvider);

  registered = true;
}
