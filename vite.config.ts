import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      /*
       * The Express API listens on 3001. This previously pointed
       * at 5000 — a template default that never matched the
       * server — so the proxy silently did nothing and callers
       * hardcoded absolute localhost URLs instead.
       *
       * Overridable so a second copy of the stack can run
       * alongside the first — two branches, or a verification
       * run that must not borrow whatever is already on 3001.
       * The default is unchanged, so nothing needs configuring
       * to work the way it always has.
       */
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
