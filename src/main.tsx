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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
