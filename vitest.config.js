/* global process */
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Load .env.local so VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are available
  const env = loadEnv(mode ?? "test", process.cwd(), "");

  return {
    test: {
      globals: true,
      environment: "node",
      setupFiles: ["./tests/setup.js"],
      env,
      // Run integration tests sequentially to avoid Supabase rate limits
      // and keep stock assertions deterministic.
      // fileParallelism=false is required in Vitest 4.x (singleThread was removed).
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 30_000,
      include: ["tests/integration/**/*.test.js"],
      coverage: {
        provider: "v8",
        reporter: ["text", "json-summary"],
        include: ["src/**/*.{js,jsx}"],
      },
    },
  };
});
