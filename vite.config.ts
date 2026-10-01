import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Freebuff requires HMR to remain disabled.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: false,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
  },
});