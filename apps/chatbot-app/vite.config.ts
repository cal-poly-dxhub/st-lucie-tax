import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE || "/chat/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      "/chatbot": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
