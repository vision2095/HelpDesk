import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/release/**", "**/.data/**"] },
    proxy: {
      "/api": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/downloads": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/releases": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/install.sh": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/install.ps1": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/hintlens-install.ps1": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/install-stealth.ps1": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
      "/download": process.env.LENSDESK_DEV_API_URL || "http://127.0.0.1:4318",
    },
  },
});
