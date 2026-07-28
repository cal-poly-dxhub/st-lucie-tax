import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @st-lucie/ui ships .tsx source, not a build. Aliasing it to the source
      // path keeps it in the app's own transform pipeline — a bare specifier
      // would land in dep pre-bundling, which does not expect raw JSX.
      "@st-lucie/ui": path.resolve(__dirname, "../packages/ui/src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
