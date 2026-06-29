import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE || "/admin/",
  plugins: [react()],
  server: {
    port: 5181,
    strictPort: true,
    proxy: {
      "/admin": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
});
