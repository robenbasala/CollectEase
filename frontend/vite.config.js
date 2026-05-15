import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = String(env.VITE_BACKEND_PORT || "5000").trim() || "5000";
  const proxyTarget =
    String(env.VITE_DEV_API_PROXY || "").trim() || `http://127.0.0.1:${backendPort}`;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@collectease/transformation-ops": path.resolve(__dirname, "src/lib/transformationOpsRegistryClient.js")
      }
    },
    server: {
      port: 5173,
      proxy: {
        // Same-origin /api in dev when VITE_API_BASE_URL is empty → Express on VITE_BACKEND_PORT (default 5000).
        "/api": {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
