import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/*
 * Self-hosted variable fonts.
 *
 * Bundled rather than fetched from Google at runtime: no
 * third-party request on load, no flash of fallback text.
 */
import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";

import "./index.css";

import App from "./App.tsx";
import { AuthProvider } from "./auth/AuthContext";

/*
 * A deploy deletes the previous build's chunks. A learner who
 * had the site open from before it then clicks into a page whose
 * chunk no longer exists, and the import fails — the screen
 * stays on the old page and nothing happens.
 *
 * Reloading fetches the new index.html, which names the new
 * chunks. Once per session, so a chunk that is genuinely
 * missing (or a network that is down) shows its error instead
 * of reloading forever.
 */
const RELOADED_KEY = "neurolink:chunk-reload";

window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem(RELOADED_KEY)) {
      return;
    }

    sessionStorage.setItem(RELOADED_KEY, "1");
  } catch {
    /* Storage blocked: reloading without the guard could loop. */
    return;
  }

  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
