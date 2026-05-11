import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin /api in dev → Express on 5000 (avoids HTML index fallback when API URL is wrong).
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true
      }
    }
  }
});
