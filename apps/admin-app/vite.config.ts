import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE || "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @st-lucie/ui ships .tsx source, not a build. Aliasing it to the source
      // path keeps it in the app's own transform pipeline — a bare specifier
      // would land in dep pre-bundling, which does not expect raw JSX.
      "@st-lucie/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  server: {
    port: 5181,
    strictPort: true,
    proxy: {
      // Proxy only the session-review API routes. A broad /admin proxy would
      // intercept the SPA's /admin/ base path before Vite can serve index.html.
      "/admin/health": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/admin/summary": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/admin/sessions": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      // Office-ops config APIs → services/office-ops (:3000). Both backends
      // must be running to exercise the whole dashboard locally.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
